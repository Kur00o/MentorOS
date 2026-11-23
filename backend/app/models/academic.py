"""Signal source tables: academics, attendance, LMS, placement, scores, risk."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base
from backend.app.models.base import ProvenanceMixin, TimestampMixin, utcnow


class Subject(Base, ProvenanceMixin):
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False, index=True)
    semester: Mapped[int] = mapped_column(Integer, nullable=False)
    credits: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    kind: Mapped[str] = mapped_column(String(12), default="theory", nullable=False)
    faculty_name: Mapped[Optional[str]] = mapped_column(String(160))


class AttendanceRecord(Base, ProvenanceMixin):
    """Cumulative per-subject attendance for a student in a term."""

    __tablename__ = "attendance_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    total_classes: Mapped[int] = mapped_column(Integer, nullable=False)
    attended_classes: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(24), default="import", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    subject: Mapped[Subject] = relationship()

    __table_args__ = (
        UniqueConstraint("student_id", "subject_id", "period", name="uq_attendance_records_student_subject_period"),
        CheckConstraint("attended_classes >= 0 and total_classes >= 0 and attended_classes <= total_classes", name="counts"),
    )


class AttendanceWeekly(Base, ProvenanceMixin):
    """Week-by-week attendance (all subjects) — powers trend charts and the
    'attendance dropping' risk rule."""

    __tablename__ = "attendance_weekly"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    week_index: Mapped[int] = mapped_column(Integer, nullable=False)
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    classes_held: Mapped[int] = mapped_column(Integer, nullable=False)
    classes_attended: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "period", "week_index", name="uq_attendance_weekly_student_period_week"),
    )


class MarkRecord(Base, ProvenanceMixin):
    """Continuous-assessment marks (internals, assignments, labs)."""

    __tablename__ = "mark_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id", ondelete="CASCADE"), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    assessment: Mapped[str] = mapped_column(String(32), nullable=False)
    max_marks: Mapped[float] = mapped_column(Float, nullable=False)
    marks_obtained: Mapped[float] = mapped_column(Float, nullable=False)
    assessed_on: Mapped[Optional[date]] = mapped_column(Date)

    subject: Mapped[Subject] = relationship()

    __table_args__ = (
        UniqueConstraint("student_id", "subject_id", "period", "assessment", name="uq_mark_records_student_subject_period_assessment"),
        CheckConstraint("max_marks > 0 and marks_obtained >= 0 and marks_obtained <= max_marks", name="bounds"),
    )


class SemesterResult(Base, ProvenanceMixin):
    """Declared end-of-semester results (SGPA). Drives the Academic pillar."""

    __tablename__ = "semester_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    semester: Mapped[int] = mapped_column(Integer, nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    sgpa: Mapped[float] = mapped_column(Float, nullable=False)
    credits_earned: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    backlogs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "semester", name="uq_semester_results_student_semester"),
        CheckConstraint("sgpa >= 0 and sgpa <= 10", name="sgpa"),
    )


class LmsActivity(Base, ProvenanceMixin):
    """Term-level LMS engagement aggregate (drives the Engagement pillar)."""

    __tablename__ = "lms_activity"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    login_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assignments_submitted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    assignments_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    quizzes_attempted: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    avg_quiz_score: Mapped[Optional[float]] = mapped_column(Float)
    forum_posts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_active_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("student_id", "period", name="uq_lms_activity_student_period"),
        CheckConstraint("assignments_submitted <= assignments_total", name="assignments"),
    )


class LmsWeekly(Base, ProvenanceMixin):
    __tablename__ = "lms_weekly"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    week_index: Mapped[int] = mapped_column(Integer, nullable=False)
    logins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    submissions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    __table_args__ = (UniqueConstraint("student_id", "period", "week_index", name="uq_lms_weekly_student_period_week"),)


class PlacementProfile(Base, ProvenanceMixin):
    __tablename__ = "placement_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), unique=True, nullable=False)
    has_resume: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resume_path: Mapped[Optional[str]] = mapped_column(String(500))
    skills: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    certifications: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    internships: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mock_tests_taken: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    aptitude_score: Mapped[Optional[float]] = mapped_column(Float)
    target_role: Mapped[Optional[str]] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(16), default="not_started", nullable=False)
    linkedin_url: Mapped[Optional[str]] = mapped_column(String(300))
    github_url: Mapped[Optional[str]] = mapped_column(String(300))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    student: Mapped["Student"] = relationship(back_populates="placement_profile")  # noqa: F821

    __table_args__ = (
        CheckConstraint("status in ('not_started','preparing','applying','placed','higher_studies')", name="status"),
    )


class PlacementOffer(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "placement_offers"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    company: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(160), nullable=False)
    ctc_lpa: Mapped[Optional[float]] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="applied", nullable=False)
    stage_date: Mapped[Optional[date]] = mapped_column(Date)

    __table_args__ = (
        CheckConstraint("status in ('applied','shortlisted','interview','offered','accepted','rejected')", name="status"),
    )


class StudentSuccessScore(Base, ProvenanceMixin):
    """Append-only score history. Null components mean 'no source data'."""

    __tablename__ = "student_success_scores"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    week_index: Mapped[Optional[int]] = mapped_column(Integer)
    attendance_component: Mapped[Optional[float]] = mapped_column(Float)
    academic_component: Mapped[Optional[float]] = mapped_column(Float)
    engagement_component: Mapped[Optional[float]] = mapped_column(Float)
    placement_component: Mapped[Optional[float]] = mapped_column(Float)
    total_score: Mapped[Optional[float]] = mapped_column(Float)
    risk_category: Mapped[str] = mapped_column(String(20), nullable=False)
    trigger: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("ix_student_success_scores_student_computed", "student_id", "computed_at"),)


class RiskAlert(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "risk_alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    rule: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(8), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[Optional[str]] = mapped_column(Text)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False, index=True)
    resolved_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[Optional[str]] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("severity in ('high','medium','low')", name="severity"),
        CheckConstraint("status in ('open','acknowledged','resolved')", name="status"),
    )
