"""Rule-based early-warning detection.

Each rule is explainable (it stores the evidence it used) and idempotent:
an open alert for the same (student, rule) is refreshed instead of
duplicated, and alerts whose condition has cleared are auto-resolved.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models import (
    AttendanceRecord,
    AttendanceWeekly,
    LmsActivity,
    MarkRecord,
    Meeting,
    RiskAlert,
    Student,
    Subject,
)
from backend.app.scoring.formula import ATTENDANCE_REQUIREMENT

RULES = {
    "low_attendance": "Attendance below the 75% requirement",
    "attendance_drop": "Attendance falling over recent weeks",
    "subject_shortage": "Subject-level attendance shortage",
    "low_internals": "Weak internal assessment marks",
    "score_drop": "Success Score dropped sharply",
    "lms_inactive": "Inactive on the LMS",
    "backlogs": "Active backlogs",
    "no_recent_meeting": "At-risk student without a recent mentor meeting",
}


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def evaluate(db: Session, student_ids: list[int], period: str) -> dict[int, dict[str, dict]]:
    """Return {student_id: {rule: {severity, title, detail, evidence}}} for
    every currently-firing rule."""
    now = datetime.now(timezone.utc)
    findings: dict[int, dict[str, dict]] = defaultdict(dict)
    students = {s.id: s for s in db.scalars(select(Student).where(Student.id.in_(student_ids)))}

    def fire(sid: int, rule: str, severity: str, detail: str, evidence: dict, title: Optional[str] = None):
        findings[sid][rule] = {"severity": severity, "title": title or RULES[rule], "detail": detail, "evidence": evidence}

    # Attendance (overall + per subject)
    per_student: dict[int, list[tuple[str, int, int]]] = defaultdict(list)
    for sid, code, name, attended, total in db.execute(
        select(AttendanceRecord.student_id, Subject.code, Subject.name, AttendanceRecord.attended_classes, AttendanceRecord.total_classes)
        .join(Subject, Subject.id == AttendanceRecord.subject_id)
        .where(AttendanceRecord.period == period, AttendanceRecord.student_id.in_(student_ids))
    ):
        per_student[sid].append((f"{code} · {name}", attended, total))
    for sid, rows in per_student.items():
        att = sum(r[1] for r in rows)
        tot = sum(r[2] for r in rows)
        if tot:
            pct = att / tot * 100
            if pct < ATTENDANCE_REQUIREMENT:
                fire(sid, "low_attendance", "high" if pct < 65 else "medium",
                     f"Overall attendance is {pct:.1f}%, below the {ATTENDANCE_REQUIREMENT:.0f}% exam-eligibility threshold.",
                     {"attendance_pct": round(pct, 1)})
        short = [(n, a / t * 100) for n, a, t in rows if t and a / t * 100 < ATTENDANCE_REQUIREMENT]
        if short and len(short) >= 1 and (not tot or att / tot * 100 >= ATTENDANCE_REQUIREMENT or len(short) >= 2):
            worst = sorted(short, key=lambda x: x[1])[:3]
            fire(sid, "subject_shortage", "medium" if len(short) < 3 else "high",
                 "Below 75% in " + ", ".join(f"{n} ({p:.0f}%)" for n, p in worst) + ("…" if len(short) > 3 else "."),
                 {"subjects": [{"subject": n, "pct": round(p, 1)} for n, p in short]})

    # Attendance trend: last 3 weeks vs the 3 before
    weekly: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    for sid, wk, held, att in db.execute(
        select(AttendanceWeekly.student_id, AttendanceWeekly.week_index, AttendanceWeekly.classes_held, AttendanceWeekly.classes_attended)
        .where(AttendanceWeekly.period == period, AttendanceWeekly.student_id.in_(student_ids))
    ):
        weekly[sid].append((wk, held, att))
    for sid, rows in weekly.items():
        rows.sort()
        if len(rows) >= 6:
            recent, before = rows[-3:], rows[-6:-3]
            r = sum(x[2] for x in recent) / max(1, sum(x[1] for x in recent)) * 100
            b = sum(x[2] for x in before) / max(1, sum(x[1] for x in before)) * 100
            if b - r >= 12:
                fire(sid, "attendance_drop", "high" if b - r >= 25 else "medium",
                     f"Attendance fell from {b:.0f}% to {r:.0f}% over the last three weeks.",
                     {"recent_pct": round(r, 1), "previous_pct": round(b, 1)})

    # Internal marks below 40% in any subject (aggregate over assessments)
    marks: dict[tuple[int, str], list[float]] = defaultdict(lambda: [0.0, 0.0])
    for sid, name, obtained, mx in db.execute(
        select(MarkRecord.student_id, Subject.name, MarkRecord.marks_obtained, MarkRecord.max_marks)
        .join(Subject, Subject.id == MarkRecord.subject_id)
        .where(MarkRecord.period == period, MarkRecord.student_id.in_(student_ids))
    ):
        agg = marks[(sid, name)]
        agg[0] += obtained
        agg[1] += mx
    weak: dict[int, list[tuple[str, float]]] = defaultdict(list)
    for (sid, name), (o, m) in marks.items():
        if m and o / m * 100 < 40:
            weak[sid].append((name, o / m * 100))
    for sid, items in weak.items():
        items.sort(key=lambda x: x[1])
        fire(sid, "low_internals", "high" if len(items) >= 2 else "medium",
             "Internal marks under 40% in " + ", ".join(f"{n} ({p:.0f}%)" for n, p in items[:3]) + ".",
             {"subjects": [{"subject": n, "pct": round(p, 1)} for n, p in items]})

    # LMS inactivity
    for sid, last_active in db.execute(
        select(LmsActivity.student_id, LmsActivity.last_active_at).where(
            LmsActivity.period == period, LmsActivity.student_id.in_(student_ids)
        )
    ):
        la = _aware(last_active)
        if la and now - la > timedelta(days=14):
            days = (now - la).days
            fire(sid, "lms_inactive", "medium" if days < 28 else "high",
                 f"No LMS activity for {days} days.", {"days_inactive": days})

    # Score drop, backlogs, missing meetings
    last_meeting: dict[int, datetime] = {}
    for sid, when in db.execute(
        select(Meeting.student_id, Meeting.scheduled_at).where(
            Meeting.student_id.in_(student_ids), Meeting.status == "completed"
        )
    ):
        when = _aware(when)
        if sid not in last_meeting or when > last_meeting[sid]:
            last_meeting[sid] = when
    for sid, st in students.items():
        if st.score_delta is not None and st.score_delta <= -8:
            fire(sid, "score_drop", "high" if st.score_delta <= -15 else "medium",
                 f"Success Score fell by {abs(st.score_delta):.1f} points since the last computation.",
                 {"delta": st.score_delta, "score": st.success_score})
        if st.active_backlogs:
            fire(sid, "backlogs", "high" if st.active_backlogs >= 2 else "low",
                 f"{st.active_backlogs} active backlog{'s' if st.active_backlogs != 1 else ''} to clear.",
                 {"active_backlogs": st.active_backlogs})
        if st.risk_category in ("amber", "coral") and st.mentor_id:
            lm = last_meeting.get(sid)
            if lm is None or now - lm > timedelta(days=45):
                fire(sid, "no_recent_meeting", "medium" if st.risk_category == "amber" else "high",
                     "No completed mentor meeting in the last 45 days." if lm else "No mentor meeting on record yet.",
                     {"last_meeting": lm.isoformat() if lm else None})
    return findings


def detect_for_students(db: Session, student_ids: list[int], period: Optional[str] = None,
                        on_new: Optional[Callable[[RiskAlert], None]] = None) -> int:
    period = period or settings.SCORING_PERIOD
    findings = evaluate(db, student_ids, period)
    existing = defaultdict(dict)
    for alert in db.scalars(
        select(RiskAlert).where(RiskAlert.student_id.in_(student_ids), RiskAlert.status != "resolved")
    ):
        existing[alert.student_id][alert.rule] = alert
    students = {s.id: s for s in db.scalars(select(Student).where(Student.id.in_(student_ids)))}
    now = datetime.now(timezone.utc)
    opened = 0
    for sid in student_ids:
        current = findings.get(sid, {})
        for rule, alert in existing[sid].items():
            if rule not in current:
                alert.status = "resolved"
                alert.resolved_at = now
                alert.resolution_note = "Auto-resolved: condition no longer detected."
        for rule, f in current.items():
            alert = existing[sid].get(rule)
            if alert:
                alert.severity, alert.title, alert.detail, alert.evidence = f["severity"], f["title"], f["detail"], f["evidence"]
            else:
                st = students[sid]
                alert = RiskAlert(student_id=sid, rule=rule, is_synthetic=st.is_synthetic, batch_id=st.batch_id, **f)
                db.add(alert)
                opened += 1
                if on_new:
                    on_new(alert)
    db.flush()
    return opened
