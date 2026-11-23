"""
Student Success Score — the single, pure definition (faculty-agreed).

    Total = 0.35·Attendance + 0.35·Academic + 0.15·Engagement + 0.15·Placement

* Attendance = classes attended / classes held × 100 across all subjects
  (raw percentage, as documented in docs/scoring.md).
* Academic   = min(SGPA × 10, 100) using the latest declared SGPA
  (Phase-3 DECISION-1, SGPA variant).
* Engagement = mean(login ratio vs department cohort, capped at 100;
  assignment submission rate).
* Placement  = resume 40 + min(skills, 5)·8 + min(certifications, 5)·4, capped 100.

If either 35 % pillar (attendance or academic) is missing the result is
`insufficient_data` — never a misleading number. Missing engagement counts
as 0 (it is improvable), missing placement profile counts as 0.

Every caller — the scoring engine, the synthetic data generator, the
"what-if" simulator and the tests — goes through these functions, so the
number a student sees is the number a HOD sees.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, Optional

WEIGHTS = {"attendance": 0.35, "academic": 0.35, "engagement": 0.15, "placement": 0.15}
GREEN_MIN = 70.0
AMBER_MIN = 50.0
ATTENDANCE_REQUIREMENT = 75.0  # university minimum for exam eligibility

PLACEMENT_RESUME_POINTS = 40
PLACEMENT_SKILL_POINTS = 8
PLACEMENT_CERT_POINTS = 4
PLACEMENT_CAP_ITEMS = 5


@dataclass(frozen=True)
class ScoreResult:
    attendance_component: Optional[float]
    academic_component: Optional[float]
    engagement_component: Optional[float]
    placement_component: Optional[float]
    total_score: Optional[float]
    risk_category: str

    def as_dict(self) -> dict:
        return asdict(self)


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, value))


def attendance_component(pairs: Iterable[tuple[int, int]]) -> Optional[float]:
    """pairs = (attended, total) per subject. Weighted by classes held."""
    attended = total = 0
    for a, t in pairs:
        attended += max(0, a)
        total += max(0, t)
    if total <= 0:
        return None
    return round(_clamp(attended / total * 100), 2)


def academic_component(sgpa: Optional[float]) -> Optional[float]:
    if sgpa is None:
        return None
    return round(_clamp(sgpa * 10), 2)


def engagement_component(
    login_count: Optional[int],
    cohort_avg_logins: Optional[float],
    assignments_submitted: Optional[int],
    assignments_total: Optional[int],
) -> Optional[float]:
    if login_count is None and assignments_submitted is None:
        return None
    logins = login_count or 0
    submitted = assignments_submitted or 0
    if logins == 0 and submitted == 0:
        return None
    avg = cohort_avg_logins if cohort_avg_logins and cohort_avg_logins > 0 else max(logins, 1)
    login_ratio = _clamp(logins / avg * 100)
    total = assignments_total or 0
    submission_rate = _clamp(submitted / total * 100) if total > 0 else 0.0
    return round((login_ratio + submission_rate) / 2, 2)


def placement_component(has_resume: bool, skills_count: int, certifications_count: int) -> float:
    score = PLACEMENT_RESUME_POINTS if has_resume else 0
    score += min(max(skills_count, 0), PLACEMENT_CAP_ITEMS) * PLACEMENT_SKILL_POINTS
    score += min(max(certifications_count, 0), PLACEMENT_CAP_ITEMS) * PLACEMENT_CERT_POINTS
    return float(_clamp(score))


def risk_band(total: Optional[float]) -> str:
    if total is None:
        return "insufficient_data"
    if total >= GREEN_MIN:
        return "green"
    if total >= AMBER_MIN:
        return "amber"
    return "coral"


def compose(
    attendance: Optional[float],
    academic: Optional[float],
    engagement: Optional[float],
    placement: Optional[float],
) -> ScoreResult:
    if attendance is None or academic is None:
        total = None
    else:
        total = round(
            WEIGHTS["attendance"] * attendance
            + WEIGHTS["academic"] * academic
            + WEIGHTS["engagement"] * (engagement or 0.0)
            + WEIGHTS["placement"] * (placement or 0.0),
            2,
        )
    return ScoreResult(attendance, academic, engagement, placement, total, risk_band(total))


def classes_needed_for(attended: int, total: int, target_pct: float = ATTENDANCE_REQUIREMENT) -> int:
    """Consecutive classes a student must attend to reach `target_pct`."""
    if total <= 0:
        return 0
    if attended / total * 100 >= target_pct:
        return 0
    t = target_pct / 100
    # (attended + x) / (total + x) >= t  →  x >= (t·total − attended) / (1 − t)
    needed = (t * total - attended) / (1 - t)
    return max(0, int(needed) + (0 if needed == int(needed) else 1))


def classes_can_skip(attended: int, total: int, target_pct: float = ATTENDANCE_REQUIREMENT) -> int:
    """Classes a student can miss and still stay at or above `target_pct`."""
    if total <= 0:
        return 0
    t = target_pct / 100
    # attended / (total + y) >= t → y <= attended / t − total
    return max(0, int(attended / t - total))


def weakest_component(result: ScoreResult) -> Optional[str]:
    """Pillar with the largest weighted gap to 100 — where effort pays most."""
    gaps = {}
    for key, weight in WEIGHTS.items():
        value = getattr(result, f"{key}_component")
        gaps[key] = weight * (100 - (value if value is not None else 0))
    return max(gaps, key=gaps.get) if gaps else None
