from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


class ComplianceReport(BaseModel):
    department: str
    academic_year: str
    generated_at: datetime
    total_students: int
    risk_summary: dict  # counts of Green, Amber, Coral
    mentoring_meetings_logged: int
    accreditation_type: str  # NAAC, NBA


class UserMgmtAction(BaseModel):
    user_id: int
    action: str  # e.g., "activate", "deactivate", "change_role"
    target_role: Optional[str] = None


class UserCreateRequest(BaseModel):
    full_name: str
    email: EmailStr
    role: str
    usn: Optional[str] = None
    department: Optional[str] = None
    semester: Optional[int] = None
    student_mobile: Optional[str] = None
    parent_mobile: Optional[str] = None
    parent_email: Optional[str] = None
    mobile_no: Optional[str] = None
    max_mentees: Optional[int] = None


class AdminUserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    department_code: str
    status: str
    last_active: datetime

    class Config:
        from_attributes = True

