# U4.1 — Attendance proof database and Storage foundation

Historical phase record: U4.2 now revokes proofless browser RPC access in the local
schema. See [U4.2 finalization](supabase-u42-attendance-finalization.md) for current
enforcement, reconciliation, tests and the U4.3 deployment gate. The U4.1 migration
itself remains unchanged.

Local-only, additive foundation. No hosted push/deployment. No frontend changes,
camera UI, geolocation acquisition, watermark, Admin UI, or U4.2 finalization.
The existing U3 `attendance_time_in()` / `attendance_time_out()` are unchanged and
still accept punches without proof. There is deliberately no partial cutover.

## Approved product decisions

- Attendance will use live selfie/face capture only: front camera preferred on
  phones, available webcam on laptops. No attendance gallery/file picker.
- Location will be required for both actions. No accuracy cutoff has been invented.
- The server punch timestamp is official. A later canvas watermark can show
  clearly labeled capture information, not pretend to contain the future commit time.
- Approved students may read their own evidence; approved Admins may inspect it.
- Existing attendance is valid without proof. Do not backfill fabricated proof.
  At enforcement cutover, a legacy open session needs proof only for its future Time Out.

## Migration and tables

Migration: `supabase/migrations/20261007000100_u41_attendance_proof_foundation.sql`.

`public.attendance_proofs` stores:

- UUID proof ID, session ID, authenticated owner UID, action (`time_in`/`time_out`).
- Unique object path and unique upload reservation ID.
- Official punch timestamp, finite bounded latitude/longitude, finite nonnegative
  accuracy in metres, and server-generated attachment timestamp.
- Unique `(attendance_session_id, action_type)` permits one proof for each punch.
- Composite session/owner FK prevents cross-student attachment.
- Composite reservation FK binds upload, owner, session, action and path exactly.

No session ordinal is stored. Attendance grouping, durations, and Days Present
still derive from `attendance_sessions.time_in` / `time_out`, never proof dates.
Latitude is [-90,90], longitude [-180,180]; accuracy excludes negative, NaN and
infinite values but has no product rejection threshold. Browser coordinates remain
client-reported evidence, not cryptographically trusted presence.

`private.attendance_proof_uploads` stores owner, unique owner/request ID, immutable
action and intended session UUID, exact path, latest-session snapshot, today's
start count, Manila preparation day, lifecycle state, creation and expiry.

Time In preallocates a session UUID without inserting attendance. Therefore its
intended session cannot yet have an attendance FK. The final proof has the composite
FK. Time Out preparation selects the caller's exact currently open session.
The latest-session snapshot lets U4.2 reject a stale Time In after another tab
completes an intervening session even if attendance is OUT again.

## Public RPCs (authenticated only)

`attendance_proof_prepare(request_id uuid, action_type text)` returns a row with
`upload_id`, `attendance_session_id`, `photo_path`, `expires_at`.

- Derives UID from `auth.uid()` and locks the trusted approved-student profile.
- Rejects Admin, pending/rejected, missing identity, null request and invalid action.
- Time In requires OUT and fewer than two starts on the current Manila day.
- Time Out requires an open session, including a carried-over previous-day session.
- Pending, unexpired, still-valid retries return the exact existing reservation.
- Reusing a request for a different action fails `REQUEST_CONFLICT`.
- Changed expected state fails `ATTENDANCE_STATE_CHANGED`; a Time In retry across
  Manila midnight also requires fresh preparation. Time Out remains tied to the
  same open session across midnight.
- Terminal/expired retries fail `UPLOAD_EXPIRED_OR_DISCARDED`; no silent renewal.
- Preparation never changes presence, start count, official time, or Admin signals.

`attendance_proof_discard(upload_id uuid)` returns the allocated path.

- Locks the same approved-student profile, then the caller's reservation.
- Pending/expired reservations can become discarded; repeated discard is safe.
- An attached reservation/proof fails `PROOF_IN_USE`.
- The browser can then call Storage remove for that exact path. The RPC does not
  delete Storage metadata/bytes directly.

Expiration is derived from `expires_at` (one hour), not a background state update.
Lifecycle: pending -> attached OR pending -> discarded. Neither terminal state
can return to pending. Reservation identity and intent cannot be edited.

## Private Storage and authorization

Bucket `attendance-proofs`: private, 5 MiB maximum, JPEG/PNG/WebP.
Path: `<student-uuid>/<intended-session-uuid>/<upload-uuid>/proof`.
No names, emails, Student IDs or coordinates appear in paths.

- INSERT: approved owner, exact pending/unexpired reserved path, matching Storage owner.
- SELECT: approved student can read their own reserved objects (including pending
  objects for retry checks and discarded objects for deletion reconciliation).
  Approved Admin can read only paths attached to proof records.
- DELETE: approved owner, exact discarded reservation, no attached proof.
- No UPDATE policy: no overwrite/upsert/replacement/move of attached bytes.
- Anonymous, pending/rejected and cross-student access are denied.

Proof metadata grants SELECT only, guarded by owner/approved-Admin RLS.
Reservations have no browser table privileges. Helpers use an empty search path
and no public EXECUTE grant; only the Storage policy predicate is executable by
authenticated clients. No proof/location table is added to Realtime.

Use future authenticated blob downloads, not public URLs. No service-role browser use.
Activity's bucket, reservations, editable versions and revision history remain separate.

## Immutable attachment foundation (not an attendance finalizer)

There is **no public proof INSERT privilege or attachment/finalization RPC**.
Private triggers defend a future trusted insertion:

1. Match and lock the reservation; require pending and unexpired.
2. Match an existing session owned by the student and its exact authoritative
   Time In or Time Out timestamp (including a session mutated earlier in the same transaction).
3. Verify Storage object path, owner, allowed MIME metadata and nonzero size <=5 MiB.
4. Set `attached_at` from the server.
5. After insertion, mark that reservation attached in the same transaction.

These triggers do not insert/update attendance. A failed constraint/trigger rolls
back proof insertion and attachment together. UPDATE/DELETE of an attached proof
raises `IMMUTABLE_ATTENDANCE_PROOF`, even from ordinary trusted SQL. A future
correction mechanism is separately designed; there is no Activity-style replacement.
Privileged maintenance can bypass database protections, as with any PostgreSQL schema.

## Exact U4.2 boundary — not implemented

U4.2 must introduce a trusted attendance finalizer and coordinate its frontend cutover:

1. Authenticate and lock approved profile first, then reservation, then bound session
   and Storage object in consistent order. Recheck approval after lock acquisition.
2. For an already attached matching request, return the immutable receipt for
   uncertain-response reconciliation without creating another punch.
3. For pending: recheck expiry, expected latest session/state, current open session,
   Manila day and two-start limit. Never retarget a stale reservation.
4. Validate required structured location, uploaded object ownership/type/size,
   and approved capture metadata policy. Browser timestamps never set attendance time.
5. Take official server time after locking. Insert the preallocated Time In session
   or close the exact reserved Time Out session, preserving U3 invariants.
6. Insert the immutable proof with that same session timestamp. Existing private
   triggers validate it and attach the reservation. **All database writes are one transaction.**
7. Return an authoritative receipt; retain request ID and reconcile lost responses.
   Never automatically allocate a new punch after an uncertain response.
8. Gate/revoke the old no-proof write path at enforcement cutover. Leaving it callable
   would bypass mandatory evidence. U4.1 deliberately does not perform that cutover.

No Time In reservation itself creates an open row. A U4.2 transaction must roll back
attendance if proof validation/insertion fails. Uploaded unattached objects can
then be discarded. Existing attendance INSERT/UPDATE signals continue to trigger
Admin trusted refetches; do not publish proof metadata or coordinates.

## Orphans, retention and limitations

- SQL metadata and Storage bytes are not a distributed transaction. Upload-first,
  atomic database finalization and deletion policies protect the normal flow, not
  against privileged deletion or Storage outages.
- No cleanup worker is built. Future cleanup must first tombstone unused expired
  reservations and remove bytes through Storage API, never SQL-delete objects.
- An upload authorized just before discard may finish afterwards. It cannot attach;
  a later sweep must retry deletion. Keep discarded tombstones, do not recycle paths.
- Revoked students cannot use cleanup RPCs; trusted future maintenance must handle
  their abandoned uploads. Retention for attached selfie/location evidence is still
  a product decision. Do not delete attached evidence automatically.
- Bucket MIME metadata checks are not image-byte decoding, face/liveness validation,
  or malware scanning. Later UI validation does not replace server trust boundaries.
- Camera-only UI and browser geolocation are evidence, not tamper-proof presence.
- Multiple abandoned request IDs can allocate multiple reservations; they consume
  no attendance starts. Rate limits/quotas may be considered before hosted enforcement.

## Validation commands (local only)

```sh
npm run supabase:reset
npm run test:supabase
node --test tests/supabaseAttendanceProofs.local.test.js
npm run test:supabase:activities
npm run test:supabase:attendance
npm run test:supabase:realtime
npm run supabase:lint
npm test
npm run build
git diff --check
```

The new API test obtains local CLI credentials in memory, asserts the exact loopback
API URL, never reads frontend `.env`, and uses only synthetic local identities.
API fixture cleanup removes only its generated paths/UUIDs; immutable proof fixture
cleanup temporarily disables its trigger in one local privileged transaction.
Database tests roll back all fixtures. No hosted fallback exists.

Production UI has not changed. Laptop/phone camera, permissions, GPS, watermark and
end-to-end proof-backed punching cannot be manually verified until later phases.
Hosted migration/application and enforcement verification require separate approval.

## Local validation results

- Clean `supabase db reset --local --no-seed`: all 10 migrations applied, including U4.1.
- Database: 9 files, 643 assertions passed, including 80 new U4.1 assertions.
- U4.1 Auth/Storage API: 13 tests passed (12 scenarios plus the parent test).
- Existing Activity/Storage/S6/S7 integration: 19 tests passed.
- Existing attendance concurrency: 5 tests passed.
- Existing Admin Realtime/RLS integration: 1 test passed on each of two consecutive
  final runs. Two earlier runs received zero events despite successful writes and
  subscriptions. Only the local Realtime container was restarted; no application,
  publication or test changes were made. Later delivery recovered; the precise
  cause of the transient local failure was not established.
- Full frontend/unit suite: 214 tests passed.
- Local schema lint: no errors. Production build: passed.
- Git whitespace checks: passed, including the four new untracked files.
- Local fixture audit: zero remaining U4.1 users/reservations/proofs/objects and
  zero matching S5/U3 synthetic users. Test cleanup ran on failed Realtime attempts too.

Exact change manifest: this document, the migration above,
`supabase/tests/database/009_u41_attendance_proofs.test.sql`, and
`tests/supabaseAttendanceProofs.local.test.js` were created. No existing source,
test, configuration, package, or migration file was modified. No dependencies added.
