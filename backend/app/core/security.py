"""Supabase access-token verification.

Supports both Supabase signing schemes:
  * legacy shared secret (HS256)  — `SUPABASE_JWT_SECRET`
  * asymmetric signing keys (ES256/RS256) — fetched from the project's JWKS
If neither verifies locally, we fall back to asking Supabase Auth itself
(`/auth/v1/user`), so a rotated key never locks everyone out.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Optional

import httpx
import jwt

from backend.app.core.config import settings

log = logging.getLogger("mentoros.auth")


class AuthError(Exception):
    pass


@dataclass
class TokenClaims:
    sub: str
    email: Optional[str]
    raw: dict[str, Any]


_jwks_cache: dict[str, Any] = {"at": 0.0, "client": None}


def _jwks_client() -> Optional[jwt.PyJWKClient]:
    if not settings.supabase_url:
        return None
    if _jwks_cache["client"] is None or time.time() - _jwks_cache["at"] > 600:
        _jwks_cache["client"] = jwt.PyJWKClient(
            f"{settings.supabase_url}/auth/v1/.well-known/jwks.json", cache_keys=True, timeout=5
        )
        _jwks_cache["at"] = time.time()
    return _jwks_cache["client"]


def _claims(payload: dict) -> TokenClaims:
    sub = payload.get("sub")
    if not sub:
        raise AuthError("Token has no subject")
    return TokenClaims(sub=str(sub), email=(payload.get("email") or "").lower() or None, raw=payload)


def verify_access_token(token: str) -> TokenClaims:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise AuthError("Malformed token") from exc
    alg = header.get("alg", "")
    options = {"require": ["exp", "sub"]}
    audience = settings.SUPABASE_JWT_AUDIENCE or None

    if alg.startswith("HS"):
        if not settings.SUPABASE_JWT_SECRET:
            raise AuthError("HS256 token but SUPABASE_JWT_SECRET is not configured")
        try:
            return _claims(jwt.decode(token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"], audience=audience, options=options))
        except jwt.ExpiredSignatureError as exc:
            raise AuthError("Session expired") from exc
        except jwt.PyJWTError as exc:
            raise AuthError("Invalid token signature") from exc

    client = _jwks_client()
    if client is not None:
        try:
            key = client.get_signing_key_from_jwt(token)
            return _claims(jwt.decode(token, key.key, algorithms=["ES256", "RS256", "EdDSA"], audience=audience, options=options))
        except jwt.ExpiredSignatureError as exc:
            raise AuthError("Session expired") from exc
        except Exception as exc:  # network / key-rotation issues → remote check
            log.warning("JWKS verification failed (%s); falling back to Supabase Auth", exc)

    return _verify_remotely(token)


def _verify_remotely(token: str) -> TokenClaims:
    if not (settings.supabase_url and settings.supabase_anon_key):
        raise AuthError("Supabase Auth is not configured")
    try:
        resp = httpx.get(
            f"{settings.supabase_url}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": settings.supabase_anon_key},
            timeout=6,
        )
    except httpx.HTTPError as exc:
        raise AuthError("Could not reach Supabase Auth") from exc
    if resp.status_code != 200:
        raise AuthError("Invalid or expired session")
    data = resp.json()
    return TokenClaims(sub=data["id"], email=(data.get("email") or "").lower() or None, raw=data)
