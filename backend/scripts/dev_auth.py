"""LOCAL DEVELOPMENT ONLY — a tiny GoTrue-compatible auth stub.

Lets the React app run end-to-end against a local Postgres without a hosted
Supabase project. supabase-js talks to it exactly like Supabase Auth; it mints
HS256 tokens signed with SUPABASE_JWT_SECRET, which the API verifies through
its normal production code path. Any user that exists in the `users` table
can sign in with DEMO_ACCOUNT_PASSWORD.

    python -m uvicorn backend.scripts.dev_auth:app --port 9999

Never deploy this. It refuses to start when ENVIRONMENT=production.
"""
import time
import uuid

import jwt
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from backend.app.core.config import settings
from backend.app.core.database import SessionLocal
from backend.app.models import User

if settings.is_production:
    raise SystemExit("dev_auth must never run in production")

app = FastAPI(title="MentorOS dev auth stub")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _sub(email: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"mentoros-dev:{email}"))


def _session(email: str) -> dict:
    now = int(time.time())
    sub = _sub(email)
    user = {"id": sub, "aud": "authenticated", "role": "authenticated", "email": email, "app_metadata": {"provider": "email"},
            "user_metadata": {}, "created_at": "2026-01-01T00:00:00Z"}
    token = jwt.encode({"sub": sub, "email": email, "aud": "authenticated", "role": "authenticated", "iat": now, "exp": now + 3600},
                       settings.SUPABASE_JWT_SECRET, algorithm="HS256")
    return {"access_token": token, "token_type": "bearer", "expires_in": 3600, "expires_at": now + 3600,
            "refresh_token": f"dev-refresh:{email}", "user": user}


@app.post("/auth/v1/token")
async def token(request: Request, grant_type: str):
    body = await request.json()
    if grant_type == "refresh_token":
        rt = body.get("refresh_token", "")
        if not rt.startswith("dev-refresh:"):
            raise HTTPException(400, {"error": "invalid_grant", "error_description": "Invalid Refresh Token"})
        return _session(rt.split(":", 1)[1])
    email = (body.get("email") or "").strip().lower()
    db = SessionLocal()
    try:
        exists = db.scalar(select(User.id).where(func.lower(User.email) == email))
    finally:
        db.close()
    if not exists or body.get("password") != settings.DEMO_ACCOUNT_PASSWORD:
        raise HTTPException(400, {"error": "invalid_grant", "error_description": "Invalid login credentials"})
    return _session(email)


@app.get("/auth/v1/user")
def user(authorization: str = Header(default="")):
    try:
        claims = jwt.decode(authorization.removeprefix("Bearer "), settings.SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "invalid token") from exc
    return _session(claims["email"])["user"]


@app.post("/auth/v1/logout")
def logout():
    return {}


@app.get("/auth/v1/health")
def health():
    return {"status": "ok", "name": "dev-auth-stub"}
