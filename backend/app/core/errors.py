"""Consistent error envelope: `{"error": {"code", "message", "details"}}`."""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError

log = logging.getLogger("mentoros")


class AppError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str, details: Optional[Any] = None):
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.message = message
        self.details = details


def not_found(what: str = "Resource") -> AppError:
    return AppError(404, "not_found", f"{what} not found")


def forbidden(message: str = "You do not have access to this resource") -> AppError:
    return AppError(403, "forbidden", message)


def bad_request(message: str, details: Any = None, code: str = "bad_request") -> AppError:
    return AppError(400, code, message, details)


def conflict(message: str, details: Any = None) -> AppError:
    return AppError(409, "conflict", message, details)


def _envelope(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    # `detail` kept for clients that expect FastAPI's default shape.
    body["detail"] = message
    return JSONResponse(status_code=status, content=body)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return _envelope(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException):
        code = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "error")
        return _envelope(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        details = [
            {"field": ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")), "message": err.get("msg")}
            for err in exc.errors()
        ]
        first = details[0] if details else {"field": "", "message": "Invalid input"}
        msg = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
        return _envelope(422, "validation_error", msg, details)

    @app.exception_handler(IntegrityError)
    async def _integrity(_: Request, exc: IntegrityError):
        log.warning("Integrity error: %s", exc.orig)
        return _envelope(409, "conflict", "This change conflicts with existing data (duplicate or invalid reference).")

    @app.exception_handler(OperationalError)
    async def _db_down(_: Request, exc: OperationalError):
        log.error("Database unavailable: %s", exc.orig)
        return _envelope(503, "database_unavailable", "The database is temporarily unavailable. Please retry shortly.")

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("Unhandled error")
        return _envelope(500, "internal_error", "Something went wrong on our side. The error has been logged.")
