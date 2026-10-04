# U6.4C — Journal Activity proof visibility

Local implementation only. Adds Activity proof images inside the existing Journal;
no UI redesign, database/Storage/RLS change, attendance proof, AI, export or release.

## Retrieval and association

JournalView passes the exact `internal.sources[activity.sourceIndex].proofPath`
to JournalActivityProof. It never constructs paths from IDs or renders paths as
text. Description/category/time/revision/grouping and attendance model are unchanged.
The component receives only its private path; the same path binds the download and
rendered bytes. Replacing the report/proof cancels and clears the old viewer.

`journalActivityProof.js` reuses activityApi.download and validatePhoto. Existing
Supabase authentication/approved Student checks and private Storage RLS enforce
access. The existing download uses no-store and a 20-second request deadline.
The shared blob reader checks account identity before dispatch, after download,
and after decoding. It returns only a validated Blob, independent of Journal DOM,
so later export preparation can reuse it without screenshots or scraping.

No public or signed URL is created, bucket visibility/policies remain unchanged,
and no service-role credential, provider or external processing service is involved.
The internal path is necessarily used in the authenticated Storage network request;
it is not included in visible page text or image alt text.

## Loading, memory and lifecycle

Both Daily and Date Range use explicit on-demand View proof photo controls. This
avoids eager downloads and automatically scales to a future longer report. When
requested, an actual inline image appears, using contain/preserved aspect ratio,
responsive width and bounded height. No heavy crop, resize/recompression or
click-to-enlarge functionality was added. Native image lazy loading is supplemental;
the controlled Storage download is initiated by the user, not by an img URL.

The shared reader permits at most two concurrent download/decode jobs. Cancelled
queued work is removed without dispatch. An active existing activityApi download
may finish after cancellation; it keeps its concurrency slot until settled, and
its late bytes cannot become a displayed URL. This avoids claiming immediate HTTP
abort where the reused API does not expose an external signal. Per-view repeated
clicks while loading/visible do not redownload. Hiding then deliberately reopening
retrieves fresh bytes; there is no persistent cache or cross-session blob cache.

Each viewer retains one temporary URL while visible. Hide, path/account change,
scope replacement and unmount clear it. Validation's own temporary decode URL is
revoked by the reused validatePhoto helper. Stale results are checked before any
viewer URL creation. Browser image decode errors clear/revoke the URL and expose a
sanitized retry state. Selecting many photos deliberately retains their displayed
URLs; Hide releases them, and leaving/changing the report clears all viewers.

Loading/failure are independent per Activity. Failure says Proof photo unavailable
and offers Retry. Missing association says No proof photo available without implying
fraud. Current schema/U6.4A normally require proof references; the neutral component
state also supports an absent association defensively, without changing that model
or assuming missing historical bytes can be reconstructed.

## Deferred work

No PDF/DOCX/Print dependencies or export preparation. Later exporters can consume
validated blobs directly and add explicit bounded compression/total-memory budgets.
No attendance selfies/location/coordinates/address enter the Journal photo flow.
No AI/provider, CDN or external image processor receives bytes.

Complete OJT is NOT implemented. Required U6.4B.1 should introduce an approved
owner-derived whole-OJT activity scope using bounded keyset pagination and explicit
completion/large-report limits, then extend shared report/attendance range behavior
and UI. It must include all recorded Activities rather than stop at required hours.
This is a meaningful read-contract change; do not bypass the current 31-day limit.
The on-demand component and two-job reader can be reused without eagerly loading
hundreds of images. Required/completed hours remain separate progress fields.

## Validation and manual acceptance

18 focused proof reader/controller/Vue-render tests pass; 20 Journal UI tests and
19 U6.4A model/service tests pass. Existing frontend regressions pass 370 tests,
including Activity private-proof service/view lifecycle tests; npm test passes.
Production build passes with the existing large-chunk warning. No SQL suite is
needed because database behavior was untouched. No AI acceptance suite was run.

Tests cover exact association, temporary image display, loading/failure/retry,
no-proof, account/path/stale cleanup, URL revocation, queued cancellation, eight
requested photos with two active jobs, independent failures, and initial no-download
rendering. Journal UI tests now mock the reusable proof component for page-only
render assertions; focused proof tests compile/render the real component separately.
Mock/SSR results do not establish a real local Student photo download or responsive
browser acceptance.

Manual local acceptance (use your existing approved LOCAL Student account):
1. Open Daily Journal with existing Activities; tap View proof photo. Compare each
   visible image with the existing Activity History proof viewer.
2. Open several photos, hide/reopen one, then change dates/ranges quickly. Verify
   correct associations and that prior photos disappear. Check phone and desktop.
3. Safely simulate offline/blocked Storage request, then restore access and Retry.
   Do not delete objects/change policies to manufacture failure. A genuine missing
   association should show neutral no-proof state if such data is available.
4. Check no Storage path/UUID is visibly rendered. Clear the Network log and request
   photos: authenticated Supabase Storage is expected only on demand; no Groq,
   Cloudflare, AI endpoint, third-party image processor/CDN is expected.
5. Navigate away/log out; old images must disappear and stale responses must not
   restore them. AI remains disabled; export controls remain absent.

Existing private Activity/Admin proof components, config, migrations and AI artifacts
are preserved. No permanent fixtures, staging, commit, push, hosted change or deploy.
Stop at U6.4C; the next checkpoint requires explicit approval.
