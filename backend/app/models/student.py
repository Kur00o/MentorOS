from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from backend.app.core.database import Base


class Student(Base):
    __tablename__ = "students"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    usn = Column(String, unique=True, index=True, nullable=False)
    department = Column(String, nullable=False)
    semester = Column(Integer, nullable=False)
    student_mobile = Column(String, nullable=True)
    parent_mobile = Column(String, nullable=True)
    parent_email = Column(String, nullable=True)
    
    # Profile picture URL (stored in Supabase Storage or external CDN)
    profile_picture_url = Column(String, nullable=True)

    # Analytics / Academic signals
    attendance_rate = Column(Float, default=100.0)
    cgpa = Column(Float, default=0.0)
    sgpa = Column(Float, nullable=True)  # THIS semester's GPA — drives Academic component
    # No default: an unscored student must read as "no score yet", not as a
    # perfect one. The scoring engine fills this in; null means the mentor
    # roster shows insufficient_data.
    success_score = Column(Float, nullable=True)
    risk_status = Column(String, default="Green") # Green, Amber, Coral
    
    # Consent flag (legacy single boolean — kept for backward compatibility).
    # Per-category decisions live in the StudentConsent table (see `consents`).
    consent_given = Column(Boolean, default=True)

    # DPDP Act 2023: under-18 students require verifiable parental consent;
    # they cannot self-update consent server-side.
    is_under_18 = Column(Boolean, default=False, nullable=False)

    # Relationships
    user = relationship("User", back_populates="student_profile")
    mentor_id = Column(Integer, ForeignKey("mentors.id"), nullable=True)
    mentor = relationship("Mentor", back_populates="students")
    allocations = relationship("Allocation", back_populates="student", foreign_keys="[Allocation.student_id]")
    meetings = relationship("Meeting", back_populates="student")
    attendance_records = relationship("AttendanceRecord", back_populates="student")
    lms_activity_records = relationship("LmsActivityRecord", back_populates="student")
    placement_profile = relationship("PlacementProfile", back_populates="student",uselist=False)
    success_scores = relationship("StudentSuccessScore", back_populates="student")
    consents = relationship(
        "StudentConsent",
        back_populates="student",
        cascade="all, delete-orphan",
    )
