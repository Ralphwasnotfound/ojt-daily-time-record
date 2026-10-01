> Historical phase report: this records the implementation and validation at that phase. Current setup is documented in [README](../README.md); superseded backend and deployment instructions are not current operations guidance.

# S7 refinement — Student-first Admin Activity Monitor

Local implementation only. No hosted push/deployment; no S8. Existing S7 audit/Storage protections and S6 Student Activity behavior remain unchanged.

## Previous and new data flow

Previously ActivityMonitorView rendered AdminRecords with kind=activities, paging 25 global activities. Repeated student cards were activity rows, and grouping that fetched page would give incomplete student histories/counts.

Now ActivityMonitorView renders AdminActivityStudents. The initial query returns at most 25 student summaries, each keyed by trusted profiles.id. One student remains one summary regardless of activity count. Identical names or similar Student IDs never merge identities. Cards default collapsed; only one is expanded at a time.

Expansion mounts the existing AdminRecords activity component with target_uid and the parent's active filters. It fetches a bounded 25-activity page. Previous/Next pagination replaces that page, rather than an ever-growing Load More array. This satisfies bounded nested history loading without loading every activity. Collapsing, switching student, changing filters, changing main page, refreshing, logout, or unmount removes the expanded component and its proof/history descendants. Controllers discard late responses; existing proof components revoke object URLs. Reopening intentionally fetches fresh records; no cross-session cache was added.

Photos still require View private photo. Revision history still requires View Edit History. Existing submitted time, category/description, Edited ×N, last edit time, audit baseline/current labels and retained historical proof remain available.

## New migration

`supabase/migrations/20261003000100_s7_activity_students.sql`

Adds only:

```text
admin_activity_students(
  page_size integer = 25,
  after_id uuid = null,
  search text = '',
  category_filter text = '',
  attendance_status text = '',
  on_day date = null
) → jsonb array
```

Each result contains id, full_name, student_id, is_in, total_activities, total_edits, matching_activities, latest_activity_at.

- Stable ascending UID keyset pages, bounded in the database to 1–100.
- Profiles must be students with at least one activity matching the activity filters.
- All-time count is count(activities); all-time edits is sum(activities.revision), the authoritative server revision field. It does not count audit snapshots, so existing migration baselines do not undercount historical edits.
- Current IN state is existence of an open attendance session.
- Read-only STABLE SECURITY DEFINER function, empty search_path and existing private.require_admin() authorization.
- PUBLIC/anonymous execution revoked; authenticated execution still requires the trusted approved Admin profile.
- No table, index, RLS, Storage policy, audit trigger, mutation RPC or publication changes. Existing student/history indexes support owner lookups.

Applied locally with `npx supabase migration up --local`. No existing migration was edited. Nothing was pushed to hosted Supabase.

## Filter/count semantics

- Search: server-side case-insensitive literal substring of student name or Student ID.
- IN/OUT: current attendance, not status at activity submission.
- Category/date: qualify a student only when the same activity matches all applicable activity filters. Date means original created_at day in Asia/Manila, including the start boundary and excluding the next day.
- Total activities / total edits: all-time, explicitly labeled; unaffected by category/date filters.
- Matching activities: category/date result count, shown when either is active.
- Latest submission: all-time timestamp, explicitly labeled.
- Expanded activities receive the same search, category, attendance and date parameters plus target_uid. These filters cannot silently diverge through separate child controls; filter controls inside this embedded activity list are hidden.
- Other AdminRecords consumers retain their existing independent filters and behavior.

Counts/state are server snapshots. If another user changes records after the summary is read, Refresh/focus reconciles the summary; no realtime behavior was added. A final full page may expose a Next button leading to an empty page, as in existing S7 pagination.

## Exact files changed for this refinement

Created:

- `supabase/migrations/20261003000100_s7_activity_students.sql`
- `supabase/tests/database/005_s7_activity_students.test.sql`
- `src/components/AdminActivityStudents.vue`
- `docs/supabase-s7-student-first-monitor.md`

Modified:

- `src/services/supabaseAdmin.js` — one activityStudents read wrapper using the existing client.
- `src/components/AdminRecords.vue` — optional monitorFilters prop; inherited filters for the embedded list, independent filter controls hidden only in that mode.
- `src/views/admin/ActivityMonitorView.vue` — use the student-first component.
- `tests/supabaseAdmin.test.js` — summary rendering, UID identity, filters, pagination and actual mounted-component lifecycle coverage.
- `tests/supabaseActivities.local.test.js` — real local RPC/service counts, cursor, filter and unauthorized-caller assertions.

Other working-tree changes belong to the earlier S7 implementation and were preserved. No changes to Firebase, Student components/services, other Admin pages, account-review behavior, audit lifecycle or proof retention.

## Validation

- Focused S7 frontend tests: 40 passed (31 previous + 9 refinement tests).
- Complete frontend/unit suite: 179 passed.
- Local Activity/Storage/Admin API integration: 18 passed, including new RPC checks and S6 regression.
- All pgTAP: 393 passed (39 new student-first assertions).
- Local schema lint: no schema errors.
- Production build: passed.
- git diff --check: passed.

Mounted tests use a minimal Vue host to exercise component mount/unmount and requests; native DOM v-model directives are omitted in that host, while compiled rendering and filter argument semantics are separately tested. Actual hosted browser visual verification remains manual.

## Manual hosted follow-up (not executed)

After review, use the already verified project link and the existing manual deployment procedure. Check `npx supabase migration list --linked`, then `npx supabase db push --linked --skip-vault --dry-run`. With the initial S7 migration already deployed, only `20261003000100_s7_activity_students.sql` should be pending. Stop on an unexpected migration list. Push only after manual approval; this task did not run those hosted commands.

After deploying the RPC and frontend, verify:

1. One collapsed card per student with activities; all-time totals match trusted data.
2. Same-name accounts remain separate.
3. Category/date qualification, matching counts, IN/OUT and name/ID search behave as labeled.
4. Expanding loads only that student and preserves filters. Use nested Previous/Next for a large existing history.
5. Current/historical private photos and edit history remain lazy and correct.
6. Collapse/logout/navigation clears images and stale requests; changing main filters collapses the child.
7. Dashboard, directory, Student Details, S2 review and S6 student flows remain unchanged.

No hosted test records or operations were created by this refinement. Stop here; do not start S8.
