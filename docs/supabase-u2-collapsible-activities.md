# U2 — Consistent collapsible Admin activity UI

## Scope and component boundaries

Frontend-only, Vue Options API. No RPC, schema, policy, authentication, roster,
attendance, activity-write or Storage changes. Student Dashboard, Student History
and student editing/reconciliation are excluded. U3 has not started.

- `ActivityDisclosure.vue`: controlled `expanded` prop/update event, summary and
  body slots, native keyboard-operable button, chevrons, `aria-expanded`,
  `aria-controls` and labelled region. Body uses `v-if`, never CSS-only hiding.
- `AdminActivityCard.vue`: read-only category, description, submission timestamp
  and existing `AdminActivityProof`. Its context slot lets AdminRecords retain
  edit indicators and revision metadata without adding page modes to the card.
- `AdminRecentActivities.vue`: Dashboard-only loading/controller, UID grouping,
  snapshot summaries and one open disclosure at a time.
- `AdminRecords.vue`: still owns filters, cursor pagination, Monitor modes and
  lazy revision requests. Logs remain a separate summary branch.

## Dashboard semantics

Requests `admin_activities({ page_size: 3 })`; never substitutes the UID-ordered
student-summary RPC. Groups only returned records by trusted `student_uid` in
their existing newest-first order. Equal names do not merge identities.

Collapsed summaries show name, Student ID, latest category/description excerpt,
Manila timestamp and current attendance. A multiple-record group says
“2 of the latest 3 updates” (using the actual returned snapshot size), never an
all-time total. A single record needs no count label.

Expansion uses those already-loaded records only. It does not fetch more
activities, images or revisions. Dashboard has no audit controls. The existing
View Activity Monitor link remains the route to complete monitoring.

## Student Details

Activities are visible immediately when the Admin selects the Activities tab.
There is no View/Hide Activities disclosure or extra student grouping layer.
AdminRecords receives `pageSize=5` and `collapseRecords=false`: the actual
`admin_activities` request uses `page_size: 5`, and all returned records render.
No Show More/Show Less appears in this list. ExpandableList's optional disabled
mode passes through records without a presentation limit; all other usages keep
its original default behavior.

Previous/Next retain server cursors and replace each page rather than accumulate
history. Filters reset to page one and retain the five-record server bound.
Category/date and existing filters, edit indicators and lazy edit history remain.
Nested revision reads retain their existing 25-record bound. Overview and
attendance are unchanged. No activity total is fabricated.

## Bounds and cleanup

| Context | Server bound |
| --- | --- |
| Dashboard | Latest 3 activities globally |
| Student Details | 5 activities per page |
| Activity Monitor | 25 students; 25 activities per expanded student page |
| Audit timeline | 25 revisions per page |

Pages replace rows rather than accumulate history. Photos and revisions remain
click-to-load. AdminActivityProof still owns object URLs and request-version
guards. Dashboard disclosure collapse unmounts children; page/filter replacement removes
old children; account/logout/unmount invalidate pending work. Late photo results
cannot create a visible URL after cleanup. Controllers retain generation/account
checks, so stale activity responses cannot repopulate removed histories.

Monitor Current Activities/Activity Logs tabs, grouping, filters, pagination and
chronological audit timelines remain intact. Only shared read-only content is
extracted; Monitor data loading and audit logic are unchanged.

## Responsive and accessibility behavior

Uses existing crimson/neutral styling, Lucide icons, wrapping flex layouts,
`min-w-0`, word-wrapped descriptions and minimum 44px disclosure controls.
Native buttons provide Enter/Space activation and visible keyboard focus.
Dashboard expanded content is mounted only while open. Student Details mounts
its activity list immediately on selecting the Activities tab.

## Local validation (revised Student Details)

- Focused Admin/U2 tests: **73 passed**, including Monitor/audit regressions.
- Complete frontend/unit suite (`npm test`): **198 passed**.
- Production build (`npm run build`): passed.
- `git diff --check`: passed (existing Git LF/CRLF notices only).
- Revised tests cover immediate Student Details activity loading, five-record
  requests/rendering, next/previous cursors, filter reset, no nested Show More,
  lazy proof/revision requests, cleanup on page/filter/student/tab/logout/unmount,
  and late responses. Dashboard disclosure and Monitor/audit tests still pass.

Tests use mocked clients and a Vue renderer. No hosted operations were performed.
Actual desktop/mobile browser layout and hosted data remain manual checks.

## Manual browser verification checklist

Use an authorized Admin account and existing records; no data mutation is needed.

1. Dashboard: confirm the approved latest-three snapshot remains grouped by UID,
   collapsed by default, with only one expanded group and truthful counts.
2. Student Details → Activities: records appear immediately, with no View/Hide
   Activities and no Show More/Less. Network request must use `page_size: 5`
   and the selected `target_uid`.
3. Confirm at most five activity cards, newest first. Next requests five using
   the last record cursor; Previous restores the preceding page. Filters reset
   to page one and still request five. No future page is prefetched.
4. Photos and revisions must make no requests until explicitly selected. Open a
   photo, then change page/filter/student/tab or logout; verify the image is
   removed and its blob URL revoked. Repeat with a throttled pending download.
5. Monitor: verify Current Activities/Activity Logs, filters, 25-student and
   25-activity pagination, View Changes and historical photos still work.
6. At desktop and narrow phone widths, check wrapping, no horizontal overflow,
   touch targets and keyboard access to filters, paging and photo controls.

Dashboard and Activity Monitor retain their existing collapsible presentation.
Student-side feeds are excluded. No backend changes, migrations, hosted
operations, deployment or U3 work are included.
