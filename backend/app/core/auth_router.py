from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.core.deps import Principal, get_principal
from backend.app.models import Mentor
from backend.app.students.service import iso

router = APIRouter()


@router.get("/config")
def public_config():
    """Non-secret, public configuration the login screen needs."""
    return {
        "google_oauth": settings.GOOGLE_OAUTH_ENABLED,
        "allowed_domains": settings.ALLOWED_EMAIL_DOMAINS,
        "demo_domain": settings.DEMO_EMAIL_DOMAIN,
        "environment": settings.ENVIRONMENT,
        "period": settings.SCORING_PERIOD,
    }


@router.get("/me")
def me(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    u = p.user
    mentor = db.scalar(select(Mentor).where(Mentor.user_id == u.id)) if p.role in ("mentor", "hod") else None
    return {
        "id": u.id,
        "email": u.email,
        "full_name": u.full_name,
        "role": p.role,
        "avatar_url": u.avatar_url,
        "phone": u.phone,
        "department": {"id": u.department.id, "code": u.department.code, "name": u.department.name} if u.department else None,
        "student_id": p.student_id,
        "mentor_id": mentor.id if mentor else None,
        "is_synthetic": u.is_synthetic,
        "last_login_at": iso(u.last_login_at),
    }
