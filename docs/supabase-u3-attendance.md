# U3 — Two daily attendance sessions and Admin attendance signals

## Scope

Local implementation only. No hosted operation or deployment. Historical S1/S3
migrations are unchanged. No attendance proof, geolocation, watermark, report
export, company schedule, U4, or activity write/audit redesign.

## Database contract

Forward migrations:

- `20261006000100_u3_attendance.sql`
- `20261006000200_u3_attendance_realtime.sql`

The first drops `attendance_one_start_per_manila_day_idx` and creates the
nonunique `attendance_student_manila_day_idx` on student UID and Manila Time In
date. `attendance_one_open_per_student_idx` is preserved.

Time In still locks the approved student's profile row, rejects an open session,
captures `clock_timestamp()` AFTER the lock, and counts starts on that Manila
date. At two starts it raises `DAILY_ATTENDANCE_LIMIT_REACHED`. Browser writes
remain denied. No historical rows or timestamps are rewritten. The two-start
limit is enforced by the serialized database RPC; unrestricted database-owner
maintenance can bypass RPC rules and must not insert invalid attendance.

Time Out is unchanged: own open session, profile/session locks, server timestamp,
interval validation and `NO_OPEN_ATTENDANCE` for a duplicate close. Mutations have
no automatic retries or client timestamp/UID arguments. They are not idempotency-
keyed: racing IN/OUT requests have serialized outcomes, not an exactly-once promise.

Session ordinal is derived with row_number over student + Manila start-day,
ordered by `(time_in,id)` before presentation/pagination. No ordinal/proof columns.

### attendance_summary()

Explicitly recreated without CASCADE to evolve its TABLE return type. Approved-
student authorization, invoker RLS, empty search_path and authenticated-only
EXECUTE grants are preserved.

Fields:

- `open_session_id`, `open_time_in`
- `started_today` (compatibility only)
- `completed_seconds`, `completed_sessions` (all time)
- `manila_day`, `starts_today`
- `next_action`: `time_in`, `time_out`, `none`
- `today_sessions`: complete current-day session records, including derived ordinal
- `open_session_ordinal` (also works for an overnight session)
- `today_completed_seconds`
- `days_present`: DISTINCT Manila start-days, including days with an open session

Closed intervals sum individually with numeric fractional seconds. Open time and
breaks are excluded. A session crossing midnight belongs entirely to its Time In
day. After closing yesterday's session today, today still permits two starts.

### Grouped history reads

- `attendance_days(day_limit integer default 15, before_day date default null, on_day date default null)`
- `admin_attendance_days(target_uid uuid, day_limit integer default 15, before_day date default null, on_day date default null)`

Both return `{days, next_before_day}`. A day contains `start_day`,
`completed_seconds`, and ordered `sessions` including ordinal and per-session
completed seconds. Newest day first; sessions oldest first within each day.
`before_day` is exclusive; `on_day` filters on the server. Limits are 1–31 whole
days, default 15; no day is split. A bounded extra day determines whether another
page exists. Ordinary valid data has at most 30/62 session rows per default/max
page. Existing `admin_attendance` is retained.

Public wrappers authorize approved student/approved Admin respectively. The
private read helper/view have no browser grants. Student UID comes from auth.uid;
only the Admin wrapper accepts a target UID.

## Student integration

The controller reconciles a single authoritative summary, instead of downloading
all history and comparing it with total session counts. No eligibility depends
on `started_today` anymore. Action states:

| State | Label | Action |
| --- | --- | --- |
| No starts | Ready to Time In | Time In |
| First open | Currently IN · Session 1 | Time Out |
| First closed | First session completed | Time In Again |
| Second open | Currently IN · Session 2 | Time Out |
| Second closed | Attendance completed for today | Disabled |

An overnight open session takes precedence and its original date is displayed.
Today's total and Days Present use the new summary fields. Display formatting
floors only after aggregation. Uncertain writes reconcile and are never replayed.
Legacy `ALREADY_STARTED_TODAY` remains mapped alongside the new friendly limit
message. Missing U3 summary fields fail closed; deploy backend before frontend.

`AttendanceDays.vue` provides bounded date-filtered Previous/Next history for
Student Attendance, Student History and Admin Student Details. It replaces the
old unbounded student 200-row accumulation and all-history date dropdown.
Account/filter/page changes invalidate old responses. Cross-midnight Time Out
includes its actual date. Student Dashboard consumes the updated mixin; its
activity feed is untouched.

## Admin integration and Realtime

The existing completed-hour aggregation was already correct and is unchanged.
Admin Student Details uses whole-day history. IN means an open session; OUT does
not mean both sessions are completed.

`adminAttendanceSignals.js` owns one channel, started/stopped by AdminLayout using
approved `adminKey()` identity. Mounted datasets register callbacks; no Pinia or
attendance record store is introduced. INSERT/UPDATE and SUBSCRIBED/reconnect
produce invalidations only. Event values never become displayed attendance state.
Error envelopes are ignored. Reads still use approved-Admin RPCs.

Signals use a 300ms trailing debounce with a 1000ms maximum wait. One signal-driven
read runs per registered dataset; events during it mark one follow-up read dirty.
Generation checks reject obsolete channel events. Timers/channel clean up on
logout, account/role change and layout teardown. Subscribers unregister on unmount.

Mounted summary/directory/current-activity components reconcile existing bounded
reads. Background summaries retain their previous result instead of unmounting
children. Admin Student Details awaits its visible attendance history refresh as
part of the same reconciliation. Page controllers reload current cursors; filters
and activity disclosures remain. Same-key ExpandableList refreshes retain their
expanded presentation. Removed records still unmount and clean photos correctly.

No audit timeline or proof download is automatically refreshed. Dashboard latest-3
activity grouping, Student Details 5-activity pages, Monitor 25-student/25-activity
pages, and lazy audit/proof behavior are preserved.

Initial fetch, manual Refresh, focus, online and subscription establishment remain
reconciliation paths. Websocket failure cannot block attendance writes. Missed
signals can leave a mounted view stale until one of those fallbacks occurs.

## Publication findings and security

Before modification, local `supabase_realtime` had zero members and all four
operations enabled. Repository inspection found no existing subscription consumer.
Local config previously disabled Realtime. It is now enabled for local testing.

The separate publication migration refuses missing publications, FOR ALL TABLES,
or unrelated member tables. It restricts `supabase_realtime` to INSERT/UPDATE and
adds ONLY public.attendance_sessions. It does not change the separate Realtime
messages publication created internally by the local service.

Existing attendance SELECT RLS is unchanged. Real local websocket tests prove:

- Approved Admin and owner receive their permitted INSERT/UPDATE rows.
- Another approved student receives no rows for that student.
- Pending/rejected users receive no row events.
- Anonymous receives no attendance row data. This local Realtime version emits
  401 Unauthorized envelopes containing table/event/commit metadata and empty
  `new`/`old` objects. Tests explicitly assert this, rather than claiming no wire
  message exists. No SELECT grant was added to anon to suppress those errors.
- DELETE/TRUNCATE publication is disabled; no DELETE-RLS assumption is used.

Hosted publication state has NOT been inspected or modified.

## Validation

- Clean local reset applied all historical and both U3 migrations successfully.
- pgTAP: 563 assertions passed across eight files.
- Attendance concurrency: 5 tests passed (includes queued first/second starts,
  duplicate close, third rejection, IN/OUT race and approval revocation).
- Account integration: 7 tests passed.
- Activity/Storage/S6/S7 integration: 19 tests passed, including creation on both
  sessions, old reservation rejection, between-session denial and post-close edit.
- Real local Realtime/RLS: 1 integration test passed, covering five action states,
  four events and six identity contexts; synthetic fixtures cleaned afterward.
- Full frontend/unit suite: 214 tests passed, including six signal-service tests,
  U1/U1.1, U2, Monitor/audit and mounted background-preservation regressions.
- Schema lint: no errors.
- Production build and git diff --check: passed.

Database tests must run sequentially with committed-fixture integration suites.
An initial simultaneous run caused count assertions to see Realtime test fixtures;
the sequential rerun passed. Initial websocket validation was not treated as a
pass: startup/isolation diagnostics were resolved and the real test rerun alone.

Actual hosted Google/browser multi-device behavior and visual phone/desktop checks
remain for the next verification phase. No claim of hosted validation is made.

## NEXT phase: hosted preflight and rollout (not executed)

1. Confirm intended project reference, backup/recovery readiness, and existing
   migration history. Do not print keys or use service-role credentials in browser.
2. In the intended hosted SQL editor, run read-only preflight:

```sql
select pubname, puballtables, pubinsert, pubupdate, pubdelete, pubtruncate
from pg_publication where pubname = 'supabase_realtime';
select pubname, schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime';
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'attendance_sessions';
select student_uid, (time_in at time zone 'Asia/Manila')::date, count(*)
from public.attendance_sessions group by 1,2 having count(*) > 2;
select student_uid, count(*) from public.attendance_sessions
where time_out is null group by 1 having count(*) > 1;
```

3. Review consumers outside this repository. If publication membership includes
   unrelated tables, FOR ALL TABLES is set, or any consumer needs DELETE/TRUNCATE,
   STOP. Do not bypass the migration guard or silently alter consumer behavior.
4. Review both new migration files and approve the hosted target explicitly. In
   that later authorized phase, use `supabase db push --dry-run` to confirm only
   the expected migrations, then `supabase db push`. Neither was run in U3.
5. Verify migration history, indexes, new RPC grants, attendance RLS and publication
   membership/operations. Existing historical rows/associations must be unchanged.
6. Deploy the tested frontend only AFTER the backend contract exists and separate
   deployment approval is given. No new frontend environment variables are needed.
7. Use designated test accounts and minimum records. With Admin and student browsers
   open, verify IN→OUT→IN→OUT, third denial, Session 1/2 activity association,
   today/all-time totals, distinct Days Present and grouped history pagination.
8. Watch Admin Dashboard, directory IN/OUT filters, Student Details history and
   Monitor badges update without manual refresh. Confirm U2 activity page/filter/
   disclosure/photo state is preserved; no eager audit/proof requests occur.
9. Exercise logout/account switch, reconnect, offline/focus fallback, two tabs,
   phone/desktop layouts and keyboard controls. Verify unapproved/anonymous/cross-
   student access remains denied. Do not perform uncontrolled real-user cleanup.
10. Keep midnight fixture manipulation local. Hosted cross-midnight checks should
    use existing approved test data or an explicitly reviewed test plan, not edits
    to real attendance timestamps. Attendance proof and U4 remain deferred.

## Exact change manifest

Created:

- `docs/supabase-u3-attendance.md`
- `src/components/AttendanceDays.vue`
- `src/services/adminAttendanceSignals.js`
- `supabase/migrations/20261006000100_u3_attendance.sql`
- `supabase/migrations/20261006000200_u3_attendance_realtime.sql`
- `supabase/tests/database/008_u3_attendance.test.sql`
- `tests/adminAttendanceSignals.test.js`
- `tests/supabaseAttendanceRealtime.local.test.js`

Modified:

- `package.json`
- `src/components/AdminActivityStudents.vue`
- `src/components/AdminRecentActivities.vue`
- `src/components/AdminRecords.vue`
- `src/components/ExpandableList.vue`
- `src/layouts/AdminLayout.vue`
- `src/services/adminSummaryMixin.js`
- `src/services/studentAttendanceMixin.js`
- `src/services/supabaseAdmin.js`
- `src/services/supabaseAttendance.js`
- `src/services/supabaseAttendanceController.js`
- `src/services/supabaseAttendancePresentation.js`
- `src/views/admin/StudentDetailsView.vue`
- `src/views/student/AttendanceView.vue`
- `src/views/student/HistoryView.vue`
- `supabase/config.toml`
- `supabase/tests/database/001_s1_foundation.test.sql`
- `supabase/tests/database/002_s3_attendance.test.sql`
- `tests/studentAttendanceView.test.js`
- `tests/supabaseActivities.local.test.js`
- `tests/supabaseAdmin.test.js`
- `tests/supabaseAttendance.local.test.js`
- `tests/supabaseAttendanceUi.test.js`
- `tests/supabaseAuth.test.js`
