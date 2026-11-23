"""Test harness.

Runs against SQLite by default; set TEST_DATABASE_URL to a Postgres URL to run
the identical suite against Postgres (CI does both). Auth uses real HS256
Supabase-style JWTs signed with a test secret, so the production verification
path is exercised end to end.
"""
import os
import sys
import tempfile
import time
import uuid

TEST_DB = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tempfile.gettempdir()}/mentoros_test_{os.getpid()}.sqlite3"
os.environ.update({
    "DATABASE_URL": TEST_DB,
    "POSTGRES_URL": "",
    "POSTGRES_URL_NON_POOLING": "",
    "ENVIRONMENT": "test",
    "SUPABASE_JWT_SECRET": "test-secret-for-mentoros-suite-0123456789",
    "SUPABASE_URL": "",
    "SUPABASE_SERVICE_ROLE_KEY": "",
    "OPS_TOKEN": "test-ops-token",
    "CRON_SECRET": "test-cron",
    "LLM_PROVIDER": "none",
    "ALLOWED_EMAIL_DOMAINS": "",
})
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import jwt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select, text  # noqa: E402

from backend.app.core.database import Base, SessionLocal, engine  # noqa: E402
from backend.app.main import app  # noqa: E402
from backend.app.models import Mentor, Student, User  # noqa: E402
from backend.app.seed.generator import generate  # noqa: E402

SECRET = os.environ["SUPABASE_JWT_SECRET"]


def make_token(sub: str, email: str, *, exp_in: int = 3600, secret: str = SECRET, aud: str = "authenticated") -> str:
    now = int(time.time())
    return jwt.encode({"sub": sub, "email": email, "aud": aud, "role": "authenticated", "iat": now, "exp": now + exp_in}, secret, algorithm="HS256")


@pytest.fixture(scope="session", autouse=True)
def database():
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("drop schema public cascade; create schema public"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()
    summary = generate(db, seed=7)
    db.close()
    yield summary
    Base.metadata.drop_all(engine)


@pytest.fixture()
def db():
    s = SessionLocal()
    yield s
    s.close()


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


class Actor:
    def __init__(self, client: TestClient, user: User):
        self.client = client
        self.user = user
        self.headers = {"Authorization": f"Bearer {make_token(user.auth_user_id or str(uuid.uuid4()), user.email)}"}

    def get(self, url, **kw):
        return self.client.get(url, headers=self.headers, **kw)

    def post(self, url, **kw):
        return self.client.post(url, headers=self.headers, **kw)

    def patch(self, url, **kw):
        return self.client.patch(url, headers=self.headers, **kw)

    def put(self, url, **kw):
        return self.client.put(url, headers=self.headers, **kw)

    def delete(self, url, **kw):
        return self.client.delete(url, headers=self.headers, **kw)


def _user(db, email):
    return db.scalar(select(User).where(User.email == email))


@pytest.fixture()
def as_student(client, db):
    return Actor(client, _user(db, "student@mentoros.demo"))


@pytest.fixture()
def as_mentor(client, db):
    return Actor(client, _user(db, "mentor@mentoros.demo"))


@pytest.fixture()
def as_hod(client, db):
    return Actor(client, _user(db, "hod@mentoros.demo"))


@pytest.fixture()
def as_admin(client, db):
    return Actor(client, _user(db, "admin@mentoros.demo"))


@pytest.fixture()
def other_mentor(client, db):
    """A CSE mentor who is not the demo mentor."""
    demo = _user(db, "mentor@mentoros.demo")
    m = db.scalar(select(Mentor).join(User, User.id == Mentor.user_id).where(
        User.role == "mentor", Mentor.department_id == demo.department_id, User.id != demo.id))
    return Actor(client, m.user)


@pytest.fixture()
def foreign_student(db):
    """A student from another department."""
    demo = _user(db, "student@mentoros.demo")
    return db.scalar(select(Student).where(Student.department_id != demo.department_id))
