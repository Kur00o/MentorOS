from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.core.deps import Principal, get_accessible_student, get_principal
from backend.app.scoring import engine, formula

router = APIRouter()


class SimulateIn(BaseModel):
    attendance: Optional[float] = Field(default=None, ge=0, le=100)
    sgpa: Optional[float] = Field(default=None, ge=0, le=10)
    engagement: Optional[float] = Field(default=None, ge=0, le=100)
    has_resume: Optional[bool] = None
    skills: Optional[int] = Field(default=None, ge=0, le=50)
    certifications: Optional[int] = Field(default=None, ge=0, le=50)


@router.get("/formula")
def get_formula():
    """Public description of the score so every client explains it identically."""
    return {
        "weights": formula.WEIGHTS,
        "bands": {"green": formula.GREEN_MIN, "amber": formula.AMBER_MIN},
        "attendance_requirement": formula.ATTENDANCE_REQUIREMENT,
        "placement": {"resume": formula.PLACEMENT_RESUME_POINTS, "per_skill": formula.PLACEMENT_SKILL_POINTS,
                      "per_certification": formula.PLACEMENT_CERT_POINTS, "max_items": formula.PLACEMENT_CAP_ITEMS},
    }


@router.get("/students/{student_id}")
def live_score(student_id: int, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Read-only live computation from source tables (does not persist)."""
    st = get_accessible_student(db, p, student_id)
    res = engine.compute_scores(db, [st.id])[st.id]
    return {"student_id": st.id, "usn": st.usn, **res.as_dict()}


@router.post("/students/{student_id}/simulate")
def simulate(student_id: int, body: SimulateIn, p: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """What-if: override any inputs and see the resulting score and band,
    computed by the same formula as the real score."""
    st = get_accessible_student(db, p, student_id)
    sig = engine.gather_signals(db, [st.id])[st.id]
    current = sig.score()
    att = body.attendance if body.attendance is not None else current.attendance_component
    acad = formula.academic_component(body.sgpa) if body.sgpa is not None else current.academic_component
    eng = body.engagement if body.engagement is not None else current.engagement_component
    place = formula.placement_component(
        body.has_resume if body.has_resume is not None else sig.has_resume,
        body.skills if body.skills is not None else sig.skills_count,
        body.certifications if body.certifications is not None else sig.certifications_count,
    )
    sim = formula.compose(att, acad, eng, place)
    return {"current": current.as_dict(), "simulated": sim.as_dict(),
            "delta": round((sim.total_score or 0) - (current.total_score or 0), 2) if sim.total_score is not None and current.total_score is not None else None}
