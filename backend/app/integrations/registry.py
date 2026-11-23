"""Single view of every integration's status for health checks and admin UI."""
from __future__ import annotations

from backend.app.core.config import settings
from backend.app.integrations import connectors, llm, messaging


def integrations_overview(probe: bool = False) -> list[dict]:
    s = settings
    items: list[dict] = []

    db_kind = "postgres" if s.database_url().startswith("postgresql") else "sqlite"
    items.append({
        "key": "database", "label": "Supabase PostgreSQL", "category": "core",
        "status": "ok" if db_kind == "postgres" else "degraded",
        "message": "Primary source of truth" if db_kind == "postgres" else "Local SQLite fallback (development only)",
        "required": True,
    })
    auth_ok = bool(s.supabase_url and (s.SUPABASE_JWT_SECRET or s.supabase_anon_key))
    items.append({
        "key": "supabase_auth", "label": "Supabase Auth", "category": "core",
        "status": "ok" if auth_ok else "not_configured",
        "message": "Email/password sign-in with JWT verification" if auth_ok else "Set SUPABASE_URL and keys",
        "required": True,
    })
    items.append({
        "key": "supabase_storage", "label": "Supabase Storage", "category": "core",
        "status": "ok" if s.SUPABASE_SERVICE_ROLE_KEY else "not_configured",
        "message": f"Buckets: {s.STORAGE_AVATAR_BUCKET} (public), {s.STORAGE_RESUME_BUCKET} (private)" if s.SUPABASE_SERVICE_ROLE_KEY else "Service role key needed for uploads",
        "required": False,
    })
    items.append({
        "key": "google_oauth", "label": "Google OAuth", "category": "identity",
        "status": "configured" if s.GOOGLE_OAUTH_ENABLED else "not_configured",
        "message": "Google sign-in enabled via Supabase" if s.GOOGLE_OAUTH_ENABLED else "Enable the Google provider in Supabase, then set GOOGLE_OAUTH_ENABLED=true",
        "required": False,
    })
    items.append({"key": "llm", "label": "LLM provider", "category": "ai", "required": False, **llm.status()})
    items.append({"key": "email", "label": "Email delivery", "category": "messaging", "required": False, **messaging.email_status()})
    items.append({
        "key": "webhook", "label": "Notification webhook", "category": "messaging", "required": False,
        "status": "configured" if s.NOTIFY_WEBHOOK_URL else "not_configured",
        "message": "Slack/Discord-compatible alerts" if s.NOTIFY_WEBHOOK_URL else "Set NOTIFY_WEBHOOK_URL to mirror high-severity alerts",
    })
    for c in connectors.CONNECTORS.values():
        entry = {"key": c.key, "label": c.label, "category": "institution", "required": False,
                 "datasets": list(c.datasets), "description": c.description}
        if probe and c.configured():
            entry.update(c.test())
        else:
            entry.update({"status": "configured" if c.configured() else "not_configured",
                          "message": c.base_url or f"CSV import available · set {c.url_setting} for live sync"})
        items.append(entry)
    items.append({
        "key": "scheduler", "label": "Nightly recompute", "category": "core", "required": False,
        "status": "configured" if (s.CRON_SECRET or s.CELERY_BROKER_URL) else "not_configured",
        "message": "Vercel Cron → /api/v1/ops/cron/nightly" if s.CRON_SECRET else ("Celery beat" if s.CELERY_BROKER_URL else "Manual recompute only"),
    })
    return items
