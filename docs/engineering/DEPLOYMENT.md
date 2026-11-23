# Deployment

MentorOS runs as **one Vercel project** backed by **Supabase provisioned through Vercel Storage**.

| Piece | Where | Notes |
| --- | --- | --- |
| SPA (React/Vite) | Vercel static output `frontend/dist` | SPA fallback rewrite to `index.html` |
| API (FastAPI) | Vercel Python function `api/index.py` → `/api/*` | region `bom1` (Mumbai), next to the database; 60 s max duration |
| Database | Supabase Postgres (`ap-south-1`) | pooled `POSTGRES_URL` for requests, `POSTGRES_URL_NON_POOLING` for migrations |
| Auth | Supabase Auth | email/password; Google optional |
| Storage | Supabase Storage | `avatars` (public, 3 MB images) · `resumes` (private, 5 MB PDF, signed URLs) |
| Scheduler | Vercel Cron | `GET /api/v1/ops/cron/nightly` at 20:30 UTC (02:00 IST), `Authorization: Bearer $CRON_SECRET` |

Celery/Redis are **not required** in the hosted deployment: recomputation is fast enough (≈1–2 s for 150 students) to run synchronously, after every import and nightly via Vercel Cron. A Celery broker can be configured for self-hosting (`CELERY_BROKER_URL`).

## Current production

- Vercel team: `ainesh1` · project `mentoros` (`prj_OOZ628qnxkcPUqgEEzJ25LxApctO`)
- Production URL: https://mentoros-murex.vercel.app
- Supabase store: `supabase-almond-ladder` (managed through Vercel → Storage)
- Health: `/api/v1/health` (includes the deployed commit), readiness: `/api/v1/health/ready` (DB round-trip + migration revision)

## Environment variables

Injected automatically by the Supabase integration: `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the SPA reads `NEXT_PUBLIC_*` via Vite `envPrefix`).

Set on the project (encrypted): `ENVIRONMENT=production`, `APP_BASE_URL`, `SCORING_PERIOD`, `DEMO_EMAIL_DOMAIN`, `LLM_PROVIDER`, `OPS_TOKEN`, `CRON_SECRET`, `DEMO_ACCOUNT_PASSWORD`. Optional integrations (LLM, email, webhook, connectors) are added the same way — see `.env.example`.

## First deployment / re-bootstrapping

All bootstrap endpoints require `X-Ops-Token: $OPS_TOKEN` and are disabled when `OPS_TOKEN` is unset. Each is idempotent.

```bash
curl -X POST "$URL/api/v1/ops/bootstrap/migrate"   -H "X-Ops-Token: $OPS_TOKEN"  # alembic upgrade head + RLS hardening
curl -X POST "$URL/api/v1/ops/bootstrap/seed"      -H "X-Ops-Token: $OPS_TOKEN"  # knowledge base + synthetic institution (skips if present; ?force=true regenerates)
curl -X POST "$URL/api/v1/ops/bootstrap/provision" -H "X-Ops-Token: $OPS_TOKEN"  # storage buckets + 4 demo Supabase Auth users
```

Migrations run under a Postgres advisory lock, so concurrent deploys cannot race.

## Deploying a new version

```bash
vercel deploy --prod --scope ainesh1 --build-env BUILD_COMMIT_SHA=$(git rev-parse HEAD) --env BUILD_COMMIT_SHA=$(git rev-parse HEAD)
curl -X POST "$URL/api/v1/ops/bootstrap/migrate" -H "X-Ops-Token: $OPS_TOKEN"   # only when a migration was added
```

Connecting the Vercel project to the GitHub repository (Vercel → Project → Settings → Git) enables automatic deployments on every push to `main`.

## Going live with real data

1. Create institutional admin accounts (People → Add person) and sign in with one of them.
2. Data → *Purge synthetic data* (requires an institutional admin; demo accounts cannot purge).
3. Import departments' rosters, then attendance, results, LMS and placement CSVs (or configure connectors).
4. Set `ALLOWED_EMAIL_DOMAINS` to the institute's domain(s) and optionally enable Google OAuth.
5. Rotate `OPS_TOKEN` (or unset it to disable bootstrap endpoints) and `DEMO_ACCOUNT_PASSWORD`.
