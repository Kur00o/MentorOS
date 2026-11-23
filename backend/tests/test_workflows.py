"""End-to-end API workflows across all four roles."""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from backend.app.models import Department, Meeting, Mentor, RiskAlert, Student, StudentSuccessScore, User
from backend.app.scoring import engine, formula


def future(days=3, hour=11):
    d = datetime.now(timezone.utc) + timedelta(days=days)
    return d.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


# ── seed integrity ─────────────────────────────────────────────────────────
def test_seed_is_complete_and_labelled(database, db):
    assert database["students"] == 150
    assert db.scalar(select(func.count(Student.id))) == 150
    assert db.scalar(select(func.count(Student.id)).where(Student.is_synthetic.is_(False))) == 0
    assert all(u.startswith("DEMO") for u in db.scalars(select(Student.usn)))
    assert db.scalar(select(func.count(User.id)).where(~User.email.like("%@mentoros.demo"))) == 0
    for role in ("student", "mentor", "hod", "admin"):
        assert db.scalar(select(User).where(User.email == f"{role}@mentoros.demo")).role == role
    assert set(database["bands"]) >= {"green", "amber", "coral"}


def test_stored_scores_match_formula(db):
    """The mirrored score on every student equals a fresh computation."""
    live = engine.compute_scores(db)
    for st in db.scalars(select(Student)):
        assert st.success_score == live[st.id].total_score
        assert st.risk_category == live[st.id].risk_category


def test_allocation_rules_hold_in_seed(db):
    for m in db.scalars(select(Mentor)):
        mentees = db.scalars(select(Student).where(Student.mentor_id == m.id)).all()
        assert len(mentees) <= m.max_mentees
        assert all(s.department_id == m.department_id for s in mentees)


# ── student ────────────────────────────────────────────────────────────────
def test_student_overview_is_rich_and_consistent(as_student):
    ov = as_student.get("/api/v1/students/me").json()
    sc = ov["score"]
    recomputed = formula.compose(*(sc["components"][k] for k in ("attendance", "academic", "engagement", "placement")))
    assert recomputed.total_score == sc["total"] and recomputed.risk_category == sc["band"]
    assert ov["attendance"]["subjects"] and ov["attendance"]["weekly"]
    assert ov["academics"]["semesters"] and ov["mentor"]["name"]
    assert len(ov["history"]) >= 10
    for m in ov["meetings"]["past"]:
        assert "private_notes" not in (m["log"] or {})


def test_student_profile_update_validates(as_student):
    assert as_student.patch("/api/v1/students/me", json={"phone": "call me maybe"}).status_code == 422
    r = as_student.patch("/api/v1/students/me", json={"bio": "Hello", "interests": ["Robotics", " ", "Chess"]})
    assert r.status_code == 200 and r.json()["interests"] == ["Robotics", "Chess"]


def test_placement_update_recomputes_score(as_student):
    before = as_student.get("/api/v1/students/me").json()["score"]
    r = as_student.put("/api/v1/students/me/placement", json={"skills": ["Python", "SQL", "React", "Docker", "Git", "Python"]})
    assert r.status_code == 200
    after = r.json()["score"]
    assert after["components"]["placement"] >= before["components"]["placement"]
    assert r.json()["placement"]["skills"] == ["Python", "SQL", "React", "Docker", "Git"]


def test_what_if_simulation(as_student):
    sid = as_student.get("/api/v1/auth/me").json()["student_id"]
    r = as_student.post(f"/api/v1/scoring/students/{sid}/simulate", json={"attendance": 95, "sgpa": 9})
    data = r.json()
    assert r.status_code == 200 and data["simulated"]["total_score"] > data["current"]["total_score"]
    assert as_student.post(f"/api/v1/scoring/students/{sid}/simulate", json={"sgpa": 12}).status_code == 422


def test_consent_rules(as_student):
    sid = as_student.get("/api/v1/auth/me").json()["student_id"]
    r = as_student.patch(f"/api/v1/students/{sid}/consents", json={"category": "placement", "consented": False})
    assert r.status_code == 200 and r.json()["placement"]["consented"] is False
    assert as_student.patch(f"/api/v1/students/{sid}/consents", json={"category": "wellness", "consented": True}).status_code == 403
    as_student.patch(f"/api/v1/students/{sid}/consents", json={"category": "placement", "consented": True})


# ── meetings lifecycle ─────────────────────────────────────────────────────
def test_meeting_request_confirm_log_and_actions(as_student, as_mentor):
    r = as_student.post("/api/v1/mentoring/meetings", json={"title": "Help with OS internals", "scheduled_at": future(4, 9), "mode": "video"})
    assert r.status_code == 201, r.text
    meeting = r.json()
    assert meeting["status"] == "requested"
    # mentor gets a notification
    assert any(n["kind"] == "meeting_request" for n in as_mentor.get("/api/v1/notifications").json()["items"])
    # student cannot reschedule, only cancel
    assert as_student.patch(f"/api/v1/mentoring/meetings/{meeting['id']}", json={"title": "Changed title"}).status_code == 403
    r = as_mentor.patch(f"/api/v1/mentoring/meetings/{meeting['id']}", json={"status": "scheduled"})
    assert r.status_code == 200 and r.json()["status"] == "scheduled"
    # cannot log a future meeting
    assert as_mentor.post(f"/api/v1/mentoring/meetings/{meeting['id']}/log", json={"summary": "Too early to log this one"}).status_code == 400


def test_log_past_meeting_and_toggle_action(as_mentor, as_student, db):
    sid = as_student.get("/api/v1/auth/me").json()["student_id"]
    mentor_id = as_mentor.get("/api/v1/auth/me").json()["mentor_id"]
    m = Meeting(mentor_id=mentor_id, student_id=sid, title="Walk-in chat", scheduled_at=datetime.now(timezone.utc) - timedelta(hours=2), status="scheduled")
    db.add(m)
    db.commit()
    body = {"summary": "Discussed the attendance dip and a recovery plan.", "topics": ["attendance"],
            "action_items": [{"text": "Attend all OS lectures this week"}], "student_mood": "stressed", "private_notes": "Seems tired"}
    r = as_mentor.post(f"/api/v1/mentoring/meetings/{m.id}/log", json=body)
    assert r.status_code == 201 and r.json()["status"] == "completed"
    assert as_mentor.post(f"/api/v1/mentoring/meetings/{m.id}/log", json=body).status_code == 409
    action_id = r.json()["log"]["action_items"][0]["id"]
    seen = as_student.get("/api/v1/mentoring/meetings").json()
    mine = next(x for x in seen if x["id"] == m.id)
    assert "private_notes" not in mine["log"]
    r = as_student.patch(f"/api/v1/mentoring/meetings/{m.id}/actions/{action_id}", json={"done": True})
    assert r.status_code == 200 and r.json()["action_items"][0]["done"] is True


def test_meeting_clash_detected(as_mentor):
    roster = as_mentor.get("/api/v1/students?page_size=50").json()["items"]
    t = future(9, 13)
    a = as_mentor.post("/api/v1/mentoring/meetings", json={"student_id": roster[0]["id"], "title": "Slot A", "scheduled_at": t, "duration_minutes": 30})
    assert a.status_code == 201
    b = as_mentor.post("/api/v1/mentoring/meetings", json={"student_id": roster[1]["id"], "title": "Slot B", "scheduled_at": t})
    assert b.status_code == 409


def test_mentor_cannot_schedule_with_non_mentee(as_mentor, db):
    mentor_id = as_mentor.get("/api/v1/auth/me").json()["mentor_id"]
    other = db.scalar(select(Student).where(Student.mentor_id != mentor_id))
    r = as_mentor.post("/api/v1/mentoring/meetings", json={"student_id": other.id, "title": "Nope", "scheduled_at": future()})
    assert r.status_code == 404


def test_past_scheduling_rejected(as_mentor):
    roster = as_mentor.get("/api/v1/students").json()["items"]
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert as_mentor.post("/api/v1/mentoring/meetings", json={"student_id": roster[0]["id"], "title": "Past", "scheduled_at": past}).status_code == 422


def test_mentor_dashboard(as_mentor):
    d = as_mentor.get("/api/v1/mentoring/dashboard").json()
    assert d["kpis"]["mentees"] == len(d["roster"]) > 0
    assert d["attention"] and all(a["band"] in ("amber", "coral") or a["high_alerts"] for a in d["attention"])


def test_alert_workflow(as_mentor):
    alerts = as_mentor.get("/api/v1/alerts").json()
    assert alerts
    a = alerts[0]
    r = as_mentor.patch(f"/api/v1/alerts/{a['id']}", json={"status": "acknowledged", "note": "Spoke to student"})
    assert r.status_code == 200 and r.json()["status"] == "acknowledged"


# ── allocation ─────────────────────────────────────────────────────────────
def test_allocation_overview_and_auto(as_hod):
    ov = as_hod.get("/api/v1/allocation/overview").json()
    assert ov["stats"]["unassigned"] > 0
    bands = [p["band"] for p in ov["pending"]]
    order = {"coral": 0, "amber": 1, "insufficient_data": 2, "green": 3}
    assert bands == sorted(bands, key=order.get)
    dry = as_hod.post("/api/v1/allocation/auto", json={"dry_run": True}).json()
    assert dry["dry_run"] and dry["allocated"] > 0
    real = as_hod.post("/api/v1/allocation/auto", json={"dry_run": False}).json()
    assert real["allocated"] == dry["allocated"]
    after = as_hod.get("/api/v1/allocation/overview").json()
    assert after["stats"]["unassigned"] == ov["stats"]["unassigned"] - real["allocated"]
    assert all(m["load"] <= m["capacity"] for m in after["mentors"])


def test_allocation_rules_enforced(as_hod, as_admin, db, foreign_student):
    hod_dept = as_hod.get("/api/v1/auth/me").json()["department"]["id"]
    own_mentor = db.scalar(select(Mentor).where(Mentor.department_id == hod_dept, Mentor.max_mentees > 0))
    # cross-department → mismatch (admin can see both, still refused)
    r = as_admin.post("/api/v1/allocation/assign", json={"student_id": foreign_student.id, "mentor_id": own_mentor.id})
    assert r.status_code == 400 and r.json()["error"]["code"] == "department_mismatch"
    # capacity
    full = as_hod.patch(f"/api/v1/allocation/mentors/{own_mentor.id}", json={"max_mentees": 0})
    assert full.status_code == 400  # cannot drop below current load
    student = db.scalar(select(Student).where(Student.department_id == hod_dept, Student.mentor_id != own_mentor.id))
    load = db.scalar(select(func.count(Student.id)).where(Student.mentor_id == own_mentor.id))
    as_hod.patch(f"/api/v1/allocation/mentors/{own_mentor.id}", json={"max_mentees": load})
    r = as_hod.post("/api/v1/allocation/assign", json={"student_id": student.id, "mentor_id": own_mentor.id})
    assert r.status_code == 400 and r.json()["error"]["code"] == "capacity_reached"
    as_hod.patch(f"/api/v1/allocation/mentors/{own_mentor.id}", json={"max_mentees": load + 1})
    r = as_hod.post("/api/v1/allocation/assign", json={"student_id": student.id, "mentor_id": own_mentor.id, "reason": "Better fit"})
    assert r.status_code == 200 and r.json()["reassigned"] is True
    hist = as_hod.get(f"/api/v1/allocation/history?student_id={student.id}").json()
    assert hist[0]["reason"] == "Better fit" and hist[0]["ended_at"] is None


# ── analytics ──────────────────────────────────────────────────────────────
def test_hod_analytics(as_hod):
    a = as_hod.get("/api/v1/analytics/department").json()
    assert a["kpis"]["students"] == sum(a["bands"].values())
    assert a["trend"] and a["semesters"] and a["subjects"] and a["mentors"] and a["placement"]["funnel"]


def test_admin_institution(as_admin):
    a = as_admin.get("/api/v1/analytics/institution").json()
    assert len(a["departments"]) == 3 and sum(d["students"] for d in a["departments"]) == 150
    assert any(b["kind"] == "synthetic" for b in a["batches"])
    assert any(i["key"] == "database" for i in a["integrations"])


# ── imports / exports ──────────────────────────────────────────────────────
def test_attendance_import_with_row_errors(as_admin, db):
    st = db.scalar(select(Student).where(Student.semester == 5))
    from backend.app.models import Subject
    sub = db.scalar(select(Subject).where(Subject.department_id == st.department_id, Subject.semester == 5))
    csv = ("usn,subject_code,total_classes,attended_classes\n"
           f"{st.usn},{sub.code},60,55\n"
           f"{st.usn},{sub.code},10,12\n"
           f"NOPE123,{sub.code},10,5\n"
           f"{st.usn},XX999,10,5\n")
    r = as_admin.post("/api/v1/admin/imports/attendance", files={"file": ("att.csv", csv, "text/csv")})
    data = r.json()
    assert r.status_code == 200 and data["row_count"] == 4 and data["success_count"] == 1 and data["status"] == "partial"
    reasons = {e["column"] for e in data["error_log"]}
    assert {"attended_classes", "usn", "subject_code"} <= reasons
    assert data["recomputed"] == 1


def test_import_rejects_bad_file(as_admin):
    r = as_admin.post("/api/v1/admin/imports/lms", files={"file": ("x.csv", b"\xff\xfe\x00bad", "text/csv")})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_file"


def test_hod_import_limited_to_department(as_hod, foreign_student):
    csv = f"usn,sgpa,semester\n{foreign_student.usn},8.1,3\n"
    data = as_hod.post("/api/v1/admin/imports/results", files={"file": ("r.csv", csv, "text/csv")}).json()
    assert data["success_count"] == 0 and "outside your department" in data["error_log"][0]["reason"]


def test_naac_export_respects_consent(as_admin, as_student, db):
    sid = as_student.get("/api/v1/auth/me").json()["student_id"]
    as_student.patch(f"/api/v1/students/{sid}/consents", json={"category": "attendance", "consented": False})
    r = as_admin.get("/api/v1/admin/exports/naac")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    usn = db.get(Student, sid).usn
    line = next(l for l in r.text.splitlines() if l.startswith(usn))
    assert "Consent not given" in line and line.endswith("synthetic")
    as_student.patch(f"/api/v1/students/{sid}/consents", json={"category": "attendance", "consented": True})


def test_templates_and_audit(as_admin):
    t = as_admin.get("/api/v1/admin/imports/templates/attendance")
    assert t.status_code == 200 and t.text.startswith("usn,subject_code")
    log = as_admin.get("/api/v1/admin/audit-log").json()
    assert any(e["action"] == "export_naac" for e in log)


# ── admin users ────────────────────────────────────────────────────────────
def test_admin_user_lifecycle(as_admin, db):
    dept = db.scalar(select(Department).where(Department.code == "ECE"))
    r = as_admin.post("/api/v1/admin/users", json={"email": "new.mentor@example.edu", "full_name": "New Mentor", "role": "mentor",
                                                   "department_id": dept.id, "provision_login": False})
    assert r.status_code == 201
    uid = r.json()["user"]["id"]
    assert as_admin.post("/api/v1/admin/users", json={"email": "new.mentor@example.edu", "full_name": "Dup", "role": "mentor",
                                                      "department_id": dept.id, "provision_login": False}).status_code == 409
    assert db.scalar(select(Mentor).where(Mentor.user_id == uid)) is not None
    r = as_admin.patch(f"/api/v1/admin/users/{uid}", json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    # Provisioning without Supabase configured fails loudly, not silently.
    assert as_admin.post(f"/api/v1/admin/users/{uid}/provision", json={}).status_code == 503


def test_admin_cannot_demote_self(as_admin):
    me = as_admin.get("/api/v1/auth/me").json()
    assert as_admin.patch(f"/api/v1/admin/users/{me['id']}", json={"role": "mentor"}).status_code == 403


def test_synthetic_admin_cannot_purge(as_admin):
    r = as_admin.post("/api/v1/admin/batches/purge-synthetic", json={"confirm": "PURGE SYNTHETIC DATA"})
    assert r.status_code == 403


def test_integrations_listing(as_admin):
    data = as_admin.get("/api/v1/admin/integrations").json()
    keys = {i["key"] for i in data["integrations"]}
    assert {"database", "supabase_auth", "llm", "email", "erp", "lms", "attendance", "placement"} <= keys
    r = as_admin.post("/api/v1/admin/integrations/erp/sync", data={"dataset": "students"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_configured"


# ── companion ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("who,question,intent", [
    ("as_student", "How am I doing?", "score"),
    ("as_student", "How many classes can I skip?", "attendance"),
    ("as_student", "What should I focus on to improve?", "improve"),
    ("as_student", "What if my SGPA was 9?", "whatif"),
    ("as_mentor", "Who needs attention?", "attention"),
    ("as_hod", "Which mentor is overloaded?", "workload"),
    ("as_hod", "Give me a department summary", "department"),
    ("as_admin", "System status", "system"),
])
def test_companion_grounded_answers(request, who, question, intent):
    actor = request.getfixturevalue(who)
    r = actor.post("/api/v1/companion/chat", json={"message": question})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["intent"] == intent and len(data["answer"]) > 40 and data["provider"] == "grounded"


def test_companion_policy_question_uses_knowledge(as_student):
    data = as_student.post("/api/v1/companion/chat", json={"message": "How is the success score calculated?"}).json()
    assert data["sources"] and "35%" in data["answer"]


def test_companion_respects_scope(as_mentor, foreign_student, db):
    name = db.get(User, foreign_student.user_id).full_name
    data = as_mentor.post("/api/v1/companion/chat", json={"message": f"Brief me on {foreign_student.usn}"}).json()
    assert name not in data["answer"]


def test_companion_history(as_student):
    h = as_student.get("/api/v1/companion/history").json()
    assert h["messages"] and h["messages"][-1]["role"] == "assistant"


# ── cron ───────────────────────────────────────────────────────────────────
def test_nightly_cron_recomputes(client, db):
    before = db.scalar(select(func.count(StudentSuccessScore.id)))
    r = client.get("/api/v1/ops/cron/nightly", headers={"Authorization": "Bearer test-cron"})
    assert r.status_code == 200 and r.json()["count"] == 150
    assert db.scalar(select(func.count(StudentSuccessScore.id))) == before + 150
    assert db.scalar(select(func.count(RiskAlert.id)).where(RiskAlert.status == "open")) > 0
