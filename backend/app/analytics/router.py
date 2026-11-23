from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.core.deps import Principal, require_department_scope, require_roles
from backend.app.models import (
    AttendanceRecord,
    AuditLog,
    DataBatch,
    Department,
    ImportJob,
    MarkRecord,
    Meeting,
    Mentor,
    PlacementOffer,
    PlacementProfile,
    RiskAlert,
    Student,
    StudentSuccessScore,
    Subject,
    User,
)
from backend.app.students.service import iso, list_rows

router = APIRouter()

BANDS = ("green", "amber", "coral", "insufficient_data")


def _avg(values) -> Optional[float]:
    vals = [v for v in values if v is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


def department_analytics(db: Session, dept_id: Optional[int]) -> dict:
    period = settings.SCORING_PERIOD
    now = datetime.now(timezone.utc)
    s_stmt = select(Student).where(Student.status == "active")
    if dept_id:
        s_stmt = s_stmt.where(Student.department_id == dept_id)
    students = db.scalars(s_stmt).all()
    ids = [s.id for s in students]
    by_id = {s.id: s for s in students}
    dept = db.get(Department, dept_id) if dept_id else None

    bands = Counter(s.risk_category for s in students)
    scored = [s.success_score for s in students if s.success_score is not None]

    # Latest components per student
    latest: dict[int, StudentSuccessScore] = {}
    weekly_totals: dict[int, list] = defaultdict(list)
    weekly_bands: dict[int, Counter] = defaultdict(Counter)
    if ids:
        for row in db.scalars(select(StudentSuccessScore).where(StudentSuccessScore.student_id.in_(ids)).order_by(StudentSuccessScore.computed_at)):
            latest[row.student_id] = row
            if row.period == period and row.week_index is not None:
                if row.total_score is not None:
                    weekly_totals[row.week_index].append(row.total_score)
                weekly_bands[row.week_index][row.risk_category] += 1
    components = {
        k: _avg(getattr(r, f"{k}_component") for r in latest.values())
        for k in ("attendance", "academic", "engagement", "placement")
    }
    trend = [
        {"week": w, "avg_score": _avg(weekly_totals[w]), **{b: weekly_bands[w].get(b, 0) for b in BANDS}}
        for w in sorted(set(weekly_totals) | set(weekly_bands))
    ]

    # Semester × band heatmap
    sem: dict[int, dict] = defaultdict(lambda: {"scores": [], **{b: 0 for b in BANDS}})
    for s in students:
        sem[s.semester][s.risk_category] += 1
        if s.success_score is not None:
            sem[s.semester]["scores"].append(s.success_score)
    semester_heatmap = [{"semester": k, "avg_score": _avg(v.pop("scores")), "total": sum(v[b] for b in BANDS), **v} for k, v in sorted(sem.items())]

    # Subject difficulty matrix
    subj: dict[int, dict] = defaultdict(lambda: {"att": [], "short": 0, "marks": defaultdict(lambda: [0.0, 0.0])})
    if ids:
        for sid, sub_id, a, t in db.execute(select(AttendanceRecord.student_id, AttendanceRecord.subject_id, AttendanceRecord.attended_classes,
                                                   AttendanceRecord.total_classes).where(AttendanceRecord.student_id.in_(ids), AttendanceRecord.period == period)):
            if t:
                pct = a / t * 100
                subj[sub_id]["att"].append(pct)
                subj[sub_id]["short"] += pct < 75
        for sid, sub_id, got, mx in db.execute(select(MarkRecord.student_id, MarkRecord.subject_id, MarkRecord.marks_obtained, MarkRecord.max_marks)
                                               .where(MarkRecord.student_id.in_(ids), MarkRecord.period == period)):
            agg = subj[sub_id]["marks"][sid]
            agg[0] += got
            agg[1] += mx
    sub_meta = {s.id: s for s in db.scalars(select(Subject).where(Subject.id.in_(list(subj))))} if subj else {}
    subjects = []
    for sub_id, v in subj.items():
        mark_pcts = [o / m * 100 for o, m in v["marks"].values() if m]
        s = sub_meta.get(sub_id)
        if not s:
            continue
        subjects.append({
            "subject_id": sub_id, "code": s.code, "name": s.name, "semester": s.semester, "faculty": s.faculty_name,
            "avg_attendance": _avg(v["att"]), "attendance_shortage": v["short"], "avg_marks": _avg(mark_pcts),
            "below_40": sum(1 for x in mark_pcts if x < 40), "students": len(v["att"]),
        })
    subjects.sort(key=lambda x: ((x["avg_marks"] or 100) + (x["avg_attendance"] or 100)))

    # Mentor workload & effectiveness
    m_stmt = select(Mentor)
    if dept_id:
        m_stmt = m_stmt.where(Mentor.department_id == dept_id)
    mentors = db.scalars(m_stmt).all()
    mentees: dict[int, list[Student]] = defaultdict(list)
    for s in students:
        if s.mentor_id:
            mentees[s.mentor_id].append(s)
    recent = defaultdict(set)
    meetings_30 = Counter()
    if mentors:
        for mid, sid, when, status in db.execute(select(Meeting.mentor_id, Meeting.student_id, Meeting.scheduled_at, Meeting.status)
                                                 .where(Meeting.mentor_id.in_([m.id for m in mentors]), Meeting.status == "completed")):
            when = when if when.tzinfo else when.replace(tzinfo=timezone.utc)
            if when >= now - timedelta(days=45):
                recent[mid].add(sid)
            if when >= now - timedelta(days=30):
                meetings_30[mid] += 1
    open_alerts_by_student = Counter()
    if ids:
        for (sid,) in db.execute(select(RiskAlert.student_id).where(RiskAlert.student_id.in_(ids), RiskAlert.status == "open")):
            open_alerts_by_student[sid] += 1
    mentor_rows = []
    for m in mentors:
        ms = mentees.get(m.id, [])
        mentor_rows.append({
            "id": m.id, "name": m.user.full_name, "designation": m.designation, "avatar_url": m.user.avatar_url,
            "load": len(ms), "capacity": m.max_mentees, "avg_score": _avg(s.success_score for s in ms),
            "avg_delta": _avg(s.score_delta for s in ms), "meetings_30d": meetings_30[m.id],
            "coverage": round(len(recent[m.id]) / len(ms) * 100) if ms else 0,
            "at_risk": sum(1 for s in ms if s.risk_category in ("amber", "coral")),
            "open_alerts": sum(open_alerts_by_student[s.id] for s in ms),
            "bands": {b: sum(1 for s in ms if s.risk_category == b) for b in BANDS},
        })
    mentor_rows.sort(key=lambda r: -r["load"])

    # Placement funnel
    profiles = db.scalars(select(PlacementProfile).where(PlacementProfile.student_id.in_(ids))).all() if ids else []
    status_counts = Counter(p.status for p in profiles)
    offers = db.scalars(select(PlacementOffer).where(PlacementOffer.student_id.in_(ids))).all() if ids else []
    offer_counts = Counter(o.status for o in offers)
    accepted = [o for o in offers if o.status in ("offered", "accepted")]
    final_year = [s for s in students if s.semester >= 7]
    placed_students = {o.student_id for o in offers if o.status == "accepted"}
    placement = {
        "statuses": {k: status_counts.get(k, 0) for k in ("not_started", "preparing", "applying", "placed", "higher_studies")},
        "with_resume": sum(1 for p in profiles if p.has_resume),
        "funnel": [
            {"stage": "Final-year students", "count": len(final_year)},
            {"stage": "Applied", "count": len({o.student_id for o in offers})},
            {"stage": "Shortlisted", "count": len({o.student_id for o in offers if o.status in ('shortlisted', 'interview', 'offered', 'accepted')})},
            {"stage": "Interviewed", "count": len({o.student_id for o in offers if o.status in ('interview', 'offered', 'accepted')})},
            {"stage": "Offers", "count": len({o.student_id for o in accepted})},
            {"stage": "Placed", "count": len(placed_students)},
        ],
        "offer_statuses": dict(offer_counts),
        "avg_ctc_lpa": _avg(o.ctc_lpa for o in accepted),
        "max_ctc_lpa": max((o.ctc_lpa or 0 for o in accepted), default=None),
        "top_companies": [{"company": c, "offers": n} for c, n in Counter(o.company for o in accepted).most_common(6)],
    }

    # Alerts by rule
    alerts = db.scalars(select(RiskAlert).where(RiskAlert.student_id.in_(ids), RiskAlert.status != "resolved")).all() if ids else []
    alert_rules = Counter(a.rule for a in alerts)
    attention = sorted(students, key=lambda s: ({"coral": 0, "amber": 1}.get(s.risk_category, 2), s.success_score if s.success_score is not None else 999))[:12]

    assigned = sum(1 for s in students if s.mentor_id)
    covered = sum(len(v) for v in recent.values())
    return {
        "department": {"id": dept.id, "code": dept.code, "name": dept.name} if dept else None,
        "period": period,
        "kpis": {
            "students": len(students), "avg_score": _avg(scored), "avg_attendance": _avg(s.attendance_pct for s in students),
            "avg_cgpa": _avg(s.cgpa for s in students), "at_risk": bands.get("amber", 0) + bands.get("coral", 0),
            "coral": bands.get("coral", 0), "open_alerts": len(alerts), "high_alerts": sum(1 for a in alerts if a.severity == "high"),
            "mentors": len(mentors), "assigned": assigned, "unassigned": len(students) - assigned,
            "meeting_coverage": round(covered / assigned * 100) if assigned else 0,
            "avg_delta": _avg(s.score_delta for s in students),
            "placement_ready": round(sum(1 for r in latest.values() if (r.placement_component or 0) >= 60) / len(students) * 100) if students else 0,
        },
        "bands": {b: bands.get(b, 0) for b in BANDS},
        "components": components,
        "trend": trend,
        "semesters": semester_heatmap,
        "subjects": subjects,
        "mentors": mentor_rows,
        "placement": placement,
        "alert_rules": [{"rule": r, "count": n} for r, n in alert_rules.most_common()],
        "attention": list_rows(db, attention),
        "score_distribution": [
            {"bucket": f"{lo}–{lo + 9}", "lo": lo, "count": sum(1 for v in scored if lo <= v < lo + 10 or (lo == 90 and v == 100))}
            for lo in range(20, 100, 10)
        ],
    }


@router.get("/department")
def department(department_id: Optional[int] = None, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    return department_analytics(db, require_department_scope(p, department_id))


@router.get("/institution")
def institution(p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    from backend.app.integrations.registry import integrations_overview

    depts = db.scalars(select(Department).order_by(Department.code)).all()
    cards = []
    for d in depts:
        rows = db.execute(select(Student.risk_category, Student.success_score, Student.mentor_id).where(Student.department_id == d.id, Student.status == "active")).all()
        scores = [r[1] for r in rows if r[1] is not None]
        cards.append({
            "id": d.id, "code": d.code, "name": d.name, "hod": d.hod.full_name if d.hod else None, "students": len(rows),
            "avg_score": _avg(scores), "bands": {b: sum(1 for r in rows if r[0] == b) for b in BANDS},
            "unassigned": sum(1 for r in rows if r[2] is None),
            "mentors": db.scalar(select(func.count(Mentor.id)).where(Mentor.department_id == d.id)) or 0,
            "is_synthetic": d.is_synthetic,
        })
    roles = dict(db.execute(select(User.role, func.count(User.id)).group_by(User.role)).all())
    logins = db.scalar(select(func.count(User.id)).where(User.auth_user_id.is_not(None))) or 0
    active_7d = db.scalar(select(func.count(User.id)).where(User.last_login_at >= datetime.now(timezone.utc) - timedelta(days=7))) or 0
    batches = []
    for b in db.scalars(select(DataBatch).order_by(DataBatch.id)):
        batches.append({"id": b.id, "label": b.label, "kind": b.kind, "description": b.description, "created_at": iso(b.created_at),
                        "students": db.scalar(select(func.count(Student.id)).where(Student.batch_id == b.id)) or 0})
    real_students = db.scalar(select(func.count(Student.id)).where(Student.is_synthetic.is_(False))) or 0
    imports = [{"id": j.id, "kind": j.kind, "source": j.source, "filename": j.filename, "rows": j.row_count, "ok": j.success_count,
                "status": j.status, "created_at": iso(j.created_at)} for j in db.scalars(select(ImportJob).order_by(ImportJob.created_at.desc()).limit(8))]
    activity = [{"id": a.id, "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id, "user_id": a.user_id,
                 "created_at": iso(a.created_at)} for a in db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(12))]
    users = {u.id: u.full_name for u in db.scalars(select(User).where(User.id.in_({a["user_id"] for a in activity if a["user_id"]})))}
    for a in activity:
        a["user_name"] = users.get(a["user_id"])
    summary = department_analytics(db, None)
    return {
        "departments": cards, "roles": roles, "logins_provisioned": logins, "active_7d": active_7d,
        "batches": batches, "real_students": real_students, "imports": imports, "activity": activity,
        "integrations": integrations_overview(), "kpis": summary["kpis"], "bands": summary["bands"], "trend": summary["trend"],
        "components": summary["components"],
    }
