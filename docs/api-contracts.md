# API — MentorOS v1

The live, authoritative contract is the OpenAPI document: `/api/v1/docs` (Swagger UI) and `/api/v1/openapi.json`.

All endpoints except `/health*`, `/auth/config` and `/scoring/formula` require `Authorization: Bearer <Supabase access token>`. Errors use one envelope:

```json
{ "error": { "code": "validation_error", "message": "scheduled_at: Meetings must be scheduled in the future", "details": [...] }, "detail": "…" }
```

| Prefix | Highlights | Roles |
| --- | --- | --- |
| `/auth` | `GET /me`, `GET /config` | all |
| `/students` | list (search/filter/sort/paginate, scoped), `GET /me` & `GET /{id}` (Student 360), `PATCH /me`, `PUT /me/placement`, `POST /me/avatar`, `POST /me/resume`, resume signed URLs, consents | scoped |
| `/scoring` | `GET /formula`, `GET /students/{id}` (live), `POST /students/{id}/simulate` (what-if) | scoped |
| `/mentoring` | meetings list/create/update, `POST /meetings/{id}/log`, `PUT …/log`, action-item toggle, `GET /dashboard` | mentor, student (own), HOD/admin |
| `/alerts` | list (scoped), `PATCH /{id}` acknowledge/resolve/reopen | staff |
| `/allocation` | `GET /overview`, `POST /auto` (dry run or commit), `POST /assign`, `DELETE /students/{id}`, `PATCH /mentors/{id}` capacity, `GET /history` | HOD (own dept), admin |
| `/analytics` | `GET /department`, `GET /institution` | HOD, admin |
| `/admin` | users (create/update/provision login), departments, imports (CSV + templates + history), integrations (status/test/sync), exports (NAAC, students, at-risk, audit), `POST /scores/recompute`, audit log, batches + purge | admin (HOD: imports, exports, recompute in own dept) |
| `/companion` | `POST /chat`, `GET/DELETE /history`, `GET /config` | all |
| `/notifications` | list, mark read, mark all read | all |
| `/ops` | `POST /bootstrap/{migrate,seed,provision}` (X-Ops-Token), `GET /cron/nightly` (Bearer CRON_SECRET) | operators |
