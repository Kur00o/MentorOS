from typing import Optional
from typing_extensions import Literal
from pydantic import BaseModel


class StudentBase(BaseModel):
    usn: str
    department: str
    semester: int
    attendance_rate: Optional[float] = 100.0
    cgpa: Optional[float] = 0.0
    success_score: Optional[float] = 100.0
    risk_status: Optional[str] = "Green"
    consent_given: Optional[bool] = True
    student_mobile: Optional[str] = None
    parent_mobile: Optional[str] = None
    parent_email: Optional[str] = None
    sgpa: Optional[float] = None
    is_under_18: Optional[bool] = False
    profile_picture_url: Optional[str] = None


class StudentCreate(StudentBase):
    user_id: int


class StudentUpdate(BaseModel):
    department: Optional[str] = None
    semester: Optional[int] = None
    attendance_rate: Optional[float] = None
    cgpa: Optional[float] = None
    success_score: Optional[float] = None
    risk_status: Optional[str] = None
    sgpa: Optional[float] = None
    student_mobile: Optional[str] = None
    parent_mobile: Optional[str] = None
    parent_email: Optional[str] = None
    is_under_18: Optional[bool] = None
    profile_picture_url: Optional[str] = None


class StudentConsentUpdate(BaseModel):
    consent_given: bool


class ConsentUpdate(BaseModel):
    """Per-category consent toggle. `wellness` is rejected server-side (locked)."""

    category: Literal["academic", "attendance", "placement", "wellness"]
    consented: bool


from backend.app.auth.schemas import UserResponse


class StudentResponse(StudentBase):
    id: int
    user_id: int
    user: Optional[UserResponse] = None

    class Config:
        from_attributes = True
