"""
Centralised configuration for the MentorOS API.

Every setting is read from the environment (or a local `.env` file during
development). Nothing secret has a real default: optional integrations are
simply reported as "not configured" and the platform keeps working.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated, List, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=True,
    )

    # ── App ────────────────────────────────────────────────────────────────
    PROJECT_NAME: str = "MentorOS API"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"  # development | test | production
    APP_BASE_URL: str = "http://localhost:5173"
    GIT_COMMIT_SHA: str = Field(default="", validation_alias="VERCEL_GIT_COMMIT_SHA")
    BUILD_COMMIT_SHA: str = ""
    LOG_LEVEL: str = "INFO"

    # ── Database ───────────────────────────────────────────────────────────
    # Supabase via the Vercel integration provides POSTGRES_URL (pooled) and
    # POSTGRES_URL_NON_POOLING. DATABASE_URL wins when set explicitly.
    DATABASE_URL: str = ""
    POSTGRES_URL: str = ""
    POSTGRES_URL_NON_POOLING: str = ""
    DB_ECHO: bool = False

    # ── Supabase (auth + storage) ──────────────────────────────────────────
    SUPABASE_URL: str = ""
    NEXT_PUBLIC_SUPABASE_URL: str = ""  # name used by the Vercel integration
    SUPABASE_ANON_KEY: str = ""
    NEXT_PUBLIC_SUPABASE_ANON_KEY: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""
    SUPABASE_JWT_AUDIENCE: str = "authenticated"
    STORAGE_AVATAR_BUCKET: str = "avatars"
    STORAGE_RESUME_BUCKET: str = "resumes"

    # ── Access policy ──────────────────────────────────────────────────────
    # Comma separated. Empty = any domain may sign in *if* an admin has
    # provisioned the account. Self-provisioning is never automatic.
    ALLOWED_EMAIL_DOMAINS: Annotated[List[str], NoDecode] = []
    BACKEND_CORS_ORIGINS: Annotated[List[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
    ]

    # ── Scoring ────────────────────────────────────────────────────────────
    SCORING_PERIOD: str = "2026-ODD"
    PRIVACY_NOTICE_VERSION: str = "1.0"

    # ── Operations ─────────────────────────────────────────────────────────
    OPS_TOKEN: str = ""  # protects /ops/* (bootstrap, reseed)
    CRON_SECRET: str = ""  # Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`
    DEMO_ACCOUNT_PASSWORD: str = ""  # used by bootstrap to provision demo logins
    DEMO_EMAIL_DOMAIN: str = "mentoros.demo"

    # ── Optional integrations ──────────────────────────────────────────────
    GOOGLE_OAUTH_ENABLED: bool = False
    LLM_PROVIDER: str = "auto"  # auto | anthropic | openai | gemini | ollama | none
    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-opus-5-5"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o-mini"
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"
    OLLAMA_BASE_URL: str = ""
    OLLAMA_MODEL: str = "gemma3:4b"
    LLM_TIMEOUT_SECONDS: float = 20.0

    EMAIL_PROVIDER: str = "auto"  # auto | resend | smtp | none
    EMAIL_FROM: str = "MentorOS <no-reply@mentoros.app>"
    RESEND_API_KEY: str = ""
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""

    NOTIFY_WEBHOOK_URL: str = ""  # Slack/Discord-compatible incoming webhook

    ERP_API_URL: str = ""
    ERP_API_KEY: str = ""
    LMS_API_URL: str = ""
    LMS_API_KEY: str = ""
    ATTENDANCE_API_URL: str = ""
    ATTENDANCE_API_KEY: str = ""
    PLACEMENT_API_URL: str = ""
    PLACEMENT_API_KEY: str = ""

    # Celery/Redis are optional: Vercel Cron drives the nightly recompute in
    # the hosted deployment. Set this to run the worker on your own infra.
    CELERY_BROKER_URL: str = ""

    @field_validator("ALLOWED_EMAIL_DOMAINS", "BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def _split_list(cls, value):
        if value is None:
            return []
        if isinstance(value, str):
            raw = value.strip()
            if not raw:
                return []
            if raw.startswith("["):
                return [str(v).strip() for v in json.loads(raw)]
            return [part.strip() for part in raw.split(",") if part.strip()]
        return value

    # ── Derived values ─────────────────────────────────────────────────────
    @property
    def supabase_url(self) -> str:
        return (self.SUPABASE_URL or self.NEXT_PUBLIC_SUPABASE_URL).rstrip("/")

    @property
    def supabase_anon_key(self) -> str:
        return self.SUPABASE_ANON_KEY or self.NEXT_PUBLIC_SUPABASE_ANON_KEY

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    @property
    def commit_sha(self) -> str:
        return self.GIT_COMMIT_SHA or self.BUILD_COMMIT_SHA

    def database_url(self, *, direct: bool = False) -> str:
        raw = self.DATABASE_URL
        if direct and self.POSTGRES_URL_NON_POOLING:
            raw = self.POSTGRES_URL_NON_POOLING
        raw = raw or self.POSTGRES_URL or self.POSTGRES_URL_NON_POOLING
        if not raw:
            return f"sqlite:///{BACKEND_DIR / 'mentoros_dev.sqlite3'}"
        return normalize_database_url(raw)


def normalize_database_url(raw: str) -> str:
    """Make provider URLs safe for SQLAlchemy + psycopg2.

    The Supabase/Vercel integration emits `postgres://` URLs with extra query
    parameters (`supa=`, `pgbouncer=`) that libpq rejects.
    """
    if raw.startswith("sqlite"):
        return raw
    parts = urlsplit(raw)
    scheme = parts.scheme
    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+psycopg2"
    allowed = {"sslmode", "connect_timeout", "application_name", "options", "target_session_attrs"}
    query = [(k, v) for k, v in parse_qsl(parts.query) if k in allowed]
    if not any(k == "sslmode" for k, _ in query) and "localhost" not in parts.netloc and "127.0.0.1" not in parts.netloc:
        query.append(("sslmode", "require"))
    return urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), ""))


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def integration_flags() -> dict[str, Optional[bool]]:
    """Lightweight booleans used by health checks and the admin UI."""
    s = settings
    return {
        "supabase_auth": bool(s.supabase_url and (s.SUPABASE_JWT_SECRET or s.supabase_anon_key)),
        "supabase_admin": bool(s.supabase_url and s.SUPABASE_SERVICE_ROLE_KEY),
        "google_oauth": s.GOOGLE_OAUTH_ENABLED,
        "llm": bool(s.ANTHROPIC_API_KEY or s.OPENAI_API_KEY or s.GEMINI_API_KEY or s.OLLAMA_BASE_URL)
        and s.LLM_PROVIDER != "none",
        "email": bool(s.RESEND_API_KEY or s.SMTP_HOST) and s.EMAIL_PROVIDER != "none",
        "webhook": bool(s.NOTIFY_WEBHOOK_URL),
        "erp": bool(s.ERP_API_URL),
        "lms": bool(s.LMS_API_URL),
        "attendance": bool(s.ATTENDANCE_API_URL),
        "placement": bool(s.PLACEMENT_API_URL),
        "celery": bool(s.CELERY_BROKER_URL),
    }
