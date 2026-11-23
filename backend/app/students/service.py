"""Builds the Student 360° payload (used by the student's own dashboard and
by mentors/HODs/admins), plus compact list rows."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.deps import Principal
from backend.app.models import (
    AttendanceRecord,
    AttendanceWeekly,
    Department,
    LmsActivity,
    LmsWeekly,
    MarkRecord,
    Meeting,
    MeetingLog,
    Mentor,
    PlacementOffer,
    RiskAlert,
    SemesterResult,
    Student,
    StudentConsent,
    StudentSuccessScore,
    Subject,
    User,
)
from backend.app.scoring import formula

CONSENT_CATEGORIES = ("academic", "attendance", "placement", "wellness")


def iso(dt) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, datetime) and dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def person(user: Optional[User]) -> Optional[dict]:
    if user is None:
        return None
    return {"id": user.id, "name": user.full_name, "email": user.email, "avatar_url": user.avatar_url}


def consent_state(student: Student) -> dict:
    explicit = {c.category: c for c in student.consents}
    out = {}
    for cat in CONSENT_CATEGORIES:
        c = explicit.get(cat)
        consented = c.consented if c else (False if cat == "wellness" else True)
        out[cat] = {
            "consented": consented,
            "notice_version": c.notice_version if c else settings.PRIVACY_NOTICE_VERSION,
            "decided_at": iso(c.decided_at) if c else None,
            "locked": cat == "wellness" or student.is_under_18,
        }
    return out


def mentor_card(db: Session, mentor_id: Optional[int]) -> Optional[dict]:
    if not mentor_id:
        return None
    m = db.get(Mentor, mentor_id)
    if not m:
        return None
    return {
        "id": m.id, "user_id": m.user_id, "name": m.user.full_name, "email": m.user.email, "phone": m.user.phone,
        "avatar_url": m.user.avatar_url, "designation": m.designation, "specialization": m.specialization, "office": m.office,
    }


def meeting_dict(m: Meeting, *, include_private: bool, names: Optional[dict] = None) -> dict:
    log = m.log
    d = {
        "id": m.id, "mentor_id": m.mentor_id, "student_id": m.student_id, "title": m.title, "agenda": m.agenda,
        "scheduled_at": iso(m.scheduled_at), "duration_minutes": m.duration_minutes, "mode": m.mode,
        "location": m.location, "status": m.status, "requested_by": m.requested_by, "created_at": iso(m.created_at),
        "log": None,
    }
    if names:
        d.update(names.get(m.id, {}))
    if log:
        d["log"] = {
            "summary": log.summary, "topics": log.topics or [], "action_items": log.action_items or [],
            "student_mood": log.student_mood, "follow_up_on": iso(log.follow_up_on), "logged_at": iso(log.logged_at),
            **({"private_notes": log.private_notes} if include_private else {}),
        }
    return d


def alert_dict(a: RiskAlert) -> dict:
    return {
        "id": a.id, "student_id": a.student_id, "rule": a.rule, "severity": a.severity, "title": a.title, "detail": a.detail,
        "evidence": a.evidence or {}, "status": a.status, "created_at": iso(a.created_at), "resolved_at": iso(a.resolved_at),
        "resolution_note": a.resolution_note,
    }


def score_block(student: Student, latest: Optional[StudentSuccessScore]) -> dict:
    comps = {
        "attendance": latest.attendance_component if latest else None,
        "academic": latest.academic_component if latest else None,
        "engagement": latest.engagement_component if latest else None,
        "placement": latest.placement_component if latest else None,
    }
    result = formula.compose(comps["attendance"], comps["academic"], comps["engagement"], comps["placement"])
    return {
        "total": student.success_score,
        "band": student.risk_category,
        "delta": student.score_delta,
        "updated_at": iso(student.score_updated_at),
        "components": comps,
        "weights": formula.WEIGHTS,
        "weakest": formula.weakest_component(result) if result.total_score is not None else None,
        "thresholds": {"green": formula.GREEN_MIN, "amber": formula.AMBER_MIN},
    }


def build_overview(db: Session, student: Student, viewer: Principal) -> dict:
    period = settings.SCORING_PERIOD
    sid = student.id
    staff = viewer.is_staff()

    history_rows = db.scalars(
        select(StudentSuccessScore).where(StudentSuccessScore.student_id == sid).order_by(StudentSuccessScore.computed_at)
    ).all()
    latest = history_rows[-1] if history_rows else None
    history = [
        {
            "period": h.period, "week": h.week_index, "computed_at": iso(h.computed_at), "total": h.total_score,
            "band": h.risk_category, "attendance": h.attendance_component, "academic": h.academic_component,
            "engagement": h.engagement_component, "placement": h.placement_component,
        }
        for h in history_rows
    ][-40:]

    # Attendance
    att_rows = db.execute(
        select(AttendanceRecord, Subject).join(Subject, Subject.id == AttendanceRecord.subject_id)
        .where(AttendanceRecord.student_id == sid, AttendanceRecord.period == period).order_by(Subject.code)
    ).all()
    subjects_att = []
    tot_a = tot_t = 0
    for rec, sub in att_rows:
        tot_a += rec.attended_classes
        tot_t += rec.total_classes
        pct = rec.attended_classes / rec.total_classes * 100 if rec.total_classes else None
        subjects_att.append({
            "subject_id": sub.id, "code": sub.code, "name": sub.name, "credits": sub.credits, "kind": sub.kind,
            "faculty": sub.faculty_name, "attended": rec.attended_classes, "total": rec.total_classes,
            "pct": round(pct, 1) if pct is not None else None,
            "needed_for_75": formula.classes_needed_for(rec.attended_classes, rec.total_classes),
            "can_skip": formula.classes_can_skip(rec.attended_classes, rec.total_classes),
        })
    weekly = [
        {"week": w.week_index, "week_start": iso(w.week_start), "held": w.classes_held, "attended": w.classes_attended,
         "pct": round(w.classes_attended / w.classes_held * 100, 1) if w.classes_held else None}
        for w in db.scalars(select(AttendanceWeekly).where(AttendanceWeekly.student_id == sid, AttendanceWeekly.period == period).order_by(AttendanceWeekly.week_index))
    ]

    # Academics
    marks_by_subject: dict[int, list] = defaultdict(list)
    for mr in db.scalars(select(MarkRecord).where(MarkRecord.student_id == sid, MarkRecord.period == period).order_by(MarkRecord.assessed_on)):
        marks_by_subject[mr.subject_id].append(mr)
    subjects_marks = []
    sub_lookup = {s.id: s for _, s in att_rows}
    missing_ids = [k for k in marks_by_subject if k not in sub_lookup]
    if missing_ids:
        sub_lookup.update({s.id: s for s in db.scalars(select(Subject).where(Subject.id.in_(missing_ids)))})
    for sub_id, items in marks_by_subject.items():
        sub = sub_lookup[sub_id]
        got = sum(i.marks_obtained for i in items)
        mx = sum(i.max_marks for i in items)
        subjects_marks.append({
            "subject_id": sub_id, "code": sub.code, "name": sub.name,
            "assessments": [{"assessment": i.assessment, "max": i.max_marks, "obtained": i.marks_obtained, "on": iso(i.assessed_on)} for i in items],
            "obtained": round(got, 1), "max": round(mx, 1), "pct": round(got / mx * 100, 1) if mx else None,
        })
    subjects_marks.sort(key=lambda x: x["code"])
    semesters = [
        {"semester": r.semester, "period": r.period, "sgpa": r.sgpa, "credits": r.credits_earned, "backlogs": r.backlogs}
        for r in db.scalars(select(SemesterResult).where(SemesterResult.student_id == sid).order_by(SemesterResult.semester))
    ]

    # Engagement
    lms = db.scalar(select(LmsActivity).where(LmsActivity.student_id == sid, LmsActivity.period == period))
    cohort_avg = db.scalar(
        select(func.avg(LmsActivity.login_count)).join(Student, Student.id == LmsActivity.student_id)
        .where(LmsActivity.period == period, Student.department_id == student.department_id)
    )
    lms_weekly = [
        {"week": w.week_index, "logins": w.logins, "minutes": w.active_minutes, "submissions": w.submissions}
        for w in db.scalars(select(LmsWeekly).where(LmsWeekly.student_id == sid, LmsWeekly.period == period).order_by(LmsWeekly.week_index))
    ]

    # Placement
    prof = student.placement_profile
    offers = [
        {"id": o.id, "company": o.company, "role": o.role, "ctc_lpa": o.ctc_lpa, "status": o.status, "stage_date": iso(o.stage_date)}
        for o in db.scalars(select(PlacementOffer).where(PlacementOffer.student_id == sid).order_by(PlacementOffer.stage_date.desc()))
    ]

    # Mentoring
    meetings = db.scalars(select(Meeting).where(Meeting.student_id == sid).order_by(Meeting.scheduled_at.desc())).all()
    now = datetime.now(timezone.utc)

    def _aware(d):
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)

    upcoming = sorted([m for m in meetings if m.status in ("scheduled", "requested") and _aware(m.scheduled_at) >= now], key=lambda m: m.scheduled_at)
    past = [m for m in meetings if m not in upcoming]
    open_actions = []
    for m in past:
        if m.log:
            for item in m.log.action_items or []:
                if not item.get("done"):
                    open_actions.append({**item, "meeting_id": m.id, "meeting_title": m.title})

    alerts = db.scalars(
        select(RiskAlert).where(RiskAlert.student_id == sid).order_by(RiskAlert.status != "open", RiskAlert.created_at.desc())
    ).all()

    user = student.user
    dept: Department = student.department
    profile = {
        "id": student.id, "user_id": user.id, "usn": student.usn, "name": user.full_name, "email": user.email,
        "phone": user.phone, "avatar_url": user.avatar_url, "department": {"id": dept.id, "code": dept.code, "name": dept.name},
        "semester": student.semester, "section": student.section, "admission_year": student.admission_year,
        "gender": student.gender, "home_city": student.home_city, "hostel_resident": student.hostel_resident,
        "guardian_name": student.guardian_name, "guardian_phone": student.guardian_phone, "guardian_email": student.guardian_email,
        "bio": student.bio, "interests": student.interests or [], "status": student.status, "is_under_18": student.is_under_18,
        "date_of_birth": iso(student.date_of_birth) if (staff or viewer.student_id == sid) else None,
        "is_synthetic": student.is_synthetic, "has_login": bool(user.auth_user_id), "last_login_at": iso(user.last_login_at),
    }
    return {
        "profile": profile,
        "mentor": mentor_card(db, student.mentor_id),
        "score": score_block(student, latest),
        "history": history,
        "attendance": {
            "overall_pct": round(tot_a / tot_t * 100, 1) if tot_t else None,
            "attended": tot_a, "total": tot_t, "requirement": formula.ATTENDANCE_REQUIREMENT,
            "needed_for_75": formula.classes_needed_for(tot_a, tot_t), "can_skip": formula.classes_can_skip(tot_a, tot_t),
            "subjects": subjects_att, "weekly": weekly,
        },
        "academics": {
            "cgpa": student.cgpa, "sgpa": student.sgpa, "active_backlogs": student.active_backlogs,
            "semesters": semesters, "subjects": subjects_marks,
        },
        "engagement": {
            "login_count": lms.login_count if lms else None, "cohort_avg_logins": round(float(cohort_avg), 1) if cohort_avg else None,
            "active_minutes": lms.active_minutes if lms else None,
            "assignments_submitted": lms.assignments_submitted if lms else None, "assignments_total": lms.assignments_total if lms else None,
            "quizzes_attempted": lms.quizzes_attempted if lms else None, "avg_quiz_score": lms.avg_quiz_score if lms else None,
            "forum_posts": lms.forum_posts if lms else None, "last_active_at": iso(lms.last_active_at) if lms else None,
            "weekly": lms_weekly,
        },
        "placement": {
            "has_resume": bool(prof and prof.has_resume), "resume_available": bool(prof and prof.resume_path),
            "skills": (prof.skills if prof else []) or [], "certifications": (prof.certifications if prof else []) or [],
            "internships": prof.internships if prof else 0, "mock_tests_taken": prof.mock_tests_taken if prof else 0,
            "aptitude_score": prof.aptitude_score if prof else None, "target_role": prof.target_role if prof else None,
            "status": prof.status if prof else "not_started", "linkedin_url": prof.linkedin_url if prof else None,
            "github_url": prof.github_url if prof else None, "offers": offers,
        },
        "meetings": {
            "upcoming": [meeting_dict(m, include_private=staff) for m in upcoming],
            "past": [meeting_dict(m, include_private=staff) for m in past[:20]],
            "completed_count": sum(1 for m in meetings if m.status == "completed"),
            "open_action_items": open_actions,
        },
        "alerts": [alert_dict(a) for a in alerts if a.status != "resolved"] + [alert_dict(a) for a in alerts if a.status == "resolved"][:5],
        "consents": consent_state(student),
        "period": period,
    }


def list_rows(db: Session, students: list[Student]) -> list[dict]:
    ids = [s.id for s in students]
    if not ids:
        return []
    open_alerts = dict(db.execute(
        select(RiskAlert.student_id, func.count(RiskAlert.id)).where(RiskAlert.student_id.in_(ids), RiskAlert.status == "open").group_by(RiskAlert.student_id)
    ).all())
    high_alerts = dict(db.execute(
        select(RiskAlert.student_id, func.count(RiskAlert.id)).where(RiskAlert.student_id.in_(ids), RiskAlert.status == "open", RiskAlert.severity == "high").group_by(RiskAlert.student_id)
    ).all())
    last_meet = dict(db.execute(
        select(Meeting.student_id, func.max(Meeting.scheduled_at)).where(Meeting.student_id.in_(ids), Meeting.status == "completed").group_by(Meeting.student_id)
    ).all())
    next_meet = dict(db.execute(
        select(Meeting.student_id, func.min(Meeting.scheduled_at)).where(
            Meeting.student_id.in_(ids), Meeting.status.in_(("scheduled", "requested")), Meeting.scheduled_at >= datetime.now(timezone.utc)
        ).group_by(Meeting.student_id)
    ).all())
    # Sparkline: last 8 score snapshots
    spark: dict[int, list] = defaultdict(list)
    for sid, total in db.execute(
        select(StudentSuccessScore.student_id, StudentSuccessScore.total_score)
        .where(StudentSuccessScore.student_id.in_(ids)).order_by(StudentSuccessScore.student_id, StudentSuccessScore.computed_at)
    ):
        spark[sid].append(total)
    mentors = {m.id: m for m in db.scalars(select(Mentor).where(Mentor.id.in_({s.mentor_id for s in students if s.mentor_id})))}
    rows = []
    for s in students:
        m = mentors.get(s.mentor_id) if s.mentor_id else None
        rows.append({
            "id": s.id, "usn": s.usn, "name": s.user.full_name, "email": s.user.email, "avatar_url": s.user.avatar_url,
            "department": s.department.code, "department_id": s.department_id, "semester": s.semester, "section": s.section,
            "mentor": {"id": m.id, "name": m.user.full_name} if m else None,
            "score": s.success_score, "band": s.risk_category, "delta": s.score_delta, "attendance_pct": s.attendance_pct,
            "cgpa": s.cgpa, "sgpa": s.sgpa, "active_backlogs": s.active_backlogs,
            "open_alerts": open_alerts.get(s.id, 0), "high_alerts": high_alerts.get(s.id, 0),
            "last_meeting_at": iso(last_meet.get(s.id)), "next_meeting_at": iso(next_meet.get(s.id)),
            "sparkline": [v for v in spark.get(s.id, []) if v is not None][-8:],
            "has_login": bool(s.user.auth_user_id), "is_synthetic": s.is_synthetic,
        })
    return rows


def set_consent(db: Session, student: Student, category: str, consented: bool) -> None:
    existing = db.scalar(select(StudentConsent).where(StudentConsent.student_id == student.id, StudentConsent.category == category))
    now = datetime.now(timezone.utc)
    if existing:
        existing.consented, existing.decided_at, existing.notice_version = consented, now, settings.PRIVACY_NOTICE_VERSION
    else:
        db.add(StudentConsent(student_id=student.id, category=category, consented=consented, decided_at=now, notice_version=settings.PRIVACY_NOTICE_VERSION))
