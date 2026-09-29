# S3 — Supabase attendance backend

S3 adds database RPCs only. S2 auth/account code, Vue pages, the S2 attendance UI
compatibility gate, Firebase references, and activity code are unchanged. S4 is not
started. This migration has been applied only to local Docker Supabase.

## Migration and API

Migration: `supabase/migrations/20260930000100_s3_attendance.sql`.
S1 tables, indexes, constraints, policies and direct table grants remain unchanged.
No attendance state table or redundant duration column is introduced.

| RPC | Arguments | Return | Behavior |
| --- | --- | --- | --- |
| `attendance_time_in()` | none | `attendance_sessions` row | Lock approved student's profile; reject open session or same Manila-day start; insert server timestamp |
| `attendance_time_out()` | none | `attendance_sessions` row | Lock same profile and its open session; close exactly that session with server timestamp |
| `attendance_summary()` | none | One summary row | Own open-session identity/time, today's start flag, exact completed seconds and completed-session count |

Write return fields are `id`, `student_uid`, `time_in`, `time_out`.
Summary fields are `open_session_id`, `open_time_in`, `started_today`,
`completed_seconds`, `completed_sessions`. Null open-session fields mean OUT.
An empty history returns zero completed seconds/count and `started_today = false`.
The summary is a read-only snapshot, not a reservation or permission to write.

The client supplies neither identity, session ID, role/status, timestamps nor duration.
Identity is `auth.uid()` and authorization is the trusted `profiles` row.
PostgREST calls for future S4 (not wired into the app here):

```js
supabase.rpc('attendance_time_in')
supabase.rpc('attendance_time_out')
supabase.rpc('attendance_summary')
```

History and admin reads continue through RLS-protected `attendance_sessions` SELECTs.
Use stable time/id ordering and pagination when S4 implements history. The summary
aggregates in PostgreSQL and is not truncated by the REST row limit.

## Concurrency, timestamps and worked time

Both write RPCs acquire `SELECT ... FOR UPDATE` on the caller's approved-student
profile before inspecting attendance. Transactions for that student serialize on the
same row; concurrent account status changes must also wait for that lock. Under the
normal PostgREST READ COMMITTED isolation level, a waiting request sees the committed
result of the earlier request. Tests also verify approval changes while waiting.

S1's independent unique indexes remain defense-in-depth:

- `attendance_one_open_per_student_idx`: one open row per student.
- `attendance_one_start_per_manila_day_idx`: one start per Manila date, even after closing.

`clock_timestamp()` is captured after acquiring the lock, avoiding the stale timestamp
that transaction-start `now()` could produce after a long wait. Time In uses that same
captured value for the day check and inserted timestamp. Dates use explicit
`AT TIME ZONE 'Asia/Manila'`; stored values remain `timestamptz`. Session timezone and
browser clock never determine the policy. An overnight session must close before a
new start, but its previous-day start does not consume the new day's allowance.

S1 has no duration column. Completed seconds are exactly
`sum(extract(epoch from (time_out - time_in)))` over closed sessions. Fractional seconds
are retained, no individual session is rounded, and open sessions contribute nothing.
There is no automatic break deduction, daily cap, auto-close or invented correction.
Time Out fails without mutation if the server clock is earlier than the stored start.

## Security and error contract

Time In/Out are `SECURITY DEFINER` with empty `search_path`, qualified table references,
and explicit approved-student checks. Only `authenticated` receives EXECUTE; PUBLIC
and anon do not. The read summary is `SECURITY INVOKER` and preserves RLS.
Students read their own attendance only while approved. Approved admins keep their
existing read access but cannot call student attendance operations or write tables.
No new coordinator role is invented; S1 recognizes student/admin only.
INSERT/UPDATE/DELETE remain unavailable to browser roles. No RLS policy is weakened.

| SQLSTATE | Message | Meaning |
| --- | --- | --- |
| `42501` | `AUTHENTICATION_REQUIRED` | Missing authenticated UID |
| `42501` | `APPROVED_STUDENT_REQUIRED` | Missing profile, pending/rejected student, or admin |
| `P0001` | `ALREADY_TIMED_IN` | An open session already exists |
| `P0001` | `ALREADY_STARTED_TODAY` | A start already exists on today's Manila date |
| `P0001` | `NO_OPEN_ATTENDANCE` | No caller-owned open session to close |
| `P0001` | `ATTENDANCE_CLOCK_INVALID` | Server time precedes stored Time In |

Anonymous roles may be denied EXECUTE before the function's UID check runs.
Unexpected constraint errors remain failures; they are not swallowed. Requests are
not replay-idempotent: a retry after an ambiguous network result should first read
the current summary/history in S4. Duplicate operations cannot create duplicate rows.

## Local validation

| Check | Result |
| --- | --- |
| `npm run supabase:reset` | Passed; explicit `--local --no-seed`, both migrations applied |
| `npm run test:supabase` | 208 assertions passed: 147 S1 + 61 S3 |
| `npm run test:supabase:attendance` | 5 tests passed (parent plus 4 concurrency cases) |
| `npm run test:supabase:accounts` | 7 existing S2 integration tests passed |
| `npm run supabase:lint` | No schema errors |
| `npm test` | 64 tests passed |
| `npm run build` | Passed; existing large legacy attendance chunk warning |

The SQL tests use rollback-only fixtures and cover authorization, server timestamps,
open/closed state, exact totals, ownership, repeated operations, direct-write denial,
RLS reads, overnight sessions, and microsecond Manila/year boundaries under a different
session timezone. Fixed boundary fixtures test the index without overriding the clock.
They do not simulate the wall clock itself crossing midnight during a lock wait.

Concurrency tests use separate psql connections to the fixed local Docker container.
They first hold the profile lock, verify both requests actually wait in
`pg_stat_activity`, release it, and assert results/timestamp ordering. Fixtures are
removed afterward. The first test run correctly rejected a lowercase fixture Student
ID; the fixture was uppercased and the complete concurrency suite then passed. Its
failed setup transaction rolled back. No production/schema workaround was needed.
Automatic permission review initially timed out; the permitted retry succeeded.
No new dependency was installed. Firebase emulator tests were not repeated because
no Firebase code/rules changed; normal reference-service tests were included.

## Hosted gate — recommended next steps, not executed

1. Obtain explicit approval for hosted S3 deployment. Confirm the intended project
   reference and that hosted migration history already includes S1. Review any drift
   and preserve an appropriate backup. Do not rerun S1 manually or reset hosted data.
2. With the intended project link verified (link only if needed and authorized), run:
   `npx supabase migration list --linked`, then `npx supabase db push --linked --dry-run`.
   The plan must contain only the pending S3 migration. Stop if it proposes unexpected
   migrations or reports history drift. Do not repair migration history blindly.
3. After reviewing that plan, run `npx supabase db push --linked`. Confirm all three
   signatures, intended EXECUTE grants, unchanged RLS/write restrictions, and unchanged
   unique indexes. These commands were NOT run by this task.
4. Use a designated approved student test account for authorized live RPC verification:
   initial summary, Time In, duplicate/concurrent Time In rejection, Time Out, duplicate
   Time Out rejection, same-day restart rejection, and exact completed time. Confirm
   pending/rejected/admin/anonymous write denial and cross-student read isolation.
   Use ordinary authenticated tokens, never an admin/service credential for authorization
   testing. Do not log tokens or real personal data. Live tests create real attendance
   records; agree on test accounts and any cleanup separately.
5. Verify an overnight/next-Manila-day case at the real boundary or in a separately
   controlled test environment. Do not accept browser-supplied timestamps or loosen
   constraints to accelerate testing. Observe a real lock/network retry case.
6. Stop after hosted S3 verification. Student UI integration requires a separate S4 task;
   existing attendance buttons remain deliberately unavailable during S3.

PostgreSQL references: [row locks](https://www.postgresql.org/docs/17/explicit-locking.html),
[timestamp semantics](https://www.postgresql.org/docs/17/functions-datetime.html).

## Files changed in S3

Created:
- `supabase/migrations/20260930000100_s3_attendance.sql`
- `supabase/tests/database/002_s3_attendance.test.sql`
- `tests/supabaseAttendance.local.test.js`
- `docs/supabase-s3-attendance.md`

Modified: `package.json` adds only `test:supabase:attendance`.
Earlier uncommitted S1/S2 changes are preserved and are not S3 changes.
