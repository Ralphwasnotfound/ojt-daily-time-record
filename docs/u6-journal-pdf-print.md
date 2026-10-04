# U6.4D — Student Journal PDF and Print

Local implementation only. U6.4C real private photo visibility was manually accepted
by the user. Download PDF and Print now consume the same authoritative U6.4A report
shown in the Journal. No DOM text scraping, screenshot, AI, DOCX, Complete OJT,
Admin export or database change.

## Dependency and data flow

Installed exact pdfmake 0.3.11 (MIT) using `npm install pdfmake --save-exact
--ignore-scripts`. Both runtime and bundled Roboto virtual fonts use dynamic imports
inside the PDF action. Vite emits separate lazy runtime/font chunks; normal Journal
startup does not initialize/load them. No CDN or remote fonts/document API.
Official integration: https://pdfmake.github.io/docs/0.3/getting-started/client-side/
Official project/license: https://github.com/bpampuch/pdfmake

The UI defaults Include Activity Photos to checked and adds real Download PDF,
Print and Cancel export controls. An exporter captures the current shared report,
projects only presentation facts, prepares photos, then rereads the same selected
scope through createStudentJournalReader and compares the complete report. Changed
activity revisions/proof associations/profile/attendance facts reject completion
with a refresh message. No new query contract or independent duration calculation.
This check reduces race exposure; it is not a transactional/finalized historical
snapshot and cannot eliminate changes after the final read. Report scopes remain
Daily/31-day maximum Date Range. No Complete OJT workaround.

Export model keeps exact descriptions, punctuation/case/Unicode/line breaks and
stored whitespace; pdfmake preserveLeadingSpaces and Print white-space:pre-wrap
retain presentation whitespace where supported. No HTML/Markdown/auto-link parsing.
Internal source IDs, paths/revision IDs, sessions' private evidence/location and
profile extras never enter the prepared document model. Filenames sanitize the
Student ID and include Daily date or start_to_end dates, never private proof IDs.

## Photos, limits and cancellation

Photos use the reusable U6.4C readJournalActivityProof reader, not existing img DOM.
Preparation is sequential (one export photo at a time); the shared reader still
limits total download/decode jobs to two, including on-screen requests. OFF does
zero export proof retrieval. Missing references are neutral; unavailable/invalid
photos retain the activity and add an unavailable note plus completion count.

Validated blobs are decoded locally into temporary canvas copies. Retain aspect
ratio, maximum edge 1600 pixels, JPEG quality 0.88 with white transparency background;
no upscaling/cropping. Stored originals are never changed. Images exceeding 24
million decoded pixels are skipped as unavailable. This dimension check is after
browser decoding, not protection against all initial decoder allocation. Conversion
has a 15-second bounded load deadline and cleans decode URLs on success/error/cancel.

Explicit total limits: 500 activities, 100 requested photos, 20 MiB aggregate
prepared image bytes. These reject the whole oversized export with a shorter-range/
photos-off message, never silently truncate. Prepared base64/canvas/library overhead
adds memory beyond encoded bytes; limits are conservative initial bounds, not a
universal phone memory guarantee. No persistent private cache or external processing.

Controller blocks duplicate actions. Scope/refresh/account/unmount cancellation
invalidates work and removes print/download resources; stale output cannot trigger
save/print. Existing active Storage requests may settle later within their deadline.
PDF library generation cannot be interrupted midway; its eventual output is
suppressed if stale. Download blob URLs are revoked after 30 seconds or cleanup.

## PDF and Print layout

Real pdfmake PDF bytes, A4 portrait, text branding BSIT / TCC (no decorative-logo
network dependency), student identity/program/required hours, selected dates/timezone,
selected completed vs all-dates completed hours, chronological daily activities,
Edited, optional embedded image bytes, Session 1/2 and Ongoing Time Out. Overnight
Time Out includes its actual date. Daily/range totals use authoritative seconds
and existing duration formatting, never timestamp subtraction or rounded sums.
U6.4D.1 retains every represented date, with “No activity recorded for this day.”
on dates without Activities and attendance where present. No forced page per empty day.

Repeated running header/footer includes generated Manila time and PDF page numbers.
Activity table heading stays with content and can repeat for long entries. Images
fit a bounded rectangle without stretch and have a contextual caption. Attendance
heading/table stays together and includes its date if it moves to a following page.

Print builds a dedicated same-origin iframe from prepared report facts using
textContent nodes only; sidebar/navigation/buttons/AI card cannot enter it. A4 print
CSS preserves descriptions, constrains photos, and controls section breaks. It waits
for images and fonts before print; cancellation removes the frame. afterprint clears
it, with a five-minute lifetime fallback for mobile browsers omitting that event.
Browser headers/footers/page numbering and mobile print availability remain browser
controlled. Print bytes stay in the iframe and are removed on close/cancel/cleanup.

Bundled Roboto covers Latin accents and other supported Unicode. A cmap check
rejects unsupported glyphs (for example this bundle's Japanese/emoji) instead of
silently substituting missing-glyph boxes; the UI recommends Print / Save as PDF,
which uses installed browser fonts. Exact original strings remain untouched.
Arbitrary Unicode output depends on font coverage; additional fonts are deferred.

## Validation

25 focused integration tests pass: genuine pdfmake bytes (%PDF), metadata/filename,
exact Unicode/line breaks, order, required/selected/lifetime hours, Session 1/2,
overnight/open attendance, photo OFF zero reads, exact proof association, eight
sequential photos, failures/no-proof, explicit limits, aspect ratio and decode URL
cleanup, revision recheck, duplicate/cancel/stale handling, isolated Print readiness/
cleanup, lazy imports and privacy projection. No library-internal assertions.

U6.4C 18, U6.4B 20 and U6.4A 19 focused tests pass. Existing frontend regressions:
370 tests across 11 files pass; npm test passes. Production build and diff check
pass. Large main/lazy chunks retain size warnings. SQL tests not run: no DB change.

A synthetic genuine three-page A4 PDF with embedded 640x320 test image was parsed
with pdfinfo/pdftotext and rendered with Poppler. All pages visually reviewed after
correcting an orphaned activity heading and split attendance table. Real local
Student PDF downloads, private photo export and native Print dialog remain manual
acceptance; synthetic/DOM-mock tests do not claim those passed.

## Manual acceptance

Using the existing approved LOCAL Student account and recorded local Activities:
1. Daily PDF: leave photos checked, download/open the actual PDF; compare identity,
   exact text/photos to Journal/History; verify attendance and distinct hours.
2. Photos OFF: clear Network, uncheck, download; no export Storage bytes should be
   fetched. Existing separately clicked on-screen photos are independent.
3. Range PDF: test several days/photos, edited records, attendance-only/empty days,
   overnight/Ongoing, chronology, image proportions and page boundaries.
4. Print ON/OFF: verify report-only content in Print Preview/Save as PDF, no shell,
   buttons/AI; correct text/photos/hours and A4 settings. Test desktop/phone viewport.
5. Rapid scope change/Cancel while preparing; no stale file/dialog should appear.
   Safely block a Storage request to check unavailable-photo continuation; restore
   connectivity and retry. Do not delete objects/change policies to test failures.
6. Network may show same-origin lazy PDF/font chunks and authenticated Supabase
   reads when needed. No public proof URL, Groq/Cloudflare AI, external document or
   image-processing service. Unicode outside bundled PDF fonts gets an explicit
   Print alternative, never silent source rewriting.

Future DOCX can reuse prepared presentation facts/photos and existing export limits;
not implemented. Complete OJT still needs the separately approved U6.4B.1 bounded
read extension, not a required-hours cutoff. Local-only config, migrations, AI work
and earlier uncommitted work preserved. Nothing staged, committed, pushed, deployed
or modified on hosted Supabase/production. Stop at U6.4D.

## U6.4D.1 eligibility update

User confirmed real local Student PDF download after U6.4D. This small checkpoint
adds `canExportJournal(report)` in journalReportModel, shared by the UI and all
export formats. Eligibility requires at least one Activity somewhere in the scope;
attendance, required hours and proof availability do not grant eligibility.
`requireJournalActivities` provides the same defensive guard at preparation, PDF
and Print entry points. The controller refuses before any photo preparation and
uses a neutral application message. DOCX and Complete OJT can reuse this contract;
neither is implemented and the 31-day limit remains.

Daily and Date Range zero-Activity selections hide the whole export section,
including the photo option. Preview remains visible with dated neutral empty-day
messages and existing attendance. Eligible ranges retain every model date in PDF
and Print instead of dropping empty dates. Photos, text, seconds, authorization,
image conversion and dependency versions are unchanged.

Local manual acceptance still required for this checkpoint:
- Activity Daily: PDF/Print/photo controls visible; PDF downloads as before.
- Empty Daily and attendance-only Daily: controls absent; exact neutral message;
  attendance remains when present.
- Mixed range: controls visible; PDF and Print retain each empty date with the
  exact message and attendance where present; check compact page boundaries.
- Zero-Activity range, including attendance-only: controls absent.
- Return to Activity day and export photos ON/OFF; real private photo still works.

Checkpoint files: modified journalReportModel.js, journalExportModel.js,
journalExportController.js, journalPdf.js, journalPrint.js, JournalView.vue,
journalExport.test.js, journalView.test.js and this document. Created
journalExportEligibility.test.js. No dependency, database or hosted change.

U6.4D.1 validation: eligibility 4, export 26, Journal view 22, proof 18 and
report 19 tests pass. Existing npm frontend suite passes (370 individual tests).
Production build and diff check pass; existing chunk-size warnings remain.
Synthetic three-page PDF regenerated and all pages visually reviewed; the retained
empty date/message fits compactly after attendance, without a forced empty page.
No SQL tests required because database behavior was not changed.
