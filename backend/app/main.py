"""MentorOS API — FastAPI application factory."""
from __future__ import annotations

import logging
import os
import sys
import time

APP_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(APP_DIR))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi import Depends, FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.middleware.gzip import GZipMiddleware  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

import backend.app.models  # noqa: E402,F401  (register tables)
from backend.app.admin.router import router as admin_router  # noqa: E402
from backend.app.allocation.router import router as allocation_router  # noqa: E402
from backend.app.analytics.router import router as analytics_router  # noqa: E402
from backend.app.companion.router import router as companion_router  # noqa: E402
from backend.app.core.auth_router import router as auth_router  # noqa: E402
from backend.app.core.config import integration_flags, settings  # noqa: E402
from backend.app.core.database import get_db  # noqa: E402
from backend.app.core.errors import install_error_handlers  # noqa: E402
from backend.app.mentoring.router import alerts_router, router as mentoring_router  # noqa: E402
from backend.app.notifications.router import router as notifications_router  # noqa: E402
from backend.app.ops.router import router as ops_router  # noqa: E402
from backend.app.scoring.router import router as scoring_router  # noqa: E402
from backend.app.students.router import router as students_router  # noqa: E402

logging.basicConfig(level=settings.LOG_LEVEL, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("mentoros")

API = settings.API_V1_STR


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version="1.0.0",
        description="MentorOS — explainable student success, mentoring and early-warning platform.",
        openapi_url=f"{API}/openapi.json",
        docs_url=f"{API}/docs",
        redoc_url=None,
    )
    install_error_handlers(app)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.BACKEND_CORS_ORIGINS,
        allow_origin_regex=r"https://mentoros(-[a-z0-9-]+)?\.vercel\.app",
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Ops-Token"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path.startswith(API) and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - started) * 1000:.1f}"
        return response

    @app.get(f"{API}/health", tags=["Health"])
    def health():
        return {"status": "ok", "service": "mentoros-api", "version": app.version, "environment": settings.ENVIRONMENT,
                "commit": settings.commit_sha[:12] or None, "integrations": integration_flags()}

    @app.get(f"{API}/health/ready", tags=["Health"])
    def ready(db: Session = Depends(get_db)):
        started = time.perf_counter()
        db.execute(text("select 1"))
        rev = None
        try:
            rev = db.execute(text("select version_num from alembic_version")).scalar()
        except Exception:
            db.rollback()
        return {"status": "ready", "database": db.bind.dialect.name, "migration": rev, "db_ms": round((time.perf_counter() - started) * 1000, 1)}

    app.include_router(auth_router, prefix=f"{API}/auth", tags=["Auth"])
    app.include_router(students_router, prefix=f"{API}/students", tags=["Students"])
    app.include_router(scoring_router, prefix=f"{API}/scoring", tags=["Success Score"])
    app.include_router(mentoring_router, prefix=f"{API}/mentoring", tags=["Mentoring"])
    app.include_router(alerts_router, prefix=f"{API}/alerts", tags=["Risk alerts"])
    app.include_router(allocation_router, prefix=f"{API}/allocation", tags=["Allocation"])
    app.include_router(analytics_router, prefix=f"{API}/analytics", tags=["Analytics"])
    app.include_router(admin_router, prefix=f"{API}/admin", tags=["Administration"])
    app.include_router(companion_router, prefix=f"{API}/companion", tags=["AI Companion"])
    app.include_router(notifications_router, prefix=f"{API}/notifications", tags=["Notifications"])
    app.include_router(ops_router, prefix=f"{API}/ops", tags=["Operations"])
    return app


app = create_app()
