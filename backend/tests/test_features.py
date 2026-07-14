"""
Coverage for the MVP feature/security pass: role guards, structured meeting
logs, per-category consent, NAAC export, and audit logging. Runs on the
in-memory SQLite engine configured in conftest.
"""
import pytest

from backend.app.core.security import create_access_token
from backend.app.models.user import User
from backend.app.models.student import Student
from backend.app.models.mentor import Mentor
from backend.app.models.meeting import Meeting
from backend.app.models.consent import StudentConsent, ConsentCategory
from backend.app.models.audit import AuditLog


def _user(db, email, role, full_name="Test User"):
    u = User(
        email=email,
        hashed_password="not-used-in-these-tests",
        full_name=full_name,
        role=role,
        is_active=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


@pytest.fixture
def world(db):
    """Seed: admin, two mentors (with profiles), an adult student, a minor."""
    admin = _user(db, "admin@x.edu", "Admin", "Admin")
    mentor_u = _user(db, "mentor@x.edu", "Mentor", "Mentor One")
    mentor2_u = _user(db, "mentor2@x.edu", "Mentor", "Mentor Two")
    stu_u = _user(db, "stu@x.edu", "Student", "Adult Student")
    minor_u = _user(db, "minor@x.edu", "Student", "Minor Student")

    mentor = Mentor(user_id=mentor_u.id, department="CSE", max_mentees=20)
    mentor2 = Mentor(user_id=mentor2_u.id, department="CSE", max_mentees=20)
    db.add_all([mentor, mentor2])
    db.commit()
    db.refresh(mentor)
    db.refresh(mentor2)

    student = Student(
        user_id=stu_u.id, usn="CS001", department="CSE", semester=5,
        attendance_rate=88.0, cgpa=8.2, success_score=80.0, risk_status="Green",
        consent_given=True, is_under_18=False, mentor_id=mentor.id,
    )
    minor = Student(
        user_id=minor_u.id, usn="CS002", department="CSE", semester=1,
        attendance_rate=70.0, cgpa=6.0, is_under_18=True, mentor_id=mentor.id,
    )
    db.add_all([student, minor])
    db.commit()
    db.refresh(student)
    db.refresh(minor)

    return dict(
        db=db, admin=admin, mentor_u=mentor_u, mentor2_u=mentor2_u, stu_u=stu_u,
        minor_u=minor_u, mentor=mentor, mentor2=mentor2, student=student, minor=minor,
    )


# --- Phase 1: role guards -------------------------------------------------

def test_student_cannot_recompute_scores(client, world):
    r = client.post("/api/v1/admin/scores/recompute", headers=auth(world["stu_u"]))
    assert r.status_code == 403


def test_admin_can_recompute_scores(client, world):
    r = client.post("/api/v1/admin/scores/recompute", headers=auth(world["admin"]))
    assert r.status_code == 200
    assert r.json()["count"] == 2


# --- Phase 2: structured meeting logs ------------------------------------

def _make_meeting(db, mentor, student):
    from datetime import datetime
    m = Meeting(
        mentor_id=mentor.id, student_id=student.id, title="Check-in",
        date=datetime(2026, 6, 1, 10, 0), status="Scheduled",
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return m


def test_mentor_logs_own_meeting(client, world):
    m = _make_meeting(world["db"], world["mentor"], world["student"])
    r = client.post(
        f"/api/v1/mentoring/meetings/{m.id}/log",
        headers=auth(world["mentor_u"]),
        json={
            "topics_discussed": ["attendance", "exam_prep"],
            "action_items": ["attend next 5 classes"],
            "next_meeting_date": "2026-07-04",
            "observations": "Stressed about backlogs",
        },
    )
    assert r.status_code == 201, r.text
    world["db"].expire_all()
    refreshed = world["db"].get(Meeting, m.id)
    assert refreshed.status == "Completed"
    assert refreshed.log is not None
    assert refreshed.log.topics_discussed == ["attendance", "exam_prep"]


def test_mentor_cannot_log_another_mentors_meeting(client, world):
    m = _make_meeting(world["db"], world["mentor"], world["student"])
    r = client.post(
        f"/api/v1/mentoring/meetings/{m.id}/log",
        headers=auth(world["mentor2_u"]),
        json={"topics_discussed": [], "action_items": []},
    )
    assert r.status_code == 403


def test_get_student_meetings_with_log(client, world):
    m = _make_meeting(world["db"], world["mentor"], world["student"])
    client.post(
        f"/api/v1/mentoring/meetings/{m.id}/log",
        headers=auth(world["mentor_u"]),
        json={"topics_discussed": ["career"], "action_items": ["build resume"]},
    )
    r = client.get(
        f"/api/v1/mentoring/students/{world['student'].id}/meetings",
        headers=auth(world["stu_u"]),
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 1
    assert data[0]["log"]["topics_discussed"] == ["career"]


def test_student_cannot_view_other_students_meetings(client, world):
    r = client.get(
        f"/api/v1/mentoring/students/{world['student'].id}/meetings",
        headers=auth(world["minor_u"]),
    )
    assert r.status_code == 403


# --- Phase 4: per-category consent ---------------------------------------

def test_consent_get_returns_four_categories(client, world):
    r = client.get(
        f"/api/v1/students/{world['student'].id}/consents",
        headers=auth(world["stu_u"]),
    )
    assert r.status_code == 200
    body = r.json()
    for cat in ("academic", "attendance", "placement", "wellness"):
        assert cat in body
    assert body["wellness"]["locked"] is True
    assert body["is_under_18"] is False


def test_consent_patch_wellness_forbidden(client, world):
    r = client.patch(
        f"/api/v1/students/{world['student'].id}/consent",
        headers=auth(world["stu_u"]),
        json={"category": "wellness", "consented": True},
    )
    assert r.status_code == 403


def test_consent_patch_under18_forbidden(client, world):
    r = client.patch(
        f"/api/v1/students/{world['minor'].id}/consent",
        headers=auth(world["minor_u"]),
        json={"category": "attendance", "consented": False},
    )
    assert r.status_code == 403
    assert "under 18" in r.json()["detail"].lower()


def test_consent_patch_adult_ok_and_persists(client, world):
    r = client.patch(
        f"/api/v1/students/{world['student'].id}/consent",
        headers=auth(world["stu_u"]),
        json={"category": "attendance", "consented": False},
    )
    assert r.status_code == 200
    row = (
        world["db"].query(StudentConsent)
        .filter(
            StudentConsent.student_id == world["student"].id,
            StudentConsent.category == ConsentCategory.attendance,
        )
        .first()
    )
    assert row is not None and row.consented is False


def test_student_cannot_update_others_consent(client, world):
    r = client.patch(
        f"/api/v1/students/{world['student'].id}/consent",
        headers=auth(world["minor_u"]),
        json={"category": "attendance", "consented": False},
    )
    assert r.status_code == 403


# --- Phase 5: NAAC export -------------------------------------------------

def test_naac_export_respects_consent(client, world):
    # Decline attendance consent for the adult student.
    world["db"].add(StudentConsent(
        student_id=world["student"].id,
        category=ConsentCategory.attendance,
        consented=False,
    ))
    world["db"].commit()

    r = client.get("/api/v1/admin/export/naac", headers=auth(world["admin"]))
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    body = r.text
    assert "Consent not given" in body
    assert "CS001" in body


def test_naac_export_forbidden_for_student(client, world):
    r = client.get("/api/v1/admin/export/naac", headers=auth(world["stu_u"]))
    assert r.status_code == 403


def test_naac_export_lists_enabled_consent_categories(client, world):
    # Adult student with default consent_given=True → all three resolve enabled.
    r = client.get("/api/v1/admin/export/naac", headers=auth(world["admin"]))
    assert r.status_code == 200
    assert "Consent Categories Enabled" in r.text
    assert "academic,attendance,placement" in r.text


# --- Audit log export -----------------------------------------------------

def test_audit_log_export_admin_only(client, world):
    # generate at least one audited action
    client.post("/api/v1/admin/scores/recompute", headers=auth(world["admin"]))
    ok = client.get("/api/v1/admin/export/audit-log", headers=auth(world["admin"]))
    assert ok.status_code == 200
    assert ok.headers["content-type"].startswith("text/csv")
    assert "score_recompute" in ok.text

    denied = client.get("/api/v1/admin/export/audit-log", headers=auth(world["stu_u"]))
    assert denied.status_code == 403


# --- Meeting mode ---------------------------------------------------------

def test_scheduled_meeting_records_mode(client, world):
    r = client.post(
        "/api/v1/mentoring/meetings",
        headers=auth(world["mentor_u"]),
        json={
            "student_id": world["student"].id,
            "title": "Video check-in",
            "date": "2026-06-27T15:00:00",
            "mode": "video",
        },
    )
    assert r.status_code in (200, 201), r.text
    assert r.json()["mode"] == "video"


# --- Phase 1C: audit logging ---------------------------------------------

def test_state_change_writes_audit(client, world):
    client.patch(
        f"/api/v1/students/{world['student'].id}/consent",
        headers=auth(world["stu_u"]),
        json={"category": "academic", "consented": True},
    )
    world["db"].expire_all()
    actions = [a.action for a in world["db"].query(AuditLog).all()]
    # explicit endpoint audit + middleware safety-net row
    assert "consent_update" in actions
    assert any(a.startswith("PATCH") for a in actions)


def test_admin_create_users(client, world):
    # 1. Non-admin should be denied
    r = client.post(
        "/api/v1/admin/users",
        headers=auth(world["stu_u"]),
        json={"full_name": "New Student", "email": "newstu@mitwpu.edu.in", "role": "Student"}
    )
    assert r.status_code == 403

    # 2. Admin should be able to list users
    r = client.get(
        "/api/v1/admin/users",
        headers=auth(world["admin"])
    )
    assert r.status_code == 200
    initial_count = len(r.json())

    # 3. Admin creates a student with detailed attributes
    r = client.post(
        "/api/v1/admin/users",
        headers=auth(world["admin"]),
        json={
            "full_name": "New Student Test",
            "email": "newstu@mitwpu.edu.in",
            "role": "Student",
            "usn": "1234567890",
            "department": "CSE",
            "semester": 3,
            "student_mobile": "+91 99999 88888",
            "parent_mobile": "+91 99999 77777",
            "parent_email": "parent@email.com",
        }
    )
    assert r.status_code == 201
    
    # 3.5. Admin attempts to create another student with the same USN (should fail)
    r = client.post(
        "/api/v1/admin/users",
        headers=auth(world["admin"]),
        json={
            "full_name": "Another Student",
            "email": "anotherstu@mitwpu.edu.in",
            "role": "Student",
            "usn": "1234567890",
        }
    )
    assert r.status_code == 400

    # 4. Admin creates a mentor with detailed attributes
    r = client.post(
        "/api/v1/admin/users",
        headers=auth(world["admin"]),
        json={
            "full_name": "New Mentor Test",
            "email": "newmentor@mitwpu.edu.in",
            "role": "Mentor",
            "department": "ECE",
            "max_mentees": 15,
            "mobile_no": "+91 88888 77777",
        }
    )
    assert r.status_code == 201

    # 5. List users again, check count and properties
    r = client.get(
        "/api/v1/admin/users",
        headers=auth(world["admin"])
    )
    assert r.status_code == 200
    assert len(r.json()) == initial_count + 2
    
    emails = [u["email"] for u in r.json()]
    assert "newstu@mitwpu.edu.in" in emails
    assert "newmentor@mitwpu.edu.in" in emails

    # 6. Verify audit log entry
    world["db"].expire_all()
    actions = [a.action for a in world["db"].query(AuditLog).all()]
    assert "create_user" in actions

