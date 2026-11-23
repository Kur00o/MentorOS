# MentorOS

**Every student leaves a trace. Notice when it wavers.**

MentorOS is a mentoring and early-warning platform for engineering institutes. It turns attendance, declared results, LMS engagement and placement readiness into one explainable **Student Success Score**, raises explainable risk alerts, and gives students, mentors, HODs and admins a shared, role-appropriate view of the same signal.

- **Live demo:** https://mentoros-murex.vercel.app — runs on a clearly-labelled *synthetic* institution (150 students, 3 departments).
- **API docs (OpenAPI):** https://mentoros-murex.vercel.app/api/v1/docs
- **Engineering log:** [`docs/engineering/MASTER_PROGRESS.md`](docs/engineering/MASTER_PROGRESS.md)

## What each role gets

| Role | Desk |
| --- | --- |
| **Student** | Score gauge + weekly signal trace, pillar breakdown, what-if simulator, subject attendance (“attend N more / can skip N”), SGPA + internals, LMS activity, placement profile + resume upload, mentoring notes & action items, profile and DPDP consent controls |
| **Mentor** | *Today* desk: attention queue, agenda, session notebook; roster with micro-traces; Student 360; meeting requests → confirm → log (topics, action items, mood, private notes); alert acknowledgement/resolution |
| **HOD** | Department analytics (cohort strata over time, semester × band heatmap, score histogram, subject difficulty, mentor workload & coverage, placement funnel), risk-prioritised allocation with dry-run preview, imports & NAAC/NBA exports |
| **Admin** | Institution overview, people & sign-in provisioning, departments, data imports/connectors, exports, integrations health, provenance (synthetic vs institutional), audit log |
| **Everyone** | AI Companion grounded in live data the role may see (optional LLM voice), ⌘K command palette, notifications, paper / night-shift themes, mobile layout |

## The score

```
Success Score = 0.35·Attendance + 0.35·Academic + 0.15·Engagement + 0.15·Placement
Attendance  = classes attended ÷ classes held (all subjects), %
Academic    = min(latest SGPA × 10, 100)
Engagement  = mean(LMS logins vs department average [cap 100], assignment submission rate)
Placement   = resume 40 + 8 × skills (≤5) + 4 × certifications (≤5), cap 100
Bands       = Green ≥ 70 · Amber 50–69.9 · Coral < 50 · “insufficient data” if attendance or SGPA is missing
```

Defined once in [`backend/app/scoring/formula.py`](backend/app/scoring/formula.py) and used by the scoring engine, the seed generator, the what-if simulator and the tests. See [`docs/scoring.md`](docs/scoring.md).

## Architecture

```
frontend/   React 18 + Vite + Tailwind + Motion + Radix + TanStack Query   → static SPA
backend/    FastAPI + SQLAlchemy 2 + Alembic                                → /api/v1 (Vercel Python function)
api/        Vercel entrypoint that mounts the FastAPI app
Supabase    PostgreSQL (source of truth) · Auth (email/password, Google optional) · Storage (avatars, resumes)
```

- **Auth:** the SPA signs in with Supabase Auth; the API verifies the access token (HS256 secret, JWKS or Auth API fallback) and resolves the role **from the database** — never from the client. Accounts are only created by admins.
- **Permissions:** admin → everything · HOD → their department · mentor → their mentees · student → themselves. Out-of-scope records return 404, not 403.
- **Data access:** only through the API. Every table has RLS enabled with no policies, and `anon`/`authenticated` privileges are revoked, so the Supabase Data API exposes nothing.
- **Provenance:** every row carries `is_synthetic` + `batch_id`; the demo batch can be purged in one action without touching institutional data.
- **Jobs:** Vercel Cron calls `/api/v1/ops/cron/nightly` (02:00 IST) to recompute scores and run risk rules. Celery/Redis are optional for self-hosting.

## Run locally

```bash
cp .env.example .env              # fill in DATABASE_URL (and Supabase values if you have a project)
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements.txt
python -m backend.scripts.seed    # migrations + knowledge base + synthetic institution
uvicorn backend.app.main:app --reload --port 8000
```

Without a Supabase project, run the dev-only auth stub (it signs any seeded user in with `DEMO_ACCOUNT_PASSWORD`):

```bash
uvicorn backend.scripts.dev_auth:app --port 9999
```

```bash
cd frontend && npm ci
printf 'VITE_SUPABASE_URL=http://localhost:9999\nVITE_SUPABASE_ANON_KEY=dev\n' > .env.local
npm run dev                        # http://localhost:5173 (proxies /api to :8000)
```

Or everything at once: `docker compose up --build`.

## Tests

```bash
python -m pytest backend/tests -q                                   # SQLite
TEST_DATABASE_URL=postgresql://… python -m pytest backend/tests -q  # Postgres
cd frontend && npm test && npm run typecheck && npm run build
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs both backend suites, checks that migrations apply cleanly, then typechecks, tests and builds the frontend.

## Deploying

See [`docs/engineering/DEPLOYMENT.md`](docs/engineering/DEPLOYMENT.md): one Vercel project (SPA + Python function in `bom1`), Supabase provisioned through Vercel Storage, protected `/api/v1/ops/bootstrap/*` endpoints for migrations, seeding and demo logins.

## Repository history

This codebase consolidates the team's work: the original MVP and architecture (`main`), the `development` line (Supabase OAuth, student profiles, subject-wise attendance, scoring engine, allocation module, mentor dashboard), and the AI-companion RAG line (`feature/ai-companion`, `testing`). Decisions are recorded in [`docs/decisions-log.md`](docs/decisions-log.md).
