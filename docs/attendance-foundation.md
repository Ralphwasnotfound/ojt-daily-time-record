> Historical phase report: this records the implementation and validation at that phase. Current setup is documented in [README](../README.md); superseded backend and deployment instructions are not current operations guidance.

# Phase 3A-1: attendance data foundation

No UI is connected to these services yet. Authentication, registration, user approval, routing and the existing users/studentIds rules are unchanged. Nothing is deployed by the test commands.

## Data model

- `attendance/{autoId}`: studentUid, studentId, status (IN/OUT), timeIn, timeOut, createdAt, updatedAt.
- `attendanceStates/{authUid}`: studentUid, sessionId, status, timeIn, timeOut, updatedAt.

The state document is permanent, including after Time Out. It points to the current/latest session. No dateKey, duration, totals, photos or credit-policy data is persisted. Both documents must transition together. Sessions are immutable except for the single IN-to-OUT transition. Admins are read-only for attendance in this phase.

## Service API

`src/services/attendance.js` exports:

- `timeIn()`: reads the approved student profile and own state in a transaction. A previous closed state also has its referenced session checked. An open state is rejected. A session auto-ID is allocated once outside the callback so transaction retries reuse it. Both new documents use serverTimestamp transforms. Returns `{ sessionId, studentUid }` after commit.
- `timeOut()`: reads profile, state and referenced session in a transaction. Only status, timeOut and updatedAt are patched in both documents. It never deletes state or replaces a previous Time Out. Returns the session/UID after commit.
- `getAttendanceState()`: server read of own state; null means confirmed missing, errors never imply OUT.
- `getStudentAttendance({ pageSize = 25, after = null })`: own history, newest timeIn first.
- `getCompletedAttendance(options)`: same query plus status OUT.

Read helpers return `{ records, lastSnapshot, mayHaveMore }`. The cursor is a Firestore DocumentSnapshot; pass it as `after`. Page sizes are 1–100. `mayHaveMore` is a hint, not proof of another record. A full history/total requires fetching every page until exhausted; never label a single page sum as a lifetime total. Neither helper accepts a student UID; all collection reads constrain studentUid to the authenticated UID. Rules enforce approved-student ownership independently. Admin read helpers/listeners are deferred to UI integration.

Every operation maps errors to an AttendanceError with a friendly message and code:
NOT_AUTHENTICATED, NOT_APPROVED_STUDENT, ALREADY_TIMED_IN, ALREADY_COMPLETED_TODAY, NO_OPEN_ATTENDANCE, ATTENDANCE_INCONSISTENT, OFFLINE, PERMISSION_DENIED, ATTENDANCE_FAILED or INVALID_QUERY.

There is no automatic retry after an uncertain application-level result. Refresh state before offering another action. SDK transaction retries contain no UI effects. UI integration must handle account changes, loading, stale results and unresolved writes without claiming success.

## Server time and Manila day

All stored timestamps use serverTimestamp(). Rules compare timeIn/createdAt/updatedAt on creation and timeOut/updatedAt on closing to request.time. Matching state/session timestamps are required by reciprocal checks.

Rules enforce that the previous start's Manila day is earlier than the current request's Manila day: `(t + duration.value(8, 'h')).date()`. No browser date is sent as authorization data. Open sessions block starts across midnight and are never auto-closed. After closing an overnight session, a new start is permitted if its previous start was on an earlier Manila day.

The service additionally compares the previous trusted timeIn against Timestamp.now() ONLY for a friendly preflight error. Timestamp.now() is device time, not authority: it never enters a write and never replaces the server rule. A wrong device clock can cause a false preflight rejection, or allow a request to reach rules that will reject it. Correct the device clock and retry after refreshing; do not weaken rules. The daily restriction itself remains server-authoritative.

## Duration utilities

`src/services/attendanceTime.js` provides manilaDay(), sameManilaDay(), timestampNanoseconds(), calculateSessionDuration() and calculateTotalCompletedDuration().

Durations are BigInt **nanoseconds**, preserving Firestore timestamp precision. An open session returns null and is excluded from completed totals. Invalid timestamps, reversed intervals or inconsistent statuses throw ATTENDANCE_INCONSISTENT instead of silently producing a misleading total. Zero-duration completed sessions are valid. Sum first, format/round only at the UI boundary. BigInt is not directly JSON serializable; these values are not stored in Firestore. Convert only when formatting a display, for example whole minutes = total / 60000000000n.

No lunch deductions, daily caps, credited-hours policy, automatic correction or admin editing exists. Completed elapsed duration is not automatically department-approved credit. Required hours continue to come from users/{uid}.

## Rules integrity and limits

The existing users and studentIds matches are preserved. New attendance matches require the current profile's role student and status approved for writes. Own reads require approved student; approved admins can read all attendance/state. Unknown and unauthorized access is denied.

Session creates require the post-write state to match their exact ID and timestamps. State starts require that referenced session to be absent before and present afterward. Existing state must be OUT, match its previous session and have a prior Manila start day. Closing requires both the prior and post-write counterpart to match. No standalone reset, two-session batch, deletion, timestamp replacement or identity change is allowed.

Conservatively, counting repeated profile reads before caching, successful session creates use at most four document-access calls and state starts at most five; closing uses at most four per written document. This is below the 10-call per-operation and 20-call atomic-write limits. Emulator tests exercise first starts, later-day starts and closing. Keep these limits in view if future photo or policy checks are added.

## Indexes

firestore.indexes.json defines only the two implemented query shapes:

1. attendance: studentUid ASC + timeIn DESC.
2. attendance: studentUid ASC + status ASC + timeIn DESC.

firebase.json references the rules/indexes and configures a loopback Firestore emulator on port 8080. Emulator UI is disabled. Composite index availability must still be checked after eventual deployment; emulator success does not validate production index readiness.

## Tests

```sh
npm test
npm run test:rules
npm run build
```

The only new npm development dependency is `@firebase/rules-unit-testing` (5.0.2 at installation). `test:rules` uses the existing Firebase CLI (tested with 15.20.0) and requires Java 21+. It starts only Firestore for `demo-ojt-attendance`; test code refuses a non-loopback emulator. It does not use .env.local or production credentials. Rules tests must not be run against production.

On this Windows machine, Java is bundled with Android Studio. The successful local command environment was:

```powershell
$env:PATH = 'C:\Program Files\Android\Android Studio\jbr\bin;' + $env:PATH
$env:XDG_CONFIG_HOME = 'D:\CODE\DTR\.firebase-config.local'
$env:FIREBASE_EMULATORS_PATH = 'D:\CODE\DTR\.firebase-emulators.local'
npm run test:rules
```

These process-local settings avoid touching the signed-in CLI configuration and keep downloaded emulator files in ignored local directories. A normal terminal with Java/CLI configured can run npm run test:rules directly. The CLI may download the official emulator JAR on first run. Do not commit emulator caches/logs.

Rules tests use the real Firestore emulator with official mocked authentication contexts. They cover authorization, forged identities, extra fields, arbitrary timestamps, reciprocal writes, concurrent/malicious starts, same-day and later-day starts, overnight closing, immutable completed records, deletion denial, scoped reads, approval revocation, and the actual service transactions/paginated reads.

The Manila boundary test loads the unchanged helper into a separate demo rules environment with a read-only test probe. It evaluates fixed midnight/month/year timestamps using the actual Rules engine. It does not mock production request.time or simulate a live write arriving exactly at midnight. The expected multiple-demo-project warning for this probe is harmless. Pure utility boundary tests provide matching client coverage.

## Before Phase 3A-2

1. Review these local changes and the passing test results. No live Firestore rules or indexes have changed yet.
2. Before live UI writes, explicitly publish the reviewed rules and indexes to the intended Firebase project using the Console or an authorized deployment. Wait for both indexes to finish building. Do not replace the existing account rules with open rules.
3. Verify approved test-student profiles have matching UID and valid studentId, and have a second student plus approved administrator available for access checks. Never migrate mock attendance into real records.
4. Approve the next UI integration phase. Wire the Attendance page first; keep Dashboard/Admin mock attendance until their explicit integration step.
5. Live-check Time In, Time Out, refresh/logout/login while IN, same-day refusal, duplicate requests from two devices, offline failure, and ownership restrictions. Server acceptance time, not the click's device time, is authoritative.

Forgotten Time Out and approval revocation while IN intentionally retain the open record. A future trusted correction workflow is needed; no student/admin write exception is provided here. State/profile corruption must be reviewed manually, not auto-repaired. Photos and Storage remain Phase 3B.
