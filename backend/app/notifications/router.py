from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.deps import Principal, get_principal
from backend.app.core.errors import not_found
from backend.app.models import Notification
from backend.app.students.service import iso

router = APIRouter()


@router.get("")
def list_notifications(unread: bool = False, limit: int = Query(default=30, le=100), p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    stmt = select(Notification).where(Notification.user_id == p.id)
    if unread:
        stmt = stmt.where(Notification.read_at.is_(None))
    items = db.scalars(stmt.order_by(Notification.created_at.desc()).limit(limit)).all()
    count = db.scalar(select(func.count(Notification.id)).where(Notification.user_id == p.id, Notification.read_at.is_(None)))
    return {"unread": count or 0, "items": [
        {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "read": n.read_at is not None, "created_at": iso(n.created_at)}
        for n in items]}


@router.post("/{notification_id}/read")
def mark_read(notification_id: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    n = db.get(Notification, notification_id)
    if n is None or n.user_id != p.id:
        raise not_found("Notification")
    n.read_at = n.read_at or datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    res = db.execute(update(Notification).where(Notification.user_id == p.id, Notification.read_at.is_(None)).values(read_at=datetime.now(timezone.utc)))
    db.commit()
    return {"updated": res.rowcount}
