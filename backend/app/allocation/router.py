"""Mentor allocation: workload overview, risk-prioritised auto-allocation
(per-department min-heap — see engine.py), manual (re)assignment and
capacity management. Enforces docs/allocation-rules.md:
  1. same department only, 2. never exceed capacity, 3. balanced load,
  4. Coral/Amber students are matched first."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.allocation import engine
from backend.app.core.audit import audit
from backend.app.core.database import get_db
from backend.app.core.deps import Principal, get_accessible_student, require_department_scope, require_roles
from backend.app.core.errors import bad_request, not_found
from backend.app.integrations.messaging import notify
from backend.app.models import Allocation, Department, Mentor, Student, User
from backend.app.students.service import iso, list_rows

router = APIRouter()


class AutoAllocateIn(BaseModel):
    department_id: Optional[int] = None
    dry_run: bool = True


class AssignIn(BaseModel):
    student_id: int
    mentor_id: int
    reason: Optional[str] = Field(default=None, max_length=300)


class CapacityIn(BaseModel):
    max_mentees: Optional[int] = Field(default=None, ge=0, le=60)
    is_accepting: Optional[bool] = None


def _loads(db: Session, mentor_ids: list[int]) -> dict[int, int]:
    if not mentor_ids:
        return {}
    return dict(db.execute(
        select(Student.mentor_id, func.count(Student.id)).where(Student.mentor_id.in_(mentor_ids)).group_by(Student.mentor_id)
    ).all())


def _mentor_rows(db: Session, mentors: list[Mentor]) -> list[dict]:
    ids = [m.id for m in mentors]
    loads = _loads(db, ids)
    bands: dict[int, dict] = defaultdict(lambda: defaultdict(int))
    scores: dict[int, list] = defaultdict(list)
    for mid, band, score in db.execute(select(Student.mentor_id, Student.risk_category, Student.success_score).where(Student.mentor_id.in_(ids))):
        bands[mid][band] += 1
        if score is not None:
            scores[mid].append(score)
    return [{
        "id": m.id, "user_id": m.user_id, "name": m.user.full_name, "email": m.user.email, "avatar_url": m.user.avatar_url,
        "designation": m.designation, "specialization": m.specialization, "department": m.department.code,
        "department_id": m.department_id, "load": loads.get(m.id, 0), "capacity": m.max_mentees, "is_accepting": m.is_accepting,
        "bands": {b: bands[m.id].get(b, 0) for b in ("green", "amber", "coral", "insufficient_data")},
        "avg_score": round(sum(scores[m.id]) / len(scores[m.id]), 1) if scores[m.id] else None,
    } for m in mentors]


def _record(db: Session, student: Student, mentor: Mentor, p: Principal, method: str, reason: Optional[str]) -> None:
    now = datetime.now(timezone.utc)
    for prev in db.scalars(select(Allocation).where(Allocation.student_id == student.id, Allocation.ended_at.is_(None))):
        prev.ended_at = now
    db.add(Allocation(student_id=student.id, mentor_id=mentor.id, allocated_by=p.id, method=method, reason=reason, started_at=now,
                      is_synthetic=student.is_synthetic and mentor.is_synthetic, batch_id=student.batch_id))
    student.mentor_id = mentor.id


@router.get("/overview")
def overview(department_id: Optional[int] = None, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    dept_id = require_department_scope(p, department_id)
    m_stmt = select(Mentor).join(User, User.id == Mentor.user_id).where(User.is_active.is_(True))
    s_stmt = select(Student).where(Student.mentor_id.is_(None), Student.status == "active")
    if dept_id:
        m_stmt = m_stmt.where(Mentor.department_id == dept_id)
        s_stmt = s_stmt.where(Student.department_id == dept_id)
    mentors = _mentor_rows(db, db.scalars(m_stmt.order_by(User.full_name)).all())
    pending = list_rows(db, db.scalars(s_stmt).all())
    order = engine.RISK_ORDER
    pending.sort(key=lambda r: (order.get(r["band"], 9), r["score"] if r["score"] is not None else 999))
    total_q = select(func.count(Student.id)).where(Student.status == "active")
    if dept_id:
        total_q = total_q.where(Student.department_id == dept_id)
    total = db.scalar(total_q) or 0
    capacity = sum(m["capacity"] for m in mentors if m["is_accepting"])
    assigned = sum(m["load"] for m in mentors)
    departments = [{"id": d.id, "code": d.code, "name": d.name} for d in db.scalars(select(Department).order_by(Department.code))] if p.role == "admin" else []
    return {
        "department_id": dept_id, "departments": departments, "mentors": mentors, "pending": pending,
        "stats": {
            "students": total, "assigned": assigned, "unassigned": len(pending), "capacity": capacity,
            "free_seats": max(0, capacity - assigned), "utilisation": round(assigned / capacity * 100, 1) if capacity else 0,
            "at_risk_unassigned": sum(1 for r in pending if r["band"] in ("coral", "amber")),
        },
    }


@router.post("/auto")
def auto_allocate(body: AutoAllocateIn, request: Request, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    dept_id = require_department_scope(p, body.department_id)
    s_stmt = select(Student).where(Student.mentor_id.is_(None), Student.status == "active")
    m_stmt = select(Mentor).join(User, User.id == Mentor.user_id).where(User.is_active.is_(True), Mentor.is_accepting.is_(True))
    if dept_id:
        s_stmt = s_stmt.where(Student.department_id == dept_id)
        m_stmt = m_stmt.where(Mentor.department_id == dept_id)
    students = db.scalars(s_stmt).all()
    mentors = db.scalars(m_stmt).all()
    by_dept_s: dict[str, list] = defaultdict(list)
    for s in students:
        by_dept_s[str(s.department_id)].append({"id": s.id, "risk_status": s.risk_category, "score": s.success_score})
    by_dept_m: dict[str, list] = defaultdict(list)
    for m in mentors:
        by_dept_m[str(m.department_id)].append({"id": m.id, "max_mentees": m.max_mentees})
    result = engine.allocate(dict(by_dept_s), dict(by_dept_m), _loads(db, [m.id for m in mentors]))
    s_map = {s.id: s for s in students}
    m_map = {m.id: m for m in mentors}
    plan = [{
        "student_id": sid, "student_name": s_map[sid].user.full_name, "usn": s_map[sid].usn, "band": s_map[sid].risk_category,
        "score": s_map[sid].success_score, "mentor_id": mid, "mentor_name": m_map[mid].user.full_name,
    } for sid, mid in result["plan"]]
    if not body.dry_run and plan:
        for sid, mid in result["plan"]:
            _record(db, s_map[sid], m_map[mid], p, "auto", "Risk-prioritised auto-allocation")
        per_mentor: dict[int, int] = defaultdict(int)
        for _, mid in result["plan"]:
            per_mentor[mid] += 1
        for mid, n in per_mentor.items():
            notify(db, [m_map[mid].user], kind="allocation", title=f"{n} new mentee{'s' if n > 1 else ''} assigned to you",
                   link="/mentor/mentees")
        notify(db, [s_map[sid].user for sid, _ in result["plan"]], kind="allocation", title="You have been assigned a mentor",
               link="/student")
        db.commit()
        audit(db, p.id, "allocation_auto", "department", dept_id, {"allocated": len(plan), "skipped": result["stats"]["skipped"]}, request)
    return {"dry_run": body.dry_run, "plan": plan, "allocated": len(plan), "skipped": result["stats"]["skipped"],
            "message": "Capacity exhausted for some students — raise mentor capacity or add mentors." if result["stats"]["skipped"] else None}


@router.post("/assign")
def assign(body: AssignIn, request: Request, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    st = get_accessible_student(db, p, body.student_id)
    mentor = db.get(Mentor, body.mentor_id)
    if mentor is None:
        raise not_found("Mentor")
    require_department_scope(p, mentor.department_id)
    if mentor.department_id != st.department_id:
        raise bad_request("Inter-departmental mentoring is not allowed: student and mentor must share a department.", code="department_mismatch")
    if st.mentor_id == mentor.id:
        raise bad_request("The student is already assigned to this mentor.")
    load = _loads(db, [mentor.id]).get(mentor.id, 0)
    if load >= mentor.max_mentees:
        raise bad_request(f"{mentor.user.full_name} is at full capacity ({mentor.max_mentees}). Raise their capacity first.", code="capacity_reached")
    previous = db.get(Mentor, st.mentor_id) if st.mentor_id else None
    _record(db, st, mentor, p, "manual", body.reason)
    notify(db, [mentor.user], kind="allocation", title=f"New mentee: {st.user.full_name}", link=f"/mentor/students/{st.id}")
    notify(db, [st.user], kind="allocation", title=f"Your mentor is now {mentor.user.full_name}", link="/student")
    if previous:
        notify(db, [previous.user], kind="allocation", title=f"{st.user.full_name} was reassigned to {mentor.user.full_name}")
    db.commit()
    audit(db, p.id, "allocation_assign", "student", st.id, {"mentor_id": mentor.id, "previous_mentor_id": previous.id if previous else None,
                                                             "reason": body.reason}, request)
    return {"ok": True, "student_id": st.id, "mentor_id": mentor.id, "reassigned": previous is not None}


@router.delete("/students/{student_id}")
def unassign(student_id: int, request: Request, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    st = get_accessible_student(db, p, student_id)
    if st.mentor_id is None:
        raise bad_request("This student has no mentor assigned.")
    old = st.mentor_id
    for prev in db.scalars(select(Allocation).where(Allocation.student_id == st.id, Allocation.ended_at.is_(None))):
        prev.ended_at = datetime.now(timezone.utc)
    st.mentor_id = None
    db.commit()
    audit(db, p.id, "allocation_unassign", "student", st.id, {"mentor_id": old}, request)
    return {"ok": True}


@router.patch("/mentors/{mentor_id}")
def update_capacity(mentor_id: int, body: CapacityIn, request: Request, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    mentor = db.get(Mentor, mentor_id)
    if mentor is None:
        raise not_found("Mentor")
    require_department_scope(p, mentor.department_id)
    if body.max_mentees is not None:
        load = _loads(db, [mentor.id]).get(mentor.id, 0)
        if body.max_mentees < load:
            raise bad_request(f"Capacity cannot be below the current load ({load}). Reassign mentees first.")
        mentor.max_mentees = body.max_mentees
    if body.is_accepting is not None:
        mentor.is_accepting = body.is_accepting
    db.commit()
    audit(db, p.id, "mentor_capacity", "mentor", mentor.id, body.model_dump(exclude_none=True), request)
    return _mentor_rows(db, [mentor])[0]


@router.get("/history")
def history(student_id: Optional[int] = None, limit: int = 100, p: Principal = Depends(require_roles("hod", "admin")), db: Session = Depends(get_db)):
    stmt = select(Allocation, Student, Mentor).join(Student, Student.id == Allocation.student_id).join(Mentor, Mentor.id == Allocation.mentor_id)
    if p.role == "hod":
        stmt = stmt.where(Student.department_id == p.department_id)
    if student_id:
        stmt = stmt.where(Allocation.student_id == student_id)
    rows = db.execute(stmt.order_by(Allocation.started_at.desc()).limit(min(limit, 500))).all()
    return [{
        "id": a.id, "student_id": s.id, "student_name": s.user.full_name, "usn": s.usn, "mentor_id": m.id, "mentor_name": m.user.full_name,
        "method": a.method, "reason": a.reason, "started_at": iso(a.started_at), "ended_at": iso(a.ended_at),
    } for a, s, m in rows]
