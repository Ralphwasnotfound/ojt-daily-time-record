# S1 — local Supabase schema and RLS foundation

## Status and scope

Locally validated on 2026-09-30. Docker Desktop 29.8.1 (desktop-linux) starts the
Supabase stack successfully. Required images downloaded, local reset applied the
migration, all 147 pgTAP assertions passed, and local lint reported no schema errors.
Catalog inspection confirmed all three tables, 21 constraints (including 5 foreign
keys), 15 indexes, RLS and three SELECT policies, plus intended helper/RPC grants.
No hosted project was linked, reset, or written. No S1 SQL or test correction was needed.

The working application remains entirely Firebase-backed. No source file, route,
Firebase service, Firestore rules/indexes, environment value, or existing test was
changed in S1. Existing pre-S1 worktree edits have been preserved.

Added pinned development dependency `supabase` 2.118.0. The browser SDK/client module
is deliberately deferred until S2: there is no runtime consumer in S1, and no reason
to initialize a second Auth client. `.env.supabase.example` is documentation-only;
Vite does not automatically load that filename. It contains no actual credentials.

## Local structure and prerequisites

CLI-generated local project, narrowed to public API schema plus Auth/database only:
`supabase/config.toml`, migrations, and `tests/database`. Private helpers are NOT in
the exposed schemas or extra search path. Storage, Realtime, Studio, SMTP, analytics,
and edge runtime are disabled. No Google provider is configured. Local Auth schema
is needed for identity fixtures; this is not a hosted authentication setup.

Node 24.15.0 and npm 11.12.1 were available when S1 was prepared. Project-local
Supabase CLI remains pinned to 2.118.0. The user subsequently installed Docker Desktop;
validation confirmed client/server 29.8.1 and desktop-linux. Sandbox access to Docker
required escalation, after which local startup and database validation succeeded.
No system tool was installed by the validation task.

After installing/starting a supported local runtime yourself, from the repository:

```powershell
$env:SUPABASE_TELEMETRY_DISABLED = '1'
npm run supabase:start
npm run supabase:reset
npm run test:supabase
npm run supabase:lint
npm run supabase:stop
```

`supabase:reset` explicitly uses `db reset --local --no-seed`. It destroys and
recreates THIS LOCAL DEVELOPMENT database; preserve any local data needed first.
Tests explicitly use `test db --local`. Do not append remote flags, use `link`,
`db push`, `--linked`, `--project-ref`, or a hosted database URL. Never use hosted
service-role credentials for these tests. There is no project link in this setup.
The tests create fake Auth rows inside a transaction and roll everything back.
Required Docker images downloaded successfully during the S1 validation continuation.

Local database major version is 17, the pinned CLI's initialization default. Check
compatibility with a future hosted project only in a separately authorized phase.

## Tables, defaults and relationships

`profiles`:
- `id uuid` PK -> auth.users(id), ON DELETE RESTRICT; no generated default.
- `full_name text`, `email text`: required and trimmed/nonempty; name max 100 Unicode chars.
- `student_id text`: nullable only for admins, UNIQUE; canonical uppercase ASCII format
  `[A-Z0-9][A-Z0-9-]{2,29}`. RPC trims/uppercases; direct noncanonical input is rejected.
- `role text NOT NULL DEFAULT 'student'`; only student/admin.
- `status text NOT NULL DEFAULT 'pending'`; only pending/approved/rejected.
- `program text`, `required_hours integer`: nullable for admins; students must have
  exactly BS Information Technology and 486. Explicit IS NOT NULL prevents CHECK's
  three-valued NULL behavior from bypassing these requirements.
- `department text`: null for students; optional for admins.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- `approved_at timestamptz`, `approved_by uuid` nullable; approver FK -> profiles(id)
  ON DELETE RESTRICT. Approved students require both, pending/rejected require neither.
  Admin requires approved status and approved_at; bootstrap approved_by may be null.
- Role-specific constraints prevent admins from carrying student fields.

`attendance_sessions`:
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- `student_uid uuid NOT NULL` -> profiles(id), ON DELETE RESTRICT.
- `time_in timestamptz NOT NULL`, no default; future RPC supplies authoritative clock.
- `time_out timestamptz NULL`, default NULL, must be >= time_in when present.
- UNIQUE(id,student_uid) supports the composite activity FK.
- IN/OUT derives from null/non-null time_out. No duplicate state table.

`activities`:
- `id uuid PRIMARY KEY`, no default; allocated before future upload.
- `student_uid uuid NOT NULL` -> profiles(id), ON DELETE RESTRICT.
- `attendance_session_id uuid NOT NULL`; composite FK (attendance_session_id,student_uid)
  -> attendance_sessions(id,student_uid), ON DELETE RESTRICT.
- `category text NOT NULL`: exact eight-value approved allowlist.
- `description text NOT NULL`: trimmed/non-whitespace, 1–500 PostgreSQL Unicode
  characters, legitimate internal newlines retained. private.trim_text lists the
  frontend's Unicode whitespace explicitly. No reliance on ASCII-only btrim defaults.
- `photo_path text NOT NULL UNIQUE`: exactly student_uid/id/proof using canonical UUID
  text; bucket name NOT included; no URL or another owner/session's path accepted.
- `created_at timestamptz NOT NULL DEFAULT now()`; future locked submission RPC must
  explicitly assign clock_timestamp() after locks. No client timestamp write path.

All FK deletes restrict, never cascade. Trusted maintenance must design evidence
retention explicitly. An FK to a profile proves existence, not that it is a student;
future write RPCs must verify role/status. Similarly a session FK does not prove
that it is open at insertion time. No activity/attendance mutation API is exposed yet.

## Indexes

Profiles: PK; unique Student ID; pending-student created_at/id partial index;
non-null approved_by index for FK access.

Attendance: PK; unique id/student pair; partial UNIQUE(student_uid) WHERE time_out
IS NULL; UNIQUE(student_uid, Manila date of time_in); student/time_in DESC/id DESC.
The daily index explicitly uses Asia/Manila, never session timezone. It is independent
of the open-session index. A future policy migration can drop only the daily index
and adjust the later RPC without redesigning tables.

Activities: PK; unique photo_path; student/created_at DESC/id DESC;
student/session/created_at DESC/id DESC; student/category/created_at DESC/id DESC;
session/student index for composite-FK maintenance. No description index or speculative
admin global-feed indexes.

## RLS and grants

RLS enabled on all three application tables. All privileges revoked from PUBLIC,
anon and authenticated, then SELECT alone granted to authenticated. No INSERT,
UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER privileges granted to browser roles.
There are SELECT policies only:
- Any signed-in account reads its own profile, including pending/rejected.
- Approved admin reads own profile and student profiles, not other admin profiles.
- Approved student reads own attendance/activities only.
- Approved admin reads all attendance/activities.
- Anonymous has no table SELECT grant.

private.is_approved_student() and private.is_approved_admin() are STABLE SECURITY
DEFINER predicates, with no parameters. They query the profile for auth.uid(). Their
migration-owner execution avoids recursive profiles RLS. search_path is empty and
objects are qualified. PUBLIC/anon execution revoked; authenticated has schema USAGE
and EXECUTE only for these predicates, needed by policies. They are not REST RPCs
because private is not API-exposed. private.trim_text is a non-definer immutable
normalizer, not executable by browser roles.

No broad schema-level grants to new public functions are relied upon. Each account
RPC explicitly revokes PUBLIC/anon/authenticated execution before granting authenticated
EXECUTE. CLI auto-exposure is disabled, but migrations independently revoke object
privileges so hosted defaults must not silently grant table writes.

SECURITY DEFINER RPCs use the trusted migration owner (normally postgres). This owner
can bypass RLS; explicit checks inside each RPC are therefore essential. Do not transfer
ownership to an application login, add dynamic SQL, grant browser schema CREATE, or
expose arbitrary UID/role/timestamp arguments. Service-role/superuser access is trusted
maintenance, not a browser client. RLS and these grants do not constrain a superuser.

## Implemented account RPCs

`complete_student_registration(full_name text, student_id text)`:
- Requires auth.uid(). Locks that Auth user row to serialize same-user registration.
- Requires confirmed nonempty Auth email plus matching Auth-managed Google identity,
  provider google, email_verified true, matching identity email.
- Never trusts raw_user_meta_data, email/domain role inference, or browser email.
- Rejects existing profiles (including admins). Creates fixed student/pending profile,
  canonical unique Student ID, fixed program/486 hours, server created_at, null approval.
- Unique violations retain SQLSTATE 23505/constraint name for future friendly mapping.
- This verifies a linked, verified Google identity. It does NOT prove the most recent
  login used Google if other providers later become enabled. S2 must keep the intended
  Google-only provider policy and test actual hosted OAuth identity claims explicitly.

`review_student(student_uid uuid, decision text)`:
- Requires caller approved admin, locks caller for share then target for update.
- Allows only approved/rejected decisions on a pending student; no re-review/admin target.
- Derives approver from auth.uid() and timestamp from database clock_timestamp().
- Rejection leaves both approval fields null. No role promotion or browser metadata.

No Time In/Out or activity submission RPC exists. No database trigger was necessary.
Future activity/attendance RPCs must share profile-then-session lock order, enforce
approval/open-session state, and capture clock_timestamp after acquiring locks.

## pgTAP tests prepared

`001_s1_foundation.test.sql` covers profile role/field/approval checks and NULL attacks;
canonical Student IDs and duplicate constraints; Auth/profile/approver FKs and restricted
deletes; independent one-open/daily indexes and Manila year/midnight boundaries under
another session timezone; all eight activity categories, composite ownership, 500/501
Unicode characters, whitespace/newlines, paths and uniqueness; all read roles, foreign
rows, grant audit and direct writes; helper hardening; synthetic Google identity checks,
metadata spoofing, registration normalization/fixed authority fields, duplicate failure
atomicity, existing admin preservation, approval/rejection/no re-review.

The duplicate test verifies UNIQUE constraint behavior, not a two-connection race.
Actual concurrent registration/review tests and real Google OAuth remain required before
S2 production use. All 147 prepared pgTAP assertions passed on the local stack during S1 validation.

## Validation and deferred work

Local startup, explicit local reset, pgTAP (147 assertions), and local lint all passed.
The original Docker-unavailable blocker is resolved. The migration is recorded as
20260929000100. Catalog verification confirmed PUBLIC has no application-table grants
or helper/RPC execution, authenticated has SELECT but no table writes, and only the
two account RPCs and two authorization predicates have authenticated execution.
All definer functions are owned by postgres with an empty search_path. The normalizer
is not executable by browser roles. Tests roll back their synthetic data.

The unchanged Firebase checks passed: `npm test` (43 tests) and `npm run test:rules`
(65 tests against the local Firestore emulator). `npm run build` also passed, with
the existing bundle-size warning. No application changes were needed.

Deferred: Supabase browser dependency/client, hosted linkage/deployment, Google setup,
Auth UI migration, attendance/activity RPCs and UI, Realtime, Storage/buckets/policies,
photos, admin monitoring integration, data migration, Firebase removal. Do not start S2
until local S1 reset/tests/lint pass and identity behavior has been reviewed.
