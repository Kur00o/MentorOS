# Phase 3 Plan — Real Feature-1 Scoring (Data Sources + Nightly Job)

Status: **IMPLEMENTED (SGPA variant), 2026-06-24.** Team chose the **SGPA** Academic
formula (`min(SGPA×10, 100)`) and Placement `certs×4` capped at 5 (DECISION-1/2),
with the `insufficient_data` rule (DECISION-3). Built: `scoring/engine.py`,
`scoring/tasks.py` (guarded Celery), source-table models + migration `0003`,
`/admin/scores/recompute` + CSV import wiring, and `test_scoring_engine.py`.
Celery/Redis/Postgres and the docker services are **not validated in-sandbox**
(no broker / PG); the recompute endpoint runs synchronously without a broker.
The earlier both-variants design below is retained for history.

---

Related: [build-prompts.md], [success-score.md], [decisions-log.md]. The earlier
build-prompt and the latest feature spec disagree in places — those conflicts are
called out as **DECISION** below.

---

## 0. Open decisions (resolve before coding the engine)

- **DECISION-1 — Marks/Academic formula.** Two definitions in play:
  - `A` (current canonical `docs/success-score.md`): `academic = min(CGPA × 10, 100)`.
  - `B` (latest spec): `academic = avg(internal/max × 100 over subjects) − 10 × backlogs`, clamped `0..100`.
  - Plan: implement **both** behind `settings.MARKS_FORMULA ∈ {"cgpa","internal_backlog"}`, default `"cgpa"` until changed. No behaviour change until the flag flips.
- **DECISION-2 — Placement weights.** Specs conflict: build-prompt says certs `×4` (skills/certs capped at 5); latest spec says skills `×8`, certs `×12`. Keep weights/caps as named constants in one place for a one-line change.
- **DECISION-3 — Missing-data aggregation.** Latest spec: engagement missing → `null`, placement missing → `0`. Need the exact rule for the **total**: proposed — if either 35% pillar (attendance or marks) has no source data → `total_score = null`, `risk_category = "insufficient_data"`. Confirm.

---

## 1. New data-source tables (additive migrations only)

All keyed by `student_id` (int FK `students.id`) + a `period` string (e.g. `"2025-ODD"`).

| Table | Columns | Feeds |
|---|---|---|
| `attendance_records` | subject_code, total_classes, attended_classes, period | Attendance |
| `mark_records` | subject_code, internal_marks, max_marks, period | Marks (variant B) |
| `backlog_records` *(or `students.backlog_count`)* | subject_code, cleared:bool | Marks penalty |
| `lms_activity_records` | period, login_count, assignments_submitted, assignments_total | Engagement |
| `placement_profiles` | has_resume:bool, skills_count, certifications_count | Placement |

These are populated by the **CSV import** (Feature 3) — wiring the currently-placeholder
`/students/import` to write these tables is part of this phase (import type → table).

## 2. Score storage (history + insufficient_data)

New `student_success_scores` table (history, not overwrite):
`id, student_id, attendance_component (nullable), academic_component (nullable),
engagement_component (nullable), placement_component (nullable), total_score
(nullable), risk_category, computed_at`.

Keep `students.success_score` / `risk_status` updated as the "latest" mirror for
backward compatibility with existing dashboards/exports. `risk_category` gains a
fourth value `"insufficient_data"`.

## 3. Component functions (`scoring/engine.py`, new)

Each returns `Optional[float]` (None = no source data, **not** 0):

- `attendance(student, period)` = `mean(attended/total over subjects) × 100`; None if no records.
- `academic(student, period)` = strategy by `MARKS_FORMULA` (variant A or B above).
- `engagement(student, period)` = `((logins/cohort_avg_logins) + (submitted/total)) / 2 × 100`, capped 100; None if no LMS records. (Cohort avg = same department + period.)
- `placement(student)` = `resume(40) + min(skills,CAP)×W_SKILL + min(certs,CAP)×W_CERT`, capped 100; `0.0` if no profile (per spec, placement is improvable so 0 not None — confirm against DECISION-3).
- `aggregate(...)` applies the weighted formula and the insufficient_data rule.

`compute_success_score()` stays the pure 4-float weighting (unchanged) — the engine
feeds it real numbers instead of 75/80 baselines.

## 4. Nightly recompute (Celery)

- Add `celery`, `redis` to `requirements.txt`; `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` to config.
- `scoring/tasks.py`: `celery_app` + beat `crontab(hour=2, minute=0)` → `compute_all_scores` → fan out `compute_score_for_student.delay(id)` → upsert `student_success_scores` + mirror to `students`.
- Existing `POST /admin/scores/recompute` stays the manual trigger: enqueue when a broker is configured, else run inline (current behaviour). No interface change.
- **Testability:** like the audit middleware, any task that opens its own session must use late-bound `database.SessionLocal` so `conftest` can rebind it to SQLite (see [test-suite-runs-on-sqlite] / current `conftest.py`).

## 5. Rollout order (gated)

1. Migrations for the 5 source tables + `student_success_scores` + `risk_category` value. (PG must be running — not available in the current sandbox.)
2. `scoring/engine.py` components + `insufficient_data` aggregation, behind `MARKS_FORMULA`. Unit-test both variants on SQLite.
3. Wire CSV import (attendance/marks/lms) to populate source tables; surface row errors via the existing `CsvImport.tsx` states.
4. Swap NAAC export + scoring router to read `student_success_scores`; show `insufficient_data` instead of a misleading score.
5. Celery + beat last (infra). Until then `/admin/scores/recompute` covers it synchronously.

## 6. Frontend follow-ups (mock today)

- Roster: sort lowest-score-first, render `insufficient_data` as "Attendance not yet imported" rather than a red flag.
- These hit the same blocker as before: the frontend is a mock demo with no real auth/session, so live wiring waits on the auth work (still deferred).

---

## What this plan deliberately does NOT do yet
- Does not change `docs/success-score.md` or the Marks formula (paused — DECISION-1).
- Does not install Celery/Redis or alter scoring until the above is approved.
