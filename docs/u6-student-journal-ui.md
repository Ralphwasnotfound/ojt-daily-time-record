# U6.4B — Student OJT Journal UI

Local implementation only. Journal content comes directly from recorded Activities
through the approved U6.4A service/model. No rewriting, provider initialization,
photo retrieval, export functionality, Admin Journal or hosted release.

## Page and navigation

`/student/journal` is a child of the existing guarded Student route/layout.
Existing role/status guards and server authorization remain authoritative.
Student navigation adds Journal/BookOpen after Activity Update; WorkspaceLayout's
shared icon registry handles desktop sidebar/mobile drawer and active styling.

JournalView consumes only `createStudentJournalReader().prepare(from,to)`.
Initial Daily date uses the centralized U6.4A Manila day helper. Daily loads once
on mount; account changes clear/cancel the old controller and recheck eligibility.
Daily/Date Range controls invalidate old previews immediately on selection changes.
Load/Refresh submits the selected dates. Frontend errors explain missing/reversed/
invalid/over-31-day ranges, while the existing server limit remains authoritative.
No silent clamping. Loading and sanitized recoverable errors use status/alert roles.
A controller generation counter suppresses stale loads, even if an underlying
request ignores cancellation. Unmount clears pending work and private model data.

Preview shows trusted name, Student ID, program, required hours, selected dates,
chronological current activities and attendance. Activity interpolation is plain
Vue-escaped text with whitespace-pre-wrap; no HTML/Markdown parsing or auto links.
Official time and edited status remain separate from the exact description.
Proof association produces only "Proof photo recorded". No path/UUID/image URL is
rendered; no proof component, Storage call, blob, signed URL or image preparation.

Session 1/2 Time In/Out use existing Manila formatters. Overnight Time Out includes
its actual date; open Time Out says Ongoing. Daily/range/lifetime durations format
existing authoritative model seconds with the existing duration helper. No elapsed
timestamp subtraction. All-dates lifetime hours have a distinct label. Attendance
selfies, coordinates, location/address and internal proof metadata are omitted.

Attendance-only days show sessions and "No activities recorded for this date".
Daily with no data shows "No journal records for this date". Range previews show
only days containing activities/attendance, plus a compact count of selected empty
days; completely empty ranges show one neutral empty state. The shared model is
not altered or truncated by this display choice.

ActivityEditor now explains exact Journal reuse and adds concise confidentiality
guidance, linked to the textarea via aria-describedby. Schema, validation and the
1–500 Unicode-character limit are unchanged. Existing private proof components
elsewhere are untouched.

The small secondary AI Journal Generator card says Coming Soon. Its Generate
button is disabled and has no click handler, AI import or endpoint. PDF/DOCX/Print
controls are omitted until their approved checkpoints; no export dependencies.
Mobile controls/cards use existing brand styles, touch-friendly sizing, labels,
headings, pressed/disabled states and explicit focus styles. Desktop grids expand
within the existing layout. Real browser/responsive acceptance remains pending.

## Local migration

The existing U6.4A migration was unchanged. `npx supabase migration list --local`
confirmed it was the only pending migration. `npx supabase migration up --local`
applied only `20261011000100_u64a_journal_reads.sql` to the normal development stack.
No reset or hosted/linked command was used. Local history now includes
20261011000100; SQL verification confirms authenticated EXECUTE=true, anon=false.
41 focused pgTAP assertions then passed on the development stack using synthetic
fixtures inside a rolled-back transaction. No existing development rows changed.

## Automated validation

- 20 U6.4B Vue SSR/controller/wiring tests passed.
- 19 U6.4A service/model tests passed.
- 41 U6.4A SQL assertions passed against the migrated normal local stack.
- Existing frontend regressions: 370 tests passed across 11 files; npm test passed.
- Production build passed; existing >500 kB chunk warning remains.
- Diff whitespace check passed.

Tests cover exact escaped Unicode/newlines, ordering, scopes/default date,
validation, attendance/overnight/empty states, totals, stale response/access
revocation, static proof indication, disabled AI, navigation and Activity guidance.
They do not establish real OAuth/browser/mobile acceptance. No AI experiments run.

## Manual local acceptance

Use an already-approved LOCAL Student account and existing local records. An Admin
account will remain governed by the normal Admin route guard. No credentials need
to be shared with Codex; no permanent fixtures were created for this checkpoint.

1. Run the existing localhost frontend and sign in manually as the local Student.
2. Open Journal through desktop navigation/mobile drawer; verify default Manila day.
3. Select a Daily date with existing activities. Compare category/text/newlines/
   official time to History and confirm Edited where applicable.
4. Load a Date Range including existing attendance. Check both sessions, ongoing
   Time Out, overnight date, daily/range totals and distinct all-dates total.
5. Check an empty date and attendance-only date where available; test 31 days and
   a 32-day/reversed/missing selection. Change selection during a slow load.
6. Verify narrow-phone and desktop readability, focus/keyboard controls, no exposed
   paths/UUIDs and disabled Coming Soon AI. Exports should be absent.
7. Clear the browser Network log on the Journal page and reload. Reads should use
   existing profile/attendance APIs and journal_activity_range; there must be no
   Storage image requests or journal-generate/Groq/Cloudflare requests.

Stop at U6.4B. U6.4C needs explicit approval. All U6.2/U6.3 experiments, provider
architecture and existing local-only config changes remain preserved. Nothing
staged, committed, pushed, deployed, installed or changed on hosted/production.
