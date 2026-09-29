# OJT Monitoring & DTR — Google sign-in

Vue 3 Options API, JavaScript, Vite, Tailwind and the existing Firebase modular SDK. No new dependencies.

## Run and validate

Keep Firebase Web App configuration in ignored `.env.local`; never commit it.

```sh
npm run dev
npm run build
node --experimental-vm-modules --test tests/auth.test.js
```

## Student and administrator flow

Both roles use Continue with Google. The Firebase SDK opens Google's account chooser and manages local session persistence. The application never receives a Google password. No email/password form or public administrator signup remains.

After Auth restoration/sign-in, read `users/{auth.uid}` from Firestore before deciding access:

- Google identity with no profile: authenticated `/signup` (Complete Registration).
- Student/pending: `/pending`.
- Student/approved: `/student`.
- Admin/approved: `/admin`.
- Rejected, invalid, mismatched or unreadable profile: blocked at `/pending` with a relevant message.
- Anonymous protected navigation: `/`.

Full Name is prefilled from Google and editable. Google email is read-only and persisted from Firebase Auth, never from form input. Student ID is normalized to uppercase; Program is fixed to BS Information Technology. No year level is inferred or collected. Google Workspace identities are supported as well as Gmail; email suffixes never grant roles.

The `users/{uid}` pending student profile and `studentIds/{normalizedId}` reservation are one atomic batch. Rules require the signed-in Google provider, verified email, matching UID/email, exact permitted fields and reciprocal batch documents. Role/student and status/pending are set explicitly. Existing profiles and ID reservations cannot be overwritten. ID uniqueness does not prove real-world ownership; administrators verify student details.

Registration failures retain the Google identity and permit a safe retry. They never delete the Google Auth user. An existing profile is re-read rather than overwritten, including an administrator provisioned while registration is open. A missing profile after a read failure is not treated as first-time registration.

Approved administrators review real Pending Registrations in Students. Approval changes status, approvedAt and approvedBy; rejection changes status only. Existing demonstration directory and other OJT data remain mock. Self-editing Firestore profiles, role escalation, reservation overwrite/deletion and all unrelated collections remain denied by rules. The existing confirmation dialog/signOut behavior is preserved, including on Complete Registration.

## Required Firebase Console configuration

1. Authentication → Sign-in method: enable Google, select a project support email and save.
2. Authentication → Settings → Authorized domains: ensure localhost for development and your deployed host are authorized. Do not assume localhost was added automatically.
3. Publish the exact updated `firestore.rules` under Firestore → Rules. Alternatively use an authenticated Firebase CLI: `firebase deploy --only firestore:rules --project ojt-bsit-tcc-monitoring`. Local changes do not publish themselves. Old rules still requiring yearLevel will reject the new registration schema.
4. Keep the existing default Firestore database. No new database or indexes are intentionally introduced.

Official Google setup: https://firebase.google.com/docs/auth/web/google-signin

## Pre-authorize an administrator

Use trusted Console administration, never an email allowlist in frontend code. The approved `users/{UID}` document is the authorization record.

For an existing Firebase Auth Google identity, obtain its exact UID. For a new administrator, have the intended person Continue with Google once to establish their Firebase Auth identity, then stop at Complete Registration without submitting student details. A trusted project administrator can now copy that UID from Authentication and pre-authorize the next sign-in by manually creating `users/{UID}` with:

- uid: the same UID
- fullName: administrator's name
- email: exact Google identity email
- role: admin
- status: approved
- department: BSIT Department
- createdAt: Timestamp set to the current time in Console

The person signs out and continues with Google again; Firestore verification sends them to Admin Dashboard. No admin privileges exist before this trusted provisioning. Never store a password in Firestore. To pre-provision before any interactive sign-in, use a separately administered trusted Firebase identity provisioning process; no Admin SDK or service-account key is included here.

Existing password accounts are not deleted, migrated or automatically linked by this code. If Google resolves to a different UID or reports an existing-credential conflict, a trusted administrator must resolve that identity migration without copying privileges based only on email. Disabling the Email/Password provider is a separate Console migration decision; removing the UI alone does not disable that provider.

## Manual tests

1. Enable/configure Google and publish rules. On desktop and a phone browser, Continue with Google. Check cancellation, popup blocking, network failure and retry; no raw SDK errors should display.
2. New Google user reaches Complete Registration with prefilled name and read-only Google email. Refresh; it must remain there. Anonymous `/signup` returns to login.
3. Submit valid student details. Verify users UID/profile and canonical ID reservation, student/pending, requiredHours 486, createdAt, null approval metadata and no passwords. Verify `/pending` blocks both workspaces.
4. Try a duplicate canonical Student ID with another Google identity. It must fail without replacing either document or deleting the Google identity. Correct the ID and retry.
5. Provision the approved admin as above. Verify direct Admin Dashboard redirect and denial of Student workspace. Confirm approved admin never sees/overwrites itself through student registration.
6. Admin approves the pending student; check approval metadata. Student refreshes/checks status/logs in and reaches `/student`; `/admin` stays denied.
7. Reject another registration; both workspaces stay denied and the ID reservation remains. Test missing/invalid profiles and failed server reads.
8. Test persistence across refresh, logout Cancel/Escape/confirm, and denial after signOut. Verify existing desktop/mobile layout remains usable.
9. Use Rules Playground or an emulator to test own read, other-student read denial, non-Google/unverified creation denial, forged role/status/email denial, missing reciprocal batch denial, duplicate concurrent reservation denial, self-approval denial and approved-admin-only review updates. Atomic multi-write races require the emulator or separate test sessions.

## Validation limits / deferred work

10 focused isolated tests pass, covering SDK delegation, profile initialization, routing, registration validation, preservation/retry and friendly failures. Production build passes with the existing large-chunk warning. Tests substitute the SDK: they do not perform Google OAuth or compile/emulate rules. Live Google login, Firebase Console settings, rules deployment and live approval still require the manual checks above. OAuth popups must be allowed; embedded browsers may restrict Google login, so test in supported normal browsers.

No attendance writes, activity writes, uploads, real hour calculations, password reset, email-based role rules, Functions, or widgets were added. Role/status refreshes on navigation or explicit refresh rather than a realtime subscription. Database rules independently enforce authorization.
