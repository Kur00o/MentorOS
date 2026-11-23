from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.audit import audit
from backend.app.core.database import get_db
from backend.app.core.deps import Principal, can_access_student, get_accessible_student, get_principal, require_roles, scope_students
from backend.app.core.errors import bad_request, conflict, forbidden, not_found
from backend.app.integrations.messaging import notify, post_webhook
from backend.app.models import Meeting, MeetingLog, Mentor, RiskAlert, Student, User
from backend.app.students.service import alert_dict, list_rows, meeting_dict

router = APIRouter()
alerts_router = APIRouter()

Mode = Literal["in_person", "video", "phone"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class MeetingCreate(BaseModel):
    student_id: Optional[int] = None  # students omit this (they request with their own mentor)
    title: str = Field(min_length=3, max_length=200)
    agenda: Optional[str] = Field(default=None, max_length=2000)
    scheduled_at: datetime
    duration_minutes: int = Field(default=30, ge=10, le=180)
    mode: Mode = "in_person"
    location: Optional[str] = Field(default=None, max_length=200)

    @field_validator("scheduled_at")
    @classmethod
    def _future(cls, v: datetime):
        v = _aware(v)
        if v < _now() - timedelta(minutes=5):
            raise ValueError("Meetings must be scheduled in the future")
        if v > _now() + timedelta(days=180):
            raise ValueError("Meetings can be scheduled at most 6 months ahead")
        return v


class MeetingUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=200)
    agenda: Optional[str] = Field(default=None, max_length=2000)
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = Field(default=None, ge=10, le=180)
    mode: Optional[Mode] = None
    location: Optional[str] = Field(default=None, max_length=200)
    status: Optional[Literal["scheduled", "cancelled", "no_show"]] = None

    @field_validator("scheduled_at")
    @classmethod
    def _future(cls, v):
        if v is None:
            return v
        v = _aware(v)
        if v < _now() - timedelta(minutes=5):
            raise ValueError("Meetings must be scheduled in the future")
        return v


class ActionItemIn(BaseModel):
    text: str = Field(min_length=2, max_length=300)
    due: Optional[date] = None
    owner: Literal["student", "mentor"] = "student"


class MeetingLogIn(BaseModel):
    summary: str = Field(min_length=10, max_length=4000)
    topics: list[str] = Field(default_factory=list, max_length=12)
    action_items: list[ActionItemIn] = Field(default_factory=list, max_length=15)
    student_mood: Optional[Literal["thriving", "steady", "stressed", "struggling"]] = None
    follow_up_on: Optional[date] = None
    private_notes: Optional[str] = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def _follow_up(self):
        if self.follow_up_on and self.follow_up_on < date.today():
            raise ValueError("Follow-up date must be today or later")
        return self


class ActionToggle(BaseModel):
    done: bool


class AlertUpdate(BaseModel):
    status: Literal["acknowledged", "resolved", "open"]
    note: Optional[str] = Field(default=None, max_length=1000)


# ── helpers ────────────────────────────────────────────────────────────────
def _meeting_names(db: Session, meetings: list[Meeting]) -> dict:
    if not meetings:
        return {}
    sids = {m.student_id for m in meetings}
    mids = {m.mentor_id for m in meetings}
    students = {sid: (name, usn, band) for sid, name, usn, band in db.execute(
        select(Student.id, User.full_name, Student.usn, Student.risk_category).join(User, User.id == Student.user_id).where(Student.id.in_(sids)))}
    mentors = {mid: name for mid, name in db.execute(
        select(Mentor.id, User.full_name).join(User, User.id == Mentor.user_id).where(Mentor.id.in_(mids)))}
    return {
        m.id: {
            "student_name": students.get(m.student_id, ("", "", ""))[0],
            "student_usn": students.get(m.student_id, ("", "", ""))[1],
            "student_band": students.get(m.student_id, ("", "", ""))[2],
            "mentor_name": mentors.get(m.mentor_id, ""),
        }
        for m in meetings
    }


def _serialize(db: Session, meetings: list[Meeting], p: Principal) -> list[dict]:
    names = _meeting_names(db, meetings)
    return [meeting_dict(m, include_private=p.is_staff(), names=names) for m in meetings]


def _get_meeting(db: Session, p: Principal, meeting_id: int) -> Meeting:
    m = db.get(Meeting, meeting_id)
    if m is None:
        raise not_found("Meeting")
    st = db.get(Student, m.student_id)
    if p.role == "mentor":
        if m.mentor_id != p.mentor_id:
            raise not_found("Meeting")
    elif not can_access_student(p, st):
        raise not_found("Meeting")
    return m


def _check_clash(db: Session, mentor_id: int, start: datetime, minutes: int, exclude: Optional[int] = None) -> None:
    end = start + timedelta(minutes=minutes)
    window = db.scalars(select(Meeting).where(
        Meeting.mentor_id == mentor_id, Meeting.status.in_(("scheduled", "requested")),
        Meeting.scheduled_at >= start - timedelta(hours=4), Meeting.scheduled_at <= end,
    )).all()
    for other in window:
        if exclude and other.id == exclude:
            continue
        o_start = _aware(other.scheduled_at)
        o_end = o_start + timedelta(minutes=other.duration_minutes)
        if o_start < end and start < o_end:
            raise conflict(f"Overlaps with “{other.title}” at {o_start.strftime('%d %b %H:%M UTC')}")


def _users_for(db: Session, m: Meeting) -> tuple[Optional[User], Optional[User]]:
    st = db.get(Student, m.student_id)
    mentor = db.get(Mentor, m.mentor_id)
    return (st.user if st else None), (mentor.user if mentor else None)


# ── meetings ───────────────────────────────────────────────────────────────
@router.get("/meetings")
def list_meetings(
    status: Optional[str] = Query(default=None, pattern="^(requested|scheduled|completed|cancelled|no_show)(,(requested|scheduled|completed|cancelled|no_show))*$"),
    student_id: Optional[int] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    limit: int = Query(default=200, ge=1, le=500),
    p: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    stmt = select(Meeting).join(Student, Student.id == Meeting.student_id)
    if p.role == "mentor":
        stmt = stmt.where(Meeting.mentor_id == (p.mentor_id or -1))
    else:
        stmt = scope_students(stmt, p)
    if status:
        stmt = stmt.where(Meeting.status.in_(status.split(",")))
    if student_id:
        stmt = stmt.where(Meeting.student_id == student_id)
    if start:
        stmt = stmt.where(Meeting.scheduled_at >= _aware(start))
    if end:
        stmt = stmt.where(Meeting.scheduled_at <= _aware(end))
    meetings = db.scalars(stmt.order_by(Meeting.scheduled_at.desc()).limit(limit)).all()
    return _serialize(db, meetings, p)


@router.post("/meetings", status_code=201)
def create_meeting(body: MeetingCreate, request: Request, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if p.role == "student":
        st = db.get(Student, p.student_id)
        if st is None or st.mentor_id is None:
            raise bad_request("You don't have a mentor assigned yet — your HOD will allocate one soon.")
        status, requested_by = "requested", "student"
    else:
        if body.student_id is None:
            raise bad_request("student_id is required")
        st = get_accessible_student(db, p, body.student_id)
        if st.mentor_id is None:
            raise bad_request("This student has no mentor yet. Allocate a mentor first.")
        if p.role == "mentor" and st.mentor_id != p.mentor_id:
            raise forbidden("You can only schedule meetings with your own mentees")
        status, requested_by = "scheduled", ("mentor" if p.role == "mentor" else "hod")
    _check_clash(db, st.mentor_id, body.scheduled_at, body.duration_minutes)
    m = Meeting(
        mentor_id=st.mentor_id, student_id=st.id, title=body.title.strip(), agenda=body.agenda, scheduled_at=body.scheduled_at,
        duration_minutes=body.duration_minutes, mode=body.mode, location=body.location, status=status,
        requested_by=requested_by, created_by=p.id, is_synthetic=False,
    )
    db.add(m)
    db.flush()
    student_user, mentor_user = _users_for(db, m)
    when = _aware(m.scheduled_at).strftime("%a %d %b, %H:%M UTC")
    if status == "requested":
        notify(db, [mentor_user], kind="meeting_request", title=f"{student_user.full_name} requested a meeting",
               body=f"“{m.title}” · {when}", link=f"/mentor/meetings?focus={m.id}", email=True)
    else:
        notify(db, [student_user], kind="meeting_scheduled", title="New mentoring session scheduled",
               body=f"“{m.title}” · {when}", link=f"/student/meetings?focus={m.id}", email=True)
    db.commit()
    audit(db, p.id, "meeting_create", "meeting", m.id, {"student_id": st.id, "status": status}, request)
    return _serialize(db, [m], p)[0]


@router.patch("/meetings/{meeting_id}")
def update_meeting(meeting_id: int, body: MeetingUpdate, request: Request, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    m = _get_meeting(db, p, meeting_id)
    data = body.model_dump(exclude_unset=True)
    if m.status in ("completed", "cancelled"):
        raise conflict(f"This meeting is already {m.status}")
    if p.role == "student":
        allowed = {"status"}
        if set(data) - allowed or data.get("status") not in (None, "cancelled"):
            raise forbidden("Students can only cancel their meetings")
    if data.get("status") == "no_show" and p.role == "student":
        raise forbidden("Only the mentor can mark a no-show")
    if "scheduled_at" in data or "duration_minutes" in data:
        _check_clash(db, m.mentor_id, data.get("scheduled_at", _aware(m.scheduled_at)), data.get("duration_minutes", m.duration_minutes), exclude=m.id)
    previous = m.status
    for k, v in data.items():
        setattr(m, k, v)
    if previous == "requested" and p.role in ("mentor", "hod", "admin") and data.get("status") in (None, "scheduled"):
        m.status = "scheduled"
    student_user, mentor_user = _users_for(db, m)
    if m.status == "cancelled":
        target = mentor_user if p.role == "student" else student_user
        notify(db, [target], kind="meeting_cancelled", title=f"Meeting cancelled: {m.title}", link="/meetings")
    elif previous == "requested" and m.status == "scheduled":
        notify(db, [student_user], kind="meeting_confirmed", title=f"Your mentor confirmed “{m.title}”",
               body=_aware(m.scheduled_at).strftime("%a %d %b, %H:%M UTC"), link=f"/student/meetings?focus={m.id}")
    elif "scheduled_at" in data:
        notify(db, [student_user if p.role != "student" else mentor_user], kind="meeting_rescheduled",
               title=f"Meeting rescheduled: {m.title}", body=_aware(m.scheduled_at).strftime("%a %d %b, %H:%M UTC"), link="/meetings")
    db.commit()
    audit(db, p.id, "meeting_update", "meeting", m.id, {k: str(v) for k, v in data.items()}, request)
    return _serialize(db, [m], p)[0]


@router.post("/meetings/{meeting_id}/log", status_code=201)
def log_meeting(meeting_id: int, body: MeetingLogIn, request: Request, p: Principal = Depends(require_roles("mentor", "admin")), db: Session = Depends(get_db)):
    m = _get_meeting(db, p, meeting_id)
    if m.log is not None:
        raise conflict("This meeting already has a log. Edit it instead.")
    if m.status in ("cancelled", "requested"):
        raise bad_request(f"A {m.status} meeting cannot be logged")
    if _aware(m.scheduled_at) > _now() + timedelta(hours=1):
        raise bad_request("You can log a meeting once it has started")
    items = [{"id": uuid.uuid4().hex[:8], "text": a.text.strip(), "due": a.due.isoformat() if a.due else None, "owner": a.owner, "done": False}
             for a in body.action_items]
    m.log = MeetingLog(summary=body.summary.strip(), topics=[t.strip()[:40] for t in body.topics if t.strip()], action_items=items,
                       student_mood=body.student_mood, follow_up_on=body.follow_up_on, private_notes=body.private_notes, logged_by=p.id)
    m.status = "completed"
    student_user, _ = _users_for(db, m)
    notify(db, [student_user], kind="meeting_logged", title=f"Notes from “{m.title}” are ready",
           body=f"{len(items)} action item{'s' if len(items) != 1 else ''} for you", link=f"/student/meetings?focus={m.id}")
    # Resolve the "no recent meeting" alert immediately.
    for a in db.scalars(select(RiskAlert).where(RiskAlert.student_id == m.student_id, RiskAlert.rule == "no_recent_meeting", RiskAlert.status != "resolved")):
        a.status, a.resolved_at, a.resolved_by, a.resolution_note = "resolved", _now(), p.id, "Mentor meeting completed"
    db.commit()
    audit(db, p.id, "meeting_log", "meeting", m.id, {"action_items": len(items)}, request)
    return _serialize(db, [m], p)[0]


@router.put("/meetings/{meeting_id}/log")
def edit_meeting_log(meeting_id: int, body: MeetingLogIn, request: Request, p: Principal = Depends(require_roles("mentor", "admin")), db: Session = Depends(get_db)):
    m = _get_meeting(db, p, meeting_id)
    if m.log is None:
        raise not_found("Meeting log")
    done = {i.get("text"): i.get("done", False) for i in (m.log.action_items or [])}
    m.log.summary = body.summary.strip()
    m.log.topics = [t.strip()[:40] for t in body.topics if t.strip()]
    m.log.action_items = [{"id": uuid.uuid4().hex[:8], "text": a.text.strip(), "due": a.due.isoformat() if a.due else None,
                           "owner": a.owner, "done": done.get(a.text.strip(), False)} for a in body.action_items]
    m.log.student_mood, m.log.follow_up_on, m.log.private_notes = body.student_mood, body.follow_up_on, body.private_notes
    db.commit()
    audit(db, p.id, "meeting_log_edit", "meeting", m.id, request=request)
    return _serialize(db, [m], p)[0]


@router.patch("/meetings/{meeting_id}/actions/{action_id}")
def toggle_action(meeting_id: int, action_id: str, body: ActionToggle, request: Request, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    m = _get_meeting(db, p, meeting_id)
    if m.log is None:
        raise not_found("Meeting log")
    items = [dict(i) for i in (m.log.action_items or [])]
    for item in items:
        if item.get("id") == action_id:
            item["done"] = body.done
            item["done_at"] = _now().isoformat() if body.done else None
            break
    else:
        raise not_found("Action item")
    m.log.action_items = items  # reassign so JSON change is persisted
    db.commit()
    audit(db, p.id, "action_item_toggle", "meeting", m.id, {"action_id": action_id, "done": body.done}, request)
    return {"ok": True, "action_items": items}


# ── mentor dashboard ───────────────────────────────────────────────────────
@router.get("/dashboard")
def mentor_dashboard(p: Principal = Depends(require_roles("mentor")), db: Session = Depends(get_db)):
    mentor = db.get(Mentor, p.mentor_id) if p.mentor_id else None
    if mentor is None:
        raise not_found("Mentor profile")
    students = db.scalars(select(Student).where(Student.mentor_id == mentor.id)).all()
    rows = list_rows(db, students)
    now = _now()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    meetings = db.scalars(select(Meeting).where(Meeting.mentor_id == mentor.id)).all()
    upcoming = sorted([m for m in meetings if m.status in ("scheduled", "requested") and _aware(m.scheduled_at) >= now - timedelta(hours=1)],
                      key=lambda m: m.scheduled_at)[:12]
    requests = [m for m in meetings if m.status == "requested"]
    recent_logs = sorted([m for m in meetings if m.log is not None], key=lambda m: m.log.logged_at, reverse=True)[:6]
    open_actions = sum(1 for m in meetings if m.log for a in (m.log.action_items or []) if not a.get("done"))
    alerts = db.scalars(select(RiskAlert).join(Student, Student.id == RiskAlert.student_id)
                        .where(Student.mentor_id == mentor.id, RiskAlert.status == "open")
                        .order_by(RiskAlert.severity, RiskAlert.created_at.desc())).all()
    sev_rank = {"high": 0, "medium": 1, "low": 2}
    alerts = sorted(alerts, key=lambda a: (sev_rank.get(a.severity, 3), -(a.created_at.timestamp() if a.created_at else 0)))

    def priority(r):
        band_rank = {"coral": 0, "amber": 1, "insufficient_data": 2, "green": 3}[r["band"]]
        return (-r["high_alerts"], band_rank, r["delta"] or 0, r["score"] or 0)

    attention = sorted([r for r in rows if r["band"] in ("coral", "amber") or r["high_alerts"]], key=priority)[:8]
    bands = {b: sum(1 for r in rows if r["band"] == b) for b in ("green", "amber", "coral", "insufficient_data")}
    scored = [r["score"] for r in rows if r["score"] is not None]
    completed_month = sum(1 for m in meetings if m.status == "completed" and _aware(m.scheduled_at) >= month_start)
    covered = {m.student_id for m in meetings if m.status == "completed" and _aware(m.scheduled_at) >= now - timedelta(days=45)}
    return {
        "mentor": {"id": mentor.id, "name": p.user.full_name, "designation": mentor.designation, "department": mentor.department.code,
                   "max_mentees": mentor.max_mentees, "specialization": mentor.specialization},
        "kpis": {
            "mentees": len(rows), "capacity": mentor.max_mentees, "avg_score": round(sum(scored) / len(scored), 1) if scored else None,
            "bands": bands, "open_alerts": len(alerts), "high_alerts": sum(1 for a in alerts if a.severity == "high"),
            "meetings_this_month": completed_month, "pending_requests": len(requests), "open_action_items": open_actions,
            "coverage_45d": round(len(covered) / len(rows) * 100) if rows else 0,
        },
        "attention": attention,
        "roster": rows,
        "upcoming": _serialize(db, upcoming, p),
        "recent_logs": _serialize(db, recent_logs, p),
        "alerts": [dict(alert_dict(a), student_name=next((r["name"] for r in rows if r["id"] == a.student_id), "")) for a in alerts[:20]],
    }


# ── alerts ─────────────────────────────────────────────────────────────────
@alerts_router.get("")
def list_alerts(
    status: Literal["open", "acknowledged", "resolved", "active", "all"] = "active",
    severity: Optional[Literal["high", "medium", "low"]] = None,
    student_id: Optional[int] = None,
    limit: int = Query(default=200, ge=1, le=500),
    p: Principal = Depends(require_roles("mentor", "hod", "admin")),
    db: Session = Depends(get_db),
):
    stmt = scope_students(select(RiskAlert, Student, User).join(Student, Student.id == RiskAlert.student_id).join(User, User.id == Student.user_id), p)
    if status == "active":
        stmt = stmt.where(RiskAlert.status != "resolved")
    elif status != "all":
        stmt = stmt.where(RiskAlert.status == status)
    if severity:
        stmt = stmt.where(RiskAlert.severity == severity)
    if student_id:
        stmt = stmt.where(RiskAlert.student_id == student_id)
    rows = db.execute(stmt.order_by(RiskAlert.created_at.desc()).limit(limit)).all()
    sev = {"high": 0, "medium": 1, "low": 2}
    out = [dict(alert_dict(a), student_name=u.full_name, student_usn=s.usn, student_band=s.risk_category, student_score=s.success_score)
           for a, s, u in rows]
    out.sort(key=lambda a: (a["status"] == "resolved", sev.get(a["severity"], 3)))
    return out


@alerts_router.patch("/{alert_id}")
def update_alert(alert_id: int, body: AlertUpdate, request: Request, p: Principal = Depends(require_roles("mentor", "hod", "admin")), db: Session = Depends(get_db)):
    a = db.get(RiskAlert, alert_id)
    if a is None:
        raise not_found("Alert")
    get_accessible_student(db, p, a.student_id)
    a.status = body.status
    if body.status == "resolved":
        a.resolved_at, a.resolved_by, a.resolution_note = _now(), p.id, body.note or "Resolved by staff"
    elif body.status == "open":
        a.resolved_at = a.resolved_by = None
    if body.note and body.status != "resolved":
        a.resolution_note = body.note
    db.commit()
    audit(db, p.id, "alert_update", "risk_alert", a.id, body.model_dump(), request)
    return alert_dict(a)


def broadcast_high_alerts(db: Session, alerts: list[RiskAlert]) -> None:
    """Notify the student's mentor (and webhook) about new high-severity alerts."""
    for a in alerts:
        if a.severity != "high":
            continue
        st = db.get(Student, a.student_id)
        if st and st.mentor_id:
            mentor = db.get(Mentor, st.mentor_id)
            notify(db, [mentor.user], kind="risk_alert", title=f"High risk: {st.user.full_name}", body=a.detail,
                   link=f"/mentor/students/{st.id}")
        post_webhook(f"MentorOS high-risk alert · {st.usn if st else a.student_id}: {a.title}")

