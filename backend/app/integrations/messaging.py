"""Email + notification delivery.

In-app notifications are always stored in the database. Email (Resend or
SMTP) and webhook (Slack/Discord-compatible) delivery are optional
side-channels: when not configured they are skipped silently and the
in-app notification still lands.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from typing import Iterable, Optional

import httpx
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models import Notification, User

log = logging.getLogger("mentoros.messaging")


def email_status() -> dict:
    if settings.EMAIL_PROVIDER == "none":
        return {"status": "disabled", "message": "Email disabled by configuration"}
    if settings.RESEND_API_KEY:
        return {"status": "configured", "message": "Resend"}
    if settings.SMTP_HOST:
        return {"status": "configured", "message": f"SMTP {settings.SMTP_HOST}"}
    return {"status": "not_configured", "message": "No email provider — notifications are in-app only."}


def send_email(to: str, subject: str, text: str) -> bool:
    if email_status()["status"] != "configured" or to.endswith("." + settings.DEMO_EMAIL_DOMAIN) or to.endswith("@" + settings.DEMO_EMAIL_DOMAIN):
        return False  # never email synthetic demo addresses
    try:
        if settings.RESEND_API_KEY:
            resp = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json={"from": settings.EMAIL_FROM, "to": [to], "subject": subject, "text": text},
                timeout=10,
            )
            resp.raise_for_status()
            return True
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = settings.EMAIL_FROM, to, subject
        msg.set_content(text)
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            smtp.starttls()
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception as exc:
        log.warning("Email delivery failed: %s", exc.__class__.__name__)
        return False


def post_webhook(text: str) -> bool:
    if not settings.NOTIFY_WEBHOOK_URL:
        return False
    try:
        httpx.post(settings.NOTIFY_WEBHOOK_URL, json={"text": text, "content": text}, timeout=6).raise_for_status()
        return True
    except Exception as exc:
        log.warning("Webhook delivery failed: %s", exc.__class__.__name__)
        return False


def notify(
    db: Session,
    users: Iterable[User],
    *,
    kind: str,
    title: str,
    body: Optional[str] = None,
    link: Optional[str] = None,
    email: bool = False,
) -> int:
    count = 0
    for user in users:
        if user is None:
            continue
        db.add(Notification(user_id=user.id, kind=kind, title=title, body=body, link=link, is_synthetic=user.is_synthetic, batch_id=user.batch_id))
        count += 1
        if email:
            send_email(user.email, title, f"{body or ''}\n\n{settings.APP_BASE_URL}{link or ''}")
    return count
