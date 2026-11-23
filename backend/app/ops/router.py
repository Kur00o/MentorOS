"""Operational endpoints.

* `/ops/bootstrap/*` — one-time/idempotent hosted setup (migrations, synthetic
  seed, demo logins, storage buckets, knowledge base). Protected by
  `X-Ops-Token` matching `OPS_TOKEN`; disabled entirely when it is unset.
* `/ops/cron/nightly` — Vercel Cron target (Bearer `CRON_SECRET`).
"""
from __future__ import annotations

import hmac
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from backend.app.core.config import BACKEND_DIR, settings
from backend.app.core.database import engine as db_engine
from backend.app.core.database import get_db
from backend.app.core.errors import AppError
from backend.app.integrations import supabase_admin
from backend.app.models import DataBatch, RiskAlert, Student

log = logging.getLogger("mentoros.ops")
router = APIRouter()


def _require_ops(x_ops_token: Optional[str] = Header(default=None)) -> None:
    if not settings.OPS_TOKEN:
        raise AppError(404, "not_found", "Not found")
    if not x_ops_token or not hmac.compare_digest(x_ops_token, settings.OPS_TOKEN):
        raise AppError(403, "forbidden", "Invalid operations token")


def run_migrations() -> dict:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    started = time.time()
    command.upgrade(cfg, "head")
    with db_engine.connect() as conn:
        rev = conn.execute(text("select version_num from alembic_version")).scalar()
    return {"revision": rev, "seconds": round(time.time() - started, 1)}


def harden_database() -> list[str]:
    """Supabase exposes `public` through PostgREST. MentorOS data is only
    served by this API, so enable RLS (deny-by-default) on every table and
    revoke direct access from the anon/authenticated roles."""
    done = []
    with db_engine.begin() as conn:
        if conn.dialect.name != "postgresql":
            return ["skipped (not postgres)"]
        tables = [r[0] for r in conn.execute(text("select tablename from pg_tables where schemaname = 'public'"))]
        roles = {r[0] for r in conn.execute(text("select rolname from pg_roles where rolname in ('anon','authenticated')"))}
        for t in tables:
            conn.execute(text(f'alter table public."{t}" enable row level security'))
            for role in roles:
                conn.execute(text(f'revoke all on table public."{t}" from {role}'))
            done.append(t)
    return done


def provision_demo_logins(db: Session) -> list[dict]:
    from backend.app.seed.generator import demo_users

    if not settings.DEMO_ACCOUNT_PASSWORD:
        raise AppError(409, "not_configured", "DEMO_ACCOUNT_PASSWORD is not set")
    out = []
    for u in demo_users(db):
        auth_user = supabase_admin.create_or_update_auth_user(u.email, settings.DEMO_ACCOUNT_PASSWORD, full_name=u.full_name, role=u.role)
        u.auth_user_id = auth_user["id"]
        out.append({"email": u.email, "role": u.role, "auth_user_id": auth_user["id"]})
    db.commit()
    return out


def ensure_buckets() -> dict:
    return {
        settings.STORAGE_AVATAR_BUCKET: supabase_admin.ensure_bucket(settings.STORAGE_AVATAR_BUCKET, True, 3 * 1024 * 1024, ["image/jpeg", "image/png", "image/webp"]),
        settings.STORAGE_RESUME_BUCKET: supabase_admin.ensure_bucket(settings.STORAGE_RESUME_BUCKET, False, 5 * 1024 * 1024, ["application/pdf"]),
    }


@router.post("/bootstrap/migrate", dependencies=[Depends(_require_ops)])
def bootstrap_migrate():
    result = run_migrations()
    result["rls_tables"] = len(harden_database())
    return result


@router.post("/bootstrap/seed", dependencies=[Depends(_require_ops)])
def bootstrap_seed(force: bool = False, db: Session = Depends(get_db)):
    from backend.app.companion.knowledge import sync_knowledge
    from backend.app.seed.generator import BATCH_LABEL, generate

    kb = sync_knowledge(db)
    existing = db.scalar(select(DataBatch).where(DataBatch.label == BATCH_LABEL))
    if existing and not force:
        return {"skipped": True, "reason": "Synthetic batch already present (pass force=true to regenerate)", "knowledge_chunks": kb}
    started = time.time()
    summary = generate(db)
    summary["seconds"] = round(time.time() - started, 1)
    summary["knowledge_chunks"] = kb
    return summary


@router.post("/bootstrap/provision", dependencies=[Depends(_require_ops)])
def bootstrap_provision(db: Session = Depends(get_db)):
    try:
        buckets = ensure_buckets()
        accounts = provision_demo_logins(db)
    except supabase_admin.IntegrationUnavailable as exc:
        raise AppError(503, "auth_admin_unavailable", str(exc)) from exc
    except supabase_admin.SupabaseError as exc:
        raise AppError(502, "supabase_error", f"{exc} (HTTP {exc.status})") from exc
    return {"buckets": buckets, "demo_accounts": accounts}


@router.get("/cron/nightly")
def nightly(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    if not settings.CRON_SECRET or authorization != f"Bearer {settings.CRON_SECRET}":
        raise AppError(401, "unauthorized", "Invalid cron credentials")
    from backend.app.mentoring.router import broadcast_high_alerts
    from backend.app.scoring.engine import recompute

    before = {a.id for a in db.scalars(select(RiskAlert).where(RiskAlert.status == "open"))}
    result = recompute(db, list(db.scalars(select(Student.id).where(Student.status == "active"))), trigger="nightly")
    new_alerts = [a for a in db.scalars(select(RiskAlert).where(RiskAlert.status == "open")) if a.id not in before]
    broadcast_high_alerts(db, new_alerts)
    db.commit()
    return {**result, "new_high_alerts": sum(1 for a in new_alerts if a.severity == "high")}



