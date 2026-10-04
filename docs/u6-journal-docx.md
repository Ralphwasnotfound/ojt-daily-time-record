# U6.4E — Student Journal Word export

Local implementation. U6.4A through U6.4D.1 are approved; user manually accepted
Activity-based control visibility and real PDF/private photo behavior.

## Library and architecture

Exact MIT dependency `docx 9.8.1` generates genuine Office Open XML packages using
Document/Paragraph/TextRun/ImageRun/Table and Packer.toBlob. Runtime import occurs
inside generateJournalDocx, only when Download Word (.docx) is invoked. The adapter
itself is small; neither DOCX nor existing PDF runtime/fonts load at Journal startup.
Official APIs: https://docx.js.org/api/classes/Packer.html and
https://docx.js.org/api/classes/index.ImageRun.html . No HTML/RTF renaming, DOM
scraping, screenshot pages, altChunk, external conversion or document services.

Word runs through the existing shared controller and prepareJournalExport. Same
current authorized report, canExportJournal/requireJournalActivities, final scope
reread/consistency check, safe download/URL cleanup and cancellation behavior as PDF.
No independent queries or duration calculation. PDF filename remains the default;
exportFilename accepts pdf/docx explicitly with shared Student ID sanitization.

## Content and layout

A4 portrait, approximately 15mm margins, BSIT / TCC text branding, OJT Journal,
Student identity/program, selected Manila dates and distinct required/selected/
all-dates hours. Date headings, ordered exact Activity text/category/time/Edited,
embedded photos and attendance Session 1/2/Ongoing facts. Every represented empty
date in eligible ranges remains with exactly “No activity recorded for this day.”
Zero-Activity scopes hide all controls and reject before preparation, including
attendance-only scopes. Required hours never determine eligibility/date boundaries.

Text uses normal editable OOXML runs; meaningful spaces are preserved, tabs and
line breaks become native Word tabs/breaks. Unicode remains in XML. XML-incompatible
control characters/unpaired surrogates reject explicitly rather than rewrite data.
Common Arial Latin font with normal reader substitution; East Asian font is not
forced to Arial, allowing compatible fallback. No custom/proprietary font required.
Headings stay with following content, image/caption stay together, attendance rows
avoid splitting and remain with daily totals where practical. Long entries flow;
page count/spacing can vary between Word/LibreOffice/Google Docs and installed fonts.
No automatic upload/import to Google Docs. Recipient font coverage still affects
appearance, although original Unicode text remains in the document.

## Private photos and resource behavior

Unchanged U6.4C authenticated reader, correct sourceIndex proof association. Photos
OFF means zero export image reads; ON sequentially prepares authorized blobs in
browser memory. Shared U6.4D converter accepts validated JPEG/PNG/WebP, decodes and
converts all to JPEG quality 0.88, white transparency background, maximum edge1600,
no upscale/crop/stretch. DOCX converts prepared JPEG/PNG data to Uint8Array, embeds
actual bytes, scales proportionally within 540x280 document pixels, no source change.
This conversion is local; original Storage object and policies stay unchanged.

Shared limits: 31 inclusive dates, 500 Activities, 100 requested photos, 20MiB
prepared images, 24-million decoded pixel limit (checked after decode). No guarantee
against initial decoder memory or all phone-memory constraints. No silent truncation.
Unavailable proof continues with Activity text/neutral note and completion count.
Invalid internal prepared image structure rejects; normal blob conversion failures
are already handled by shared preparation. No persistent private cache.

Shared busy state blocks duplicates across formats; cancel/scope/account changes
suppress late downloads. DOCX packing cannot be interrupted during library CPU work;
eventual stale output is discarded. Download URL revoked after30sec or cleanup.
The final reread reduces staleness but is not a transactional snapshot.

No public/signed proof URLs, service-role credentials, attendance selfies/coordinates/
address, AI/provider request, external image/document service or CDN. Normal lazy
application chunks and authorized Supabase reads are the expected network activity.

## Validation and manual acceptance

16 DOCX integration tests cover genuine ZIP/OOXML entries/internal relationships,
editable exact text/Unicode/spaces/tabs/line breaks, metadata/hours, filenames,
eligibility, dates/empty messages/attendance, PNG/JPEG embedded bytes, image ratio,
shared WebP-to-JPEG conversion contract (browser decode mocked), photos ON/OFF,
association/concurrency/failure, duplicate/cancel/stale/revision handling, limits,
lazy import/private adapter and XML-invalid text rejection.
Generated package XML and relationships also parsed with Python ElementTree. A
synthetic two-page DOCX rendered in bundled LibreOffice; every page reviewed after
fixing East Asian font fallback and attendance-total pagination. This does not claim
real-account download, native edit/save/reopen, Microsoft Word or Google Docs tested.

Local manual acceptance:
1. Approved local Student, Activity Daily (Oct4 or another): photos checked, Download
   Word; open in Ubuntu LibreOffice Writer. Check identity, exact text, real photo,
   sessions/hours, proportions and selectable/editable text.
2. Photos OFF: clear Network and download; verify no export proof reads/media and
   complete Activity/attendance content. Existing on-screen photo reads independent.
3. Eligible mixed range: ordered dates, empty wording, attendance-only date, correct
   photos. Zero-Activity Daily/range: all export controls absent.
4. Edit a downloaded copy, save, reopen. Later test same file in Microsoft Word and
   optionally Google Docs import; no integration added.
5. Recheck PDF and Print ON/OFF, filenames, existing pagination; test rapid cancel/
   scope changes. Network must show only expected application/Supabase reads, no AI,
   external document/image service or public proof URL.

Future Complete OJT can reuse the same prepared facts, photos and eligibility, but
requires U6.4B.1 bounded reads. Not implemented; 31-day limit remains. Admin Journal
and AI remain untouched.

## Checkpoint files and change control

Created: src/services/journalDocx.js, tests/journalDocx.test.js,
tests/helpers/journalExportProof.jpg (synthetic JPEG fixture), this document.
Modified: journalExportModel.js (format extension only), journalExportController.js,
journalExport.js, JournalView.vue, journalExport.test.js, journalView.test.js,
journalExportEligibility.test.js, package.json/package-lock.json.

Dependency: exact docx9.8.1; 20 transitive packages added, npm audit0 vulnerabilities.
Tests inspect ZIP using docx's pinned JSZip transitive dependency only, never runtime
application code. No separate document-processing service/dependency installed.
No database, migrations, RLS, Storage policies, hosted/production change, staging,
commit, push or deployment. Existing local config/U6 AI/unrelated work preserved.
Stop after U6.4E.

Final checks: U6.4E16, eligibility5, PDF/Print26, U6.4C18, Journal UI22,
U6.4A19 tests passed. Existing frontend370 tests passed; npm test passed.
Production build and diff check passed; existing large-chunk warnings remain.
DOCX runtime emitted separate lazy403.24kB chunk (115.31kB gzip).
HEAD unchanged at8c1626721fa61de9a4541d8378930b5b3bc60451; staged set empty.
