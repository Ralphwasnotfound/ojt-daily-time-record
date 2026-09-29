# S4 — Student attendance UI integration

S3 hosted completion was confirmed by the project owner. S4 connects the student
UI to that existing backend. No migration, RLS/RPC edit, deployment, hosted test
write, Firebase edit, auth/router change, admin integration, or S5 work is included.

## Existing UI and integration

AttendanceView, StudentDashboard and the attendance tab of HistoryView already
used the shared studentAttendanceMixin. The S2 compatibility gate disabled that
layer for Supabase accounts. The previous attendance controller/service were
Firebase implementations; they remain untouched reference code with their tests.
Activities, activity counts and admin attendance remain mock data.

The existing templates, buttons, responsive table/cards, BSIT palette, status
feedback and Show More controls are preserved. Replacing the mixin's dependencies
connects all three student attendance surfaces without editing their templates.
The active identity check now uses Supabase user.id and the matching profile.uid.

## API and state

- `supabaseAttendance.js`: configured browser client; zero-argument
  attendance_summary(), attendance_time_in(), attendance_time_out(). No write UID,
  session ID, duration or timestamp arguments; no direct table writes.
- Read-only attendance_sessions queries filter the current student's UUID and
  remain subject to RLS. Stable time/id ordering and 200-row pages retrieve history.
  The SQL summary supplies total completed seconds and session count independently
  of REST row limits. There is no authoritative localStorage attendance cache.
- `supabaseAttendanceController.js`: explicit unknown/loading/busy/ready state;
  single-flight operations; server receipts retained; summary then history
  reconciliation after successful, rejected and uncertain mutations. Separate
  reads that disagree fail closed and require refresh.
- `supabaseAttendancePresentation.js`: Asia/Manila timestamps. Per-session/today
  elapsed hours are display-only differences of returned server timestamps. Overall
  completed hours use the SQL completed_seconds value, including fractional seconds
  before display rounding. Browser time does not determine attendance eligibility.
- Actions use open_session_id and started_today. An open overnight session exposes
  Time Out; a closed session started today disables attendance actions; a fresh day
  without an open session exposes Time In. The backend remains final authority.

Mutations are single-flight across views, and a remounted view waits for a pending
write before reading. Each request has a 15-second abort deadline and SDK retries
are explicitly disabled. An abort is not proof that a database write failed.
Unknown outcomes are never replayed automatically. Actions remain unavailable until
summary/history reconciliation succeeds. If confirmation succeeds but refresh
fails, the server receipt and success notice are kept while controls stay disabled.

Known rule messages are friendly; unexpected database/transport details are not
exposed. Access-denial errors refresh the existing S2 account profile/routing.
Unmount/account changes invalidate late results and clear the old UI. Page mount,
focus, reconnect, explicit refresh and a displayed Manila-day change request fresh
state. There is no attendance realtime subscription or constant polling.

## Files for this phase

Created:
- src/services/supabaseAttendance.js
- src/services/supabaseAttendanceController.js
- src/services/supabaseAttendancePresentation.js
- tests/supabaseAttendanceUi.test.js
- docs/supabase-s4-student-attendance.md

Modified:
- src/services/studentAttendanceMixin.js
- tests/studentAttendanceView.test.js (Supabase fixtures in existing rendered-view checks)
- tests/supabaseAuth.test.js (replace the retired S2 unavailable-gate expectation)
- package.json (include S4 tests in the normal suite)

The workspace already had uncommitted changes from earlier phases. Those are not
new S4 changes. No packages were installed.

## Local validation

- Focused S4 controller/service/mixin tests: 24 passed.
- Rendered student-view checks: 3 passed; S2 auth/router tests: 21 passed.
- Normal suite: 89 passed, including preserved Firebase reference tests.
- Local S3 concurrency suite: 5 passed; synthetic fixtures cleaned by the suite.
- Local S1/S3 pgTAP suite: 208 assertions passed; rollback-only fixtures.
- Configured local Supabase schema lint: no errors. No frontend lint script exists.
- Production build passed without chunk-size warnings.

Docker initially required sandbox elevation; the authorized local rerun passed.
No hosted endpoint was used by the automated validation. Rendered-view checks
cover loading, empty, completed state, disabled controls and timestamps; they do
not replace an interactive hosted browser test of real credentials/network behavior.

## Manual hosted verification

Use only designated approved student test accounts and ordinary Google sign-in.
Do not change existing records, device time, account roles, or RLS to enable tests.

1. Open /student, /student/attendance and /student/history with the student that
   completed S3 attendance on the current Manila day. After loading, expect OUT,
   completed-today state, actual server times/hours, and a disabled Completed for
   today control. No Time In or Time Out action should be available. If testing on
   a later Manila day, the once-per-day allowance naturally resets instead.
2. Ctrl+R, navigate away/back and reopen the browser. Confirm the same server state
   restores. Check dashboard totals against attendance/history, desktop and phone
   layouts, and keyboard access to the existing controls.
3. On the next Manila day, or with another designated approved test student who has
   not started today, confirm Time In is enabled. Click once/rapidly twice: observe
   one attendance_time_in request with no client parameters, busy/disabled control,
   server Time In and IN state, followed by Time Out. Refresh to confirm restoration.
4. Time Out once/rapidly twice. Confirm one attendance_time_out request, actual server
   Time Out, completed hours, OUT and disabled attendance actions for today. Refresh
   again. Preserve this legitimate test record; do not delete it to repeat a test.
5. With approved test-record creation explicitly intended, simulate a lost response
   during an operation. Do not repeatedly click. Confirm summary is requested after
   the error/deadline, no automatic mutation replay, and controls remain blocked if
   reconciliation cannot reach the server. Reconnect/Refresh attendance and verify
   the actual server result before considering another action.
6. Sign out using the existing confirmation, then sign in as another designated
   account. Confirm no previous student's values persist. Pending/rejected accounts
   must retain S2 routing; admins retain /admin and cannot reach student actions.
7. If testing two tabs, refresh/focus the other tab after a mutation. Stale-state
   business rejections must be friendly and followed by reconciliation. Server-side
   uniqueness remains the final defense, not a client lock shared across browsers.

Local implementation/validation is complete. Hosted S4 interaction, real network
loss and the real next-Manila-day/overnight transition still require manual checks.
History currently loads all own pages, so very large histories may eventually need
UI pagination. Admin attendance, activities/photos and S5 remain deferred.
