"""ORM models. Importing this package registers every table on Base.metadata
(Alembic autogenerate and the test suite rely on it)."""
from backend.app.core.database import Base
from backend.app.models.core import (
    ROLES,
    RISK_CATEGORIES,
    AcademicTerm,
    DataBatch,
    Department,
    Mentor,
    Student,
    StudentConsent,
    User,
)
from backend.app.models.academic import (
    AttendanceRecord,
    AttendanceWeekly,
    LmsActivity,
    LmsWeekly,
    MarkRecord,
    PlacementOffer,
    PlacementProfile,
    RiskAlert,
    SemesterResult,
    StudentSuccessScore,
    Subject,
)
from backend.app.models.mentoring import (
    Allocation,
    AuditLog,
    CompanionMessage,
    ImportJob,
    IntegrationRun,
    KnowledgeChunk,
    Meeting,
    MeetingLog,
    Notification,
)

__all__ = [n for n in dir() if not n.startswith("_")]
