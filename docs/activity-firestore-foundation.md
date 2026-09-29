# Phase 4A-1: Activity Firestore foundation

No UI integration, Storage, deployment, or attendance policy change is included.

## Schema

`activities/{autoId}` has exactly: `studentUid`, `studentId`, `attendanceSessionId`,
`category`, `description`, `photoPath`, `createdAt`.
The path is `activityProofs/{studentUid}/{activityId}/proof`. `createdAt` is a
server timestamp. No client-formatted date, time, name or photo flag is persisted.
Records are immutable to students and admins.

## Service API

- `allocateActivity()` reads approved profile and open attendance in a transaction;
  returns a frozen `{ activityId, studentUid, attendanceSessionId, photoPath }` descriptor.
  Allocates once outside the retryable callback. Does not write a document.
- `createActivity(draft, { category, description })` rechecks profile, state and actual
  session in a transaction and creates the record with a server timestamp. Trims
  description, preserves internal line breaks, caps at 500 JavaScript code units.
  Retain the descriptor across retries; never silently use a newer session.
- `getOwnActivity(activityId)` returns a server-confirmed record or null for reconciling
  uncertain commits. Existing IDs cannot be overwritten; creation reports ALREADY_EXISTS.
- `getStudentActivities({ pageSize = 25, after = null, category = null, day = null })`
  returns `{ records, lastSnapshot, mayHaveMore }`. `day` is a Timestamp within the
  desired Manila day. All filtering happens on the server.
- `getTodayActivities(options)` uses the current Manila day (device time for query only).
- `getRecentActivities()` returns up to three newest records.
- `getCurrentSessionActivities(options)` resolves the current open session. OUT is an
  explicit error. Category-plus-session filtering is intentionally unsupported.

All queries constrain the authenticated UID and sort by createdAt descending. Snapshot
cursors retain the implicit document-ID tie breaker. Page sizes are integers 1–100;
`mayHaveMore` is a hint and may require one final empty page. Reset cursors on filter
changes. The service rejects wrong-owner/collection/filter cursors. No entire-history
loader or admin query service is included.

## Rules and attendance

Activity creation checks exact keys/types, approved student, profile Student ID,
canonical path, exact category allowlist, trimmed non-whitespace description <=500,
and timestamp == request.time. The explicit whitespace regex covers JavaScript trim
characters because emulator tests showed Rules trim alone misses Unicode whitespace.

Both get() and getAfter() validate matching state and actual session, ownership, IN,
null timeout, and matching timestamps. A combined Time Out + activity batch fails
because its final state/session are OUT. A Time Out during the future upload causes
finalization to fail; no attendance document is changed by this service. Existing
one-start-per-Manila-day attendance rules are untouched.

Activity create checks three distinct dependent documents (profile, state, session).
Counting before/after state separately yields five dependency versions, below the
10-call per-write limit; repeated profile reads use Firestore's cached access.
Large caller-created batches must still respect the overall 20-call budget. The
provided service creates one activity per transaction.

Approved owners may read their records, approved admins may read all. Missing-document
get is permitted for approved students to support creation/reconciliation; an existing
other-student activity remains denied. Lists must constrain ownership. Updates and
deletes are denied to both roles. Auto-ID shape is validated (20 alphanumeric chars);
rules cannot prove how a caller generated a syntactically valid ID.

## Indexes and time

Added collection indexes: studentUid/createdAt, studentUid/attendanceSessionId/createdAt,
studentUid/category/createdAt (equality fields ascending, timestamp descending).
No category-only admin index: no implemented query requires it yet. Existing attendance
indexes remain intact. Description and photoPath indexing is disabled only on activities.

`activityManilaDayRange(timestamp)` follows attendance UTC+8 day arithmetic and returns
[start, end) timestamps at Manila midnight. Device time never authorizes a write.
Production index availability must be checked after a separately approved deployment;
the emulator does not establish production index readiness.

## Accepted V1 limitation / next phase

The canonical photo path does NOT prove a Storage object exists. No Storage SDK
initialization, rules, upload, cleanup, CORS or image retrieval is implemented. This
service is intentionally not called from the mock UI yet. Phase 4A-2 must upload first,
then create using the same descriptor, handle errors and reconcile uncertain commits
before treating a proof as orphaned. No Cloud Functions/trusted finalization is added.

## Validation

`npm test` includes activity validation, query and service tests plus all existing
regressions. `npm run test:rules` runs both attendance and activity suites against
loopback-only demo Firestore projects. The activity suite includes real service calls,
multiple submissions, hostile payloads, immutable records, ownership queries, and
close/create races. `npm run build` validates the unchanged application bundle.
