"""CSV/connector import pipeline.

One code path ingests rows from CSV uploads *and* from external connectors
(ERP / LMS / attendance / placement), so validation, provenance and score
recomputation behave identically regardless of the source.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.core.deps import Principal
from backend.app.models import (
    AttendanceRecord,
    Department,
    LmsActivity,
    MarkRecord,
    PlacementProfile,
    SemesterResult,
    Student,
    Subject,
    User,
)

MAX_ROWS = 20000

TEMPLATES: dict[str, dict] = {
    "students": {
        "columns": ["usn", "full_name", "email", "department_code", "semester", "section", "phone", "guardian_name", "guardian_phone", "guardian_email", "admission_year"],
        "example": ["MIT23CS001", "Ananya Kulkarni", "ananya.k@college.edu", "CSE", "7", "A", "+91 98200 00001", "R. Kulkarni", "+91 98200 00002", "parent@example.com", "2023"],
        "description": "Create or update student profiles (roster). Does not create sign-in access.",
    },
    "attendance": {
        "columns": ["usn", "subject_code", "total_classes", "attended_classes", "period"],
        "example": ["MIT23CS001", "CS701", "42", "36", settings.SCORING_PERIOD],
        "description": "Cumulative per-subject attendance for the term. Subject codes must exist.",
    },
    "marks": {
        "columns": ["usn", "subject_code", "assessment", "max_marks", "marks_obtained", "period"],
        "example": ["MIT23CS001", "CS701", "internal_1", "30", "24", settings.SCORING_PERIOD],
        "description": "Continuous-assessment marks (internals, assignments, labs).",
    },
    "results": {
        "columns": ["usn", "semester", "sgpa", "credits_earned", "backlogs", "period"],
        "example": ["MIT23CS001", "6", "8.12", "22", "0", "2026-EVEN"],
        "description": "Declared semester results. Latest SGPA drives the Academic pillar; CGPA is recalculated.",
    },
    "lms": {
        "columns": ["usn", "login_count", "active_minutes", "assignments_submitted", "assignments_total", "quizzes_attempted", "avg_quiz_score", "last_active_at", "period"],
        "example": ["MIT23CS001", "64", "1820", "11", "12", "8", "78.5", "2026-11-20T18:30:00Z", settings.SCORING_PERIOD],
        "description": "Term-level LMS engagement (drives the Engagement pillar).",
    },
    "placement": {
        "columns": ["usn", "has_resume", "skills", "certifications", "internships", "aptitude_score", "status", "target_role"],
        "example": ["MIT23CS001", "yes", "Python;SQL;React", "AWS Cloud Practitioner", "1", "72", "preparing", "Software Engineer"],
        "description": "Placement readiness. Lists use ';' as separator.",
    },
}


@dataclass
class ImportResult:
    kind: str
    row_count: int = 0
    success_count: int = 0
    created: int = 0
    updated: int = 0
    error_log: list[dict] = field(default_factory=list)
    affected_students: set[int] = field(default_factory=set)

    def error(self, row: int, column: str, reason: str) -> None:
        if len(self.error_log) < 500:
            self.error_log.append({"row": row, "column": column, "reason": reason})

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "row_count": self.row_count,
            "success_count": self.success_count,
            "created": self.created,
            "updated": self.updated,
            "error_count": self.row_count - self.success_count,
            "error_log": self.error_log,
        }


class RowError(ValueError):
    def __init__(self, column: str, reason: str):
        super().__init__(reason)
        self.column = column
        self.reason = reason


def parse_csv(raw: bytes) -> list[dict]:
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("File is not valid UTF-8 text. Export the sheet as 'CSV UTF-8'.") from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("The file has no header row.")
    rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in reader]
    if len(rows) > MAX_ROWS:
        raise ValueError(f"Too many rows ({len(rows)}). The limit per file is {MAX_ROWS}.")
    return rows


# ── field helpers ──────────────────────────────────────────────────────────
def _req(row: dict, col: str) -> str:
    value = row.get(col, "")
    if value == "":
        raise RowError(col, "Required value is missing")
    return value


def _int(row: dict, col: str, *, lo: Optional[int] = None, hi: Optional[int] = None, required: bool = True, default: int = 0) -> int:
    raw = row.get(col, "")
    if raw == "":
        if required:
            raise RowError(col, "Required number is missing")
        return default
    try:
        value = int(float(raw))
    except ValueError as exc:
        raise RowError(col, f"'{raw}' is not a whole number") from exc
    if lo is not None and value < lo:
        raise RowError(col, f"Must be ≥ {lo}")
    if hi is not None and value > hi:
        raise RowError(col, f"Must be ≤ {hi}")
    return value


def _float(row: dict, col: str, *, lo: Optional[float] = None, hi: Optional[float] = None, required: bool = True) -> Optional[float]:
    raw = row.get(col, "")
    if raw == "":
        if required:
            raise RowError(col, "Required number is missing")
        return None
    try:
        value = float(raw)
    except ValueError as exc:
        raise RowError(col, f"'{raw}' is not a number") from exc
    if lo is not None and value < lo:
        raise RowError(col, f"Must be ≥ {lo}")
    if hi is not None and value > hi:
        raise RowError(col, f"Must be ≤ {hi}")
    return value


def _bool(value: str) -> bool:
    return value.strip().lower() in ("1", "y", "yes", "true", "t")


def _list(value: str) -> list[str]:
    return [p.strip() for p in value.replace(",", ";").split(";") if p.strip()]


# ── importer ───────────────────────────────────────────────────────────────
class Importer:
    def __init__(self, db: Session, principal: Optional[Principal], *, source: str = "import"):
        self.db = db
        self.p = principal
        self.source = source
        self._students: dict[str, Optional[Student]] = {}
        self._subjects: dict[str, Optional[Subject]] = {}

    def _student(self, usn: str) -> Student:
        key = usn.upper()
        if key not in self._students:
            self._students[key] = self.db.scalar(select(Student).where(func.upper(Student.usn) == key))
        st = self._students[key]
        if st is None:
            raise RowError("usn", f"No student with USN {usn}")
        if self.p and self.p.role == "hod" and st.department_id != self.p.department_id:
            raise RowError("usn", f"{usn} is outside your department")
        return st

    def _subject(self, code: str) -> Subject:
        key = code.upper()
        if key not in self._subjects:
            self._subjects[key] = self.db.scalar(select(Subject).where(func.upper(Subject.code) == key))
        sub = self._subjects[key]
        if sub is None:
            raise RowError("subject_code", f"Unknown subject code {code}")
        return sub

    def run(self, kind: str, rows: list[dict]) -> ImportResult:
        handler: Callable[[dict, ImportResult], None] = getattr(self, f"_row_{kind}", None)  # type: ignore[assignment]
        if handler is None:
            raise ValueError(f"Unknown import type '{kind}'")
        result = ImportResult(kind=kind, row_count=len(rows))
        missing = [c for c in TEMPLATES[kind]["columns"][:2] if rows and c not in rows[0]]
        if missing:
            result.error(1, ",".join(missing), "Missing required column(s) in header")
            return result
        for i, row in enumerate(rows, start=2):  # row 1 is the header
            try:
                with self.db.begin_nested():
                    handler(row, result)
                result.success_count += 1
            except RowError as exc:
                result.error(i, exc.column, exc.reason)
        self.db.flush()
        return result

    # students roster
    def _row_students(self, row: dict, res: ImportResult) -> None:
        usn = _req(row, "usn").upper()
        email = _req(row, "email").lower()
        if "@" not in email:
            raise RowError("email", "Invalid email address")
        dept_code = _req(row, "department_code").upper()
        dept = self.db.scalar(select(Department).where(func.upper(Department.code) == dept_code))
        if dept is None:
            raise RowError("department_code", f"Unknown department {dept_code}")
        if self.p and self.p.role == "hod" and dept.id != self.p.department_id:
            raise RowError("department_code", "HODs can only import their own department")
        semester = _int(row, "semester", lo=1, hi=10)
        st = self.db.scalar(select(Student).where(func.upper(Student.usn) == usn))
        if st is None:
            if self.db.scalar(select(User.id).where(func.lower(User.email) == email)):
                raise RowError("email", "Email already belongs to another account")
            user = User(email=email, full_name=_req(row, "full_name"), role="student", department_id=dept.id, phone=row.get("phone") or None)
            self.db.add(user)
            self.db.flush()
            st = Student(user_id=user.id, usn=usn, department_id=dept.id, semester=semester)
            self.db.add(st)
            res.created += 1
        else:
            st.user.full_name = row.get("full_name") or st.user.full_name
            st.department_id = dept.id
            st.user.department_id = dept.id
            st.semester = semester
            res.updated += 1
        st.section = row.get("section") or st.section
        st.guardian_name = row.get("guardian_name") or st.guardian_name
        st.guardian_phone = row.get("guardian_phone") or st.guardian_phone
        st.guardian_email = row.get("guardian_email") or st.guardian_email
        if row.get("admission_year"):
            st.admission_year = _int(row, "admission_year", lo=1990, hi=2100)
        self.db.flush()
        res.affected_students.add(st.id)

    def _row_attendance(self, row: dict, res: ImportResult) -> None:
        st = self._student(_req(row, "usn"))
        sub = self._subject(_req(row, "subject_code"))
        total = _int(row, "total_classes", lo=0, hi=1000)
        attended = _int(row, "attended_classes", lo=0, hi=1000)
        if attended > total:
            raise RowError("attended_classes", "Attended classes exceed total classes")
        period = row.get("period") or settings.SCORING_PERIOD
        rec = self.db.scalar(select(AttendanceRecord).where(
            AttendanceRecord.student_id == st.id, AttendanceRecord.subject_id == sub.id, AttendanceRecord.period == period))
        if rec:
            rec.total_classes, rec.attended_classes, rec.source = total, attended, self.source
            res.updated += 1
        else:
            self.db.add(AttendanceRecord(student_id=st.id, subject_id=sub.id, period=period, total_classes=total,
                                         attended_classes=attended, source=self.source))
            res.created += 1
        res.affected_students.add(st.id)

    def _row_marks(self, row: dict, res: ImportResult) -> None:
        st = self._student(_req(row, "usn"))
        sub = self._subject(_req(row, "subject_code"))
        assessment = _req(row, "assessment").lower().replace(" ", "_")[:32]
        mx = _float(row, "max_marks", lo=1, hi=1000)
        got = _float(row, "marks_obtained", lo=0, hi=1000)
        if got > mx:
            raise RowError("marks_obtained", "Marks obtained exceed maximum marks")
        period = row.get("period") or settings.SCORING_PERIOD
        rec = self.db.scalar(select(MarkRecord).where(
            MarkRecord.student_id == st.id, MarkRecord.subject_id == sub.id, MarkRecord.period == period, MarkRecord.assessment == assessment))
        if rec:
            rec.max_marks, rec.marks_obtained = mx, got
            res.updated += 1
        else:
            self.db.add(MarkRecord(student_id=st.id, subject_id=sub.id, period=period, assessment=assessment, max_marks=mx, marks_obtained=got))
            res.created += 1
        res.affected_students.add(st.id)

    def _row_results(self, row: dict, res: ImportResult) -> None:
        st = self._student(_req(row, "usn"))
        semester = _int(row, "semester", lo=1, hi=10)
        sgpa = _float(row, "sgpa", lo=0, hi=10)
        period = row.get("period") or settings.SCORING_PERIOD
        rec = self.db.scalar(select(SemesterResult).where(SemesterResult.student_id == st.id, SemesterResult.semester == semester))
        credits = _int(row, "credits_earned", lo=0, hi=60, required=False)
        backlogs = _int(row, "backlogs", lo=0, hi=20, required=False)
        if rec:
            rec.sgpa, rec.period, rec.credits_earned, rec.backlogs = sgpa, period, credits, backlogs
            res.updated += 1
        else:
            self.db.add(SemesterResult(student_id=st.id, semester=semester, period=period, sgpa=sgpa, credits_earned=credits, backlogs=backlogs))
            res.created += 1
        self.db.flush()
        results = self.db.scalars(select(SemesterResult).where(SemesterResult.student_id == st.id).order_by(SemesterResult.semester)).all()
        st.sgpa = results[-1].sgpa
        st.cgpa = round(sum(r.sgpa for r in results) / len(results), 2)
        st.active_backlogs = results[-1].backlogs
        res.affected_students.add(st.id)

    def _row_lms(self, row: dict, res: ImportResult) -> None:
        st = self._student(_req(row, "usn"))
        period = row.get("period") or settings.SCORING_PERIOD
        submitted = _int(row, "assignments_submitted", lo=0, hi=500)
        total = _int(row, "assignments_total", lo=0, hi=500)
        if submitted > total:
            raise RowError("assignments_submitted", "Submitted assignments exceed total")
        last_active = None
        if row.get("last_active_at"):
            try:
                last_active = datetime.fromisoformat(row["last_active_at"].replace("Z", "+00:00"))
                if last_active.tzinfo is None:
                    last_active = last_active.replace(tzinfo=timezone.utc)
            except ValueError as exc:
                raise RowError("last_active_at", "Use ISO format, e.g. 2026-11-20T18:30:00Z") from exc
        rec = self.db.scalar(select(LmsActivity).where(LmsActivity.student_id == st.id, LmsActivity.period == period))
        values = dict(
            login_count=_int(row, "login_count", lo=0, hi=100000),
            active_minutes=_int(row, "active_minutes", lo=0, hi=1000000, required=False),
            assignments_submitted=submitted,
            assignments_total=total,
            quizzes_attempted=_int(row, "quizzes_attempted", lo=0, hi=1000, required=False),
            avg_quiz_score=_float(row, "avg_quiz_score", lo=0, hi=100, required=False),
            last_active_at=last_active,
        )
        if rec:
            for k, v in values.items():
                setattr(rec, k, v)
            res.updated += 1
        else:
            self.db.add(LmsActivity(student_id=st.id, period=period, **values))
            res.created += 1
        res.affected_students.add(st.id)

    def _row_placement(self, row: dict, res: ImportResult) -> None:
        st = self._student(_req(row, "usn"))
        status = (row.get("status") or "preparing").lower()
        if status not in ("not_started", "preparing", "applying", "placed", "higher_studies"):
            raise RowError("status", "Use not_started, preparing, applying, placed or higher_studies")
        prof = self.db.scalar(select(PlacementProfile).where(PlacementProfile.student_id == st.id))
        if prof is None:
            prof = PlacementProfile(student_id=st.id)
            self.db.add(prof)
            res.created += 1
        else:
            res.updated += 1
        prof.has_resume = _bool(row.get("has_resume", ""))
        prof.skills = _list(row.get("skills", ""))
        prof.certifications = _list(row.get("certifications", ""))
        prof.internships = _int(row, "internships", lo=0, hi=20, required=False)
        prof.aptitude_score = _float(row, "aptitude_score", lo=0, hi=100, required=False)
        prof.status = status
        prof.target_role = row.get("target_role") or prof.target_role
        res.affected_students.add(st.id)


def template_csv(kind: str) -> str:
    spec = TEMPLATES[kind]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(spec["columns"])
    w.writerow(spec["example"])
    return out.getvalue()
