"""Organisation, identity and people."""
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
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base
from backend.app.models.base import ProvenanceMixin, TimestampMixin, utcnow

ROLES = ("student", "mentor", "hod", "admin")
RISK_CATEGORIES = ("green", "amber", "coral", "insufficient_data")


class DataBatch(Base, TimestampMixin):
    """A provenance batch. `kind='synthetic'` rows are demo data and can be
    purged in one action without touching institutional records."""

    __tablename__ = "data_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    label: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="institutional")
    description: Mapped[Optional[str]] = mapped_column(Text)
    __table_args__ = (CheckConstraint("kind in ('synthetic','institutional')", name="kind"),)


class Department(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    hod_user_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", use_alter=True, name="fk_departments_hod_user_id_users")
    )

    hod: Mapped[Optional["User"]] = relationship(foreign_keys=[hod_user_id], post_update=True)


class AcademicTerm(Base):
    __tablename__ = "academic_terms"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)  # e.g. 2026-ODD
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class User(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    auth_user_id: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="student", index=True)
    department_id: Mapped[Optional[int]] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"), index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(32))
    avatar_url: Mapped[Optional[str]] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    department: Mapped[Optional[Department]] = relationship(foreign_keys=[department_id])
    student_profile: Mapped[Optional["Student"]] = relationship(back_populates="user", uselist=False)
    mentor_profile: Mapped[Optional["Mentor"]] = relationship(back_populates="user", uselist=False)

    __table_args__ = (CheckConstraint("role in ('student','mentor','hod','admin')", name="role"),)


class Mentor(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "mentors"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False, index=True)
    designation: Mapped[str] = mapped_column(String(80), default="Assistant Professor", nullable=False)
    specialization: Mapped[Optional[str]] = mapped_column(String(160))
    office: Mapped[Optional[str]] = mapped_column(String(80))
    max_mentees: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    is_accepting: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user: Mapped[User] = relationship(back_populates="mentor_profile")
    department: Mapped[Department] = relationship()
    students: Mapped[list["Student"]] = relationship(back_populates="mentor")

    __table_args__ = (CheckConstraint("max_mentees >= 0 and max_mentees <= 60", name="capacity"),)


class Student(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    usn: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False, index=True)
    mentor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("mentors.id", ondelete="SET NULL"), index=True)
    semester: Mapped[int] = mapped_column(Integer, nullable=False)
    section: Mapped[Optional[str]] = mapped_column(String(4))
    admission_year: Mapped[Optional[int]] = mapped_column(Integer)
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)
    gender: Mapped[Optional[str]] = mapped_column(String(16))
    home_city: Mapped[Optional[str]] = mapped_column(String(80))
    hostel_resident: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    guardian_name: Mapped[Optional[str]] = mapped_column(String(160))
    guardian_phone: Mapped[Optional[str]] = mapped_column(String(32))
    guardian_email: Mapped[Optional[str]] = mapped_column(String(255))
    bio: Mapped[Optional[str]] = mapped_column(Text)
    interests: Mapped[list] = mapped_column(JSON, default=list, nullable=False)

    # Academic standing (mirrors of the source tables for fast listing)
    cgpa: Mapped[Optional[float]] = mapped_column(Float)
    sgpa: Mapped[Optional[float]] = mapped_column(Float)  # latest completed semester
    active_backlogs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_under_18: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)

    # Latest Student Success Score mirror (history lives in student_success_scores)
    success_score: Mapped[Optional[float]] = mapped_column(Float)
    attendance_pct: Mapped[Optional[float]] = mapped_column(Float)
    risk_category: Mapped[str] = mapped_column(String(20), default="insufficient_data", nullable=False, index=True)
    score_delta: Mapped[Optional[float]] = mapped_column(Float)  # vs previous computation
    score_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="student_profile")
    department: Mapped[Department] = relationship()
    mentor: Mapped[Optional[Mentor]] = relationship(back_populates="students")
    consents: Mapped[list["StudentConsent"]] = relationship(back_populates="student", cascade="all, delete-orphan")
    placement_profile: Mapped[Optional["PlacementProfile"]] = relationship(back_populates="student", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("semester between 1 and 10", name="semester"),
        CheckConstraint("risk_category in ('green','amber','coral','insufficient_data')", name="risk"),
        CheckConstraint("status in ('active','on_leave','graduated','withdrawn')", name="status"),
    )


class StudentConsent(Base):
    """Per-category DPDP consent decision (one row per student × category)."""

    __tablename__ = "student_consents"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    consented: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notice_version: Mapped[str] = mapped_column(String(16), default="1.0", nullable=False)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    student: Mapped[Student] = relationship(back_populates="consents")

    __table_args__ = (
        CheckConstraint("category in ('academic','attendance','placement','wellness')", name="category"),
        UniqueConstraint("student_id", "category", name="uq_student_consents_student_category"),
    )



