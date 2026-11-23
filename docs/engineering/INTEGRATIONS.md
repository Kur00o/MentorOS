# Integrations

Everything except Supabase is optional. Unconfigured integrations report `not_configured` on the admin *Integrations* page and in `/api/v1/health`, and never block core workflows.

| Integration | Configure | Behaviour when absent |
| --- | --- | --- |
| Supabase Postgres | `POSTGRES_URL` / `DATABASE_URL` | Local SQLite fallback (development only) |
| Supabase Auth | `SUPABASE_URL`, `SUPABASE_JWT_SECRET` or anon key | Sign-in disabled |
| Supabase admin + Storage | `SUPABASE_SERVICE_ROLE_KEY` | Login provisioning and uploads return a clear 503 |
| Google OAuth | Enable the Google provider in Supabase, then `GOOGLE_OAUTH_ENABLED=true` and `VITE_ENABLE_GOOGLE_AUTH=true` | Email/password only |
| LLM | `LLM_PROVIDER` + one of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_BASE_URL` | Companion answers with grounded, data-driven templates |
| Email | `RESEND_API_KEY` or `SMTP_*` | In-app notifications only (demo domain is never emailed) |
| Webhook | `NOTIFY_WEBHOOK_URL` | High-severity alerts stay in-app |
| ERP / LMS / Attendance / Placement | `*_API_URL`, `*_API_KEY` | CSV import (same pipeline) |

## AI Companion

`backend/app/companion/engine.py` classifies the question, gathers **only the facts the caller's role may see**, writes a grounded markdown answer with structured cards, and retrieves policy text from the knowledge base (`backend/app/companion/knowledge/*.md`, BM25 retrieval — no embedding service needed). When an LLM is configured, the model receives the facts, knowledge snippets and the grounded draft, and may only rephrase. Any provider failure falls back to the grounded answer. The Anthropic provider uses the official SDK with server-side refusal fallbacks.

The original Ollama/pgvector RAG prototype (team branch `feature/ai-companion`) is preserved in git history; Ollama remains a supported provider.

## Institution connector contract

Each connector is configured with a base URL and an optional bearer key.

```
GET {BASE_URL}/health                → any 2xx when reachable
GET {BASE_URL}/mentoros/{dataset}    → {"rows": [ { <column>: <value>, ... }, ... ]}
Authorization: Bearer {API_KEY}
```

| Connector | Datasets |
| --- | --- |
| ERP / SIS | `students`, `results` |
| LMS | `lms`, `marks` |
| Attendance | `attendance` |
| Placement | `placement` |

Rows use the same columns as the CSV templates (download them from *Data → Template*, or `GET /api/v1/admin/imports/templates/{kind}`). Synced rows go through the same validation as CSV uploads, are recorded as an import job, and recompute affected scores.
