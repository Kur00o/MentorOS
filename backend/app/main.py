import os
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(APP_DIR))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.core.config import settings
from backend.app.core.audit_middleware import AuditMiddleware
from backend.app.auth.router import router as auth_router
import backend.app.models  # noqa: F401
from backend.app.students.router import router as students_router
from backend.app.scoring.router import router as scoring_router
from backend.app.mentoring.router import router as mentoring_router
from backend.app.admin.router import router as admin_router
from backend.app.allocation.router import router as allocation_router

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Audit every successful state-changing request (coarse safety net).
app.add_middleware(AuditMiddleware)

# Set all CORS enabled origins
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Expose a simple health check
@app.get("/", tags=["Health"])
def health_check():
    return {
        "status": "healthy",
        "project": settings.PROJECT_NAME,
        "version": "0.1.0"
    }

# Include routers,
app.include_router(auth_router, prefix=f"{settings.API_V1_STR}/auth", tags=["Team A - Auth"])
app.include_router(students_router, prefix=f"{settings.API_V1_STR}/students", tags=["Team A - Students"])
app.include_router(scoring_router, prefix=f"{settings.API_V1_STR}/scoring", tags=["Team B - Success Score"])
app.include_router(mentoring_router, prefix=f"{settings.API_V1_STR}/mentoring", tags=["Team B - Mentoring & Roster"])
app.include_router(admin_router, prefix=f"{settings.API_V1_STR}/admin", tags=["Team C - Administration"])
app.include_router(allocation_router, prefix=f"{settings.API_V1_STR}/allocation", tags=["Allocation"])
