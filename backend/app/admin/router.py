from __future__ import annotations

import csv
import io
import secrets
import string
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from backend.app.admin.imports import TEMPLATES, Importer, parse_csv, template_csv
from backend.app.core.audit import audit
from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.core.deps import Principal, require_department_scope, require_roles, scope_students
from backend.app.core.errors import AppError, bad_request, conflict, forbidden, not_found
from backend.app.integrations import connectors, supabase_admin
from backend.app.integrations.registry import integrations_overview
from backend.app.models import (
    AuditLog,
    DataBatch,
    Department,
    ImportJob,
    IntegrationRun,
    Meeting,
    Mentor,
    Student,
    StudentSuccessScore,
    Subject,
    User,
)
from backend.app.scoring import engine
from backend.app.students.service import consent_state, iso

router = APIRouter()

Role = Literal["student", "mentor", "hod", "admin"]


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    role: Role
    department_id: Optional[int] = None
    phone: Optional[str] = Field(default=None, max_length=20)
    usn: Optional[str] = Field(default=None, min_length=4, max_length=32)
    semester: Optional[int] = Field(default=None, ge=1, le=10)
    section: Optional[str] = Field(default=None, max_length=4)
    designation: Optional[str] = Field(default=None, max_length=80)
    max_mentees: Optional[int] = Field(default=None, ge=0, le=60)
    provision_login: bool = True
    password: Optional[str] = Field(default=None, min_length=10, max_length=72)

    @field_validator("email")
    @classmethod
    def _lower(cls, v):
        return v.lower()


class UserUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    role: Optional[Literal["mentor", "hod", "admin"]] = None
    department_id: Optional[int] = None
    is_active: Optional[bool] = None
    phone: Optional[str] = Field(default=None, max_length=20)


class ProvisionIn(BaseModel):
    password: Optional[str] = Field(default=None, min_length=10, max_length=72)
    send_reset_email: bool = False


class DepartmentIn(BaseModel):
    code: str = Field(min_length=2, max_length=16, pattern=r"^[A-Za-z0-9&-]+$")
    name: str = Field(min_length=3, max_length=160)
    hod_user_id: Optional[int] = None


class DepartmentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=3, max_length=160)
    hod_user_id: Optional[int] = None


class PurgeIn(BaseModel):
    confirm: str


def _temp_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "Mos-" + "".join(secrets.choice(alphabet) for _ in range(12)) + "!9"


def _user_row(u: User, extra: Optional[dict] = None) -> dict:
    return {
        "id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "department_id": u.department_id,
        "department": u.department.code if u.department else None, "phone": u.phone, "avatar_url": u.avatar_url,
        "is_active": u.is_active, "has_login": bool(u.auth_user_id), "last_login_at": iso(u.last_login_at),
        "created_at": iso(u.created_at), "is_synthetic": u.is_synthetic, **(extra or {}),
    }


def _provision(u: User, password: Optional[str]) -> Optional[str]:
    """Create/link the Supabase Auth identity. Returns the temp password (once)."""
    temp = password or _temp_password()
    try:
        auth_user = supabase_admin.create_or_update_auth_user(u.email, temp, full_name=u.full_name, role=u.role)
    except supabase_admin.IntegrationUnavailable as exc:
        raise AppError(503, "auth_admin_unavailable", str(exc)) from exc
    except supabase_admin.SupabaseError as exc:
        raise AppError(502, "auth_admin_error", f"Supabase Auth rejected the request: {exc}") from exc
    u.auth_user_id = auth_user["id"]
    return temp


# ── users ──────────────────────────────────────────────────────────────────
@router.get("/users")
def list_users(
    q: Optional[str] = Query(default=None, max_length=80),
    role: Optional[Role] = None,
    department_id: Optional[int] = None,
    status: Optional[Literal["active", "inactive"]] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    p: Principal = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    stmt = select(User)
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(User.full_name).like(like), func.lower(User.email).like(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if department_id:
        stmt = stmt.where(User.department_id == department_id)
    if status:
        stmt = stmt.where(User.is_active.is_(status == "active"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    users = db.scalars(stmt.order_by(User.role, User.full_name).offset((page - 1) * page_size).limit(page_size)).all()
    usns = dict(db.execute(select(Student.user_id, Student.usn).where(Student.user_id.in_([u.id for u in users]))).all())
    return {"items": [_user_row(u, {"usn": usns.get(u.id)}) for u in users], "total": total, "page": page, "page_size": page_size,
            "counts": dict(db.execute(select(User.role, func.count(User.id)).group_by(User.role)).all())}


@router.post("/users", status_code=201)
def create_user(body: UserCreate, request: Request, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    if db.scalar(select(User.id).where(func.lower(User.email) == body.email)):
        raise conflict("A user with this email already exists")
    if settings.ALLOWED_EMAIL_DOMAINS and body.email.rsplit("@", 1)[-1] not in settings.ALLOWED_EMAIL_DOMAINS:
        raise bad_request(f"Email domain must be one of: {', '.join(settings.ALLOWED_EMAIL_DOMAINS)}")
    if body.role != "admin":
        if not body.department_id or not db.get(Department, body.department_id):
            raise bad_request("A valid department is required for this role")
    u = User(email=body.email, full_name=body.full_name.strip(), role=body.role, department_id=body.department_id, phone=body.phone)
    db.add(u)
    db.flush()
    if body.role == "student":
        if not body.usn or not body.semester:
            raise bad_request("Students need a USN and semester")
        if db.scalar(select(Student.id).where(func.upper(Student.usn) == body.usn.upper())):
            raise conflict("A student with this USN already exists")
        db.add(Student(user_id=u.id, usn=body.usn.upper(), department_id=body.department_id, semester=body.semester, section=body.section))
    elif body.role in ("mentor", "hod"):
        db.add(Mentor(user_id=u.id, department_id=body.department_id, designation=body.designation or ("Professor & Head" if body.role == "hod" else "Assistant Professor"),
                      max_mentees=body.max_mentees if body.max_mentees is not None else (10 if body.role == "hod" else 20)))
        if body.role == "hod":
            dept = db.get(Department, body.department_id)
            dept.hod_user_id = u.id
    temp = _provision(u, body.password) if body.provision_login else None
    db.commit()
    audit(db, p.id, "user_create", "user", u.id, {"role": body.role, "provisioned": bool(temp)}, request)
    return {"user": _user_row(u), "temporary_password": temp if temp and not body.password else None}


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, request: Request, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found("User")
    data = body.model_dump(exclude_unset=True)
    if u.id == p.id and (data.get("is_active") is False or (data.get("role") and data["role"] != "admin")):
        raise forbidden("You cannot deactivate or demote your own admin account")
    if "role" in data and u.role == "student":
        raise bad_request("Student accounts cannot be converted to staff roles")
    if "department_id" in data and data["department_id"] is not None and not db.get(Department, data["department_id"]):
        raise bad_request("Unknown department")
    for k, v in data.items():
        setattr(u, k, v)
    if u.role in ("mentor", "hod"):
        mp = db.scalar(select(Mentor).where(Mentor.user_id == u.id))
        if mp is None:
            if not u.department_id:
                raise bad_request("Assign a department before making this user a mentor or HOD")
            db.add(Mentor(user_id=u.id, department_id=u.department_id, max_mentees=10 if u.role == "hod" else 20))
        elif "department_id" in data and data["department_id"] and mp.department_id != data["department_id"]:
            if db.scalar(select(func.count(Student.id)).where(Student.mentor_id == mp.id)):
                raise bad_request("Reassign this mentor's mentees before moving them to another department")
            mp.department_id = data["department_id"]
        if u.role == "hod" and u.department_id:
            db.get(Department, u.department_id).hod_user_id = u.id
    if u.role == "student" and "department_id" in data:
        st = db.scalar(select(Student).where(Student.user_id == u.id))
        if st and data["department_id"]:
            st.department_id = data["department_id"]
            st.mentor_id = None
    if "is_active" in data and u.auth_user_id:
        try:
            supabase_admin.ban_auth_user(u.auth_user_id, not data["is_active"])
        except (supabase_admin.IntegrationUnavailable, supabase_admin.SupabaseError):
            pass  # DB flag still blocks API access
    db.commit()
    audit(db, p.id, "user_update", "user", u.id, {k: v for k, v in data.items()}, request)
    return _user_row(u)


@router.post("/users/{user_id}/provision")
def provision_login(user_id: int, body: ProvisionIn, request: Request, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise not_found("User")
    temp = _provision(u, body.password)
    db.commit()
    sent = False
    if body.send_reset_email:
        try:
            supabase_admin.send_password_recovery(u.email, f"{settings.APP_BASE_URL}/login")
            sent = True
        except (supabase_admin.IntegrationUnavailable, supabase_admin.SupabaseError):
            sent = False
    audit(db, p.id, "user_provision_login", "user", u.id, {"reset_email": sent}, request)
    return {"user": _user_row(u), "temporary_password": None if body.password else temp, "reset_email_sent": sent}


# ── departments ────────────────────────────────────────────────────────────
@router.get("/departments")
def list_departments(p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    out = []
    for d in db.scalars(select(Department).order_by(Department.code)):
        out.append({
            "id": d.id, "code": d.code, "name": d.name, "hod_user_id": d.hod_user_id, "hod": d.hod.full_name if d.hod else None,
            "students": db.scalar(select(func.count(Student.id)).where(Student.department_id == d.id)) or 0,
            "mentors": db.scalar(select(func.count(Mentor.id)).where(Mentor.department_id == d.id)) or 0,
            "subjects": db.scalar(select(func.count(Subject.id)).where(Subject.department_id == d.id)) or 0,
            "is_synthetic": d.is_synthetic,
        })
    return out


@router.post("/departments", status_code=201)
def create_department(body: DepartmentIn, request: Request, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    if db.scalar(select(Department.id).where(func.upper(Department.code) == body.code.upper())):
        raise conflict("Department code already exists")
    d = Department(code=body.code.upper(), name=body.name.strip(), hod_user_id=body.hod_user_id)
    db.add(d)
    db.commit()
    audit(db, p.id, "department_create", "department", d.id, body.model_dump(), request)
    return {"id": d.id, "code": d.code, "name": d.name}


@router.patch("/departments/{dept_id}")
def update_department(dept_id: int, body: DepartmentUpdate, request: Request, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    d = db.get(Department, dept_id)
    if d is None:
        raise not_found("Department")
    if body.hod_user_id is not None:
        hod = db.get(User, body.hod_user_id)
        if hod is None or hod.role != "hod":
            raise bad_request("The selected user must have the HOD role")
        d.hod_user_id = hod.id
        hod.department_id = d.id
    if body.name:
        d.name = body.name.strip()
    db.commit()
    audit(db, p.id, "department_update", "department", d.id, body.model_dump(exclude_none=True), request)
    return {"id": d.id, "code": d.code, "name": d.name, "hod_user_id": d.hod_user_id}


# ── imports & connectors ───────────────────────────────────────────────────
@router.get("/imports/templates")
def import_templates(p: Principal = Depends(require_roles("hod", "admin"))):
    return [{"kind": k, "columns": v["columns"], "description": v["description"]} for k, v in TEMPLATES.items()]


@router.get("/imports/templates/{kind}")
def import_template_file(kind: str, p: Principal = Depends(require_roles("hod", "admin"))):
    if kind not in TEMPLATES:
        raise not_found("Template")
    return StreamingResponse(iter([template_csv(kind)]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="mentoros_{kind}_template.csv"'})


def _finish_import(db: Session, p: Principal, request: Request, kind: str, rows: list[dict], filename: Optional[str], source: str) -> dict:
    importer = Importer(db, p, source=source)
    result = importer.run(kind, rows)
    db.commit()
    recompute = engine.recompute(db, list(result.affected_students), trigger="import") if result.affected_students else {"count": 0}
    job = ImportJob(kind=kind, filename=filename, source=source, row_count=result.row_count, success_count=result.success_count,
                    error_log=result.error_log, status="completed" if result.success_count == result.row_count else ("partial" if result.success_count else "failed"),
                    created_by=p.id)
    db.add(job)
    db.commit()
    audit(db, p.id, f"import_{kind}", "import_job", job.id, {"rows": result.row_count, "ok": result.success_count, "source": source}, request)
    return {**result.as_dict(), "job_id": job.id, "status": job.status, "recomputed": recompute["count"]}


@router.post("/imports/{kind}")
async def import_csv(kind: str, request: Request, file: UploadFile = File(...), p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    if kind not in TEMPLATES:
        raise not_found("Import type")
    raw = await file.read()
    if len(raw) > 8 * 1024 * 1024:
        raise bad_request("CSV files must be under 8 MB")
    try:
        rows = parse_csv(raw)
    except ValueError as exc:
        raise bad_request(str(exc), code="invalid_file") from exc
    if not rows:
        raise bad_request("The file contains no data rows", code="invalid_file")
    return _finish_import(db, p, request, kind, rows, file.filename, "csv")


@router.get("/imports")
def import_history(limit: int = 30, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    stmt = select(ImportJob, User).outerjoin(User, User.id == ImportJob.created_by).order_by(ImportJob.created_at.desc()).limit(min(limit, 200))
    if p.role == "hod":
        stmt = stmt.where(ImportJob.created_by == p.id)
    return [{"id": j.id, "kind": j.kind, "source": j.source, "filename": j.filename, "row_count": j.row_count, "success_count": j.success_count,
             "status": j.status, "error_log": j.error_log[:50], "created_at": iso(j.created_at), "created_by": u.full_name if u else None}
            for j, u in db.execute(stmt).all()]


@router.get("/integrations")
def list_integrations(probe: bool = False, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    runs = [{"id": r.id, "integration": r.integration, "action": r.action, "status": r.status, "message": r.message, "created_at": iso(r.created_at)}
            for r in db.scalars(select(IntegrationRun).order_by(IntegrationRun.created_at.desc()).limit(20))]
    return {"integrations": integrations_overview(probe=probe), "runs": runs}


@router.post("/integrations/{key}/test")
def test_integration(key: str, request: Request, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    if key in ("supabase_auth", "supabase_storage"):
        result = supabase_admin.health()
    elif (c := connectors.get_connector(key)) is not None:
        result = c.test()
    else:
        item = next((i for i in integrations_overview() if i["key"] == key), None)
        if item is None:
            raise not_found("Integration")
        result = {"status": item["status"], "message": item["message"]}
    db.add(IntegrationRun(integration=key, action="test", status=result["status"], message=result.get("message"), created_by=p.id))
    db.commit()
    return result


@router.post("/integrations/{key}/sync")
def sync_integration(key: str, request: Request, dataset: str = Form(...), p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    c = connectors.get_connector(key)
    if c is None:
        raise not_found("Connector")
    if not c.configured():
        raise AppError(409, "not_configured", f"{c.label} is not configured. Set {c.url_setting} (and {c.key_setting}) or use CSV import.")
    try:
        rows = c.fetch(dataset)
    except Exception as exc:
        db.add(IntegrationRun(integration=key, action=f"sync:{dataset}", status="error", message=str(exc)[:500], created_by=p.id))
        db.commit()
        raise AppError(502, "connector_error", f"{c.label} sync failed: {exc}") from exc
    result = _finish_import(db, p, request, dataset, rows, f"{key}:{dataset}", key)
    db.add(IntegrationRun(integration=key, action=f"sync:{dataset}", status="ok", message=f"{result['success_count']}/{result['row_count']} rows", created_by=p.id))
    db.commit()
    return result


# ── scoring ────────────────────────────────────────────────────────────────
@router.post("/scores/recompute")
def recompute_scores(request: Request, department_id: Optional[int] = None, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    dept_id = require_department_scope(p, department_id)
    stmt = select(Student.id)
    if dept_id:
        stmt = stmt.where(Student.department_id == dept_id)
    result = engine.recompute(db, list(db.scalars(stmt)), trigger="manual")
    audit(db, p.id, "scores_recompute", "department", dept_id, result, request)
    return result


# ── exports ────────────────────────────────────────────────────────────────
def _csv_response(rows: list[list], header: list[str], filename: str) -> StreamingResponse:
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(header)
    w.writerows(rows)
    return StreamingResponse(iter([out.getvalue()]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _fmt(value, allowed: bool):
    if not allowed:
        return "Consent not given"
    return round(value, 1) if value is not None else "N/A"


@router.get("/exports/naac")
def export_naac(request: Request, department_id: Optional[int] = None, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    dept_id = require_department_scope(p, department_id)
    stmt = select(Student).order_by(Student.usn)
    if dept_id:
        stmt = stmt.where(Student.department_id == dept_id)
    students = db.scalars(stmt).all()
    ids = [s.id for s in students]
    latest: dict[int, StudentSuccessScore] = {}
    for r in db.scalars(select(StudentSuccessScore).where(StudentSuccessScore.student_id.in_(ids)).order_by(StudentSuccessScore.computed_at)):
        latest[r.student_id] = r
    meetings = dict(db.execute(select(Meeting.student_id, func.count(Meeting.id)).where(Meeting.student_id.in_(ids), Meeting.status == "completed").group_by(Meeting.student_id)).all())
    rows = []
    for s in students:
        c = {k: v["consented"] for k, v in consent_state(s).items()}
        sc = latest.get(s.id)
        rows.append([
            s.usn, s.user.full_name, s.department.code, s.semester, s.mentor.user.full_name if s.mentor else "Unassigned",
            meetings.get(s.id, 0), round(s.success_score, 1) if s.success_score is not None else "insufficient_data", s.risk_category,
            _fmt(sc.attendance_component if sc else None, c["attendance"]), _fmt(sc.academic_component if sc else None, c["academic"]),
            _fmt(sc.engagement_component if sc else None, True), _fmt(sc.placement_component if sc else None, c["placement"]),
            "Yes" if c["academic"] else "No", "Yes" if c["attendance"] else "No", "Yes" if c["placement"] else "No",
            "synthetic" if s.is_synthetic else "institutional",
        ])
    audit(db, p.id, "export_naac", "department", dept_id, {"rows": len(rows)}, request)
    header = ["USN", "Student Name", "Department", "Semester", "Mentor", "Completed Meetings", "Success Score", "Risk Band",
              "Attendance Component", "Academic Component", "Engagement Component", "Placement Component",
              "Consent: Academic", "Consent: Attendance", "Consent: Placement", "Data Provenance"]
    return _csv_response(rows, header, "mentoros_naac_nba_export.csv")


@router.get("/exports/students")
def export_students(request: Request, band: Optional[str] = None, p: Principal = Depends(require_roles("mentor", "hod", "admin")), db: Session = Depends(get_db)):
    stmt = scope_students(select(Student).order_by(Student.usn), p)
    if band:
        stmt = stmt.where(Student.risk_category.in_(band.split(",")))
    students = db.scalars(stmt).all()
    rows = [[s.usn, s.user.full_name, s.user.email, s.department.code, s.semester, s.section or "", s.mentor.user.full_name if s.mentor else "",
             s.success_score if s.success_score is not None else "", s.risk_category, s.attendance_pct if s.attendance_pct is not None else "",
             s.cgpa or "", s.sgpa or "", s.active_backlogs, "synthetic" if s.is_synthetic else "institutional"] for s in students]
    audit(db, p.id, "export_students", "student", None, {"rows": len(rows), "band": band}, request)
    return _csv_response(rows, ["USN", "Name", "Email", "Department", "Semester", "Section", "Mentor", "Success Score", "Risk Band",
                                "Attendance %", "CGPA", "SGPA", "Active Backlogs", "Data Provenance"],
                         "mentoros_at_risk.csv" if band else "mentoros_students.csv")


@router.get("/exports/audit-log")
def export_audit(request: Request, limit: int = Query(default=5000, ge=1, le=50000), p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    rows = db.execute(select(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id).order_by(AuditLog.created_at.desc()).limit(limit)).all()
    data = [[iso(a.created_at), a.user_id or "", u.email if u else "system", a.action, a.entity_type or "", a.entity_id or "", a.ip_address or "",
             str(a.details or {})] for a, u in rows]
    audit(db, p.id, "export_audit_log", "audit_log", None, {"rows": len(data)}, request)
    return _csv_response(data, ["Timestamp", "User ID", "User", "Action", "Entity", "Entity ID", "IP", "Details"], "mentoros_audit_log.csv")


@router.get("/audit-log")
def audit_log(action: Optional[str] = None, limit: int = Query(default=100, ge=1, le=500), p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    stmt = select(AuditLog, User).outerjoin(User, User.id == AuditLog.user_id).order_by(AuditLog.created_at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    return [{"id": a.id, "created_at": iso(a.created_at), "user": u.full_name if u else "System", "user_role": u.role if u else None,
             "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id, "ip_address": a.ip_address, "details": a.details}
            for a, u in db.execute(stmt).all()]


# ── provenance ─────────────────────────────────────────────────────────────
@router.get("/batches")
def batches(p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    return [{"id": b.id, "label": b.label, "kind": b.kind, "description": b.description, "created_at": iso(b.created_at),
             "students": db.scalar(select(func.count(Student.id)).where(Student.batch_id == b.id)) or 0,
             "users": db.scalar(select(func.count(User.id)).where(User.batch_id == b.id)) or 0}
            for b in db.scalars(select(DataBatch).order_by(DataBatch.id))]


@router.post("/batches/purge-synthetic")
def purge_synthetic(body: PurgeIn, request: Request, p: Principal = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    """Remove every synthetic row. Institutional data is untouched. Requires
    typing the confirmation phrase. The acting admin must be a real account."""
    if body.confirm != "PURGE SYNTHETIC DATA":
        raise bad_request("Type PURGE SYNTHETIC DATA to confirm")
    if p.user.is_synthetic:
        raise forbidden("Demo accounts cannot purge demo data. Sign in with an institutional admin account.")
    counts = {}
    for model in (Student, Mentor):
        counts[model.__tablename__] = db.execute(delete(model).where(model.is_synthetic.is_(True))).rowcount
    counts["users"] = db.execute(delete(User).where(User.is_synthetic.is_(True))).rowcount
    counts["subjects"] = db.execute(delete(Subject).where(Subject.is_synthetic.is_(True))).rowcount
    counts["departments"] = db.execute(delete(Department).where(Department.is_synthetic.is_(True))).rowcount
    db.execute(delete(DataBatch).where(DataBatch.kind == "synthetic"))
    db.commit()
    audit(db, p.id, "purge_synthetic", "data_batch", None, counts, request)
    return {"ok": True, "deleted": counts, "at": datetime.now(timezone.utc).isoformat()}
