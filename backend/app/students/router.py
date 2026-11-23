from __future__ import annotations

import re
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, Field, HttpUrl, field_validator
from sqlalchemy import asc, desc, func, nulls_last, or_, select
from sqlalchemy.orm import Session

from backend.app.core.audit import audit
from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.core.deps import Principal, get_accessible_student, get_principal, require_roles, scope_students
from backend.app.core.errors import AppError, bad_request, forbidden, not_found
from backend.app.integrations import supabase_admin
from backend.app.models import PlacementProfile, Student, User
from backend.app.scoring import engine
from backend.app.students import service

router = APIRouter()

PHONE_RE = re.compile(r"^[+0-9 ()-]{7,20}$")


class ProfileUpdate(BaseModel):
    phone: Optional[str] = Field(default=None, max_length=20)
    bio: Optional[str] = Field(default=None, max_length=600)
    interests: Optional[list[str]] = Field(default=None, max_length=12)
    home_city: Optional[str] = Field(default=None, max_length=80)
    guardian_name: Optional[str] = Field(default=None, max_length=160)
    guardian_phone: Optional[str] = Field(default=None, max_length=20)
    guardian_email: Optional[str] = Field(default=None, max_length=255)

    @field_validator("phone", "guardian_phone")
    @classmethod
    def _phone(cls, v):
        if v and not PHONE_RE.match(v):
            raise ValueError("Use digits, spaces, + ( ) and - only")
        return v

    @field_validator("guardian_email")
    @classmethod
    def _email(cls, v):
        if v and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v):
            raise ValueError("Invalid email address")
        return v

    @field_validator("interests")
    @classmethod
    def _interests(cls, v):
        return [i.strip()[:40] for i in v if i.strip()] if v is not None else v


class PlacementUpdate(BaseModel):
    skills: Optional[list[str]] = Field(default=None, max_length=30)
    certifications: Optional[list[str]] = Field(default=None, max_length=30)
    target_role: Optional[str] = Field(default=None, max_length=120)
    status: Optional[Literal["not_started", "preparing", "applying", "placed", "higher_studies"]] = None
    linkedin_url: Optional[HttpUrl] = None
    github_url: Optional[HttpUrl] = None

    @field_validator("skills", "certifications")
    @classmethod
    def _clean(cls, v):
        if v is None:
            return v
        seen, out = set(), []
        for item in v:
            item = item.strip()[:80]
            if item and item.lower() not in seen:
                seen.add(item.lower())
                out.append(item)
        return out


class ConsentUpdate(BaseModel):
    category: Literal["academic", "attendance", "placement", "wellness"]
    consented: bool


SORTS = {
    "score": Student.success_score,
    "attendance": Student.attendance_pct,
    "cgpa": Student.cgpa,
    "name": User.full_name,
    "usn": Student.usn,
    "delta": Student.score_delta,
    "semester": Student.semester,
}


@router.get("")
def list_students(
    q: Optional[str] = Query(default=None, max_length=80),
    band: Optional[Literal["green", "amber", "coral", "insufficient_data"]] = None,
    department_id: Optional[int] = None,
    semester: Optional[int] = Query(default=None, ge=1, le=10),
    mentor_id: Optional[int] = None,
    unassigned: bool = False,
    sort: str = "score",
    order: Literal["asc", "desc"] = "asc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    p: Principal = Depends(require_roles("mentor", "hod", "admin")),
    db: Session = Depends(get_db),
):
    stmt = scope_students(select(Student).join(User, User.id == Student.user_id), p)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(Student.usn).like(like), func.lower(User.email).like(like)))
    if band:
        stmt = stmt.where(Student.risk_category == band)
    if department_id and p.role == "admin":
        stmt = stmt.where(Student.department_id == department_id)
    if semester:
        stmt = stmt.where(Student.semester == semester)
    if mentor_id and p.role in ("hod", "admin"):
        stmt = stmt.where(Student.mentor_id == mentor_id)
    if unassigned:
        stmt = stmt.where(Student.mentor_id.is_(None))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    col = SORTS.get(sort, Student.success_score)
    stmt = stmt.order_by(nulls_last(asc(col) if order == "asc" else desc(col)), Student.usn)
    students = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": service.list_rows(db, students), "total": total, "page": page, "page_size": page_size}


@router.get("/me")
def my_overview(p: Principal = Depends(require_roles("student")), db: Session = Depends(get_db)):
    if not p.student_id:
        raise not_found("Student profile")
    return service.build_overview(db, db.get(Student, p.student_id), p)


@router.patch("/me")
def update_my_profile(body: ProfileUpdate, request: Request, p: Principal = Depends(require_roles("student")), db: Session = Depends(get_db)):
    st = db.get(Student, p.student_id) if p.student_id else None
    if st is None:
        raise not_found("Student profile")
    data = body.model_dump(exclude_unset=True)
    if "phone" in data:
        st.user.phone = data.pop("phone")
    for k, v in data.items():
        setattr(st, k, v)
    db.commit()
    audit(db, p.id, "profile_update", "student", st.id, {"fields": sorted(body.model_dump(exclude_unset=True))}, request)
    return service.build_overview(db, st, p)["profile"]


ALLOWED_IMAGES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


async def _read_upload(file: UploadFile, allowed: dict, max_mb: int) -> tuple[bytes, str]:
    if file.content_type not in allowed:
        raise bad_request(f"Unsupported file type. Allowed: {', '.join(allowed)}")
    data = await file.read()
    if len(data) > max_mb * 1024 * 1024:
        raise bad_request(f"File must be under {max_mb} MB")
    if not data:
        raise bad_request("The file is empty")
    return data, allowed[file.content_type]


@router.post("/me/avatar")
async def upload_avatar(request: Request, file: UploadFile = File(...), p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Any signed-in user may set their own avatar (stored in Supabase Storage)."""
    data, ext = await _read_upload(file, ALLOWED_IMAGES, 3)
    path = f"users/{p.id}/{uuid.uuid4().hex[:10]}.{ext}"
    try:
        supabase_admin.upload_object(settings.STORAGE_AVATAR_BUCKET, path, data, file.content_type)
    except supabase_admin.IntegrationUnavailable as exc:
        raise AppError(503, "storage_unavailable", str(exc)) from exc
    except supabase_admin.SupabaseError as exc:
        raise AppError(502, "storage_error", f"Upload failed: {exc}") from exc
    p.user.avatar_url = supabase_admin.public_url(settings.STORAGE_AVATAR_BUCKET, path)
    db.commit()
    audit(db, p.id, "avatar_upload", "user", p.id, {"path": path}, request)
    return {"avatar_url": p.user.avatar_url}


@router.put("/me/placement")
def update_my_placement(body: PlacementUpdate, request: Request, p: Principal = Depends(require_roles("student")), db: Session = Depends(get_db)):
    st = db.get(Student, p.student_id)
    prof = st.placement_profile or PlacementProfile(student_id=st.id, is_synthetic=st.is_synthetic, batch_id=st.batch_id)
    if prof.id is None:
        db.add(prof)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(prof, k, str(v) if k.endswith("_url") and v is not None else v)
    db.flush()
    engine.recompute(db, [st.id], trigger="profile")
    audit(db, p.id, "placement_update", "student", st.id, {"fields": sorted(body.model_dump(exclude_unset=True))}, request)
    return service.build_overview(db, st, p)


ALLOWED_DOCS = {"application/pdf": "pdf"}


@router.post("/me/resume")
async def upload_resume(request: Request, file: UploadFile = File(...), p: Principal = Depends(require_roles("student")), db: Session = Depends(get_db)):
    data, ext = await _read_upload(file, ALLOWED_DOCS, 5)
    if not data.startswith(b"%PDF"):
        raise bad_request("That does not look like a PDF file")
    st = db.get(Student, p.student_id)
    path = f"students/{st.id}/resume-{uuid.uuid4().hex[:8]}.{ext}"
    try:
        supabase_admin.upload_object(settings.STORAGE_RESUME_BUCKET, path, data, file.content_type)
    except supabase_admin.IntegrationUnavailable as exc:
        raise AppError(503, "storage_unavailable", str(exc)) from exc
    except supabase_admin.SupabaseError as exc:
        raise AppError(502, "storage_error", f"Upload failed: {exc}") from exc
    prof = st.placement_profile or PlacementProfile(student_id=st.id, is_synthetic=st.is_synthetic, batch_id=st.batch_id)
    if prof.id is None:
        db.add(prof)
    prof.resume_path, prof.has_resume = path, True
    db.flush()
    engine.recompute(db, [st.id], trigger="profile")
    audit(db, p.id, "resume_upload", "student", st.id, {"path": path}, request)
    return {"ok": True, "score": st.success_score, "band": st.risk_category}


def _resume_link(db: Session, st: Student, p: Principal) -> dict:
    prof = st.placement_profile
    if not prof or not prof.resume_path:
        raise not_found("Resume")
    if p.role != "student":
        consent = service.consent_state(st)["placement"]["consented"]
        if not consent:
            raise forbidden("The student has not consented to sharing placement data")
    try:
        return {"url": supabase_admin.signed_url(settings.STORAGE_RESUME_BUCKET, prof.resume_path, 600), "expires_in": 600}
    except supabase_admin.IntegrationUnavailable as exc:
        raise AppError(503, "storage_unavailable", str(exc)) from exc


@router.get("/me/resume")
def my_resume(p: Principal = Depends(require_roles("student")), db: Session = Depends(get_db)):
    return _resume_link(db, db.get(Student, p.student_id), p)


@router.get("/{student_id}")
def student_overview(student_id: int, request: Request, p: Principal = Depends(require_roles("mentor", "hod", "admin")), db: Session = Depends(get_db)):
    st = get_accessible_student(db, p, student_id)
    audit(db, p.id, "student_view", "student", st.id, request=request)
    return service.build_overview(db, st, p)


@router.get("/{student_id}/resume")
def student_resume(student_id: int, p: Principal = Depends(require_roles("mentor", "hod", "admin")), db: Session = Depends(get_db)):
    return _resume_link(db, get_accessible_student(db, p, student_id), p)


@router.get("/{student_id}/consents")
def get_consents(student_id: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    st = get_accessible_student(db, p, student_id)
    return {"is_under_18": st.is_under_18, **service.consent_state(st)}


@router.patch("/{student_id}/consents")
def update_consent(student_id: int, body: ConsentUpdate, request: Request, p: Principal = Depends(require_roles("student")), db: Session = Depends(get_db)):
    st = get_accessible_student(db, p, student_id)
    if st.is_under_18:
        raise forbidden("Students under 18 need verifiable parental consent. Please contact the admin office.")
    if body.category == "wellness":
        raise forbidden("Wellness data sharing is not configurable in this version.")
    service.set_consent(db, st, body.category, body.consented)
    db.commit()
    db.refresh(st)
    audit(db, p.id, "consent_update", "student", st.id, body.model_dump(), request)
    return {"is_under_18": st.is_under_18, **service.consent_state(st)}
