"""Server-side Supabase Admin (GoTrue) + Storage calls via the service role.

All functions degrade gracefully: if Supabase admin access is not configured
they raise `IntegrationUnavailable`, which callers translate into a clear
"not configured" message instead of a crash.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from backend.app.core.config import settings

log = logging.getLogger("mentoros.supabase")


class IntegrationUnavailable(RuntimeError):
    pass


class SupabaseError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _require() -> tuple[str, str]:
    if not (settings.supabase_url and settings.SUPABASE_SERVICE_ROLE_KEY):
        raise IntegrationUnavailable("Supabase service-role access is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).")
    return settings.supabase_url, settings.SUPABASE_SERVICE_ROLE_KEY


def _headers(key: str, extra: Optional[dict] = None) -> dict:
    h = {"apikey": key, "Authorization": f"Bearer {key}"}
    if extra:
        h.update(extra)
    return h


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        try:
            body = resp.json()
            msg = body.get("msg") or body.get("message") or body.get("error_description") or body.get("error") or resp.text
        except ValueError:
            msg = resp.text
        raise SupabaseError(resp.status_code, str(msg))


# ── Auth admin ─────────────────────────────────────────────────────────────
def find_auth_user_by_email(email: str) -> Optional[dict]:
    url, key = _require()
    email = email.lower()
    page = 1
    with httpx.Client(timeout=15) as client:
        while page < 50:
            resp = client.get(f"{url}/auth/v1/admin/users", params={"page": page, "per_page": 200}, headers=_headers(key))
            _raise_for(resp)
            users = resp.json().get("users", [])
            for u in users:
                if (u.get("email") or "").lower() == email:
                    return u
            if len(users) < 200:
                return None
            page += 1
    return None


def create_or_update_auth_user(email: str, password: Optional[str], *, full_name: str, role: str) -> dict:
    """Idempotently ensure an email/password identity exists in Supabase Auth."""
    url, key = _require()
    meta = {"full_name": full_name, "mentoros_role": role}
    existing = find_auth_user_by_email(email)
    with httpx.Client(timeout=15) as client:
        if existing:
            body: dict[str, Any] = {"user_metadata": meta, "email_confirm": True}
            if password:
                body["password"] = password
            resp = client.put(f"{url}/auth/v1/admin/users/{existing['id']}", json=body, headers=_headers(key))
            _raise_for(resp)
            return resp.json()
        body = {"email": email, "email_confirm": True, "user_metadata": meta}
        if password:
            body["password"] = password
        resp = client.post(f"{url}/auth/v1/admin/users", json=body, headers=_headers(key))
        _raise_for(resp)
        return resp.json()


def send_password_recovery(email: str, redirect_to: Optional[str] = None) -> None:
    url, key = _require()
    params = {"redirect_to": redirect_to} if redirect_to else None
    resp = httpx.post(f"{url}/auth/v1/recover", params=params, json={"email": email}, headers=_headers(key), timeout=15)
    _raise_for(resp)


def ban_auth_user(auth_user_id: str, banned: bool) -> None:
    url, key = _require()
    resp = httpx.put(
        f"{url}/auth/v1/admin/users/{auth_user_id}",
        json={"ban_duration": "876000h" if banned else "none"},
        headers=_headers(key),
        timeout=15,
    )
    _raise_for(resp)


# ── Storage ────────────────────────────────────────────────────────────────
def ensure_bucket(name: str, public: bool, file_size_limit: int, mime_types: list[str]) -> str:
    url, key = _require()
    body = {"id": name, "name": name, "public": public, "file_size_limit": file_size_limit, "allowed_mime_types": mime_types}
    with httpx.Client(timeout=15) as client:
        resp = client.get(f"{url}/storage/v1/bucket/{name}", headers=_headers(key))
        if resp.status_code == 200:
            upd = client.put(f"{url}/storage/v1/bucket/{name}", json=body, headers=_headers(key))
            _raise_for(upd)
            return "updated"
        created = client.post(f"{url}/storage/v1/bucket", json=body, headers=_headers(key))
        _raise_for(created)
        return "created"


def upload_object(bucket: str, path: str, data: bytes, content_type: str) -> str:
    url, key = _require()
    resp = httpx.post(
        f"{url}/storage/v1/object/{bucket}/{path}",
        content=data,
        headers=_headers(key, {"Content-Type": content_type, "x-upsert": "true", "cache-control": "3600"}),
        timeout=30,
    )
    _raise_for(resp)
    return path


def public_url(bucket: str, path: str) -> str:
    return f"{settings.supabase_url}/storage/v1/object/public/{bucket}/{path}"


def signed_url(bucket: str, path: str, expires_in: int = 600) -> str:
    url, key = _require()
    resp = httpx.post(
        f"{url}/storage/v1/object/sign/{bucket}/{path}", json={"expiresIn": expires_in}, headers=_headers(key), timeout=15
    )
    _raise_for(resp)
    signed = resp.json().get("signedURL") or resp.json().get("signedUrl")
    return f"{url}/storage/v1{signed}" if signed and signed.startswith("/") else signed


def health() -> dict:
    """Non-throwing connectivity probe for the admin Integrations page."""
    if not settings.supabase_url:
        return {"status": "not_configured", "message": "SUPABASE_URL is not set"}
    try:
        resp = httpx.get(f"{settings.supabase_url}/auth/v1/health", headers={"apikey": settings.supabase_anon_key or settings.SUPABASE_SERVICE_ROLE_KEY}, timeout=6)
        if resp.status_code == 200:
            return {"status": "ok", "message": "Supabase Auth reachable"}
        return {"status": "error", "message": f"Auth health returned HTTP {resp.status_code}"}
    except httpx.HTTPError as exc:
        return {"status": "error", "message": f"Unreachable: {exc.__class__.__name__}"}
