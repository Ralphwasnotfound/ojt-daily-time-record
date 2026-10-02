# U4.3 — Student attendance selfie and location

U4.3 continues the interrupted implementation and connects the existing student
attendance page to U4.1/U4.2. Local implementation and automated validation only.
No migration, dependency, hosted deployment, Admin proof viewer or watermark added.

## Change manifest

Created during U4.3 (including the five interrupted source files):

- `src/components/AttendanceVerification.vue`
- `src/services/attendanceCapture.js`
- `src/services/attendanceLocation.js`
- `src/services/attendanceProofController.js`
- `src/services/supabaseAttendanceProofs.js`
- `tests/attendanceVerification.test.js`
- `tests/attendanceVerification.local.test.js`
- `docs/supabase-u43-attendance-ui.md`

Modified during U4.3:

- `src/views/student/AttendanceView.vue`
- `src/services/studentAttendanceMixin.js`
- `src/services/supabaseAttendance.js`
- `src/services/supabaseAttendanceController.js`
- `tests/supabaseAttendanceUi.test.js`
- `tests/studentAttendanceView.test.js`
- `package.json` (test command only)

The working tree also contains completed U4.1/U4.2 migrations, test adapters,
database tests and documentation from earlier phases. Those are preserved, not
new U4.3 changes. Activity source, Admin source, routes, auth and SQL are unchanged
by U4.3. The resumed work found complete source files but missing tests/docs; it
preserved the partial architecture and corrected narrow cleanup/retry cases.

## Camera and preview

Options API `AttendanceVerification` is a dedicated native modal dialog with
keyboard cancellation, named heading, permission context, status/error messages,
touch-sized controls, bounded viewport height and a scrollable narrow layout.
It does not reuse Activity's gallery component. No file picker exists.

`createAttendanceCamera` requests video only, with `facingMode: { ideal: 'user' }`.
An OverconstrainedError alone retries using any webcam. Denied, missing, busy,
insecure and unavailable cameras have friendly feedback. Video uses autoplay,
muted and playsinline. Generation checks stop late grants after cancel/unmount.

Capture uses actual video dimensions, preserves aspect ratio, caps the longest
edge at 1920 pixels without upscaling, and encodes JPEG at quality 0.85. Empty,
non-JPEG or over-5-MiB results are rejected before upload. The canvas does not
crop, mirror, recognize faces or add a watermark. Capture success and failure
both release tracks. A stale encoding cannot stop a newer camera generation.

Preview uses one object URL. Retake revokes it, drops the Blob and reopens the
camera. Cancel/unmount/pagehide revoke URLs and stop camera work. A hidden page
pauses a live preview and requires explicit Resume. No proof bytes are logged.

## Required location

Browser `getCurrentPosition` requests high accuracy, maximumAge=0, with a 15-second
browser timeout and independent timeout guard. Latitude/longitude must be finite
and in range; accuracy must be finite and nonnegative. Reject fixes older than
30 seconds or more than 5 seconds in the future. No geofence, accuracy cutoff,
IP fallback or default coordinates. Denial, unavailable, timeout and unsupported
errors allow retry/cancel. Abort ignores late callbacks. No reservation is prepared
until a valid fix is available. Exact coordinates are frozen for this attempt;
retries intentionally do not reacquire or change them.

## Prepare, upload and finalize

The trusted summary supplies only `time_in` or `time_out`. Time In Again is another
`time_in`; session ordinals and eligibility remain server-derived. Clicking the
page button opens verification without writing attendance. Continue runs:

1. Validate the captured Blob and obtain required location.
2. Generate one UUID and call `attendance_proof_prepare(request_id, action_type)`.
3. Retain returned upload/session identifiers and validate the exact reserved path
   against the currently authenticated owner.
4. Upload to private `attendance-proofs`, JPEG, `upsert: false`.
5. Call `attendance_proof_finalize(upload_id, latitude, longitude, accuracy)`.
6. Validate the immutable receipt's owner, upload/session/path, action, server time
   and exact submitted coordinates. Close the dialog and clear temporary state.
7. `confirmProof` refetches the trusted summary. Its changed snapshot reloads the
   existing bounded day history. Failed reads leave further actions disabled and
   preserve the successful receipt/notice for an explicit Refresh.

No client identity, official timestamp, arbitrary path or arbitrary session is
sent to finalization. The active frontend no longer exports/calls proof-free
Time In/Out methods. The shared attendance write tracker still serializes active
finalizations and lets subsequent reads await them.

## Retry and reconciliation

One controller retains request ID, Blob, coordinates, reservation, upload state
and finalization state. Duplicate Continue calls share the same work. Each API
request has a 20-second deadline, no automatic RPC retry, and account checks
before/after I/O. A timeout is unknown, not proof of failure.

- Lost prepare response: repeat the same request UUID to recover its reservation.
- Lost upload response: authenticated download and byte comparison first. Identical
  bytes can finalize; a missing object can be uploaded without upsert; conflicting
  bytes block the attempt and are never overwritten.
- Lost finalize response: read `attendance_proofs` by retained upload ID and
  refresh summary. If still unconfirmed, explicit Retry uses only that upload ID
  and the original coordinates. No new reservation/punch is created.
- Stale/expired/discarded reservations and authorization conflicts stop retry.
- REQUEST_CONFLICT is not retried with changed coordinates. Cancel can recognize
  the actual same-owner server receipt and refresh the UI without deleting or
  rewriting attached evidence.

## Cancellation, teardown and orphans

Cancel aborts location, prevents further finalization, and waits for in-flight
bounded work. An unknown prepare is recovered using its same ID. A potentially
committed finalization is checked before cleanup. Only successful
`attendance_proof_discard` tombstoning authorizes Storage removal at that exact
path. PROOF_IN_USE instead triggers receipt recovery. An already committed punch
cannot be undone by Cancel and is reported/refreshed as success.

Unknown cancellation keeps the attempt in the dialog and offers Retry Cancel.
Unmount/pagehide use best-effort cleanup after late I/O settles, with no new punch.
Account changes suppress stale UI and cross-account cleanup. Network loss, abrupt
tab/process closure, revocation or late SDK uploads can leave private unattached
objects/reservations. These require future authorized orphan maintenance; this
phase adds no purge job. Attached proof is never removed by frontend cleanup.

Attempt recovery is in-memory, not durable across hard reloads. No selfie/location
is persisted in localStorage. After a reload, inspect/refresh authoritative
attendance before starting another user-initiated action. The backend's immutable
reservations, locks and stale-intent checks remain the final protection.

## Validation

Existing local database was empty (zero users/sessions) with U4.1/U4.2 already
applied, so another destructive reset was unnecessary. All commands used only
the loopback stack and local Docker container; integration harnesses reject a
non-loopback Supabase URL and do not read frontend environment files.

Run database/integration suites sequentially because fixtures share the stack:

```powershell
npm run test:supabase
node --test tests/supabaseAttendanceProofs.local.test.js
node --test tests/supabaseAttendanceFinalization.local.test.js
node --experimental-vm-modules --test tests/attendanceVerification.local.test.js
npm run test:supabase:attendance
npm run test:supabase:activities
npm run test:supabase:realtime
npm test
npm run supabase:lint
npm run build
git diff --check
```

Results are recorded after final validation below. Existing obsolete proof-free
UI write tests were adapted to receipt/read reconciliation; mutation/error/retry
coverage now exercises the proof controller and real local service instead.

- Database: 10 files / 721 assertions passed, including U4.1 and U4.2.
- U4.1 local API/Storage: 13 tests passed.
- U4.2 local finalization: 11 tests passed.
- U4.3 real service/controller integration: 6 tests passed (5 scenarios + parent).
  Initial fixture lacked its required approving Admin; corrected the fixture,
  with no schema/security change, then all passed.
- Attendance concurrency: 7 tests passed.
- Activity/Storage/S6/S7 integration: 19 tests passed; Activity source untouched.
- Admin Realtime: 1 test passed on unchanged rerun. First run received zero of
  four expected events, matching the documented U4.1/U4.2 local transient. No
  assertion was relaxed; publication and active replication slots checked out.
- Frontend/unit: **260 tests passed**, including 49 dedicated U4.3 camera,
  location, preview, API and state-machine tests plus updated page/read-controller
  coverage. Zero failures, skips or cancellations.
- Schema lint: no errors. Production build: passed.
- Proof-free EXECUTE remains false for anon/authenticated; attachment and immutable
  triggers remain enabled. Publication includes attendance_sessions only.
- Fixture users, profiles, sessions, proofs, reservations and Storage objects:
  all zero after tests. No sensitive logging, debug globals or incomplete imports.
- `git diff --check` and new-file whitespace checks passed. Production build
  completed successfully; only a non-failing bundler timing advisory was emitted.

## Manual laptop and phone plan (not claimed executed)

Use a separately configured LOCAL frontend with local public URL/key and an
approved local test student. Do not use a hosted-configured dev server for this
check. Start `npm run dev` and open localhost (camera/location need a secure context).

1. Click Time In; confirm contextual permission copy and webcam permission prompt.
   Allow it, check undistorted live preview and Capture. Check captured preview,
   Retake, camera restart, capture again, then Continue.
2. Allow location; observe progress, modal close, server Time In and refreshed
   summary/history. Confirm camera indicator turns off after capture/closing.
3. Perform Time Out, Time In Again and final Time Out with fresh selfies/location.
   Verify two sessions; third Time In is unavailable and denied by the backend.
4. Cancel from camera and preview: no punch. Cancel during submission: safe cleanup
   or recovery of already committed attendance, never reversal/deletion of proof.
5. Deny camera, disconnect/busy webcam, and deny location separately. Verify useful
   errors, no punch, retry after changing permissions, and safe Cancel.
6. Throttle/drop connection during upload/finalize; Retry must retain the same
   attempt and produce at most one punch. Restore connectivity for Retry Cancel.
7. Navigate away, background, log out, and close during camera startup/capture:
   no remaining camera indicator, leaked preview or late UI restoration.
8. Check laptop and 360px/390px portrait widths, keyboard Tab/Escape, visible
   status/error text, scrollable modal, comfortable buttons and no horizontal
   overflow. Repeat physical front-camera/permission tests on Android over HTTPS
   in a separately approved environment; a non-localhost LAN HTTP URL is insecure.

Browser hardware permission prompts, real GPS behavior and physical phone layout
remain manual verification. This collects evidence, not biometric identity,
liveness, anti-spoofing or GPS certainty. Camera switching is deferred.

## U4.4 boundary / environment declaration

The existing canvas step is the future composition point. No placeholder/final
BSIT/TCC watermark was drawn. No Admin attendance-proof viewer was implemented.

Hosted Supabase changed: **no**. Vercel changed: **no**. Production data changed:
**no**. Proof-free RPC grants restored: **no**. U4.3 local-only: **yes**.
Watermark implemented: **no**. Admin proof viewer implemented: **no**.

## Manual-test follow-up: geolocation retry feedback

Inspection traced Retry through `AttendanceVerification.submit`, the proof
controller, `getAttendanceLocation`, and native `getCurrentPosition`. Before this
follow-up edit, a component-to-native-helper regression test already passed:
denial leaves location null, retains the selfie/request ID, clears busy in finally,
and the next Retry calls native geolocation again. A later successful callback
continues preparation/upload/finalization. The AbortSignal is not aborted by a
denial. No stale rejected promise or retry lock was demonstrated.

The confirmed application UX defect was that native PERMISSION_DENIED (code 1)
always mapped to the same site-permission advice. A fast repeated failure cleared
the progress state and restored the same message while the Retry button vanished
and reappeared, making a fresh denial look like no operation. The underlying
reason Chrome returned denial on the user's laptop cannot be established from
that message or site settings alone. The tested Chrome session was not available
through the browser connection; no OS setting was inspected or changed.

The targeted follow-up changes only these five files:

- `src/services/attendanceLocation.js`
- `src/services/attendanceProofController.js`
- `src/components/AttendanceVerification.vue`
- `tests/attendanceVerification.test.js`
- `docs/supabase-u43-attendance-ui.md`

Each native denial now optionally queries current geolocation permission, bounded
to 300 ms. Query absence, failure or timeout falls back to ordinary geolocation
feedback. The query never gates native requests, requests permission itself, or
installs a listener. A reported grant with another native denial gets distinct
device/browser guidance; a reported denial explains that the page still sees a
block. No browser error text, coordinates, media or secrets are logged.

Each location request now has a visible attempt number in progress and failure
messages. Retry remains visible but disabled/aria-busy while work is active. Old
errors clear immediately. A changed failure type replaces the previous advice.
Repeated denial offers Cancel/reload/recapture as troubleshooting, not as a claim
that Chrome always requires reloading. No automatic reload or lost-proof replay
was introduced. Exact coordinates remain immutable after successful acquisition.

The [Geolocation specification](https://www.w3.org/TR/geolocation/) distinguishes
user/system permission failures; the app cannot override them or reliably infer
the underlying OS cause from code 1. A site permission grant does not itself
guarantee a successful fix. Manual Chrome revalidation remains necessary.

Follow-up validation: 10 additional tests; **89 focused tests passed**, **270 total
frontend/unit tests passed**, production build passed, and whitespace checks
passed. Coverage includes native retry invocation, stale-error clearing, retained
selfie/attempt, duplicate prevention, denied-to-granted recovery, repeated denial,
unsupported/stalled Permissions API, changed errors, and cancellation. No existing
assertions were weakened. No database tests/migrations, U4.1/U4.2 backend, hosted
resources, or deployment configuration were changed for this follow-up.

## Manual-test follow-up: uncertain-result modal escape

The trapping path is confirmed in the component/controller: Cancel, X and native
Escape all call `cancel()`. A failed receipt read/discard returns false, so the
component deliberately neither emits close nor releases its preview. The flags
normally reset, but there was no safe alternative to repeating the same failing
network operation. Additionally, submission awaited a summary refresh after
receipt reconciliation; that unrelated read could retain the active-operation
lock if it stalled. A regression now reproduces that never-settling refresh.

This follow-up changes only:

- `src/services/attendanceProofController.js`
- `src/components/AttendanceVerification.vue`
- `src/views/student/AttendanceView.vue`
- `tests/attendanceVerification.test.js`
- `tests/studentAttendanceView.test.js`
- `docs/supabase-u43-attendance-ui.md`

Summary refresh no longer holds the submission lock. The bounded proof result
check still finishes before Retry/Cancel unlocks. Cancel attempts reconciliation
first; a committed receipt is success, and discard remains the atomic server-side
arbiter when no receipt was returned. Attached proof is never deleted. Once
cancellation begins, the controller becomes recovery-only: a failed delete or
discard cannot be followed by another upload/finalization.

If cancellation cannot be confirmed, `cancelFailed` exposes **Close for now**.
It is unavailable while submission/cancellation is active. Closing creates an
account-bound in-memory recovery checkpoint containing only the original request
ID, intended action, reservation identifiers/path and request-sent flags. It drops
the selfie, coordinates and preview URL, stops camera work, and performs no new
network operation or punch. Controller teardown cannot accidentally finalize or
discard after deferral.

The Attendance page then offers **Resolve previous verification**, including after
route navigation/remount. That opens recovery without a camera or submission
path; it can only recover an existing receipt or safely discard the original
reservation. If prepare's response was lost, recovery repeats its original request
ID before cleanup. Successful resolution clears the checkpoint. Another account
cannot open it. Repeated outages permit deferral again rather than trapping users.

Checkpoints last for this app/tab session, not a hard reload/browser restart.
The page explicitly asks users to keep the tab open without reloading until
resolved. No selfie/location persistence or new backend recovery API was added.
This fixes the modal escape strategy; it does not establish why the original
hosted/network operation could not be confirmed.

Validation: six added regression tests, **95 focused tests passed**, **276 complete
frontend/unit tests passed**, **6 existing local U4.3 integration tests passed**,
production build passed, and diff/whitespace checks passed. Tests cover stalled
summary refresh, released locks, failed Cancel, safe escape with media cleanup,
same-request recovery across view recreation, committed receipt recovery without
deletion, account isolation, no escape during an active finalization, and no
resubmission after cancellation begins. No U4.1/U4.2 backend, hosted resources,
Admin/Activity behavior or U4.4 work changed.
