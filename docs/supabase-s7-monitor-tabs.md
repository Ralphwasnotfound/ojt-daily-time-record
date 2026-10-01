> Historical phase report: this records the implementation and validation at that phase. Current setup is documented in [README](../README.md); superseded backend and deployment instructions are not current operations guidance.

# S7 frontend refinement — Current Activities and Activity Logs

Completed locally. No schema, RPC, RLS, Storage, audit, authentication, routing, sidebar, Student page, Firebase, or deployment changes. No migration was created. S8 was not started.

## Files changed in this refinement

Modified:

- `src/views/admin/ActivityMonitorView.vue`
- `src/components/AdminActivityStudents.vue`
- `src/components/AdminRecords.vue`
- `tests/supabaseAdmin.test.js`

Created:

- `src/components/AdminActivityTimeline.vue`
- `docs/supabase-s7-monitor-tabs.md`

Other existing working-tree changes belong to the preceding S7 work and were preserved.

## Current Activities

The default tab at the existing Activity Monitor route. One collapsed card per trusted student UID shows name, Student ID, current IN/OUT, all-time activity count, matching count when filtered, and View Activities. Edit totals and extra timestamps were removed from these cards.

Expansion retains bounded latest-state activity reads. Each activity shows category, original submitted time, current description and lazy private photo action. No edit count, last-edit time, history button, or revisions appear. Repeated student names/IDs are suppressed inside the expanded list.

## Activity Logs

The same student-first summaries show identity, all-time activity/edit totals and View Logs. Expanded activity summaries show category, original submission time, edit count/last edit where applicable, and View Changes. Unedited records say No edits recorded.

All activities with known state are included, including unedited originals/baselines. There is no misleading client-side global edited-only filter. The tab explains this briefly. Existing authoritative revision totals may include pre-S7 edits whose individual snapshots were never recorded; those histories retain the accurate first-available disclosure.

## View Changes timeline

Explicitly opening View Changes mounts AdminActivityTimeline and invokes the existing bounded revision RPC. It shows a simple oldest-to-newest ordered timeline: Original, Edit #N, and a Current badge on the latest version. Each entry includes the server version date/time, category, description and an independently lazy private photo action. IDs, paths and RPC terminology are not displayed.

Pre-S7 baselines are labeled First available version with “Edit history is available from this point.” They are never invented originals. Current still identifies a baseline if that is the latest known state.

Timeline pagination remains chronological, at most 25 versions per request. Previous/Next changes loads another bounded page; the current marker appears on its actual version, which may be on a later page for a long history. No complete-history download or fabricated version is introduced.

## Tabs, filters and cleanup

- One sidebar destination and unchanged route.
- Accessible tablist/tab/tabpanel semantics, selected state, roving tabindex, visible focus, Arrow Left/Right and Home/End keyboard navigation.
- The keyed tab panel unmounts the previous student list, activity list, timelines and proofs. Each new tab starts collapsed with fresh filters/pagination. No hidden live tab or previous-tab cache is retained.
- Both tabs keep server-side name/Student ID search, current IN/OUT, category and original Manila submission-date filters.
- Category/date qualify students and filter expanded activities. All-time totals remain labeled as such; matching counts reflect filters.
- Date is never presented as edit date. In Logs it still means original submission date.
- Expanding a student loads only their paginated current activities. View Changes alone loads snapshots; View private photo alone downloads bytes.
- Collapse, tab switch, logout and unmount invoke existing controller invalidation and object URL cleanup. Late reads cannot repopulate the new tab.
- Other AdminRecords consumers default to the original presentation, preserving Dashboard and Student Details history controls. Directory, hours, reviews and Student S4/S6 behavior remain unchanged.

## Validation

- Focused S7 Admin tests: 54 passed, including 14 new tab/timeline tests.
- Complete frontend/unit suite: 193 passed.
- Existing local S5/S6/S7 Activity/Storage/Admin API integration: 18 passed.
- Production build: passed.
- git diff --check: passed.

Tests cover compiled Vue output, mounted Options API component trees, keyboard navigation, default tab, current/log separation, lazy timeline/proof reads, baseline/current labels, ordered/bounded history, stale response rejection, URL cleanup on switch/logout/unmount, truthful filters and existing Admin/Student regressions. The test module loader now caches in-progress module promises so shared component dependencies link consistently.

No database tests or schema lint were rerun because this refinement changes no backend code. Integration tests used local Docker Supabase only; no hosted operation or deployment was performed.

## Remaining hosted/browser verification

After deploying the frontend through the normal manually approved workflow:

1. Open Activity Monitor; confirm Current Activities defaults selected and the URL/sidebar destination stays unchanged.
2. Expand a student and check latest content/private photo without edit details. Check student and nested activity pagination.
3. Switch to Logs; confirm the previous photo closes and filters/expansions reset. Expand View Logs, then View Changes; verify original, edits, current marker and first-available baselines against designated existing test records.
4. Confirm historical photos download only on request. Close/switch/logout during a slow response; no stale image or activity should reappear.
5. Verify server-side filters in both tabs, especially that date is original submission day in Asia/Manila.
6. Check keyboard tab navigation, visible focus, small-phone spacing and no horizontal overflow.
7. Spot-check Dashboard/Student Details audit access and Student attendance/activity behavior remain unchanged.

No hosted fixtures were created by this task. No migration or security-policy change is needed for these tabs; the already approved student-summary RPC remains a prerequisite.
