"""Institution system connectors (ERP, LMS, attendance, placement).

Each connector pulls rows from an institution endpoint and feeds them through
the *same* import pipeline as CSV uploads. Contract (documented in
docs/engineering/INTEGRATIONS.md):

    GET {BASE_URL}/health                 → 200 when reachable
    GET {BASE_URL}/mentoros/{dataset}     → {"rows": [ {<template columns>}, ... ]}

with `Authorization: Bearer {API_KEY}`. Unconfigured connectors report
`not_configured` and never block anything else.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import httpx

from backend.app.core.config import settings


@dataclass(frozen=True)
class Connector:
    key: str
    label: str
    description: str
    datasets: tuple[str, ...]
    url_setting: str
    key_setting: str

    @property
    def base_url(self) -> str:
        return getattr(settings, self.url_setting, "").rstrip("/")

    @property
    def api_key(self) -> str:
        return getattr(settings, self.key_setting, "")

    def configured(self) -> bool:
        return bool(self.base_url)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

    def test(self) -> dict:
        if not self.configured():
            return {"status": "not_configured", "message": f"Set {self.url_setting} to enable."}
        try:
            resp = httpx.get(f"{self.base_url}/health", headers=self._headers(), timeout=8)
            if resp.status_code < 300:
                return {"status": "ok", "message": f"Reachable (HTTP {resp.status_code})"}
            return {"status": "error", "message": f"HTTP {resp.status_code}"}
        except httpx.HTTPError as exc:
            return {"status": "error", "message": f"Unreachable: {exc.__class__.__name__}"}

    def fetch(self, dataset: str) -> list[dict]:
        if dataset not in self.datasets:
            raise ValueError(f"{self.label} does not provide '{dataset}'")
        resp = httpx.get(f"{self.base_url}/mentoros/{dataset}", headers=self._headers(), timeout=30)
        resp.raise_for_status()
        rows = resp.json().get("rows", [])
        if not isinstance(rows, list):
            raise ValueError("Connector response must contain a 'rows' list")
        return [{str(k).strip().lower(): ("" if v is None else str(v)).strip() for k, v in r.items()} for r in rows]


CONNECTORS: dict[str, Connector] = {
    c.key: c
    for c in (
        Connector("erp", "ERP / SIS", "Student roster and declared semester results", ("students", "results"), "ERP_API_URL", "ERP_API_KEY"),
        Connector("lms", "LMS", "Logins, submissions and quiz engagement", ("lms", "marks"), "LMS_API_URL", "LMS_API_KEY"),
        Connector("attendance", "Attendance system", "Per-subject attendance counts", ("attendance",), "ATTENDANCE_API_URL", "ATTENDANCE_API_KEY"),
        Connector("placement", "Placement cell", "Resume, skills, certifications and offers", ("placement",), "PLACEMENT_API_URL", "PLACEMENT_API_KEY"),
    )
}


def get_connector(key: str) -> Optional[Connector]:
    return CONNECTORS.get(key)
