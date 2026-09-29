# Phase 3A-2 — real student attendance UI

Student Attendance, Dashboard attendance cards and the History attendance tab now use the deployed Phase 3A-1 service. Admin screens, account authorization, rules/indexes and activity mock records are unchanged. No photos/Storage or deployment is included.

## Integration

- The shared Options API mixin owns a per-page controller and listener to the current UID's attendanceStates document. Every mount restores state from Firestore; logout never calls Time Out. Listeners and clock/browser handlers are removed on teardown/account change. Permission/eligibility failures recheck the existing account policy.
- Cached or pending-write snapshots never imply confirmed OUT/IN. Loading, write processing, errors and explicit Refresh are visible. Offline disables actions; uncertain write outcomes require reconciliation rather than another blind submission.
- Time In/Out is guarded against duplicate clicks, waits for the service commit, reads confirmed state and reloads history before showing success. A committed write followed by a failed refresh explicitly asks the student to refresh; it does not invent a timestamp or invite an immediate duplicate write.
- All history pages are loaded before publishing totals. Valid completed durations are summed with the existing nanosecond utility; open sessions contribute zero. Malformed/mismatched state or history blocks actions and totals with a review message. No derived values are persisted.
- Every attendance timestamp/date is formatted with Asia/Manila. The device clock selects the display day only; service/rules still own authorization and timestamps. No running timer was added. Overnight attendance is grouped by its start date, with an explicit carry-over message; today's completed-hours card counts sessions started today.
- Profile name/requiredHours feed Dashboard totals, remaining hours and capped progress. The Activity sections remain explicitly labeled sample data. Photo proof is labeled unavailable for Phase 3B, with no capture/upload controls.

## Verification

Run `npm test`, `npm run test:rules` and `npm run build`. See attendance-foundation.md for Java/CLI emulator environment setup. Tests cover service pagination/listener metadata, controller state/actions/cleanup, actual Vue template rendering, explicit Manila formatting, and existing authentication/security behavior. Emulator tests also exercise the real state listener and all-history helper. Test fixtures are isolated; no production attendance is created by automated tests.

Production Google-session/browser restoration and responsive interaction still need the live checks below. Automated restoration checks cover remounting/controllers, not a real Google OAuth logout/login.

## First live test — leave the session open

1. Start the app (`npm run dev`) and sign in with an approved student Google account. Use a normal supported browser.
2. Open Student Attendance. Wait for server-confirmed loading to finish. With no prior records, expect OUT/Not timed in, empty history, zero completed hours and enabled Time In. If unavailable/loading persists, do not submit; check the error and deployed index readiness.
3. Press Time In once and wait. Expect a processing state, then successful confirmation with an authoritative Time In and IN status. Time Out becomes the available action.
4. Refresh Firestore Console for `ojt-bsit-tcc-monitoring`. Verify an auto-ID `attendance/{sessionId}` and `attendanceStates/{studentUid}` were created automatically.
5. Verify matching studentUid, session ID linkage, IN status, null timeOut and equal server Timestamp timeIn/updatedAt fields. Session createdAt is also a Timestamp; session studentId matches the approved profile. No duration/total fields are written.
6. Refresh the browser: the student must remain IN. Open Dashboard and History: status/time should agree; the open session must not count toward completed hours.
7. Optionally test logout/login: attendance remains IN. Logout must not write a Time Out.
8. Stop here and inspect the first open record. Do not Time Out immediately unless you choose to test closing.

When ready to test Time Out separately, confirm it records one server Time Out, updates completed hours, and disables another start for that Manila start day. Test mobile layout, Show More/Less, offline errors and a second browser's status synchronization. Existing Admin attendance remains mock until Phase 3A-3.
