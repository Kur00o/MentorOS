from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from backend.app.companion.engine import HELP, answer
from backend.app.core.database import get_db
from backend.app.core.deps import Principal, get_principal
from backend.app.core.errors import bad_request
from backend.app.integrations import llm
from backend.app.models import CompanionMessage
from backend.app.students.service import iso

router = APIRouter()

RATE_LIMIT_PER_HOUR = 120


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=1500)
    conversation_id: Optional[str] = Field(default=None, max_length=40, pattern=r"^[a-zA-Z0-9-]+$")


@router.get("/config")
def companion_config(p: Principal = Depends(get_principal)):
    return {"suggestions": HELP.get(p.role, []), "llm": llm.status()}


@router.post("/chat")
def chat(body: ChatIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    text = body.message.strip()
    if not text:
        raise bad_request("Message cannot be empty")
    recent = db.scalar(select(func.count(CompanionMessage.id)).where(
        CompanionMessage.user_id == p.id, CompanionMessage.role == "user",
        CompanionMessage.created_at >= datetime.now(timezone.utc) - timedelta(hours=1)))
    if (recent or 0) >= RATE_LIMIT_PER_HOUR:
        raise bad_request("You've reached the hourly companion limit. Try again a little later.", code="rate_limited")
    conv = body.conversation_id or uuid.uuid4().hex[:16]
    history_rows = db.scalars(select(CompanionMessage).where(CompanionMessage.user_id == p.id, CompanionMessage.conversation_id == conv)
                              .order_by(CompanionMessage.created_at.desc()).limit(8)).all()
    history = [{"role": m.role, "content": m.content} for m in reversed(history_rows)]
    reply = answer(db, p, text, history)
    db.add(CompanionMessage(user_id=p.id, conversation_id=conv, role="user", content=text, meta={}))
    db.add(CompanionMessage(user_id=p.id, conversation_id=conv, role="assistant", content=reply.answer,
                            meta={"intent": reply.intent, "cards": reply.cards, "sources": reply.sources, "provider": reply.provider,
                                  "suggestions": reply.suggestions}))
    db.commit()
    return {"conversation_id": conv, "answer": reply.answer, "intent": reply.intent, "cards": reply.cards,
            "suggestions": reply.suggestions, "sources": reply.sources, "provider": reply.provider}


@router.get("/history")
def history(conversation_id: Optional[str] = None, limit: int = Query(default=40, le=200), p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    stmt = select(CompanionMessage).where(CompanionMessage.user_id == p.id)
    if conversation_id:
        stmt = stmt.where(CompanionMessage.conversation_id == conversation_id)
    else:
        last = db.scalar(select(CompanionMessage.conversation_id).where(CompanionMessage.user_id == p.id).order_by(CompanionMessage.created_at.desc()).limit(1))
        if not last:
            return {"conversation_id": None, "messages": []}
        conversation_id = last
        stmt = stmt.where(CompanionMessage.conversation_id == last)
    rows = db.scalars(stmt.order_by(CompanionMessage.created_at.desc()).limit(limit)).all()
    return {"conversation_id": conversation_id, "messages": [
        {"id": m.id, "role": m.role, "content": m.content, "created_at": iso(m.created_at), **(m.meta or {})} for m in reversed(rows)]}


@router.delete("/history")
def clear_history(p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    n = db.execute(delete(CompanionMessage).where(CompanionMessage.user_id == p.id)).rowcount
    db.commit()
    return {"deleted": n}
