"""Database-backed scoring: gathers source signals in bulk, applies the pure
formula, appends history, mirrors the latest score onto `students` and runs
risk detection."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models import (
    AttendanceRecord,
    LmsActivity,
    PlacementProfile,
    Student,
    StudentSuccessScore,
)
from backend.app.scoring import formula


@dataclass
class StudentSignals:
    student_id: int
    department_id: int
    attendance_pairs: list[tuple[int, int]] = field(default_factory=list)
    sgpa: Optional[float] = None
    login_count: Optional[int] = None
    assignments_submitted: Optional[int] = None
    assignments_total: Optional[int] = None
    has_resume: bool = False
    skills_count: int = 0
    certifications_count: int = 0
    cohort_avg_logins: Optional[float] = None

    def score(self) -> formula.ScoreResult:
        return formula.compose(
            formula.attendance_component(self.attendance_pairs),
            formula.academic_component(self.sgpa),
            formula.engagement_component(
                self.login_count, self.cohort_avg_logins, self.assignments_submitted, self.assignments_total
            ),
            formula.placement_component(self.has_resume, self.skills_count, self.certifications_count),
        )


def gather_signals(db: Session, student_ids: Optional[Iterable[int]] = None, period: Optional[str] = None) -> dict[int, StudentSignals]:
    period = period or settings.SCORING_PERIOD
    q = select(Student.id, Student.department_id, Student.sgpa)
    ids = list(student_ids) if student_ids is not None else None
    if ids is not None:
        if not ids:
            return {}
        q = q.where(Student.id.in_(ids))
    signals = {sid: StudentSignals(sid, dept, sgpa=sgpa) for sid, dept, sgpa in db.execute(q)}
    if not signals:
        return {}
    sid_list = list(signals)

    for sid, attended, total in db.execute(
        select(AttendanceRecord.student_id, AttendanceRecord.attended_classes, AttendanceRecord.total_classes).where(
            AttendanceRecord.period == period, AttendanceRecord.student_id.in_(sid_list)
        )
    ):
        signals[sid].attendance_pairs.append((attended, total))

    for sid, logins, sub, tot in db.execute(
        select(LmsActivity.student_id, LmsActivity.login_count, LmsActivity.assignments_submitted, LmsActivity.assignments_total).where(
            LmsActivity.period == period, LmsActivity.student_id.in_(sid_list)
        )
    ):
        s = signals[sid]
        s.login_count, s.assignments_submitted, s.assignments_total = logins, sub, tot

    # Cohort = same department, same period (all students, not only this batch).
    cohort = {
        dept: float(avg)
        for dept, avg in db.execute(
            select(Student.department_id, func.avg(LmsActivity.login_count))
            .join(Student, Student.id == LmsActivity.student_id)
            .where(LmsActivity.period == period)
            .group_by(Student.department_id)
        )
        if avg is not None
    }
    for s in signals.values():
        s.cohort_avg_logins = cohort.get(s.department_id)

    for sid, has_resume, skills, certs in db.execute(
        select(PlacementProfile.student_id, PlacementProfile.has_resume, PlacementProfile.skills, PlacementProfile.certifications).where(
            PlacementProfile.student_id.in_(sid_list)
        )
    ):
        s = signals[sid]
        s.has_resume = bool(has_resume)
        s.skills_count = len(skills or [])
        s.certifications_count = len(certs or [])
    return signals


def compute_scores(db: Session, student_ids: Optional[Iterable[int]] = None, period: Optional[str] = None) -> dict[int, formula.ScoreResult]:
    return {sid: sig.score() for sid, sig in gather_signals(db, student_ids, period).items()}


def recompute(
    db: Session,
    student_ids: Optional[Iterable[int]] = None,
    *,
    period: Optional[str] = None,
    trigger: str = "manual",
    detect_risk: bool = True,
) -> dict:
    """Compute, persist history, mirror onto students, run risk rules."""
    from backend.app.scoring.risk import detect_for_students  # local import avoids a cycle

    period = period or settings.SCORING_PERIOD
    results = compute_scores(db, student_ids, period)
    if not results:
        return {"count": 0, "period": period, "bands": {}}
    now = datetime.now(timezone.utc)
    students = {s.id: s for s in db.scalars(select(Student).where(Student.id.in_(list(results))))}
    rows = []
    bands: dict[str, int] = defaultdict(int)
    for sid, res in results.items():
        st = students[sid]
        previous = st.success_score
        rows.append(
            StudentSuccessScore(
                student_id=sid,
                period=period,
                attendance_component=res.attendance_component,
                academic_component=res.academic_component,
                engagement_component=res.engagement_component,
                placement_component=res.placement_component,
                total_score=res.total_score,
                risk_category=res.risk_category,
                trigger=trigger,
                computed_at=now,
                is_synthetic=st.is_synthetic,
                batch_id=st.batch_id,
            )
        )
        st.score_delta = (
            round(res.total_score - previous, 2) if res.total_score is not None and previous is not None else None
        )
        st.success_score = res.total_score
        st.attendance_pct = res.attendance_component
        st.risk_category = res.risk_category
        st.score_updated_at = now
        bands[res.risk_category] += 1
    db.add_all(rows)
    db.flush()
    alerts = detect_for_students(db, list(results), period=period) if detect_risk else 0
    db.commit()
    return {"count": len(results), "period": period, "bands": dict(bands), "alerts_opened": alerts}
