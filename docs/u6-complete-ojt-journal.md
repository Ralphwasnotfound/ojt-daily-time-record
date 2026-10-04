# U6.4B.1 — Complete OJT Journal

Local-only implementation, following user approval of U6.4A through U6.4E. Third
scope Daily | Date Range | Complete OJT. Selecting Complete automatically loads;
refresh retains existing manual refresh pattern. No manual Complete date inputs.

## Authoritative boundaries

Inclusive Manila dates: earliest and latest of current public.activities.created_at
and public.attendance_sessions.time_in for auth.uid(). Four indexed endpoint reads
(two per table) produce two dates; no invented placement dates. Attendance Time Out
never extends boundaries: overnight records belong to Time In day. An open session
contributes its actual Time In date, never a synthetic today. Revision/update dates,
proof upload timestamps and AI records do not set boundaries. The linked-session
constraint means an Activity cannot literally exist without Attendance history,
but an Activity date may extend a boundary beyond all Attendance Time In dates.
No records => null/null period, zero days/hours, no export; no invented date.
Required Hours never sets/caps dates, duration, record count or eligibility.

## Narrow RPCs and authorization

New migration 20261012000100_u64b1_complete_journal.sql; historical migrations intact.
- journal_complete_period(): boundary metadata only.
- journal_complete_activities(page_size, after_created_at, after_id): <=100 Activity
  rows, explicit keyset cursor, chronological creation timestamp/UUID ties.
- journal_complete_attendance(day_limit, before_day): <=31 populated dates descending,
  <=2 session facts per day; explicit date cursor. Reuses authoritative completed
  epoch seconds (open zero), not Attendance evidence. Extra sessions reject explicitly.

All are security invoker with empty search_path, auth.uid identity, approved Student
gate, existing RLS and own-row predicates. No Student UID argument/Admin access or
browser service-role credentials. Foreign/mismatched/unpaired Activity cursors
rejected; Attendance cursor must match a caller-owned Time In date. Date cursors
identify dates, not users; a shared calendar date valid for own history is valid.
Anonymous execution revoked. No unrestricted arbitrary period/target RPC or writes.
Activity private paths are authorized internal associations only, not displayed,
not public URLs; no photo bytes in RPC. Attendance response explicitly projects
id/time_in/time_out/start_day/ordinal/completed seconds; no selfies/location/accuracy.
Existing journal_activity_range retains unchanged 31-day inclusive validation.

## Bounded reads and consistency

createJournalReader.prepareComplete uses the same reader machinery as prepare:
approved identity, per-request15sec deadline, abort/account/generation checks.
Complete ceiling: 3660 inclusive dates,10000 Activities,120sec total preparation.
RPC period enforces date ceiling/2000–2100 domain; client enforces record/time ceilings.
Ceilings reject explicitly; never truncate to a partial report. Activity paging is
100 records/request; Attendance paging31 populated dates/request. Failed, malformed,
repeated or out-of-order pages reject rather than return partial content.
Initial/final boundary reads must agree; assembled completed seconds must match
lifetime summary. Changed records may require Refresh. These checks reduce races,
but there is no transactional historical snapshot: edits between pages without
changing boundaries/totals can still occur. Exports reread the same Complete report
through existing controller and compare all prepared source facts/revisions.
Cancellation aborts active reads and suppresses stale completions; no subscriptions.

## Shared model, preview and exports

Same buildJournalReport, days/activities/sessions/internal sources/seconds fields.
Complete range has scope:'complete'; separate journalCompletePeriod builds dates;
journalRange stays capped31days. Every inclusive date remains present, including
attendance-only and wholly empty dates. Wording: “No activity recorded for this day.”
No absence, weekend, holiday, leave or missing-evidence inference.
Completed hours use authoritative session seconds and may exceed required hours.
UI includes Student identity/program, requirement, Complete period/completed hours
and total Activities. Empty history displays “No recorded OJT period yet.”
U6.4C on-demand View proof photo remains unchanged: no proof bytes fetched by load.

All formats reuse existing prepareJournalExport and PDF/DOCX/Print generators.
Scope metadata labels selected dates “Complete OJT”; safe filenames add Complete-OJT
before authoritative start/to/end. PDF/Word extensions and Daily/range filenames
unchanged. Shared canExportJournal still requires >=1 Activity, attendance insufficient.
Photos ON use approved authenticated reader/sequential preparation; OFF zero export
photo reads. Unavailable evidence keeps text/neutral note. No AI or outside services.

Export ceilings unchanged:500 Activities,100 requested photos,20MiB prepared images,
shared1600px JPEG conversion/max24million decoded pixels. Complete read can exceed
export capacity; export then explicitly advises photos OFF, and a shorter Date Range
if still too large. No implicit subset/truncation. Text-only >500 Activities cannot
export as one file in this checkpoint. Large date spans/DOM/documents still consume
browser memory; ceilings are not a guarantee on all devices. Packing CPU cannot be
interrupted midway; stale outputs are discarded. No independent Complete exporter.

## Validation

18 Complete frontend tests: separate period/range contracts,64-date continuity,
attendance/empty days, exact text, hours above486, null history,305 records/four pages,
multiple Attendance pages, malformed/failed pages, revision/period/totals consistency,
cancel/account/rapid scope switching, shared export dispatch/photos OFF, resource
limits,10001-Activity and total-time explicit refusal, real PDF and genuine DOCX beyond31dates.
Journal view24 tests include Complete scope inputs/period/count/hours/eligibility/
on-demand photos. U6.4E16, eligibility5, PDF/Print26, proof18 and report19 pass.
Existing frontend370 tests/npm test pass. Production build/diff check pass, existing
large main/PDF chunks warning remains. No dependencies added/changed.

51 focused SQL assertions validate own/anonymous/pending/rejected/Admin security,
no target overload, Activity/Attendance/mixed boundaries, empty history, Manila and
overnight semantics,251 records across3 Activity pages,37 Attendance dates across
2 pages, deterministic ties/microseconds, bad/foreign cursors, private associations,
no Attendance evidence fields, period ceiling. All14 SQL suites:906 assertions pass
in isolated schema-only local clone, with existing test helpers/bucket seeds/pgTAP.
Fixtures rolled back; real local development data was not reset or changed.
Only new migration applied to the local application database; not hosted.

## Local manual acceptance (pending)

1. Daily/Date Range/Complete controls available. Complete loads without date inputs;
   start/end correspond to actual Activity-created/Attendance-Time-In records.
2. Check Activity, attendance-only and empty dates inside period; exact neutral
   wording, chronology, requirement/completed distinction and no required-hours cap.
3. Network during Complete load: bounded data RPC pages only, no proof downloads.
   Click an individual View proof photo; verify correct private image/Hide/Retry.
4. Eligible Complete PDF/Word/Print ON: verify dates, exact text, images, attendance,
   hours and empty messages. Open Word in LibreOffice and edit/save/reopen a copy.
5. Photos OFF: no export proof requests in PDF/Word/Print. Zero-Activity Complete
   (if available): all export controls absent, attendance remains viewable.
6. Try cancel/scope switch while loading/preparing; no stale report/file/dialog.
   Large photo counts must give explicit photos-off/shorter-range guidance.
7. Recheck Daily and <=31-day Range behavior. Network permits authenticated Supabase
   reads/private proof retrieval and lazy app chunks; no AI, external image/document
   service or public proof URL. No Admin/Widgets/UI redesign work included.

## Checkpoint files and change control

Created: migration20261012000100, SQL014 test, tests/journalComplete.test.js, this doc.
Modified: journalReportModel.js, journalReportService.js, supabaseJournal.js,
journalPageController.js, JournalView.vue, journalExportModel.js (Complete period/
label/filename), journalExport.js (Complete validation dispatch),
journalExportController.js (large-export message), tests/journalView.test.js.
No dependency/package changes in this checkpoint. Existing local config, earlier
U6 migrations/AI experiments and unrelated work preserved. HEAD remains8c1626721fa61de9a4541d8378930b5b3bc60451;
no staging/commit/push/deployment/hosted/production changes. Stop U6.4B.1; no U6.4F/U7.
