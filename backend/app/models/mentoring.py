"""Mentoring workflow + system tables."""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base
from backend.app.models.base import ProvenanceMixin, TimestampMixin, utcnow


class Allocation(Base, ProvenanceMixin):
    """Mentor-allocation history. The live assignment is `students.mentor_id`;
    this table records who assigned whom, when and how."""

    __tablename__ = "allocations"

    id: Mapped[int] = mapped_column(primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    mentor_id: Mapped[int] = mapped_column(ForeignKey("mentors.id", ondelete="CASCADE"), nullable=False, index=True)
    allocated_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    method: Mapped[str] = mapped_column(String(12), default="manual", nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(300))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    __table_args__ = (CheckConstraint("method in ('auto','manual','import','seed')", name="method"),)


class Meeting(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    mentor_id: Mapped[int] = mapped_column(ForeignKey("mentors.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    agenda: Mapped[Optional[str]] = mapped_column(Text)
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    mode: Mapped[str] = mapped_column(String(12), default="in_person", nullable=False)
    location: Mapped[Optional[str]] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(12), default="scheduled", nullable=False, index=True)
    requested_by: Mapped[str] = mapped_column(String(8), default="mentor", nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    log: Mapped[Optional["MeetingLog"]] = relationship(back_populates="meeting", uselist=False, cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("mode in ('in_person','video','phone')", name="mode"),
        CheckConstraint("status in ('requested','scheduled','completed','cancelled','no_show')", name="status"),
        CheckConstraint("requested_by in ('mentor','student','hod','system')", name="requested_by"),
        CheckConstraint("duration_minutes between 5 and 240", name="duration"),
    )


class MeetingLog(Base, ProvenanceMixin):
    __tablename__ = "meeting_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), unique=True, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    topics: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # [{"id": "a1", "text": "...", "done": false, "due": "2026-12-01"}]
    action_items: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    student_mood: Mapped[Optional[str]] = mapped_column(String(16))
    follow_up_on: Mapped[Optional[date]] = mapped_column(Date)
    private_notes: Mapped[Optional[str]] = mapped_column(Text)  # mentor/HOD only, never shown to the student
    logged_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    logged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    meeting: Mapped[Meeting] = relationship(back_populates="log")


class Notification(Base, TimestampMixin, ProvenanceMixin):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(Text)
    link: Mapped[Optional[str]] = mapped_column(String(300))
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_type: Mapped[Optional[str]] = mapped_column(String(40))
    entity_id: Mapped[Optional[str]] = mapped_column(String(64))
    ip_address: Mapped[Optional[str]] = mapped_column(String(64))
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class ImportJob(Base, TimestampMixin):
    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    filename: Mapped[Optional[str]] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(24), default="csv", nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_log: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="completed", nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class IntegrationRun(Base, TimestampMixin):
    __tablename__ = "integration_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    integration: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[Optional[str]] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class CompanionMessage(Base, TimestampMixin):
    __tablename__ = "companion_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(12), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    __table_args__ = (CheckConstraint("role in ('user','assistant')", name="role"),)


class KnowledgeChunk(Base, TimestampMixin):
    """Institution knowledge base for the AI Companion (policies, FAQs).
    Retrieval is lexical (BM25-style) so it works without an embedding
    provider; embeddings can be layered on later."""

    __tablename__ = "knowledge_chunks"

    id: Mapped[int] = mapped_column(primary_key=True)
    source: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # roles; empty = everyone
