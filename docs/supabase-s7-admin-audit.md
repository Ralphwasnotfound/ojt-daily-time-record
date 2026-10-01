> Historical phase report: this records the implementation and validation at that phase. Current setup is documented in [README](../README.md); superseded backend and deployment instructions are not current operations guidance.

# S7 — Admin / Coordinator integration and immutable activity audit

Local implementation and complete requested local validation finished on 2026-10-01. **Stop before hosted push or frontend deployment.** S8 has not started. Supabase remains active; Firebase remains reference-only. No attendance camera/location/watermark or widgets were added.

## A. Inspection and decisions

Inspected all five Admin views, PendingRegistrations, trusted account/profile adapters, S1–S5 migrations, S3 summaries/read policies, S5 proof reservations/storage rules, and the S6 service/controller.

- AdminDashboard used fabricated class counts, static IN/OUT students, recent activities and attention warnings.
- StudentsView combined working S2 review with an eight-student demonstration directory, mock hours and latest activities.
- StudentDetailsView resolved sample Student IDs and held static attendance/activity/progress/company values.
- ActivityMonitorView used ten static activities, preview dates, fake totals and photo placeholders.
- AdminProfileView initialized a mock identity before partially overwriting it with trusted fields.
- Existing S1 RLS already permits approved admins to read student profiles, attendance and activities. Existing Storage permits current activity proofs. These authorizations were retained.
- S2 pending review read every page into one array. Its UI now reads bounded pending pages through the new admin read API, while review_student and confirmation behavior remain unchanged.

The necessary S5 contract change is historical proof retention. S7 must prevent deletion of any proof referenced by an audit snapshot. Student create/edit signatures and result types are unchanged; the discard RPC now rejects audit-referenced retired paths with PROOF_IN_USE. The original S5 maintenance instructions were updated so privileged cleanup does not bypass that retention requirement.

## B. Exact files

Created:

- `src/services/supabaseAdmin.js`
- `src/services/adminPageController.js`
- `src/services/adminSummaryMixin.js`
- `src/components/AdminRecords.vue`
- `src/components/AdminActivityProof.vue`
- `supabase/migrations/20261002000100_s7_admin_audit.sql`
- `supabase/tests/database/004_s7_admin_audit.test.sql`
- `tests/supabaseAdmin.test.js`
- `docs/supabase-s7-admin-audit.md`

Modified:

- `src/views/admin/AdminDashboard.vue`
- `src/views/admin/StudentsView.vue`
- `src/views/admin/StudentDetailsView.vue`
- `src/views/admin/ActivityMonitorView.vue`
- `src/views/admin/AdminProfileView.vue`
- `src/components/PendingRegistrations.vue`
- `supabase/tests/database/001_s1_foundation.test.sql` — trusted rollback-only fixture cleanup for the new restrictive audit FK.
- `supabase/tests/database/003_s5_activities.test.sql` — retired, audited proof must now be retained.
- `tests/supabaseActivities.local.test.js` — retention assertions, actual S7 API integration, exact local fixture cleanup.
- `package.json` — add S7 frontend tests to npm test; no dependency changes.
- `docs/supabase-s5-activities.md` — superseded cleanup contract and audit-aware maintenance guards.
- `docs/supabase-s6-student-activities.md` — historical retention clarification.

No existing migration was modified. No Student view/controller, auth service, route, Firebase reference code, or sidebar was changed.

## C. Migration inventory

`20261002000100_s7_admin_audit.sql` runs in one transaction. It locks activities against concurrent mutation before backfill and trigger installation, preventing an unrecorded edit in that interval.

Schema:

- `public.activity_revisions`: UUID row ID, activity ID, student UID, integer revision, category, description, proof path, version_at, recorded_at, migration_baseline.
- Restrictive activity/profile FKs preserve referenced history. Unique `(activity_id, revision)` enforces one snapshot per version.
- `private.admin_students`: internal read view with selected profile fields, completed seconds/session count, open Time In, latest category. Browser roles have no view access.

Triggers/functions:

- `private.activity_snapshot()` and AFTER INSERT OR UPDATE activity trigger append a complete snapshot in the activity mutation transaction. Updates must retain owner/session/created_at and increment revision by one.
- `private.audit_immutable()` and BEFORE UPDATE OR DELETE audit trigger reject rewriting/removing snapshots.
- `private.require_admin()` checks the trusted approved-admin profile, never email or user metadata.

RLS/grants:

- Audit table has RLS and approved-admin-only SELECT.
- No anonymous/authenticated INSERT, UPDATE, DELETE or TRUNCATE grants on audit history.
- No browser execution grants on internal trigger/guard functions.
- Public Admin RPCs are fixed-query SECURITY DEFINER functions with empty search_path, explicit trusted authorization, anonymous/PUBLIC execution revoked, authenticated execution granted.
- Existing profiles/attendance/activities RLS and student mutation RPC signatures remain unchanged.

Storage:

- Same private `activity-proofs` bucket, same MIME/size limits, immutable upload rules, no public URLs.
- `activity_proof_read` adds approved-admin access to audit-referenced paths; pending/unattached and unrelated objects remain inaccessible to Admin.
- `activity_discard_proof(uuid)` also checks audit references.
- `private.activity_storage_allowed(text,text)` refuses deletion of current or audit-referenced paths even if reservation state were already discarded.
- No storage.objects metadata/byte mutation is performed by the migration.

Indexes:

- `activity_revisions_photo_idx(photo_path)` supports retention and Storage authorization.
- Unique `(activity_id,revision)` also serves ordered audit reads.
- `activities_admin_history_idx(created_at DESC,id DESC)` serves the global monitor/recent feed.
- Existing student attendance/activity indexes continue serving per-student reads.

Realtime/publication changes: **none**.

## D. Admin read architecture / RPC signatures

`supabaseAdmin.js` reuses the authenticated singleton. Every request checks approved Admin identity before and after completion, has an abort deadline, and sends no privileged credentials. The page controller discards stale account/route/filter responses and retains one bounded page. Summary mixin similarly clears old profile/summary data on changes.

- `admin_dashboard()` returns one aggregate object: total/approved/pending/rejected students, timed_in, completed_sessions, completed_seconds.
- `admin_students(page_size=25, after_id=null, search='', account_status='', attendance_status='', category_filter='', target_uid=null)` returns selected trusted student fields plus totals/open state/latest category. UUID ascending keyset pagination. Search is case-insensitive literal substring on name/Student ID. All filters run server-side.
- `admin_activities(page_size=25, before_created_at=null, before_id=null, target_uid=null, search='', category_filter='', attendance_status='', on_day=null)` returns newest-first current activities with student name/ID and present IN status. Date means original submission day in Asia/Manila; attendance filter means current state, not historic state at submission.
- `admin_attendance(target_uid, page_size=25, before_time_in=null, before_id=null)` returns newest-first sessions for one selected student.
- `admin_activity_revisions(target_activity, page_size=25, after_revision=-1)` returns oldest-first snapshots with current_revision for display.

Page sizes are checked in the database, 1–100. Cursor pairs are validated. No dynamic SQL. All output is authorized server-side even if frontend checks are bypassed.

## E. Dashboard

Cards now show defined metrics rather than guessed values: registered/approved/pending/rejected students, currently open sessions, completed sessions, and summed completed OJT hours. The attention panel shows pending registrations, replacing unsupported missed-Time-In/incomplete-Time-Out examples. There is no inferred absence policy.

Recent activities are limited to three. Student Status is a three-student directory snapshot (UUID order), with real IN/OUT and a link to filter the full directory. Aggregate computation stays in PostgreSQL; the browser never downloads all attendance/activity rows to sum them.

## F. Students directory

Trusted profiles, email, account status, actual open state, latest category, completed hours/progress, UUID detail links. Search, account status, IN/OUT and latest-category filters operate across the database and reset the cursor. All 25 results on a directory page remain visible; no Show More collapse is applied to the directory. S2 review remains above it and refreshes the directory after a decision.

## G. Student Details

Fetches the selected UUID and displays real name, ID, program, email, status, required hours, completed seconds/session count, progress, and open attendance timestamp. Separate overview/attendance/activities sections retain the existing visual theme. Attendance and activity histories load only when selected, in bounded pages. No Admin attendance mutation is introduced. Unknown IDs/errors never fall back to sample students.

## H. Activity Monitor

Real, paginated current activities; server-side student/category/current-attendance/submission-date filters. Cards show original submission time, latest category/description, current proof action, `Edited ×revision`, last server edit time, and View Edit History. Unsupported mock summary counts were removed rather than fabricated.

## I. Immutable audit model

New creates produce revision 0. Each successful edit produces a complete resulting snapshot at revision N+1. Metadata-only revisions retain the same photo path; replacements preserve each applicable path. version_at is the original created_at or authoritative updated_at; recorded_at is database clock time.

Snapshots are inserted by the activity trigger inside the same transaction as activity_create/activity_edit. A forced audit failure test verifies the activity change rolls back. Failed validation/stale revisions create no snapshots. Browser roles cannot fabricate audit rows, ownership, counters, or timestamps. The persisted activities.revision remains the authoritative total edit count.

Existing records receive exactly one marked migration baseline at their current revision with their known values. Prior edits are NOT fabricated. A separate local replay tested both an original revision-0 record and an already-edited revision-2 record, with correct version times and no invented revisions 0/1 for the latter. The UI explains baseline history gaps and marks the current revision.

View Edit History expands a bounded chronological detail area inside the card; main feed cards do not preload every revision.

## J. Historical proof retention

Proof paths referenced by any recorded revision are retained indefinitely in the private bucket. Successful replacement still attaches the new proof and retires the old reservation; retired no longer means disposable if audit-referenced. Abandoned, unreferenced drafts still use discard-before-Storage-delete. S6 code already handles PROOF_IN_USE safely and does not blindly remove retired proof.

This increases storage usage with successful photo replacements. There is no new GC or retention-expiry policy. Future deletion/archival requires a separately approved retention policy and migration. Existing proof bytes deleted before S7 cannot be reconstructed; baseline snapshots do not invent earlier proof paths or content. An unavailable historical image shows a recoverable error while its snapshot remains visible.

Privileged maintenance can bypass normal policy and must honor both activities and activity_revisions references. Updated S5 documentation includes both checks. The local test suite temporarily disables the immutable trigger ONLY inside a transaction deleting its exact synthetic fixture IDs, then reenables it. This is test cleanup, not a production or browser capability.

## K. Admin private proof access

Authenticated Storage download only when View private photo is clicked, for current or historical paths. No eager per-row image downloads, public URLs, signed permanent links, service-role browser keys, or second auth client. Blob URLs are revoked on hide, path change, logout/account switch and unmount. Late responses cannot restore stale photos. Actual local HTTP tests verified retained historical bytes remain downloadable by Admin and cannot be removed by the student.

## L. Accumulated hours

The private read view computes `sum(extract(epoch from(time_out-time_in)))` for completed rows only. Fractional seconds remain numeric internally. Open sessions affect IN status but contribute zero completed seconds. Display floors only at presentation to hours/minutes. No client duration field is accepted. This definition matches S3/S4 completed totals; student attendance code remains unchanged.

## M. Realtime

Realtime was evaluated but not enabled. Explicit refresh and focus reconciliation provide bounded monitoring without expanding publications or introducing a second authorization/state path. S7 does not promise instant push updates. Changes from another tab/device appear on refresh/focus; same-view approval refreshes its directory immediately. There are no subscriptions to leak. Focus listeners are removed on unmount. Future Realtime can invalidate/refetch these read APIs rather than treating event payloads as authorization.

## N. Account review regression

The existing `review_student` RPC remains the only review writer; no direct profile updates or Admin promotion path was added. Confirmation UI, pending-only review, approve/reject messages, and trusted routing remain. Pending reads are now 25-per-page and stale responses are discarded after account changes/unmount. Both decision paths have frontend tests; S2 local Auth/REST/concurrency/session regression suite passes.

## O–P. Security, performance and states

All five Admin surfaces have explicit loading, empty/unavailable and recoverable failure states; none falls back to mocks. Trusted AdminProfile is computed from current auth profile instead of retaining preview values; editing remains unavailable.

Directory, monitor, attendance, and revision reads are cursor bounded. Dashboard recent activity size is three. Expand/Collapse applies only within activity/audit pages. Each page is replaced rather than accumulated in memory. Client search does not pretend to cover unrequested data: useful filters are server-side. Latest category means latest submitted activity, not an inferred live task.

Search uses substring scans, not a speculative search index. Dashboard totals scan real completed sessions server-side; output is bounded, but compute cost grows with data. Load-test realistic institutional volume before adding rollups/trigram indexes. A full last page may allow Next into an empty page; Previous remains available.

## Q. Final validation

| Check | Result |
| --- | --- |
| Focused S7 frontend/controller/service/render tests | 31 passed |
| Complete `npm test` (S2/S4/S6 and Firebase reference unit regressions included) | 170 passed |
| S2 account integration | 7 passed |
| S3 concurrency | 5 passed |
| S5/S6/S7 local Activity/Storage/API integration | 18 passed |
| All local pgTAP tests | 354 assertions passed; 71 S7 assertions |
| Local migration replay/backfill | Passed for original and already-edited fixtures; no invented history |
| `npm run supabase:lint` | No schema errors |
| `npm run build` | Passed |
| `git diff --check` | Passed |

Commands run:

```powershell
node --experimental-vm-modules --test tests/supabaseAdmin.test.js
npm test
npm run test:supabase:accounts
npm run test:supabase:attendance
npm run test:supabase:activities
npm run test:supabase
npm run supabase:lint
npm run build
git diff --check
```

The local database was checked empty before replaying S1–S5, seeding two explicit backfill fixtures and applying S7 with `supabase migration up --local`. Synthetic fixtures were then removed. Final local counts were zero for Auth users, profiles, attendance, activities, audit snapshots, reservations, and proof objects; audit immutability trigger was enabled. No hosted reads/writes/deployment were performed.

## R. Limitations / manual work

- Hosted S7 and browser visual/responsive verification remain manual. Tests cover rendered Vue output, state/controller behavior, SQL and actual local Auth/REST/Storage, not real hosted browser interaction.
- No Realtime, export/report generation, profile editing, activity deletion, attendance correction, retention scheduler or widgets.
- Prior S7-unknown edits cannot be recovered; current revision count may exceed available baseline/history rows and the UI discloses this.
- Retained proof consumes storage indefinitely. Monitor quota and backups; do not run old cleanup recipes that ignore audit references.
- Department is shown only when recorded; no institution or role is invented. “Coordinator” currently uses the existing approved Admin role; no new privilege class was introduced.
- Admin directory is now paginated, with all results on each page visible. Counts and current state refresh on demand/focus rather than continuously.
- Backfill holds a write-blocking lock on activities; schedule a quiet deployment window and pause privileged proof maintenance. Existing student RPC signatures remain compatible during rollout.

## S. Exact manual hosted deployment procedure — NOT executed

After reviewing/committing S7, confirm the intended existing project in the Supabase Dashboard and that backups meet your normal policy. Pause activity/proof maintenance during migration. Do not reset the hosted database, run local fixture scripts on hosted, or include seed/roles.

In the existing correctly linked checkout:

```powershell
npx supabase migration list --linked
npx supabase db push --linked --skip-vault --dry-run
```

Verify the remote history contains S1 `20260929000100`, S3 `20260930000100`, S5 `20261001000100`, and the dry-run proposes **only** `20261002000100_s7_admin_audit.sql`. Stop on a mismatch. `--skip-vault` avoids unrelated config secret updates. These commands are instructions for the operator, not actions performed in this task.

After explicit manual approval:

```powershell
npx supabase db push --linked --skip-vault
npx supabase migration list --linked
npm run build
```

If the checkout is not linked to the intended project, first use `npx supabase link --project-ref <verified-project-ref>` manually, then repeat the read/dry-run review. Never paste a privileged key into frontend configuration or a chat. Existing S2 public browser URL/key and Google OAuth configuration stay unchanged.

Deploy the built frontend through the project's existing hosting workflow only after the migration succeeds. No hosting provider was assumed and no deployment command was invented. Test with `npm run dev` if conducting the hosted verification from the existing local development frontend. The temporary window.__supabase exposure is not needed or restored.

## T. Hosted S7 verification checklist — manual, minimum fixtures

1. Sign in as the designated approved Admin using the existing Google flow. Verify AdminProfile name/email/role/status match trusted profile data, with no preview identity or edit controls.
2. Check Dashboard totals against the trusted profiles/attendance data. Pending/approved/rejected counts must agree. Verify open sessions count as IN but add no completed hours. Attention means pending review only.
3. In Students, search a designated Student ID/name, filter account status and IN/OUT/latest category. Navigate pages. All returned directory rows remain visible. Open a UUID detail link and verify the exact student, program, required hours, completed sessions and hours.
4. Use existing test attendance rows to verify fractional server durations aggregate before display rounding. Do not alter real attendance merely to force a duration. Student S4 Time In/Out should still work with its existing day policy.
5. Open Student Details attendance/activity tabs. Confirm real bounded records, original timestamps and open state. Refresh and navigate away during loading; old data must not return under another route/account.
6. In Activity Monitor, filter student/category/current attendance/date. Date is original submission day in Asia/Manila. Confirm newest-first pagination and current proof retrieval only when requested.
7. Inspect one pre-S7 edited activity. Expect a marked baseline at its existing revision; do not expect invented earlier versions. Existing unedited activity has a revision-0 baseline. Baseline version time must match its known created/updated timestamp.
8. With a designated approved student already IN (or Time In via normal S4 if allowed), create one small proof activity through S6. In Admin, refresh and open history: Original/revision 0, server creation time, correct category/description/photo.
9. Edit metadata via S6, including after Time Out if desired. Refresh Admin: revision count increments once, last-edit time changes, Original stays intact, Edit #1 shows the new text and same proof. Latest revision is marked Current.
10. Replace proof once via S6. Confirm the current card shows the new photo and earlier revisions still show the original private photo. Student flow must succeed without trying to delete audit-referenced bytes. No activity/session/owner/created timestamp changes.
11. In two student tabs, make a stale edit attempt. Confirm ACTIVITY_CHANGED behavior and no extra audit row. A failed invalid edit must not create history or change the current record. Local atomic-failure injection is already tested; do not install failure triggers on hosted.
12. Confirm anonymous/pending/rejected/student accounts cannot enter Admin routes or call Admin RPCs. Students cannot insert/update/delete audit rows or read other students' proof/history. Existing RLS tests cover malicious requests; do not paste privileged credentials into DevTools.
13. Verify Admin can view current and retained historical proof, but not a designated test student's unattached draft or arbitrary bucket path. Do not delete historical bytes to test retention. Failed proof loading must show an error, not a public fallback.
14. Approve one designated pending account and reject another only if approved for test use. Confirm confirmation dialog, pending list refresh, directory status, and student routing after their normal refresh. No account may self-approve/promote.
15. View a photo then log out/switch accounts; old rows/images must disappear. Repeat navigation during a slow request and confirm stale results are discarded. Refresh/focus should recover after a temporary network error.
16. At desktop and small-phone widths check cards, search/select controls, detail tabs, Show More/Show Less, pagination, expanded audit area, keyboard focus and private photos. No horizontal overflow or hidden untappable actions.
17. Verify S4 attendance and S6 creation/edit/replacement again after S7 deployment. Keep minimal designated test records. Historical snapshots/proofs are intentionally retained; any privileged fixture cleanup requires separate explicit review and must never target real user history.

## U. S8 prerequisites

Do not remove Firebase until hosted S7, S2 auth/account/review, S3/S4 attendance and S5/S6 activity/private-proof regressions all pass with the intended accounts. Complete the above audit/retention/isolation checks, confirm operational backups/quota monitoring, and retain a rollback/deployment record. Inventory remaining reference-only Firebase imports, emulator scripts, config and dependencies before a separately approved S8 removal. S7 has not activated or deleted Firebase.
