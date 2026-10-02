# U4.2 — Atomic proof-backed attendance finalization

LOCAL ONLY. No hosted Supabase, Vercel, production data, camera/location UI,
watermark or Admin UI changes. U4.3 is not implemented.

## Enforcement and deployment gate

Migration `20261008000100_u42_attendance_proof_finalization.sql` revokes EXECUTE
on `attendance_time_in()` and `attendance_time_out()` from PUBLIC, anon and
authenticated. There is no browser compatibility toggle or proof-free bypass.
The old functions remain available only to privileged server/database maintenance;
they are not reachable by ordinary student/Admin browser clients.

**Do not deploy this migration alone.** The current unchanged Attendance UI still
calls the retired RPCs and cannot punch against this local backend until U4.3.
Existing reads/history remain usable. Frontend unit tests cover existing UI behavior,
not end-to-end UI integration with this newly enforced backend.

The eventual hosted rollout must coordinate the proof-capable frontend and backend
enforcement. Do not restore authenticated grants to make an old frontend work.
The earlier U4.1 documentation describes the pre-enforcement phase; this document
supersedes its statements that proofless browser punches are enabled.

## RPC contract

```sql
public.attendance_proof_finalize(
  upload_id uuid,
  latitude numeric,
  longitude numeric,
  accuracy numeric
) returns public.attendance_proofs
```

Only these four inputs are accepted. UID comes from `auth.uid()`. Session, action
and exact object path come from the immutable reservation. The server supplies the
official timestamp. No client UID, timestamp, session selection or ordinal is accepted.

The return value is the immutable proof receipt: proof ID, reservation ID, session ID,
owner, action, path, official punch time, location and attachment time. It is not an
attendance summary. Refetch `attendance_summary()` / history after success.

## Lock order and transaction

1. `private.attendance_proof_student()` locks the approved student's profile.
   Approval is rechecked after waiting, using the same serialization boundary as U3.
2. Lock the caller's reservation FOR UPDATE. Reject unknown/foreign reservations.
3. Validate required finite latitude [-90,90], longitude [-180,180], and finite
   nonnegative accuracy. No GPS-quality cutoff or arbitrary accuracy upper bound.
4. For an already attached reservation, validate receipt association and identical
   coordinates/accuracy, then return it without another mutation.
5. Otherwise require pending/unexpired. Lock the caller's existing open session
   FOR UPDATE, if any. Read latest session under the profile lock.
6. Lock the exact uploaded Storage metadata row FOR SHARE. Require matching owner,
   attendance bucket/path, allowed MIME and integer byte size 1..5242880.
7. Obtain ONE `clock_timestamp()` after locks, recheck expiry and derive its Manila day.
8. For Time In: require OUT, fewer than two current-day starts, unchanged latest
   session/start count and the same prepared Manila day. Insert the reserved UUID
   with this official timestamp. Preparation alone still creates no session.
9. For Time Out: require the exact reserved open session and unchanged latest-session
   binding. Reject a backwards server clock. Update only that session with the same
   official timestamp; never retarget another open session.
10. Insert proof metadata using that timestamp and trusted reservation fields.
    Existing U4.1 triggers recheck object/association, set attachment time and mark
    the reservation attached. Verify attachment before returning.

Attendance write + proof INSERT + reservation attachment share one PostgreSQL
transaction. Any exception, constraint or trigger failure rolls all three back.
The timestamp is not reservation time, upload time, request-start time or device time.
Proof attachment time is separate from the official punch time.

## Idempotency and U4.3 reconciliation

- Retain the allocated upload ID and the exact submitted location values across
  retries. Do not reacquire a different GPS fix and present it as the same request.
- A repeated successful reservation returns the exact original receipt, even after
  attendance has advanced to another session or the reservation expiry has passed.
  The caller must still be approved. Attached objects are not downloaded again.
- Different location values on a successful reservation yield `REQUEST_CONFLICT`.
- A different stale reservation never attaches to an already completed punch.
- If a response is lost, retry finalize with the same upload/location values. Do
  not allocate a new request or automatically replay a separate Time In/Out.
- Alternatively, an approved owner can read `attendance_proofs` filtered by
  `upload_id` through existing RLS to recover the immutable receipt. One row confirms
  commitment; no row does not prove failure while a request is in flight or access
  is unavailable. Reconcile before discarding or allowing a new attempt.
- Refetch trusted summary/history after a receipt, including a recovered receipt.
  Guard late replies on logout/account change. Clear local proof/location state.
- `ATTENDANCE_STATE_CHANGED`, `ALREADY_TIMED_IN` and daily-limit errors require a
  trusted refresh and a new intentional flow where appropriate, not silent retargeting.
- A pending Time In spanning Manila midnight must be prepared again. A Time Out
  can close its exact carried-over open session; its attendance day remains Time In day.

No frontend wrapper was necessary for backend verification. API tests call the
existing authenticated Supabase instance directly; no production service/UI changed.

## Legacy sessions and preserved behavior

Historical proofless sessions are neither rejected nor backfilled. A legacy open
session may receive its future Time Out proof only; its original Time In and ID are
preserved. New ordinary-browser sessions can be created only through finalization.

U3 invariants remain: one open session, two starts per Manila Time In day, third-start
denial, derived `(time_in,id)` ordinals, cross-midnight grouping, exact completed
seconds, distinct Days Present, grouped pagination and exact Activity/session binding.

Only `attendance_sessions` INSERT/UPDATE is in the attendance publication. Proofs,
reservations, paths and coordinates are not added. Admin still receives a signal
and refetches trusted data. Activity Storage/edit/replacement/audit rules are unchanged.

## Failure boundary and security limitations

- Missing/invalid upload, invalid location, stale reservation or revoked approval:
  no attendance mutation; an eligible unattached upload can be discarded.
- Uploaded bytes are outside PostgreSQL's transaction. Do not delete them inside
  finalization. Future orphan cleanup tombstones reservations then uses Storage API.
- Attached proof remains immutable and cannot be removed by student cleanup.
- Authenticated Admin/pending/rejected/anonymous callers cannot punch or impersonate
  another student. Direct attendance/proof mutation privileges remain absent.
- Approval is checked from current database state, not stale profile UI. Standard
  Supabase JWT lifetime behavior still applies: signing out a browser is not a claim
  that every previously issued access token instantly ceases to exist.
- Object metadata validation is not image decoding, selfie/liveness verification,
  or tamper-proof geolocation. Device coordinates remain reported evidence.
- Privileged database/Storage maintenance can bypass normal browser restrictions.
  Attached-proof retention and orphan cleanup scheduling remain separate work.

## Tests and fixture isolation

`010_u42_attendance_finalization.test.sql` uses transaction-local Storage metadata
fixtures and injected failing triggers to prove rollback after attendance mutation,
including attachment failure. It tests authorization, location bounds, ownership,
staleness/day changes, exact timestamps, repeat receipts, limits and legacy behavior.

`supabaseAttendanceFinalization.local.test.js` uses actual local Auth, uploaded image
bytes and PostgREST, including concurrent finalization and lost-response recovery.

Existing S3/S5/S7/U1.1/U3/U4.1 SQL tests use a transaction-local `pg_temp` adapter
solely for historical proofless fixture/kernel contracts. It calls retained server-only
U3 functions, never restores their browser grants and is rolled back per test. The
`.inc` helper is not a migration or separately executable TAP test. New U4.2 tests
assert the actual browser cutover. No historical assertions are removed.

Activity and Realtime API integration now use genuine proof-backed attendance via
`tests/helpers/attendanceProofFixtures.js`. Attendance concurrency tests cover both
prepare/finalize workflows and already-uploaded finalizers blocked by a profile lock.
They assert post-lock timestamps, single results and post-wait approval checks.

All integration configuration is fixed to local Docker/127.0.0.1; no frontend .env,
hosted target or printed privileged credentials. API fixture cleanup removes only
generated paths/identities. Metadata-only concurrency fixtures have no stored bytes;
their local SQL metadata cleanup is explicitly scoped to generated owner UUIDs.
Immutable proof trigger disabling is restricted to local fixture cleanup transactions.

## Local commands

```sh
npm run supabase:reset
npm run test:supabase
node --test tests/supabaseAttendanceProofs.local.test.js
node --test tests/supabaseAttendanceFinalization.local.test.js
npm run test:supabase:attendance
npm run test:supabase:activities
npm run test:supabase:realtime
npm run supabase:lint
npm test
npm run build
git diff --check
```

Run database/integration fixture suites sequentially to keep global count assertions
isolated. Manual camera, phone permissions, geolocation, watermark and integrated
UI testing are deferred to U4.3/later. Hosted rollout requires separate approval.

## Validation results

- Clean local reset: all 11 migrations applied from zero.
- Complete database suite: 10 files, 721 assertions passed (78 new U4.2 assertions).
- U4.1 local Auth/Storage foundation: 13 tests passed.
- U4.2 local Auth/Storage/finalization: 11 tests passed.
- Attendance concurrency: 7 tests passed.
- Activity/Storage/S6/S7 integration: 19 tests passed.
- Admin Realtime/RLS: 1 test passed on each of two consecutive final runs, now using
  proof-backed punches. Two earlier runs received zero events. Only the local
  Realtime container was restarted; assertions were not weakened. The precise
  transient delivery cause remains unconfirmed (also observed in U4.1).
- Frontend/unit suite: 214 tests passed. Schema lint: no errors. Build: passed.
- Local publication remains attendance_sessions only, INSERT/UPDATE. No sensitive
  proof tables were published. Immutable/protection triggers remain enabled.
- Fixture cleanup and whitespace/diff review completed; no unrelated source changes.

## Exact U4.2 change manifest

Created:

- `supabase/migrations/20261008000100_u42_attendance_proof_finalization.sql`
- `supabase/tests/database/010_u42_attendance_finalization.test.sql`
- `supabase/tests/helpers/legacy-attendance.inc`
- `tests/helpers/attendanceProofFixtures.js`
- `tests/supabaseAttendanceFinalization.local.test.js`
- `docs/supabase-u42-attendance-finalization.md`

Modified:

- `supabase/tests/database/002_s3_attendance.test.sql`
- `supabase/tests/database/003_s5_activities.test.sql`
- `supabase/tests/database/004_s7_admin_audit.test.sql`
- `supabase/tests/database/007_u11_roster_surname.test.sql`
- `supabase/tests/database/008_u3_attendance.test.sql`
- `supabase/tests/database/009_u41_attendance_proofs.test.sql`
- `tests/supabaseActivities.local.test.js`
- `tests/supabaseAttendance.local.test.js`
- `tests/supabaseAttendanceRealtime.local.test.js`
- `tests/supabaseAttendanceProofs.local.test.js`
- `docs/supabase-u41-attendance-proofs.md`

The U4.1 files were already untracked when this phase began. Their migration is
preserved unchanged; their tests/docs are listed above as modified relative to the
completed U4.1 working tree, not incorrectly counted as new U4.2 implementation.
No application source, package, dependency, configuration or earlier migration changed.
