from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from backend.app.models import AuditLog

log = logging.getLogger("mentoros.audit")


def client_ip(request: Optional[Request]) -> Optional[str]:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def audit(
    db: Session,
    user_id: Optional[int],
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Any = None,
    details: Optional[dict] = None,
    request: Optional[Request] = None,
    commit: bool = True,
) -> None:
    """Append an audit row (DPDP accountability). Never breaks the action."""
    try:
        db.add(AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            ip_address=client_ip(request),
            details=details or {},
        ))
        if commit:
            db.commit()
    except Exception:  # pragma: no cover
        log.exception("Failed to write audit log for %s", action)
        db.rollback()
