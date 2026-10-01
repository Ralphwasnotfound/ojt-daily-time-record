> Historical phase report: this records the implementation and validation at that phase. Current setup is documented in [README](../README.md); superseded backend and deployment instructions are not current operations guidance.

# S6 — Student activity UI integration

Local implementation and validation complete, 2026-10-01. Hosted S6 UI verification is still required. No deployment, hosted operation, S6 migration, S7 work, dynamic Admin activity monitoring, or attendance photo/location/watermark work was performed.

## A. Existing mock paths replaced

- `ActivityView.vue`: mock photo/form submission replaced with the S5 lifecycle and real S4 attendance gating.
- `StudentDashboard.vue`: static recent activities replaced with three real records. Attendance summaries remain S4-backed.
- `HistoryView.vue`: sample activity records and fabricated count replaced with paginated S5 records and a current-page count. Existing S4 attendance history remains intact.
- Firebase activity services remain reference-only; none is imported by the active student activity integration.

## B. Files

Created:

- `src/services/supabaseActivityData.js`
- `src/services/activityPhoto.js`
- `src/services/supabaseActivities.js`
- `src/services/studentActivityController.js`
- `src/components/ActivityCamera.vue`
- `src/components/ActivityPhotoInput.vue`
- `src/components/PrivateActivityProof.vue`
- `src/components/ActivityEditor.vue`
- `src/components/ActivityFeed.vue`
- `tests/supabaseActivityUi.test.js`
- `docs/supabase-s6-student-activities.md`

Modified for S6:

- `src/views/student/ActivityView.vue`
- `src/views/student/StudentDashboard.vue`
- `src/views/student/HistoryView.vue`
- `src/supabase/supabase.js`: removed the temporary development debug exposure. This restores its committed content, so it does not appear in the final Git diff.
- `tests/studentAttendanceView.test.js`
- `tests/supabaseActivities.local.test.js`
- `package.json`: includes S6 unit tests and enables VM modules for the real local service integration test; no dependencies added.

Pre-existing S5 working-tree changes were preserved, not introduced by S6: `supabase/migrations/20261001000100_s5_activities.sql`, `supabase/tests/database/001_s1_foundation.test.sql`, `supabase/tests/database/003_s5_activities.test.sql`, and `docs/supabase-s5-activities.md`.

The continuation preserved the implementation. Final corrections put all camera capture work inside `try/finally` so early failures release tracks, and refresh the activity feed after safely closing an editor in case cancellation reconciliation discovers a committed edit. Regression coverage includes early capture failures and component teardown.

## C. Service/controller architecture

- `supabaseActivities.js` reuses the existing authenticated singleton, checks the active approved student identity, calls existing S5 RPCs, and rejects stale-account results. It contains no service-role credentials and does not create a second client.
- `studentActivityController.js` owns one immutable submission attempt per editor, busy state, retained request ID, reconciliation, revision conflicts, and authorized draft cleanup. A separate bounded feed controller owns cursor navigation and stale-response protection.
- `supabaseActivityData.js` holds the exact eight categories, validation, friendly error messages, and Asia/Manila formatting of server timestamps.
- Vue components use JavaScript Options API and local state. No new global state library or dependency.

## D–F. Camera, gallery, image validation

Camera access starts only after Take Photo. A modal displays a live `getUserMedia` video stream, with Capture and Cancel. Capture uses a canvas, JPEG output, and a maximum 1920-pixel dimension. Retake is available after capture. Permission denial, missing camera, unsupported/insecure context, and capture failures produce friendly messages.

Tracks stop on successful capture, early capture/encoding failure, cancel, dialog teardown, route/component unmount, and backgrounding. A permission response arriving after close is also stopped. Tests exercise success, failure at four stages, late permission, cancellation, and component teardown.

Choose Photo uses an ordinary file input. Camera and gallery feed the same validation and upload path. Both require nonempty JPEG/PNG/WebP, at most 5 MiB, and successful browser image decoding. Selection previews can be replaced or removed. Temporary validation and preview object URLs are revoked. Submit is blocked while decoding.

The description is trimmed, required, and limited to 500 Unicode code points, matching PostgreSQL character counting rather than JavaScript UTF-16 length. Null characters are rejected. These checks are UX safeguards, not malicious-file security; S5 remains authoritative.

## G. Create lifecycle and reconciliation

1. Require an approved student and re-read real attendance before a new create attempt. No open session means no submission.
2. Retain one generated request ID and immutable category/description/file for the intended attempt.
3. Call `activity_prepare(request_id, null)` and upload to its exact returned path in private `activity-proofs`, with `upsert:false`.
4. Call `activity_create(upload_id, category, description)`. Identity, session, and timestamps are server-owned.
5. On an uncertain response, read by the returned activity ID before any deliberate retry. An already committed record confirms success. Uncertain uploads are reconciled by authenticated byte comparison before reusing the same reservation.
6. Do not automatically replay mutations, allocate another request ID, or delete proof on a timeout. Check server result is read-only. Retry reuses the same attempt.
7. Clear form/photo only after confirmed success. History and Dashboard fetch server records when opened; feeds also support refresh and browser-focus reconciliation.

Requests have a 20-second UI deadline. RPC/read requests use abort signals. This installed Storage SDK does not accept upload cancellation signals, so an upload timeout means unknown outcome, not guaranteed cancellation. Retained reservation/path and reconciliation handle that distinction.

## H–I. History and private proof

History uses `activity_history(25, before_created_at, before_id)`, newest first. Previous/Next navigate keyset cursors; only one page of records is held. Show More/Show Less applies within that page. Date/category filters explicitly say “on this page”; they are not global search. Dashboard uses the same feed with a limit of three.

Private proof is downloaded only on View private photo through the existing authenticated Storage client. No public URLs are constructed. Decoded Blob object URLs are revoked on hide, path change, account change, and unmount. Late downloads cannot restore stale previous-account images.

## J. Edits and replacements

Opening Edit reads the current record/revision through RLS. Metadata-only edits call `activity_edit` without uploading. Edits remain available after Time Out.

Replacement allocates `activity_prepare(request_id, existing_activity_id)`, uploads to the returned replacement path, then calls `activity_edit` with the expected revision and replacement upload ID. Original proof stays attached until commit. Owner/session/created_at cannot be changed through this API.

Uncertain edits are reconciled against revision, content, and proof path. A stale revision displays the current server version and requires explicit review; it never silently overwrites it. Clear/close first reconciles and calls `activity_discard_proof(upload_id)` before deleting the exact authorized Storage path. Failed reads do not authorize deletion.

## K–L. Dashboard and History integration

Only student activity sections changed. Dashboard's existing S4 summary and History's S4 attendance tab remain real and unchanged. Activity Update uses the existing S4 attendance mixin, with no local pretend attendance. The activity count is explicitly the current page, not an invented all-time total.

## M. Errors

Friendly mappings cover AUTHENTICATION_REQUIRED, APPROVED_STUDENT_REQUIRED, NO_OPEN_ATTENDANCE, INVALID_CATEGORY, INVALID_DESCRIPTION, INVALID_UPLOAD, PROOF_REQUIRED, INVALID_PROOF, UPLOAD_EXPIRED_OR_DISCARDED, ACTIVITY_ALREADY_EXISTS, ACTIVITY_NOT_FOUND, ACTIVITY_CHANGED, PROOF_IN_USE, REQUEST_CONFLICT, INVALID_PAGE, oversized photos, and decode failure. Unknown errors show recoverable feedback without raw PostgreSQL details.

## N. Final local validation

All following runs occurred after the final camera implementation change. The earlier 134/45 counts predated that change; five additional regressions bring the counts below to 139/50.

| Command/check | Result |
| --- | --- |
| `node --experimental-vm-modules --test tests/supabaseActivityUi.test.js` | 50 passed |
| `npm test` | 139 passed, including S2/S4 regression and reference Firebase unit tests |
| `npm run test:supabase:activities` | 17 passed; S5 Storage/API security plus real S6 service/controller create, lost-response reconciliation, history, private download, replacement |
| `npm run test:supabase:accounts` | 7 passed |
| `npm run test:supabase:attendance` | 5 passed |
| `npm run test:supabase` | 283 assertions passed across S1/S3/S5 |
| `npm run supabase:lint` | No schema errors |
| `npm run build` | Passed |
| `git diff --check` | Passed |

The integration suites target local Docker Supabase only and clean their fixtures. No environment secrets were printed. Real phone cameras, hosted browser interaction, and responsive visual behavior remain manual checks below; simulated camera tests are not hardware verification.

## O. Limitations

- No realtime subscription. Refresh/focus/page navigation reconcile data.
- A full final page may expose a Next button leading to an empty page; reads remain bounded.
- Request IDs survive while the editor lives, not full page reloads. After leaving during an uncertain submission, inspect History before starting a new intended submission. No authoritative localStorage activity state is used.
- Leaving/unmounting invalidates UI callbacks but does not blindly delete uncertain proof. Unused reservations can remain for the trusted S5 maintenance procedure. After S7, audit-referenced retired proof is retained and must not be collected; see the S7 report and updated S5 maintenance guards. There is no new background garbage collector. The browser does not infer old reservation IDs or delete attached proof.
- Image decoding is UX validation, not content sanitization. Very large decoded dimensions can still be expensive even under the byte cap.
- Camera requires HTTPS or localhost and browser/device permission. Actual Android/iOS behavior remains to be verified.
- `window.__supabase` is absent from source and production output. Fully reload an already-open development page to remove any property left in that old page's memory by pre-S6 code.
- No new migration, hosted change, activity deletion UI, Admin activity integration, or attendance proof feature.

## P. Hosted S6 verification checklist — manual, not executed

Use the already configured S2–S5 hosted project and designated approved student test accounts. Do not add privileged keys, run migrations, or reset hosted data. Use the minimum necessary test activities; there is intentionally no activity-delete UI.

1. Start the existing app with `npm run dev` using its current environment configuration (do not print keys). Fully reload. In DevTools, `typeof window.__supabase` must be `"undefined"`. Sign in through the existing Google flow.
2. While OUT, open `/student/activity`: new submission is blocked with a Time In message. Existing History activities still allow edits. Confirm pending/rejected/admin routing remains unchanged.
3. Using the designated approved student and the normal S4 UI, Time In when permitted by the server's Manila-day policy. Do not bypass the one-session policy to test again. Activity Update must show the real open status.
4. Try JPEG, PNG, and WebP; confirm previews. Reject unsupported MIME, empty/corrupt image, and >5 MiB selection before upload. Try empty, >500-character, and 500-code-point Unicode descriptions; categories must match the eight approved values.
5. Click Take Photo on a real phone/desktop camera. Verify live preview, Capture, preview, Retake, and Cancel. Deny permission and verify recovery via Choose Photo. Confirm the browser camera indicator stops after capture, failure, cancel, navigation, and backgrounding.
6. Submit one valid activity. Repeated clicks must not duplicate it. Loading stages and confirmed success appear; form clears only after success. Inspect History and Dashboard: server date/time (Asia/Manila), category, description, and private proof match. Dashboard shows at most three.
7. On test data only, use DevTools network throttling/offline to exercise uncertain responses. Restore connectivity and choose Check server result before retrying. Confirm one record and retained intended submission. Never start a fresh draft solely because a response was lost.
8. Edit metadata without replacing proof. Confirm no upload is made. Replace proof and verify the old proof remains until commit. After Time Out, repeat a metadata edit and replacement; new creation must remain blocked.
9. If testing Time Out during preparation/upload, use only a designated open test session. Final create must be rejected if the server closes attendance first; clear the unused draft through the UI's authorized discard flow.
10. Open the same activity in two tabs, save one, then save the stale other. Verify a conflict/current-server-version message and explicit reload instead of overwrite. Confirm original owner, session, and created time remain unchanged.
11. Verify History loading/empty/error states, current-page filters, Show More/Show Less, Previous/Next on existing sufficient test data, refresh after edit, and browser focus refresh. Do not generate dozens of hosted rows only to test pagination; bounded paging already has local coverage.
12. View/hide proof, replace proof, navigate, and log out. Sign in as a different designated student: no prior-account activity/photo should remain. Private proof requests must use authenticated downloads, with no public URL or privileged credential.
13. At desktop and small-phone widths verify no horizontal overflow, usable form/buttons, camera and edit dialogs, keyboard focus/Escape behavior, and unchanged S4 attendance functionality. Actual hardware and hosted sign-in behavior require this manual pass.

Stop after this verification. Do not start S7 or make Admin activity monitoring dynamic.
