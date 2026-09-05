from datetime import datetime, timezone
from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.core.audit import write_audit
from backend.app.auth.router import get_current_user
from backend.app.models.user import User
from backend.app.models.student import Student
from backend.app.models.consent import StudentConsent, ConsentCategory
from backend.app.students import schemas

router = APIRouter()

CONSENT_CATEGORIES = ["academic", "attendance", "placement", "wellness"]


@router.get("/", response_model=List[schemas.StudentResponse])
def read_students(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = 0,
    limit: int = 100
) -> Any:
    """
    Retrieve students list. Accessible by Mentors, HODs, and Admins.
    """
    if current_user.role not in ["Mentor", "HOD", "Admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    students = db.query(Student).offset(skip).limit(limit).all()
    return students


@router.get("/me", response_model=schemas.StudentResponse)
def read_student_me(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Any:
    """
    Get current student's profile details.
    """
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found for this user"
        )
    return student


@router.put("/me", response_model=schemas.StudentResponse)
def update_student_me(
    update: schemas.StudentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Update current student's editable profile fields (mobile, parent contact, etc.).
    """
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found for this user",
        )
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(student, field, value)
    db.commit()
    db.refresh(student)
    return student


@router.post("/me/profile-picture", response_model=schemas.StudentResponse)
async def upload_profile_picture(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Upload a profile picture. Stores in Supabase Storage and saves the public URL.
    Accepts image/jpeg, image/png, image/webp — max 5 MB.
    """
    from backend.app.core.supabase_client import get_supabase_client

    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found for this user",
        )

    ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}
    MAX_SIZE = 5 * 1024 * 1024  # 5 MB

    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only JPEG, PNG, and WebP images are allowed.",
        )

    contents = await file.read()
    if len(contents) > MAX_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size must be under 5 MB.",
        )

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    storage_path = f"profile-pictures/{student.id}.{ext}"

    supabase = get_supabase_client()
    supabase.storage.from_("avatars").upload(
        path=storage_path,
        file=contents,
        file_options={"content-type": file.content_type, "upsert": "true"},
    )

    public_url = supabase.storage.from_("avatars").get_public_url(storage_path)
    # The storage path is intentionally stable per student; version the URL so
    # browsers do not keep displaying the previous cached image after upsert.
    public_url = f"{public_url}?v={int(datetime.now(timezone.utc).timestamp() * 1000)}"
    student.profile_picture_url = public_url
    db.commit()
    db.refresh(student)
    return student



@router.put("/me/consent", response_model=schemas.StudentResponse)
def update_student_consent(
    consent_update: schemas.StudentConsentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Any:
    """
    Legacy master consent toggle. Sets the `consent_given` flag AND syncs the
    per-category rows (academic/attendance/placement) to the same value so the
    two representations stay consistent. `wellness` is left locked.

    DPDP: under-18 students cannot self-update (parental consent required).
    """
    student = db.query(Student).filter(Student.user_id == current_user.id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student profile not found for this user"
        )

    if student.is_under_18:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Parental consent required for students under 18. Contact your admin.",
        )

    value = consent_update.consent_given
    student.consent_given = value

    now = datetime.now(timezone.utc)
    for cat in ("academic", "attendance", "placement"):
        existing = (
            db.query(StudentConsent)
            .filter(
                StudentConsent.student_id == student.id,
                StudentConsent.category == ConsentCategory(cat),
            )
            .first()
        )
        if existing:
            existing.consented = value
            existing.notice_version = settings.PRIVACY_NOTICE_VERSION
            existing.consented_at = now
        else:
            db.add(StudentConsent(
                student_id=student.id,
                category=ConsentCategory(cat),
                consented=value,
                notice_version=settings.PRIVACY_NOTICE_VERSION,
                consented_at=now,
            ))

    db.commit()
    db.refresh(student)
    write_audit(db, current_user.id, "consent_update_all", "student_consent",
                student.id, details={"consent_given": value})
    return student


@router.post("/import", response_model=List[schemas.StudentResponse])
def import_students_csv(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Any:
    """
    Import student data from a CSV file (Admin/HOD only).
    This endpoint parses columns, matches records to USNs, and updates database records.
    """
    if current_user.role not in ["HOD", "Admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to import students"
        )
    # Placeholder implementation: parses CSV headers and mock-saves to DB.
    # In a real environment, this parses 'file' content.
    return []


@router.get("/{student_id}/consents")
def get_consents(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Return all four consent categories with their current state. Students may
    only view their own. Categories with no explicit record fall back to the
    legacy `consent_given` flag; `wellness` is always reported locked.
    """
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    if current_user.role == "Student" and student.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot view another student's consent",
        )

    existing = {c.category.value: c for c in student.consents}
    result = {"is_under_18": student.is_under_18}
    for cat in CONSENT_CATEGORIES:
        c = existing.get(cat)
        if c is not None:
            consented = c.consented
        elif cat == "wellness":
            consented = False
        else:
            # No per-category record yet — fall back to the legacy flag.
            consented = bool(student.consent_given)
        result[cat] = {
            "consented": consented,
            "notice_version": c.notice_version if c else settings.PRIVACY_NOTICE_VERSION,
            "consented_at": c.consented_at.isoformat() if c else None,
            "locked": cat == "wellness",
        }
    return result


@router.patch("/{student_id}/consent")
def update_consent(
    student_id: int,
    payload: schemas.ConsentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Toggle a single consent category. Students may only update their own.
    DPDP: under-18 students cannot self-update (parental consent required).
    `wellness` is locked in this version.
    """
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )
    if current_user.role == "Student" and student.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot update another student's consent",
        )

    if student.is_under_18:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Parental consent required for students under 18. Contact your admin.",
        )

    if payload.category == "wellness":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Wellness consent is not configurable in this version.",
        )

    consent = (
        db.query(StudentConsent)
        .filter(
            StudentConsent.student_id == student_id,
            StudentConsent.category == ConsentCategory(payload.category),
        )
        .first()
    )
    now = datetime.now(timezone.utc)
    if consent:
        consent.consented = payload.consented
        consent.notice_version = settings.PRIVACY_NOTICE_VERSION
        consent.consented_at = now
    else:
        consent = StudentConsent(
            student_id=student_id,
            category=ConsentCategory(payload.category),
            consented=payload.consented,
            notice_version=settings.PRIVACY_NOTICE_VERSION,
            consented_at=now,
        )
        db.add(consent)

    db.commit()
    write_audit(
        db,
        current_user.id,
        "consent_update",
        "student_consent",
        student_id,
        details={"category": payload.category, "consented": payload.consented},
    )
    return {
        "message": "Consent updated",
        "category": payload.category,
        "consented": payload.consented,
    }
