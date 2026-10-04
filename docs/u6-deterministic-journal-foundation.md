# U6.4A — Authorized reads and shared deterministic Journal model

Journal content is derived from Student-recorded Activities and does not use AI.
Local foundation only: no Journal page/navigation, photo retrieval, export library,
PDF/DOCX/print, Admin Journal, saved report snapshot or hosted release.

## Data and authority

`journal_activity_range(from_day,to_day,page_size=50,after_created_at=null,after_id=null)`
is a SECURITY INVOKER read-only RPC. It derives ownership from auth.uid(), requires
existing approved-Student state, and queries RLS-protected current activities.
Admin, pending/rejected Students and anonymous callers are denied. No Student UID
argument or identity overload exists. PUBLIC/anon execution is revoked; only
required authenticated execution is granted. Existing tables/policies and U6.2/
U6.3 migrations remain untouched. No new content tables or indexes are needed.
The existing student/created_at/id index supports the ascending scan.

Dates are calendar dates in Asia/Manila, 2000-01-01 through 2100-12-31. Both
endpoints are inclusive; SQL uses start midnight inclusive and the midnight after
end exclusive. Daily uses identical endpoints. At most 31 calendar days; invalid,
null, reversed and oversized ranges fail, never clamp. SQL date/UUID/timestamptz
types reject malformed inputs; the frontend additionally validates ISO calendar
strings without browser-local timezone assumptions.

Returns `{activities:[{id,created_at,category,description,revision,updated_at,
photo_path,attendance_session_id}],next:null|{created_at,id}}`. Page size 1–100,
chronological created_at ASC/id ASC, one-row lookahead, explicit continuation.
Cursor pairs must be complete and match an own row inside the selected range.
Stable data yields complete, duplicate-free pages. No 30-activity AI ceiling.
No raw revision history is fetched. History-page filtering is not used.

## Shared service and model

`createStudentJournalReader()` wires existing trusted `readProfile` and
`getAttendanceSummary` to the range RPC and existing `attendance_days` RPC.
Every preparation checks approved account identity before/after reads. Cancellation
and a superseding preparation discard late results. Requests have bounded deadlines;
RPC retries are disabled. Cancelled underlying profile/summary reads may finish,
but cannot publish a stale report. No image, provider or mutation API is used.

`prepare(from,to=from)` fetches all activity pages and validates strict order and
continuation, including PostgreSQL microseconds (Date.parse alone loses precision).
Attendance starts before the day after end, pages backward, and stops once it has
covered start. The existing day reader can return up to 31 bounded older days in
the final page; only selected dates enter the report. No whole-history download.
Failures throw rather than returning partial success. No total activity ceiling is
silently imposed. Preparation memory scales with selected activities; later export
budgets must explicitly reject excessive work rather than truncate it.

Model shape:

```
{schemaVersion:1,
 student:{fullName,studentId,program,requiredHours},
 range:{from,to,timezone:'Asia/Manila'},
 days:[{date,activities:[{sourceIndex,createdAt,category,description,edited,updatedAt}],
        sessions:[{ordinal,timeIn,timeOut,completedSeconds,status}],completedSeconds}],
 selectedRangeCompletedSeconds,lifetimeCompletedSeconds,
 internal:{sources:[{id,revision,proofPath,attendanceSessionId}],consistency}}
```

Every selected day exists, including empty and attendance-only days. Exact stored
Unicode/case/punctuation/line breaks/outer whitespace are preserved without trim,
rewriting, HTML conversion or instruction interpretation. Future renderers must
use plain text and select presentation fields explicitly; never export `internal`.

Private proof paths are internal references needed for existing authenticated
Storage downloads later. They confer no public access; Storage RLS continues to
check ownership/approved role. No URLs, blob bytes or public bucket changes occur.
Current descriptions and proof references originate in the same activity row.

## Attendance and revisions

Reuse U3 server-returned daily/session completed_seconds; sum unrounded numeric
seconds for the range. Preserve fractional seconds. Lifetime seconds come from
existing trusted attendance_summary and remain distinctly named. No JavaScript
Time Out minus Time In calculation. Both session ordinals remain explicit; open
sessions contribute zero, breaks are excluded, and cross-midnight sessions belong
to their Time In Manila date. Activity grouping instead uses Activity created_at.
Historical proofless sessions remain valid. Selfies/location/address/proof metadata
are excluded by explicit model projection.

Each future preparation reads current activity revisions. Earlier returned models
are not overwritten by later edits. Source IDs/revisions/proof references allow
later consistency validation. Multi-request preparation is NOT a transactional
snapshot and does not promise reproducible historical exports. Later U6.4C must
validate source consistency before export. AI generation/version/source tables
remain preserved and deferred, not repurposed or initialized by this service.

## Validation

19 focused Node service/model tests pass: exact text, 101-row multi-page retrieval,
failed-page atomicity, precise timestamp ordering, Manila boundaries, date limits,
profile projection, revisions/proofs, attendance-only/empty days, fractional totals,
overnight/open sessions, account cancellation and no provider/Storage dependencies.
41 focused pgTAP assertions pass for authorization, date boundaries/ranges, cursors,
page caps, tied ordering, current edits/proof association and existing attendance.
All 13 local SQL suites pass 855 assertions (814 existing + 41 new). Existing
frontend regressions pass 370 tests across 11 files; npm test also passes. Vite
production build passes with the existing >500 kB chunk warning.

SQL testing used a disposable schema-only local database, with synthetic fixtures
rolled back. Application development records were not copied or modified. Restore
warnings concerned platform-owned extension/realtime/default-privilege objects;
application authorization/contracts were exercised by the suites. The migration
was applied only to that validation database; the development stack migration
history and hosted history were not advanced. No local reset was performed.

No AI acceptance tests/provider calls, export dependencies, staging, commits,
pushes, hosted changes or deployment. U6.4B requires separate approval.
