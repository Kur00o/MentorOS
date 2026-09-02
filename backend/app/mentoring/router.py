from typing import Any, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.audit import write_audit
from backend.app.auth.router import get_current_user, require_role
from backend.app.models.user import User
from backend.app.models.student import Student
from backend.app.models.mentor import Mentor
from backend.app.models.meeting import Meeting, MeetingLog
from backend.app.models.academic import StudentSuccessScore
from backend.app.mentoring import schemas as mentoring_schemas
from backend.app.students import schemas as student_schemas

router = APIRouter()


# ============================================
# HELPER — Resolve mentor from current user
# ============================================

def _get_mentor_for_user(db: Session, current_user: User) -> Mentor:
    """Get the Mentor record associated with the logged-in user."""
    mentor = db.query(Mentor).filter(Mentor.user_id == current_user.id).first()
    if not mentor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No mentor profile found for current user"
        )
    return mentor


RISK_STATUS_TO_CATEGORY = {
    "Green": "green",
    "Amber": "amber",
    "Coral": "coral",
    "Insufficient": "insufficient_data",
}


def _latest_score_rows(db: Session, student_ids: list) -> dict:
    """Latest StudentSuccessScore per student, keyed by student_id."""
    if not student_ids:
        return {}

    rows = (
        db.query(StudentSuccessScore)
        .filter(StudentSuccessScore.student_id.in_(student_ids))
        .order_by(StudentSuccessScore.student_id, StudentSuccessScore.computed_at.desc())
        .all()
    )
    latest = {}
    for row in rows:
        latest.setdefault(row.student_id, row)
    return latest


def _resolve_score(student: Student, score_row) -> dict:
    """
    Work out what to show for a student's score.

    The scoring engine's history row wins when it exists — it carries the four
    components and the authoritative risk category. Otherwise we fall back to
    the value mirrored onto `students` (see PRD 4.5), which has no component
    breakdown. Either way, no score means `insufficient_data` — never 0.
    """
    if score_row is not None:
        return {
            "attendance_component": score_row.attendance_component,
            "academic_component": score_row.academic_component,
            "engagement_component": score_row.engagement_component,
            "placement_component": score_row.placement_component,
            "success_score": score_row.total_score,
            "risk_status": (
                score_row.risk_category
                if score_row.total_score is not None
                else "insufficient_data"
            ),
        }

    risk = RISK_STATUS_TO_CATEGORY.get(student.risk_status or "", "insufficient_data")
    return {
        "attendance_component": None,
        "academic_component": None,
        "engagement_component": None,
        "placement_component": None,
        "success_score": student.success_score,
        "risk_status": risk if student.success_score is not None else "insufficient_data",
    }


def _open_action_item_counts(db: Session, student_ids: list) -> dict:
    """
    Action items recorded against each student's meeting logs.

    `MeetingLog.action_items` has no completion flag, so every recorded item
    counts. Closing items isn't supported yet.
    """
    if not student_ids:
        return {}

    rows = (
        db.query(Meeting.student_id, MeetingLog.action_items)
        .join(MeetingLog, MeetingLog.meeting_id == Meeting.id)
        .filter(Meeting.student_id.in_(student_ids))
        .all()
    )
    counts = {}
    for student_id, action_items in rows:
        counts[student_id] = counts.get(student_id, 0) + len(action_items or [])
    return counts


def _enrich_meeting(meeting: Meeting, db: Session) -> mentoring_schemas.MeetingResponse:
    """Turn a Meeting ORM object into a MeetingResponse with student/mentor names."""
    student = db.query(Student).filter(Student.id == meeting.student_id).first()
    mentor = db.query(Mentor).filter(Mentor.id == meeting.mentor_id).first()

    student_name = student.user.full_name if student and student.user else "Unknown"
    mentor_name = mentor.user.full_name if mentor and mentor.user else "Unknown"

    return mentoring_schemas.MeetingResponse(
        id=meeting.id,
        title=meeting.title,
        date=meeting.date,
        mode=meeting.mode,
        notes=meeting.notes,
        status=meeting.status,
        mentor_id=meeting.mentor_id,
        student_id=meeting.student_id,
        student_name=student_name,
        mentor_name=mentor_name,
    )


# ============================================
# ROSTER ENDPOINTS
# ============================================

@router.get("/roster", response_model=List[mentoring_schemas.MentorRosterItem])
def get_mentor_roster(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get list of students assigned to the current mentor, enriched with
    score data, risk status, and meeting context.
    """
    if current_user.role != "Mentor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only mentors can access their roster"
        )

    mentor = _get_mentor_for_user(db, current_user)
    students = db.query(Student).filter(Student.mentor_id == mentor.id).all()

    student_ids = [s.id for s in students]
    score_rows = _latest_score_rows(db, student_ids)
    action_item_counts = _open_action_item_counts(db, student_ids)

    now = datetime.utcnow()
    roster_items = []

    for student in students:
        # Last completed meeting
        last_meeting = (
            db.query(Meeting)
            .filter(
                Meeting.mentor_id == mentor.id,
                Meeting.student_id == student.id,
                Meeting.status == "Completed",
            )
            .order_by(Meeting.date.desc())
            .first()
        )

        # Next scheduled meeting
        next_meeting = (
            db.query(Meeting)
            .filter(
                Meeting.mentor_id == mentor.id,
                Meeting.student_id == student.id,
                Meeting.status == "Scheduled",
                Meeting.date >= now,
            )
            .order_by(Meeting.date.asc())
            .first()
        )

        roster_items.append(
            mentoring_schemas.MentorRosterItem(
                student_id=student.id,
                usn=student.usn,
                full_name=student.user.full_name if student.user else "Unknown",
                email=student.user.email if student.user else "",
                department=student.department,
                semester=student.semester,
                consent_given=student.consent_given,
                last_meeting=_enrich_meeting(last_meeting, db) if last_meeting else None,
                next_meeting=_enrich_meeting(next_meeting, db) if next_meeting else None,
                open_action_items=action_item_counts.get(student.id, 0),
                **_resolve_score(student, score_rows.get(student.id)),
            )
        )

    # Lowest score first so the students who need attention lead the roster;
    # unscored students sort last since we don't know where they belong.
    roster_items.sort(
        key=lambda item: (item.success_score is None, item.success_score or 0.0)
    )
    return roster_items


# ============================================
# ALLOCATION ENDPOINTS
# ============================================

@router.post("/allocate", response_model=mentoring_schemas.AllocationResponse)
def allocate_student(
    request: mentoring_schemas.AllocationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Allocate a student to a mentor.
    Enforces:
      1. Department alignment (student.department == mentor.department)
      2. Capacity limits (current mentees < mentor.max_mentees)
    Only HOD and Admin can allocate.
    """
    if current_user.role not in ("HOD", "Admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HOD and Admin can allocate students"
        )

    student = db.query(Student).filter(Student.id == request.student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with id {request.student_id} not found"
        )

    mentor = db.query(Mentor).filter(Mentor.id == request.mentor_id).first()
    if not mentor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Mentor with id {request.mentor_id} not found"
        )

    # Rule 1: Department alignment
    if student.department != mentor.department:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Department mismatch: student is in '{student.department}', mentor is in '{mentor.department}'. "
                   f"Inter-departmental mentoring is not allowed."
        )

    # Rule 2: Capacity check
    current_mentee_count = db.query(Student).filter(Student.mentor_id == mentor.id).count()
    if current_mentee_count >= mentor.max_mentees:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mentor has reached maximum capacity ({mentor.max_mentees} mentees). "
                   f"Cannot allocate more students."
        )

    # Check if student is already allocated
    if student.mentor_id is not None:
        old_mentor = db.query(Mentor).filter(Mentor.id == student.mentor_id).first()
        old_name = old_mentor.user.full_name if old_mentor and old_mentor.user else "Unknown"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Student is already allocated to mentor '{old_name}' (id={student.mentor_id}). "
                   f"Deallocate first before reassigning."
        )

    # Perform allocation
    student.mentor_id = mentor.id
    db.commit()
    db.refresh(student)

    # Write audit log
    write_audit(
        db,
        current_user.id,
        "allocate_student",
        "student",
        student.id,
        details={"mentor_id": mentor.id},
    )

    return mentoring_schemas.AllocationResponse(
        student_id=student.id,
        mentor_id=mentor.id,
        student_name=student.user.full_name if student.user else "Unknown",
        mentor_name=mentor.user.full_name if mentor.user else "Unknown",
        department=student.department,
        message="Student successfully allocated to mentor",
    )


@router.delete("/allocate/{student_id}", response_model=mentoring_schemas.AllocationResponse)
def deallocate_student(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Remove a student from their currently assigned mentor.
    Only HOD and Admin can deallocate.
    """
    if current_user.role not in ("HOD", "Admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HOD and Admin can deallocate students"
        )

    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Student with id {student_id} not found"
        )

    if student.mentor_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student is not currently allocated to any mentor"
        )

    old_mentor = db.query(Mentor).filter(Mentor.id == student.mentor_id).first()
    old_mentor_name = old_mentor.user.full_name if old_mentor and old_mentor.user else "Unknown"

    student.mentor_id = None
    db.commit()
    db.refresh(student)

    return mentoring_schemas.AllocationResponse(
        student_id=student.id,
        mentor_id=old_mentor.id if old_mentor else 0,
        student_name=student.user.full_name if student.user else "Unknown",
        mentor_name=old_mentor_name,
        department=student.department,
        message="Student successfully deallocated from mentor",
    )


# ============================================
# MEETING ENDPOINTS
# ============================================

@router.get("/meetings", response_model=List[mentoring_schemas.MeetingResponse])
def get_meetings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get all meetings for the current mentor.
    Students see their own meetings, mentors see their roster's meetings.
    HODs and Admins see all meetings.
    """
    if current_user.role == "Mentor":
        mentor = _get_mentor_for_user(db, current_user)
        meetings = db.query(Meeting).filter(Meeting.mentor_id == mentor.id).order_by(Meeting.date.desc()).all()
    elif current_user.role == "Student":
        student = current_user.student_profile
        if not student:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No student profile found")
        meetings = db.query(Meeting).filter(Meeting.student_id == student.id).order_by(Meeting.date.desc()).all()
    elif current_user.role in ("HOD", "Admin"):
        meetings = db.query(Meeting).order_by(Meeting.date.desc()).all()
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")

    return [_enrich_meeting(m, db) for m in meetings]


@router.post("/meetings", response_model=mentoring_schemas.MeetingResponse, status_code=status.HTTP_201_CREATED)
def schedule_meeting(
    meeting_data: mentoring_schemas.MeetingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Schedule a new meeting with a student.
    Mentors can only schedule meetings with their own mentees.
    """
    if current_user.role != "Mentor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only mentors can schedule meetings"
        )

    mentor = _get_mentor_for_user(db, current_user)

    # Verify the student is in this mentor's roster
    student = db.query(Student).filter(
        Student.id == meeting_data.student_id,
        Student.mentor_id == mentor.id,
    ).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student is not in your roster. You can only schedule meetings with your own mentees."
        )

    new_meeting = Meeting(
        mentor_id=mentor.id,
        student_id=meeting_data.student_id,
        title=meeting_data.title,
        date=meeting_data.date,
        mode=meeting_data.mode,
        notes=meeting_data.notes,
        status=meeting_data.status or "Scheduled",
    )
    db.add(new_meeting)
    db.commit()
    db.refresh(new_meeting)

    return _enrich_meeting(new_meeting, db)


@router.get("/meetings/{meeting_id}", response_model=mentoring_schemas.MeetingResponse)
def get_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Get a specific meeting by ID."""
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting with id {meeting_id} not found"
        )

    # Access control
    if current_user.role == "Mentor":
        mentor = _get_mentor_for_user(db, current_user)
        if meeting.mentor_id != mentor.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your meeting")
    elif current_user.role == "Student":
        student = current_user.student_profile
        if not student or meeting.student_id != student.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your meeting")

    return _enrich_meeting(meeting, db)


@router.put("/meetings/{meeting_id}", response_model=mentoring_schemas.MeetingResponse)
def update_meeting(
    meeting_id: int,
    update: mentoring_schemas.MeetingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Update a meeting — add notes, change date/title, or mark as Completed/Cancelled.
    Only the owning mentor can update.
    """
    if current_user.role != "Mentor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only mentors can update meetings"
        )

    mentor = _get_mentor_for_user(db, current_user)
    meeting = db.query(Meeting).filter(
        Meeting.id == meeting_id,
        Meeting.mentor_id == mentor.id,
    ).first()

    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting with id {meeting_id} not found or doesn't belong to you"
        )

    # Apply updates
    if update.title is not None:
        meeting.title = update.title
    if update.date is not None:
        meeting.date = update.date
    if update.notes is not None:
        meeting.notes = update.notes
    if update.status is not None:
        meeting.status = update.status

    db.commit()
    db.refresh(meeting)

    return _enrich_meeting(meeting, db)


@router.delete("/meetings/{meeting_id}")
def delete_meeting(
    meeting_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """Delete a meeting. Only the owning mentor can delete."""
    if current_user.role != "Mentor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only mentors can delete meetings"
        )

    mentor = _get_mentor_for_user(db, current_user)
    meeting = db.query(Meeting).filter(
        Meeting.id == meeting_id,
        Meeting.mentor_id == mentor.id,
    ).first()

    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting with id {meeting_id} not found or doesn't belong to you"
        )

    db.delete(meeting)
    db.commit()

    return {"message": f"Meeting {meeting_id} deleted successfully"}


@router.post("/meetings/{meeting_id}/log", status_code=status.HTTP_201_CREATED)
def log_meeting(
    meeting_id: int,
    payload: mentoring_schemas.MeetingLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role("Mentor", "Admin")),
) -> Any:
    """
    Record a structured log for a completed meeting (topics, action items,
    next date, observations) and mark the meeting completed. Mentors may only
    log their own meetings.
    """
    meeting = db.query(Meeting).filter(Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found"
        )

    if current_user.role == "Mentor":
        mentor = db.query(Mentor).filter(Mentor.user_id == current_user.id).first()
        if not mentor or meeting.mentor_id != mentor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot log another mentor's meeting",
            )

    if meeting.log:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This meeting has already been logged",
        )

    log = MeetingLog(
        meeting_id=meeting.id,
        topics_discussed=payload.topics_discussed,
        action_items=payload.action_items,
        next_meeting_date=payload.next_meeting_date,
        observations=payload.observations,
        logged_by=current_user.id,
    )
    meeting.status = "Completed"
    db.add(log)
    db.commit()
    db.refresh(log)

    write_audit(db, current_user.id, "log_meeting", "meeting", meeting.id)

    return {"message": "Meeting logged", "log_id": log.id}


@router.get("/students/{student_id}/meetings")
def get_student_meetings(
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Return a student's meetings (newest first) with their structured logs.
    Students may only view their own meetings.
    """
    student = db.query(Student).filter(Student.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Student not found"
        )

    if current_user.role == "Student" and student.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot view another student's meetings",
        )

    if current_user.role == "Mentor":
        mentor = _get_mentor_for_user(db, current_user)
        if student.mentor_id != mentor.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Student is not in your roster",
            )

    meetings = (
        db.query(Meeting)
        .filter(Meeting.student_id == student_id)
        .order_by(Meeting.date.desc())
        .all()
    )

    return [
        {
            "id": m.id,
            "student_id": m.student_id,
            "mentor_id": m.mentor_id,
            "title": m.title,
            "date": m.date.isoformat() if m.date else None,
            "mode": m.mode,
            "status": m.status,
            "log": (
                {
                    "topics_discussed": m.log.topics_discussed,
                    "action_items": m.log.action_items,
                    "next_meeting_date": (
                        m.log.next_meeting_date.isoformat()
                        if m.log.next_meeting_date
                        else None
                    ),
                    "observations": m.log.observations,
                    "logged_at": m.log.logged_at.isoformat() if m.log.logged_at else None,
                }
                if m.log
                else None
            ),
        }
        for m in meetings
    ]


# ============================================
# MENTOR DASHBOARD
# ============================================

@router.get("/dashboard", response_model=mentoring_schemas.MentorDashboardStats)
def get_mentor_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    """
    Get aggregated dashboard statistics for the current mentor:
    - Total mentees count
    - At-risk / needs-attention / on-track counts
    - Upcoming and completed meeting counts
    - Average success score
    """
    if current_user.role != "Mentor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only mentors can access their dashboard"
        )

    mentor = _get_mentor_for_user(db, current_user)
    students = db.query(Student).filter(Student.mentor_id == mentor.id).all()

    # Resolved the same way as the roster so the tiles and the table agree.
    score_rows = _latest_score_rows(db, [s.id for s in students])
    resolved = [_resolve_score(s, score_rows.get(s.id)) for s in students]

    at_risk = sum(1 for r in resolved if r["risk_status"] == "coral")
    needs_attention = sum(1 for r in resolved if r["risk_status"] == "amber")
    on_track = sum(1 for r in resolved if r["risk_status"] == "green")

    now = datetime.utcnow()
    upcoming = db.query(Meeting).filter(
        Meeting.mentor_id == mentor.id,
        Meeting.status == "Scheduled",
        Meeting.date >= now,
    ).count()

    completed = db.query(Meeting).filter(
        Meeting.mentor_id == mentor.id,
        Meeting.status == "Completed",
    ).count()

    # Unscored students are left out rather than counted as zero, which would
    # drag the average down and misrepresent the cohort.
    scored = [r["success_score"] for r in resolved if r["success_score"] is not None]
    avg_score = sum(scored) / len(scored) if scored else 0.0

    return mentoring_schemas.MentorDashboardStats(
        total_mentees=len(students),
        at_risk_count=at_risk,
        needs_attention_count=needs_attention,
        on_track_count=on_track,
        upcoming_meetings=upcoming,
        completed_meetings=completed,
        avg_success_score=round(avg_score, 2),
    )
