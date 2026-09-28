# OJT Monitoring & DTR — Firebase Phase 2

Vue 3 Options API, JavaScript, Vite, Tailwind and Firebase modular SDK. No new dependencies were added for Phase 2.

## Run and check

Keep the six Firebase Web App variables in ignored `.env.local`. Never commit their values.

```sh
npm install
npm run dev
npm run build
node --experimental-vm-modules --test tests/auth.test.js
```

## Account architecture

`src/firebase/firebase.js` exports Auth and Firestore from one shared app.
`src/services/auth.js` restores Auth, loads the server profile, and exposes reactive loading/error/account state.
`src/services/accountPolicy.js` centralizes redirects and signup validation.
`src/services/users.js` reads profiles, creates registration batches and reviews pending students.

Profiles live at `users/{authUid}`. Normalized uppercase Student IDs are reserved at `studentIds/{studentId}`.
Signup explicitly writes student/pending; it never accepts role or status from the form. Profile and reservation are committed in one Firestore batch. Reciprocal getAfter rules require both documents and prevent overwriting an existing reservation, including concurrent claims. This ensures unique normalized IDs, not ownership of a real-world ID; administrators must verify identity.

Auth creation and Firestore are separate operations. If profile creation fails, the app reads back the profile. A confirmed missing profile triggers deleteUser for the newly created current user. An uncertain read leaves the account blocked and asks for administrator assistance rather than risking deletion of a successfully registered user. Failed cleanup also requires administrator assistance. Never store passwords in Firestore.

## Routing and UI

Existing routes remain; `/signup` and authenticated `/pending` are added. Guards await Auth and server profile loading. Approved students go to `/student`; approved administrators go to `/admin`. Wrong-workspace navigation redirects to the user's own workspace. Pending, rejected, missing, invalid or unreadable profiles are denied workspace access and sent to `/pending`, with a relevant message. Anonymous protected-route requests return to `/`.

Pending users can check their status, refresh, or log in again after a decision. Status is refreshed on navigation, not through a realtime subscription. Database authorization is enforced by rules independently of route guards.

Admin Students now includes real Pending Registrations with View, Approve and Reject. Approval transaction sets status, approvedAt and approvedBy; rejection sets rejected without deleting Auth accounts. Only pending students can be reviewed. Existing directory data is separately labeled demonstration data. Profile identity comes from Firestore; remaining fields and Save actions remain local previews. Existing LogoutDialog and Firebase signOut remain in use.

## Publish rules and bootstrap an administrator

1. In the existing Firebase project, open Firestore Database → Rules. Review and publish the exact contents of `firestore.rules`. Do not use test/open rules. Alternatively, with an authenticated Firebase CLI, deploy using `firebase deploy --only firestore:rules --project ojt-bsit-tcc-monitoring` from this directory. `firebase.json` points to the rules file. Local files do not automatically change deployed rules.
2. Keep Email/Password Authentication enabled. The default Firestore database is already confirmed to exist.
3. In Authentication → Users, manually add the initial administrator using your chosen email/password. Copy its UID.
4. In Firestore create `users/{that exact UID}` with: uid (same UID), fullName (administrator's name), email (same Auth email), role `admin`, status `approved`, department `BSIT Department`, and createdAt (Timestamp set to the current time in the Console). Do not add a password. The Console is trusted administration and bypasses client rules. There is no public admin signup.
5. Log in with that account and confirm `/admin`. Existing Phase 1 accounts without profiles remain blocked; explicitly provision legitimate profiles rather than deriving roles from email.

Rules permit own-profile reads and approved-admin reads of student profiles. Public creates require the exact permitted student fields, authenticated UID/email, pending status and atomic ID reservation. Student updates and deletes are entirely denied in Phase 2. Admin updates allow only pending-to-approved/rejected transitions and corresponding approval metadata. All other collections are denied. Future student-editable contact/workplace fields need a validated allowlist; identity, role, status, IDs and approval metadata must remain protected. Rejected IDs remain reserved; only trusted maintenance should release them after checking both documents.

## Manual end-to-end test sequence

Use separate browser sessions for student and administrator. No live accounts are created by automated tests.

1. Visit `/signup`; check required fields, malformed ID/email, short/mismatched passwords and password visibility on desktop and a small phone width.
2. Register a test student. Confirm its Auth user, `users/{uid}` and canonical `studentIds/{id}` exist. Verify role student, status pending, requiredHours 486, timestamps and null approval fields. Verify no password exists in either document.
3. Confirm `/pending`; directly visit `/student/history` and `/admin/students` and confirm denial. Refresh and confirm the pending state survives. Test LogoutDialog cancel, Escape and confirmation; confirmed logout returns to `/`, and protected routes remain blocked.
4. With another email, attempt the same ID (including lowercase/outer-space variants). Confirm registration fails and no second reservation/profile exists. Confirm newly created Auth account cleanup, or the explicit administrator-help state if cleanup/readback cannot complete.
5. Bootstrap/login as administrator. Confirm `/admin` and redirection away from `/student`. Open Students → Pending Registrations, View the real record, and confirm Approve. Verify approvedAt is a Timestamp and approvedBy is the administrator UID.
6. Student checks status or refreshes/logs in again. Confirm `/student`, blocked `/admin`, authenticated-root redirect and refresh persistence.
7. Register a second student and reject it. Confirm rejected Firestore status, retained Auth account and reservation, and Registration Not Approved with both workspaces denied.
8. Test a legitimate Auth user without a profile and a denied/offline profile read: no workspace access or raw SDK errors. Restore connectivity and retry.
9. In the Firestore Rules Playground or a configured emulator, verify: anonymous reads/writes denied; own read allowed; other-student read denied; public admin/approved creation denied; standalone profile/reservation writes denied; duplicate ID batch denied; student self-approval/role change/other-user writes denied; pending/rejected administrator updates denied; approved administrator approval/rejection allowed; extra identity edits during approval denied; reservation update/delete denied. Test the valid atomic signup batch and concurrent duplicate claims with the emulator or separate test sessions as Playground cannot fully exercise multi-write races.
10. Check desktop/mobile pending and admin review interfaces, loading, retry, confirmation, empty results, and failed approval without a success notice.

## Verification and remaining scope

Nine isolated tests cover policy, validation, SDK delegation, partial failures and stale profile responses. They use SDK substitutes: they do not compile/emulate Security Rules or prove live authorization. Production build passes. Live signup, rule enforcement, approval/rejection, account persistence and logout need the above Firebase Console/test-account checks. Rules have not been deployed by this task.

Attendance, activities, uploads, hour calculations, full profile persistence, email verification, password reset, notifications, widgets and trusted deletion workflows remain deferred. No Admin SDK credentials belong in the frontend. Existing mock OJT data is intentionally retained.
