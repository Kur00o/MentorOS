# Database schema — MentorOS

Source of truth: SQLAlchemy models in `backend/app/models/` and the Alembic baseline `backend/alembic/versions/0001_core_mentoros_core_schema.py`. All tables live in `public` with RLS enabled (deny-by-default; only the API role reads them). Every data table carries `is_synthetic` + `batch_id` for provenance.

| Area | Tables |
| --- | --- |
| Organisation & identity | `data_batches`, `departments` (HOD), `academic_terms`, `users` (role ∈ student/mentor/hod/admin, `auth_user_id` → Supabase Auth), `mentors` (capacity, accepting), `students` (USN, semester, guardian, CGPA/SGPA, backlogs, latest score mirror), `student_consents` (academic/attendance/placement/wellness) |
| Signals | `subjects`, `attendance_records` (cumulative per subject/term), `attendance_weekly`, `mark_records` (internals), `semester_results` (SGPA, backlogs), `lms_activity` (term), `lms_weekly`, `placement_profiles`, `placement_offers` |
| Scoring & risk | `student_success_scores` (append-only history with components), `risk_alerts` (rule, severity, evidence JSON, open/acknowledged/resolved) |
| Mentoring | `allocations` (history: who/when/how/why), `meetings` (requested/scheduled/completed/cancelled/no_show), `meeting_logs` (summary, topics, action items, mood, private notes) |
| System | `notifications`, `audit_logs`, `import_jobs`, `integration_runs`, `companion_messages`, `knowledge_chunks` |

Key constraints: unique USN/email, one consent row per (student, category), one attendance row per (student, subject, term), `attended ≤ total`, `0 ≤ SGPA ≤ 10`, mentor capacity 0–60, enumerated statuses via CHECK constraints. Student → mentor allocation must stay within the department and under capacity (enforced in the API and tested).
