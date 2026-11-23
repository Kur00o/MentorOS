import uuid

from sqlalchemy import select

from backend.app.models import Student, User
from backend.tests.conftest import make_token


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def test_health_is_public(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert client.get("/api/v1/health/ready").json()["status"] == "ready"


def test_missing_and_invalid_tokens_are_rejected(client):
    assert client.get("/api/v1/auth/me").status_code == 401
    r = client.get("/api/v1/auth/me", headers=_h("not-a-jwt"))
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    forged = make_token(str(uuid.uuid4()), "admin@mentoros.demo", secret="wrong-secret-wrong-secret-wrong-secret")
    assert client.get("/api/v1/auth/me", headers=_h(forged)).status_code == 401


def test_expired_token_rejected(client):
    t = make_token(str(uuid.uuid4()), "admin@mentoros.demo", exp_in=-10)
    r = client.get("/api/v1/auth/me", headers=_h(t))
    assert r.status_code == 401 and "expired" in r.json()["error"]["message"].lower()


def test_wrong_audience_rejected(client):
    t = make_token(str(uuid.uuid4()), "admin@mentoros.demo", aud="something-else")
    assert client.get("/api/v1/auth/me", headers=_h(t)).status_code == 401


def test_unprovisioned_identity_gets_clear_403(client):
    r = client.get("/api/v1/auth/me", headers=_h(make_token(str(uuid.uuid4()), "stranger@example.com")))
    assert r.status_code == 403 and r.json()["error"]["code"] == "not_provisioned"


def test_first_login_links_identity_and_roles_come_from_db(client, db):
    sub = str(uuid.uuid4())
    hod = db.scalar(select(User).where(User.role == "hod", User.email != "hod@mentoros.demo", User.auth_user_id.is_(None)))
    r = client.get("/api/v1/auth/me", headers=_h(make_token(sub, hod.email.upper())))
    assert r.status_code == 200 and r.json()["role"] == "hod"
    db.expire_all()
    assert db.get(User, hod.id).auth_user_id == sub
    # Another identity claiming the same email is refused.
    r2 = client.get("/api/v1/auth/me", headers=_h(make_token(str(uuid.uuid4()), hod.email)))
    assert r2.status_code == 403


def test_inactive_user_blocked(client, db):
    u = db.scalar(select(User).where(User.role == "student", User.email != "student@mentoros.demo"))
    u.is_active = False
    db.commit()
    r = client.get("/api/v1/auth/me", headers=_h(make_token(str(uuid.uuid4()), u.email)))
    assert r.status_code == 403 and r.json()["error"]["code"] == "inactive"
    u.is_active = True
    db.commit()


def test_student_cannot_reach_staff_or_admin_endpoints(as_student):
    for url in ["/api/v1/students", "/api/v1/analytics/department", "/api/v1/admin/users", "/api/v1/alerts", "/api/v1/allocation/overview",
                "/api/v1/mentoring/dashboard", "/api/v1/admin/exports/naac"]:
        assert as_student.get(url).status_code == 403, url


def test_student_only_sees_self(as_student, db):
    me = as_student.get("/api/v1/students/me").json()
    other = db.scalar(select(Student).where(Student.id != me["profile"]["id"]))
    assert as_student.get(f"/api/v1/scoring/students/{other.id}").status_code == 404
    assert as_student.get(f"/api/v1/students/{other.id}/consents").status_code == 404


def test_mentor_scope_is_own_mentees(as_mentor, other_mentor, db):
    rows = as_mentor.get("/api/v1/students?page_size=200").json()["items"]
    mentor_id = as_mentor.get("/api/v1/auth/me").json()["mentor_id"]
    assert rows and all(r["mentor"]["id"] == mentor_id for r in rows)
    foreign = db.scalar(select(Student).where(Student.mentor_id != mentor_id, Student.mentor_id.is_not(None)))
    assert as_mentor.get(f"/api/v1/students/{foreign.id}").status_code == 404
    assert other_mentor.get(f"/api/v1/students/{rows[0]['id']}").status_code == 404


def test_hod_scope_is_department(as_hod, foreign_student):
    dept = as_hod.get("/api/v1/auth/me").json()["department"]["id"]
    rows = as_hod.get("/api/v1/students?page_size=200").json()["items"]
    assert rows and all(r["department_id"] == dept for r in rows)
    assert as_hod.get(f"/api/v1/students/{foreign_student.id}").status_code == 404
    assert as_hod.get(f"/api/v1/analytics/department?department_id={foreign_student.department_id}").status_code == 403
    assert as_hod.get("/api/v1/admin/users").status_code == 403


def test_admin_sees_everything(as_admin, foreign_student):
    data = as_admin.get("/api/v1/students?page_size=200").json()
    assert data["total"] == 150
    assert as_admin.get(f"/api/v1/students/{foreign_student.id}").status_code == 200


def test_validation_errors_use_envelope(as_mentor):
    r = as_mentor.post("/api/v1/mentoring/meetings", json={"title": "x"})
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "validation_error" and body["error"]["details"]


def test_ops_endpoints_require_token(client):
    assert client.post("/api/v1/ops/bootstrap/seed").status_code == 403
    assert client.post("/api/v1/ops/bootstrap/seed", headers={"X-Ops-Token": "nope"}).status_code == 403
    assert client.get("/api/v1/ops/cron/nightly").status_code == 401
