"""Request principal + role/scope enforcement.

Authorization is always decided server-side from the database row that a
verified Supabase identity maps to — never from client-supplied roles.

Scopes:
  admin   → everything
  hod     → their department
  mentor  → their own mentees
  student → themselves
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from fastapi import Depends, Header
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.core.errors import AppError, forbidden, not_found
from backend.app.core.security import AuthError, verify_access_token
from backend.app.models import Mentor, Student, User


@dataclass
class Principal:
    user: User
    role: str
    department_id: Optional[int]
    mentor_id: Optional[int] = None
    student_id: Optional[int] = None

    @property
    def id(self) -> int:
        return self.user.id

    def is_staff(self) -> bool:
        return self.role in ("mentor", "hod", "admin")


def _unauthorized(message: str) -> AppError:
    err = AppError(401, "unauthorized", message)
    err.headers = {"WWW-Authenticate": "Bearer"}
    return err


def resolve_principal(db: Session, token: str) -> Principal:
    try:
        claims = verify_access_token(token)
    except AuthError as exc:
        raise _unauthorized(str(exc)) from exc

    user = db.scalar(select(User).where(User.auth_user_id == claims.sub))
    if user is None and claims.email:
        user = db.scalar(select(User).where(func.lower(User.email) == claims.email))
        if user is not None and user.auth_user_id and user.auth_user_id != claims.sub:
            raise forbidden("This email is linked to a different sign-in identity. Contact your administrator.")
        if user is not None:
            user.auth_user_id = claims.sub  # first sign-in links the identity
    if user is None:
        raise AppError(403, "not_provisioned", "Your account has not been set up in MentorOS yet. Ask your administrator to add you.")
    if settings.ALLOWED_EMAIL_DOMAINS and not user.is_synthetic:
        domain = user.email.rsplit("@", 1)[-1].lower()
        if domain not in [d.lower() for d in settings.ALLOWED_EMAIL_DOMAINS]:
            raise forbidden("Sign-in is restricted to institutional email domains.")
    if not user.is_active:
        raise AppError(403, "inactive", "Your account has been deactivated. Contact your administrator.")

    now = datetime.now(timezone.utc)
    last = user.last_login_at
    if last is None or (last if last.tzinfo else last.replace(tzinfo=timezone.utc)) < now - timedelta(minutes=30):
        user.last_login_at = now
    if db.dirty:
        db.commit()

    p = Principal(user=user, role=user.role, department_id=user.department_id)
    if user.role == "mentor":
        p.mentor_id = db.scalar(select(Mentor.id).where(Mentor.user_id == user.id))
    elif user.role == "student":
        p.student_id = db.scalar(select(Student.id).where(Student.user_id == user.id))
    return p


def get_principal(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized("Sign in to continue")
    return resolve_principal(db, authorization.split(" ", 1)[1].strip())


def require_roles(*roles: str) -> Callable[..., Principal]:
    def checker(p: Principal = Depends(get_principal)) -> Principal:
        if p.role not in roles:
            raise forbidden(f"This action requires one of: {', '.join(roles)}")
        return p

    return checker


def scope_students(stmt: Select, p: Principal) -> Select:
    """Restrict any query that includes `Student` to the caller's scope."""
    if p.role == "admin":
        return stmt
    if p.role == "hod":
        return stmt.where(Student.department_id == p.department_id)
    if p.role == "mentor":
        return stmt.where(Student.mentor_id == (p.mentor_id or -1))
    return stmt.where(Student.id == (p.student_id or -1))


def can_access_student(p: Principal, student: Student) -> bool:
    if p.role == "admin":
        return True
    if p.role == "hod":
        return student.department_id == p.department_id
    if p.role == "mentor":
        return p.mentor_id is not None and student.mentor_id == p.mentor_id
    return p.student_id == student.id


def get_accessible_student(db: Session, p: Principal, student_id: int) -> Student:
    student = db.get(Student, student_id)
    if student is None:
        raise not_found("Student")
    if not can_access_student(p, student):
        # Same response as missing: do not leak existence across scopes.
        raise not_found("Student")
    return student


def require_department_scope(p: Principal, department_id: Optional[int]) -> Optional[int]:
    """Admins may target any department (or all); HODs only their own."""
    if p.role == "admin":
        return department_id
    if p.role == "hod":
        if department_id is not None and department_id != p.department_id:
            raise forbidden("HODs can only act on their own department")
        return p.department_id
    raise forbidden("Department-level access requires HOD or Admin")
