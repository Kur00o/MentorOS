"""AI Companion — grounded, role-aware answers from live MentorOS data.

Pipeline: classify intent → gather facts the caller is allowed to see →
compose a grounded markdown answer + structured cards → (optionally) let an
LLM rephrase it using *only* those facts. Works with no LLM configured.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.companion.knowledge import retrieve
from backend.app.core.deps import Principal, scope_students
from backend.app.integrations import llm
from backend.app.models import Meeting, Student, User
from backend.app.scoring import formula
from backend.app.students.service import build_overview, list_rows

BAND_LABEL = {"green": "Green · on track", "amber": "Amber · emerging risk", "coral": "Coral · critical", "insufficient_data": "Insufficient data"}
PILLAR_LABEL = {"attendance": "Attendance", "academic": "Academic", "engagement": "Engagement", "placement": "Placement"}


@dataclass
class Reply:
    answer: str
    intent: str
    cards: list[dict] = field(default_factory=list)
    suggestions: list[str] = field(default_factory=list)
    sources: list[dict] = field(default_factory=list)
    facts: dict = field(default_factory=dict)
    provider: str = "grounded"


INTENTS = [
    ("whatif", r"\bwhat if\b|\bif (i|my)\b.*\b(\d{1,3}(\.\d+)?)\b|simulat"),
    ("attendance", r"attend|bunk|skip|miss(ed)? class|absent|75 ?%|shortage"),
    ("improve", r"improv|focus|raise|increase|boost|better|tips?|advice|what should i|how can i|plan"),
    ("score", r"\bscore\b|how am i doing|my status|risk|band|coral|amber|green|standing"),
    ("marks", r"\bmarks?\b|internal|sgpa|cgpa|gpa|grade|exam|backlog|result"),
    ("placement", r"placement|resume|\bcv\b|skill|certif|intern|job|company|offer"),
    ("workload", r"workload|overload|capacity|mentor load|allocation|unassigned|allocate"),
    ("meeting", r"meeting|mentor\b|session|appointment|action item|schedule|next"),
    ("attention", r"attention|at[- ]risk|struggl|who (needs|should)|priorit|worr|concern|critical|urgent"),
    ("brief", r"brief|prepare|prep\b|talking points|before (my|the) meeting|summar(y|ise|ize) (of )?\w+"),
    ("subjects", r"subject|course|difficult|hardest|which paper"),
    ("department", r"department|overview|summary|trend|how is (the )?(dept|department|cohort|batch)"),
    ("system", r"system|integration|status|import|health|users?\b|data source|synthetic"),
]


def classify(message: str, role: str) -> str:
    text = message.lower()
    for intent, pattern in INTENTS:
        if re.search(pattern, text):
            if intent == "score" and role != "student" and not re.search(r"\bmy\b", text):
                return "attention" if role == "mentor" else "department"
            return intent
    return "help"


def _fmt(v, suffix="", nd=1) -> str:
    return "—" if v is None else f"{v:.{nd}f}{suffix}"


def _delta_text(delta) -> str:
    return "" if delta is None else f" ({delta:+.1f} since last computation)"


def _first_name(name: str) -> str:
    return name.split()[0] if name else "there"


# ── student-facing ─────────────────────────────────────────────────────────
def _recommendations(ov: dict) -> list[dict]:
    recs = []
    att = ov["attendance"]
    if att["overall_pct"] is not None and att["overall_pct"] < 75:
        recs.append({"pillar": "attendance", "impact": "high",
                     "text": f"Attend the next **{att['needed_for_75']} classes** without a break to get back to 75% (you are at {att['overall_pct']}%)."})
    short = [s for s in att["subjects"] if s["pct"] is not None and s["pct"] < 75]
    for s in sorted(short, key=lambda x: x["pct"])[:2]:
        recs.append({"pillar": "attendance", "impact": "high" if s["pct"] < 65 else "medium",
                     "text": f"{s['name']}: {s['pct']}% — attend {s['needed_for_75']} more classes in a row to clear 75%."})
    weak = [s for s in ov["academics"]["subjects"] if s["pct"] is not None and s["pct"] < 50]
    for s in sorted(weak, key=lambda x: x["pct"])[:2]:
        recs.append({"pillar": "academic", "impact": "high" if s["pct"] < 40 else "medium",
                     "text": f"{s['name']} internals are at {s['pct']}%. Book time with the subject faculty before the next assessment."})
    if ov["academics"]["active_backlogs"]:
        recs.append({"pillar": "academic", "impact": "high", "text": f"Plan to clear your {ov['academics']['active_backlogs']} active backlog(s) — ask your mentor about supplementary exams."})
    eng = ov["engagement"]
    if eng["assignments_total"]:
        missing = eng["assignments_total"] - (eng["assignments_submitted"] or 0)
        if missing > 0:
            recs.append({"pillar": "engagement", "impact": "medium",
                         "text": f"Submit the **{missing} pending LMS assignment(s)** — submission rate is half of your Engagement pillar."})
    if eng["login_count"] is not None and eng["cohort_avg_logins"] and eng["login_count"] < eng["cohort_avg_logins"] * 0.8:
        recs.append({"pillar": "engagement", "impact": "low",
                     "text": f"Log into the LMS more regularly: {eng['login_count']} logins vs a department average of {eng['cohort_avg_logins']:.0f}."})
    pl = ov["placement"]
    if not pl["has_resume"]:
        recs.append({"pillar": "placement", "impact": "medium", "text": "Upload your resume — it is worth **40 points** of the Placement pillar on its own."})
    if len(pl["skills"]) < 5:
        recs.append({"pillar": "placement", "impact": "low", "text": f"Add {5 - len(pl['skills'])} more skill(s) to your placement profile (+8 points each)."})
    if len(pl["certifications"]) < 5:
        recs.append({"pillar": "placement", "impact": "low", "text": f"Each certification adds 4 points — you have {len(pl['certifications'])} of 5 counted."})
    order = {"high": 0, "medium": 1, "low": 2}
    weakest = ov["score"]["weakest"]
    recs.sort(key=lambda r: (order[r["impact"]], r["pillar"] != weakest))
    return recs[:5]


def _score_card(ov: dict) -> dict:
    return {"type": "score", "total": ov["score"]["total"], "band": ov["score"]["band"], "delta": ov["score"]["delta"],
            "components": ov["score"]["components"], "weights": ov["score"]["weights"]}


def student_reply(db: Session, p: Principal, intent: str, message: str) -> Reply:
    st = db.get(Student, p.student_id)
    ov = build_overview(db, st, p)
    name = _first_name(ov["profile"]["name"])
    sc = ov["score"]
    comps = sc["components"]
    facts = {"student": ov["profile"]["name"], "score": sc["total"], "band": sc["band"], "delta": sc["delta"], "components": comps,
             "weakest": sc["weakest"], "attendance_pct": ov["attendance"]["overall_pct"], "sgpa": ov["academics"]["sgpa"],
             "cgpa": ov["academics"]["cgpa"], "backlogs": ov["academics"]["active_backlogs"]}

    if intent == "whatif":
        nums = [float(n) for n in re.findall(r"\d{1,3}(?:\.\d+)?", message)]
        target = {"attendance": comps["attendance"], "academic": comps["academic"], "engagement": comps["engagement"], "placement": comps["placement"]}
        text = message.lower()
        changed = []
        if nums:
            if "sgpa" in text or "gpa" in text:
                target["academic"] = formula.academic_component(min(nums[0], 10))
                changed.append(f"SGPA {min(nums[0], 10)}")
            elif "engage" in text or "lms" in text:
                target["engagement"] = min(nums[0], 100)
                changed.append(f"engagement {min(nums[0], 100):.0f}")
            elif "placement" in text:
                target["placement"] = min(nums[0], 100)
                changed.append(f"placement {min(nums[0], 100):.0f}")
            else:
                target["attendance"] = min(nums[0], 100)
                changed.append(f"attendance {min(nums[0], 100):.0f}%")
        sim = formula.compose(target["attendance"], target["academic"], target["engagement"], target["placement"])
        diff = (sim.total_score or 0) - (sc["total"] or 0)
        answer = (f"If your {', '.join(changed) or 'inputs stay the same'}, your Success Score would be **{_fmt(sim.total_score)}** "
                  f"({'+' if diff >= 0 else ''}{diff:.1f}) — **{BAND_LABEL[sim.risk_category]}**.\n\n"
                  "Try the What-if simulator on your dashboard to move all four pillars at once.")
        card = {"type": "score", "total": sim.total_score, "band": sim.risk_category, "delta": round(diff, 1),
                "components": {k: target[k] for k in target}, "weights": formula.WEIGHTS, "simulated": True}
        return Reply(answer, intent, [card], ["What should I focus on?", "How many classes can I miss?"], facts=facts)

    if intent == "attendance":
        att = ov["attendance"]
        lines = [f"Your overall attendance this term is **{_fmt(att['overall_pct'], '%')}** ({att['attended']}/{att['total']} classes)."]
        if att["overall_pct"] is not None:
            if att["overall_pct"] >= 75:
                lines.append(f"You can miss up to **{att['can_skip']} classes** overall and still stay at or above 75% — but subject-level attendance matters too.")
            else:
                lines.append(f"You need **{att['needed_for_75']} consecutive classes** to get back to the 75% exam-eligibility line.")
        short = [s for s in att["subjects"] if s["pct"] is not None and s["pct"] < 75]
        if short:
            lines.append("\n**Subjects below 75%:**")
            lines += [f"- {s['name']} — {s['pct']}% · attend {s['needed_for_75']} in a row" for s in sorted(short, key=lambda x: x["pct"])]
        else:
            lines.append("\nEvery subject is above 75%. 🎯")
        rows = [{"label": s["name"], "value": s["pct"], "hint": f"{s['attended']}/{s['total']}"} for s in att["subjects"]]
        return Reply("\n".join(lines), intent, [{"type": "bars", "title": "Attendance by subject", "unit": "%", "threshold": 75, "rows": rows}],
                     ["What if my attendance was 85%?", "What should I focus on?"], facts=facts)

    if intent == "marks":
        ac = ov["academics"]
        lines = [f"Latest SGPA **{_fmt(ac['sgpa'], nd=2)}** · CGPA **{_fmt(ac['cgpa'], nd=2)}** · active backlogs **{ac['active_backlogs']}**.",
                 f"Your Academic pillar is {_fmt(comps['academic'])} (SGPA × 10)."]
        if ac["subjects"]:
            lines.append("\n**Internal assessments this term:**")
            lines += [f"- {s['name']}: {s['obtained']}/{s['max']} ({s['pct']}%)" for s in ac["subjects"]]
        rows = [{"label": s["name"], "value": s["pct"], "hint": f"{s['obtained']}/{s['max']}"} for s in ac["subjects"]]
        return Reply("\n".join(lines), intent, [{"type": "bars", "title": "Internal marks", "unit": "%", "threshold": 40, "rows": rows}],
                     ["How is the Academic pillar calculated?", "What should I focus on?"], facts=facts)

    if intent == "placement":
        pl = ov["placement"]
        lines = [f"Your Placement readiness pillar is **{_fmt(comps['placement'])} / 100**.",
                 f"- Resume: {'uploaded ✓' if pl['has_resume'] else 'missing (+40 when uploaded)'}",
                 f"- Skills listed: {len(pl['skills'])} (5 count, 8 points each)",
                 f"- Certifications: {len(pl['certifications'])} (5 count, 4 points each)"]
        if pl["offers"]:
            lines.append("\n**Applications:** " + ", ".join(f"{o['company']} ({o['status']})" for o in pl["offers"][:5]))
        return Reply("\n".join(lines), intent, [], ["How do I improve my placement score?", "What should I focus on?"], facts=facts)

    if intent == "meeting":
        mentor = ov["mentor"]
        if not mentor:
            return Reply("You don't have a mentor assigned yet. Your HOD runs allocation and prioritises at-risk students first.", intent, facts=facts)
        lines = [f"Your mentor is **{mentor['name']}** ({mentor['designation']}{', ' + mentor['office'] if mentor.get('office') else ''})."]
        up = ov["meetings"]["upcoming"]
        cards = []
        if up:
            m = up[0]
            when = datetime.fromisoformat(m["scheduled_at"]).strftime("%a %d %b · %H:%M UTC")
            lines.append(f"Next session: **{m['title']}** — {when} ({m['mode'].replace('_', ' ')}){' · ' + m['status'] if m['status'] == 'requested' else ''}.")
            cards.append({"type": "meeting", **m})
        else:
            lines.append("You have no upcoming session — you can request one from the Meetings page.")
        acts = ov["meetings"]["open_action_items"]
        if acts:
            lines.append(f"\nYou have **{len(acts)} open action item(s)**:")
            lines += [f"- {a['text']}{' (due ' + a['due'] + ')' if a.get('due') else ''}" for a in acts[:5]]
            cards.append({"type": "actions", "items": acts[:6]})
        return Reply("\n".join(lines), intent, cards, ["Request a meeting", "What should I focus on?"], facts=facts)

    if intent in ("improve", "score"):
        recs = _recommendations(ov)
        delta = sc["delta"]
        trend = "" if delta is None else (f" — up {delta:.1f}" if delta > 0 else (f" — down {abs(delta):.1f}" if delta < 0 else " — unchanged"))
        lines = []
        if intent == "score":
            lines.append(f"Hi {name}, your Success Score is **{_fmt(sc['total'])}**{trend}, which is **{BAND_LABEL[sc['band']]}**.")
            lines.append("\n| Pillar | Score | Weight |\n|---|---|---|")
            lines += [f"| {PILLAR_LABEL[k]} | {_fmt(comps[k])} | {int(formula.WEIGHTS[k] * 100)}% |" for k in formula.WEIGHTS]
            if sc["weakest"]:
                lines.append(f"\nThe biggest lever is **{PILLAR_LABEL[sc['weakest']]}** — improving it moves your score the most.")
        else:
            lines.append(f"Here's where effort pays off most for you, {name}:")
        if recs:
            lines.append("\n**Next steps**")
            lines += [f"{i}. {r['text']}" for i, r in enumerate(recs, 1)]
        return Reply("\n".join(lines), intent, [_score_card(ov)] + ([{"type": "recommendations", "items": recs}] if recs and intent == "improve" else []),
                     ["How many classes can I miss?", "What if my SGPA was 8.5?", "When is my next meeting?"], facts=facts)

    return Reply("", intent, facts=facts)


# ── staff-facing ───────────────────────────────────────────────────────────
def _find_student(db: Session, p: Principal, message: str) -> Optional[Student]:
    usn = re.search(r"\b(DEMO\w{4,}|[A-Z0-9]{2,}\d{2}[A-Z]{2,}\d{2,})\b", message.upper())
    stmt = scope_students(select(Student).join(User, User.id == Student.user_id), p)
    if usn:
        st = db.scalar(stmt.where(func.upper(Student.usn) == usn.group(1)))
        if st:
            return st
    words = [w for w in re.findall(r"[A-Za-z]{3,}", message) if w.lower() not in {
        "how", "is", "doing", "brief", "prepare", "for", "meeting", "with", "about", "the", "student", "tell", "me", "what", "next",
        "summary", "summarise", "summarize", "talking", "points", "my", "mentee", "who", "needs", "attention", "show", "give", "status"}]
    for w in words:
        st = db.scalar(stmt.where(func.lower(User.full_name).like(f"%{w.lower()}%")).limit(1))
        if st:
            return st
    return None


def _student_brief(db: Session, p: Principal, st: Student) -> Reply:
    ov = build_overview(db, st, p)
    sc = ov["score"]
    name = ov["profile"]["name"]
    open_alerts = [a for a in ov["alerts"] if a["status"] != "resolved"]
    lines = [f"**{name}** ({ov['profile']['usn']}, Sem {ov['profile']['semester']}) — Success Score **{_fmt(sc['total'])}**, "
             f"{BAND_LABEL[sc['band']]}{_delta_text(sc['delta'])}."]
    lines.append(f"Attendance {_fmt(ov['attendance']['overall_pct'], '%')} · SGPA {_fmt(ov['academics']['sgpa'], nd=2)} · "
                 f"backlogs {ov['academics']['active_backlogs']} · LMS submissions {ov['engagement']['assignments_submitted'] or 0}/{ov['engagement']['assignments_total'] or 0}.")
    if open_alerts:
        lines.append("\n**Open alerts**")
        lines += [f"- [{a['severity']}] {a['title']}: {a['detail']}" for a in open_alerts[:5]]
    past = [m for m in ov["meetings"]["past"] if m["log"]]
    if past:
        last = past[0]
        lines.append(f"\n**Last session** ({datetime.fromisoformat(last['scheduled_at']).strftime('%d %b')}): {last['log']['summary']}")
    acts = ov["meetings"]["open_action_items"]
    if acts:
        lines.append("**Still open:** " + "; ".join(a["text"] for a in acts[:4]))
    points = []
    for r in _recommendations(ov)[:3]:
        points.append(re.sub(r"\*\*", "", r["text"]).replace("you are", "they are").replace("Your ", "Their ").replace("your ", "their ").replace("you ", "they "))
    if points:
        lines.append("\n**Suggested talking points**")
        lines += [f"{i}. {t}" for i, t in enumerate(points, 1)]
    card = {"type": "student", "id": st.id, "name": name, "usn": st.usn, "score": sc["total"], "band": sc["band"], "delta": sc["delta"],
            "components": sc["components"], "alerts": len(open_alerts)}
    return Reply("\n".join(lines), "brief", [card], [f"Schedule a meeting with {_first_name(name)}", "Who else needs attention?"],
                 facts={"student": name, "score": sc["total"], "band": sc["band"], "alerts": [a["title"] for a in open_alerts]})


def staff_reply(db: Session, p: Principal, intent: str, message: str) -> Reply:
    from backend.app.analytics.router import department_analytics

    if intent in ("brief", "score", "attendance", "marks", "placement") or (intent == "help" and _find_student(db, p, message)):
        st = _find_student(db, p, message)
        if st:
            return _student_brief(db, p, st)
        if intent == "brief":
            return Reply("Tell me which student — e.g. *“Brief me on Aarav”* or a USN like *DEMO23CSE004*.", intent)

    if intent in ("attention", "score") and p.role == "mentor" or (intent == "attention"):
        stmt = scope_students(select(Student), p).where(Student.risk_category.in_(("coral", "amber")))
        rows = list_rows(db, db.scalars(stmt).all())
        rows.sort(key=lambda r: (-r["high_alerts"], {"coral": 0, "amber": 1}.get(r["band"], 2), r["score"] or 0))
        if not rows:
            return Reply("Nobody in your scope is Amber or Coral right now. 🌿", intent)
        lines = [f"**{len(rows)} student(s)** need attention — {sum(1 for r in rows if r['band'] == 'coral')} Coral, "
                 f"{sum(1 for r in rows if r['band'] == 'amber')} Amber. Highest priority first:"]
        for r in rows[:6]:
            last = f"last met {datetime.fromisoformat(r['last_meeting_at']).strftime('%d %b')}" if r["last_meeting_at"] else "no meeting on record"
            lines.append(f"- **{r['name']}** ({r['usn']}) — {_fmt(r['score'])}, {r['band']}, attendance {_fmt(r['attendance_pct'], '%')}, "
                         f"{r['open_alerts']} alert(s), {last}")
        return Reply("\n".join(lines), intent, [{"type": "students", "title": "Needs attention", "rows": rows[:8]}],
                     [f"Brief me on {rows[0]['name'].split()[0]}", "Which subjects are hardest?"],
                     facts={"count": len(rows), "top": [r["name"] for r in rows[:6]]})

    if intent == "meeting":
        stmt = select(Meeting).join(Student, Student.id == Meeting.student_id).where(
            Meeting.status.in_(("scheduled", "requested")), Meeting.scheduled_at >= datetime.now(timezone.utc))
        stmt = stmt.where(Meeting.mentor_id == p.mentor_id) if p.role == "mentor" else scope_students(stmt, p)
        meetings = db.scalars(stmt.order_by(Meeting.scheduled_at).limit(6)).all()
        if not meetings:
            return Reply("No upcoming sessions on the calendar.", intent, suggestions=["Who needs attention?"])
        names = dict(db.execute(select(Student.id, User.full_name).join(User, User.id == Student.user_id).where(Student.id.in_([m.student_id for m in meetings]))).all())
        lines = ["**Upcoming sessions**"] + [
            f"- {m.scheduled_at.strftime('%a %d %b %H:%M')} — {names.get(m.student_id)}: {m.title}{' *(requested)*' if m.status == 'requested' else ''}" for m in meetings]
        return Reply("\n".join(lines), intent, suggestions=[f"Brief me on {names.get(meetings[0].student_id, '').split()[0]}"])

    if p.role in ("hod", "admin") and intent in ("department", "workload", "subjects", "placement", "help", "improve"):
        a = department_analytics(db, p.department_id if p.role == "hod" else None)
        k = a["kpis"]
        scope = a["department"]["name"] if a["department"] else "the institution"
        if intent == "workload":
            over = [m for m in a["mentors"] if m["load"] >= m["capacity"]]
            lines = [f"**Mentor workload in {scope}** — {k['assigned']} of {k['students']} students assigned, {k['unassigned']} waiting."]
            lines += [f"- {m['name']}: {m['load']}/{m['capacity']} mentees · {m['at_risk']} at risk · coverage {m['coverage']}%" for m in a["mentors"][:8]]
            if over:
                lines.append(f"\n{len(over)} mentor(s) are at capacity. Use auto-allocation to place the {k['unassigned']} waiting student(s) with the least-loaded mentors.")
            return Reply("\n".join(lines), intent, [{"type": "bars", "title": "Mentor load", "unit": "", "rows": [
                {"label": m["name"], "value": m["load"], "max": m["capacity"]} for m in a["mentors"]]}], ["Who needs attention?"], facts={"mentors": a["mentors"][:8]})
        if intent == "subjects":
            subs = a["subjects"][:6]
            lines = [f"**Hardest subjects in {scope}** (lowest combined marks + attendance):"]
            lines += [f"- {s['code']} {s['name']}: marks {_fmt(s['avg_marks'], '%')}, attendance {_fmt(s['avg_attendance'], '%')}, "
                      f"{s['below_40']} below 40%, {s['attendance_shortage']} below 75% attendance" for s in subs]
            return Reply("\n".join(lines), intent, [{"type": "bars", "title": "Average internal marks", "unit": "%", "threshold": 40,
                                                     "rows": [{"label": s["code"], "value": s["avg_marks"]} for s in subs]}], facts={"subjects": subs})
        if intent == "placement":
            pl = a["placement"]
            lines = [f"**Placement in {scope}** — {pl['with_resume']} students have resumes on file."]
            lines += [f"- {f['stage']}: {f['count']}" for f in pl["funnel"]]
            if pl["avg_ctc_lpa"]:
                lines.append(f"\nAverage offer {pl['avg_ctc_lpa']} LPA · highest {pl['max_ctc_lpa']} LPA.")
            return Reply("\n".join(lines), intent, facts={"placement": pl})
        b = a["bands"]
        lines = [f"**{scope}** · {k['students']} students · average score **{_fmt(k['avg_score'])}** "
                 f"({'+' if (k['avg_delta'] or 0) >= 0 else ''}{_fmt(k['avg_delta'])} vs last computation).",
                 f"- Green {b['green']} · Amber {b['amber']} · Coral {b['coral']} · Insufficient {b['insufficient_data']}",
                 f"- Average attendance {_fmt(k['avg_attendance'], '%')} · {k['high_alerts']} high-severity alerts open",
                 f"- {k['unassigned']} student(s) without a mentor · meeting coverage {k['meeting_coverage']}% (45 days)"]
        if a["alert_rules"]:
            lines.append("- Most common alert: " + a["alert_rules"][0]["rule"].replace("_", " "))
        return Reply("\n".join(lines), "department", [{"type": "bands", **b}],
                     ["Which mentor is overloaded?", "Which subjects are hardest?", "Who needs attention?"], facts={"kpis": k, "bands": b})

    if p.role == "admin" and intent == "system":
        from backend.app.integrations.registry import integrations_overview

        items = integrations_overview()
        users = dict(db.execute(select(User.role, func.count(User.id)).group_by(User.role)).all())
        synthetic = db.scalar(select(func.count(Student.id)).where(Student.is_synthetic.is_(True))) or 0
        lines = ["**System status**"] + [f"- {i['label']}: {i['status'].replace('_', ' ')} — {i['message']}" for i in items]
        lines.append(f"\nUsers: " + ", ".join(f"{v} {k}" for k, v in users.items()) + f" · {synthetic} synthetic students.")
        return Reply("\n".join(lines), intent, facts={"integrations": [(i["key"], i["status"]) for i in items]})

    if p.role == "mentor" and intent in ("help", "improve", "department", "workload"):
        stmt = select(Student).where(Student.mentor_id == p.mentor_id)
        rows = list_rows(db, db.scalars(stmt).all())
        b = {x: sum(1 for r in rows if r["band"] == x) for x in ("green", "amber", "coral", "insufficient_data")}
        scores = [r["score"] for r in rows if r["score"] is not None]
        lines = [f"You mentor **{len(rows)} students** — average score {_fmt(sum(scores) / len(scores) if scores else None)}.",
                 f"Green {b['green']} · Amber {b['amber']} · Coral {b['coral']}.",
                 "\nAsk me *who needs attention*, *brief me on <name>*, or *what's on my calendar*."]
        return Reply("\n".join(lines), "roster", [{"type": "bands", **b}], ["Who needs attention?", "What's on my calendar?"])

    return Reply("", intent)


HELP = {
    "student": ["How am I doing?", "How many classes can I miss?", "What should I focus on?", "What if my SGPA was 8.5?"],
    "mentor": ["Who needs attention?", "Brief me on my next meeting", "What's on my calendar?", "How is the score calculated?"],
    "hod": ["Department summary", "Which mentor is overloaded?", "Which subjects are hardest?", "Who needs attention?"],
    "admin": ["System status", "Institution summary", "Who needs attention?", "How does consent work?"],
}

SYSTEM_PROMPT = """You are the MentorOS Companion, an academic mentoring assistant inside an Indian engineering institute's mentoring platform.
Rules:
- Use ONLY the FACTS and KNOWLEDGE provided. Never invent numbers, names, dates or policies.
- If the facts do not answer the question, say so briefly and suggest what the user can ask.
- The DRAFT is a correct, grounded answer; you may rephrase it to be warmer and clearer, but keep every number identical.
- Be concise (under 180 words), encouraging, and practical. Use markdown (short lists, bold key numbers).
- The viewer's role is {role}. Never reveal data about students outside the facts."""


def answer(db: Session, p: Principal, message: str, history: list[dict]) -> Reply:
    intent = classify(message, p.role)
    reply = Reply("", intent)
    if p.role == "student" and p.student_id and intent not in ("help",):
        reply = student_reply(db, p, intent, message)
    elif p.role != "student":
        reply = staff_reply(db, p, intent, message)

    kb = retrieve(db, message, k=2)
    explanatory = re.search(r"calculat|\bmean|policy|\brule|consent|privacy|explain|how does|how do (i|mentors)|what is the|what are|requirement|work\b", message.lower())
    if kb and (not reply.answer or explanatory):
        kb_text = "\n\n".join(f"**{c['title']}**\n{c['body']}" for c in kb)
        reply.answer = kb_text if not reply.answer else f"{kb_text}\n\n---\n\n{reply.answer}"
        reply.sources = [{"title": c["title"], "source": c["source"]} for c in kb]
    if not reply.answer:
        reply.answer = ("I can help with your MentorOS data. Try one of these:\n" + "\n".join(f"- {s}" for s in HELP.get(p.role, [])))
        reply.intent = "help"
    if not reply.suggestions:
        reply.suggestions = HELP.get(p.role, [])[:3]

    llm_reply = llm.complete(
        SYSTEM_PROMPT.format(role=p.role),
        [*history[-6:], {"role": "user", "content": (
            f"QUESTION: {message}\n\nFACTS (JSON): {json.dumps(reply.facts, default=str)[:6000]}\n\n"
            f"KNOWLEDGE: {json.dumps(kb, default=str)[:3000]}\n\nDRAFT:\n{reply.answer}")}],
    )
    if llm_reply:
        reply.answer, reply.provider = llm_reply.text, f"{llm_reply.provider}:{llm_reply.model}"
    return reply

