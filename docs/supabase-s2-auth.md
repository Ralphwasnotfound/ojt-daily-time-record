> Historical phase report: this records the implementation and validation at that phase. Current setup is documented in [README](../README.md); superseded backend and deployment instructions are not current operations guidance.

# S2 account/auth migration and hosted configuration gate

## Scope and inspected dependencies

Before editing, the active account path used `src/firebase/firebase.js` (`getAuth`),
`services/auth.js` (Firebase observer, popup sign-in, registration orchestration and
logout), `services/users.js` (Firestore profile reads, reservation batch and admin
review transaction), and `services/accountPolicy.js` (Firebase UID/provider routing).
Login, Signup, Pending, PendingRegistrations, the router and App consumed these.
WorkspaceLayout called the shared logout service through the unchanged LogoutDialog.
StudentLayout/AdminLayout only supplied navigation. Both profile views copied account
data into their existing display models. The attendance mixin/controller/services
expected Firebase `auth.currentUser.uid`. Activity services also still use Firebase.

The old account implementations are preserved under `src/firebase/reference/` and
are not imported by the application. Existing auth tests now target those copies.
Firebase configuration, dependencies, rules, emulator tests, attendance/activity
services and controller remain intact. No S1 migration, policy or grant was changed.

## Active S2 architecture

- `src/supabase/supabase.js` creates one browser client with persistent sessions,
  automatic refresh, PKCE and automatic callback detection. No browser admin client.
- `src/supabase/config.js` accepts a publishable key or legacy anon JWT and rejects
  secret/service-role keys without printing their values.
- `services/auth.js` handles initialization, OAuth redirects, session events, profile
  loading, registration and logout. Profile queries run outside auth callbacks to
  avoid SDK lock deadlocks. Generation checks discard stale reads after account changes.
  Same-user token refresh does not discard registration state.
- `services/users.js` reads `public.profiles` under RLS and maps snake_case columns to
  existing view fields. The display `uid` is a Supabase UUID, not a Firebase UID.
- Registration sends only `full_name` and `student_id` to
  `complete_student_registration`. Google name metadata is editable prefill only.
  S1 derives UID/verified email and fixes student/pending/program/486 hours.
- Admin review sends only `student_uid` and `decision` to `review_student`.
  The database checks the caller and derives approval metadata. Pending list reads
  page through the API limit. PostgreSQL timestamps display through JavaScript Date.
- Guards await session/profile initialization and refresh profiles on navigation.
  No profile routes Google identities to `/signup`; pending/rejected/failed reads to
  `/pending`; approved student to `/student`; approved admin to `/admin`.
  Role/status never comes from metadata or a browser role cache. Guard refreshes do
  not trigger competing navigation loops. Status refresh and cross-tab sign-out are handled.
- The existing confirmation dialog calls Supabase `signOut({ scope: 'local' })`.
  Success clears this browser's session and returns to `/`; other devices are not
  deliberately logged out. As with normal JWT authentication, a previously copied
  access token may remain valid until expiry; logout does not promise instant JWT revocation.
- PendingView and shared layouts need no direct edits: their existing service imports
  now use Supabase. Student/admin profile reads use the adapted database row.
  Profile editing is deferred; Edit explains the limitation and does not simulate a save.

## Attendance compatibility boundary

`studentAttendanceMixin.js` shows an explicit migration-pending/unavailable state and
disables attendance actions for the Supabase provider. It does not load the legacy
Firebase controller on that path, preventing Firebase session restoration or reads
from being triggered by the new account flow. No Supabase attendance service, Time
In/Out RPC or data migration is implemented. Activity UI/data integration remains as
before. Supabase UUIDs are never presented as Firebase credentials.

## Environment

See `.env.supabase.example`. Required browser configuration:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<browser-safe-publishable-key>
```

If using the local/legacy anon JWT, leave PUBLISHABLE_KEY unset/empty and set
`VITE_SUPABASE_ANON_KEY`. Never use a service-role key, secret key, database password,
management token or Google client secret in a VITE variable. Restart Vite after edits.
Missing configuration produces an explicit configuration screen, not Firebase fallback.

This task generated ignored `.env.development.local` containing only the local API URL
and local browser-safe anon key; values were not printed. `.env.local` was preserved.
Vite development mode therefore targets local Supabase. Production builds need their
own approved browser configuration; a passing build does not configure hosted OAuth.

## Local validation

Installed `@supabase/supabase-js` 2.117.2 (8 packages added; install audit: 0 vulnerabilities).
Commands:

```text
npm test
npm run test:supabase:accounts
npm run test:supabase
npm run supabase:lint
npm run test:rules
npm run build
```

- Normal suite: 58 passed (43 preserved tests plus 15 S2 tests).
- Local account HTTP integration: 7 passed, including six subtests.
- S1 pgTAP: 147 passed; local lint: no schema errors.
- Firebase emulator/rules: 65 passed.
- Production build: passed; bundle-size warning only.
- Local browser: signed-out `/student` and `/admin` redirected to `/`; no console
  errors. Login had no horizontal overflow at 1280px/390px; mobile button was 48px high.
  Authenticated browser/OAuth presentation still requires the live verification below.

S2 unit tests cover browser key validation, loading/restoration, all account routes,
real router navigation, stale reads, failed logout, cross-tab sign-out, token refresh,
RPC arguments, friendly errors, and the attendance compatibility gate.
The local integration harness obtains credentials from the local CLI in memory,
requires exactly `http://127.0.0.1:54321`, and never accepts hosted environment values.
It creates random synthetic identities, exercises real Auth/session persistence and
PostgREST RPC/RLS, then deletes the fixtures. Password login exists only in that test
harness, not in the application. Google identities are synthetic database fixtures.
The initial fixture omitted identity timestamps required by GoTrue; the harness was
corrected and its leftover local identity removed. No application/schema defect was involved.
Concurrent registrations for one Student ID and competing review requests both proved
exactly one winner. These are local concurrency checks, not a production load test.

## STOP: hosted setup still requires explicit authorization

Nothing was linked, deployed or written to hosted Supabase. Real Google OAuth,
browser redirect/PKCE exchange and production admin bootstrap remain unverified.
Do not claim S2 production readiness from synthetic local identities.

After explicit approval, the safe sequence is:

1. Verify the intended project's reference in the Supabase dashboard, inspect its
   existing schema/migration history, and take an appropriate backup if it contains data.
   Proposed commands (NOT executed): `npx supabase link --project-ref <verified-project-ref>`,
   then `npx supabase db push --linked --dry-run`. Review the planned S1 migration before
   authorizing `npx supabase db push --linked`. Never reset a hosted database.
2. Create/configure a Google Web OAuth client. Register the exact app origin in Google
   and the Supabase callback URL shown by the target project's Google provider panel
   (normally `https://<project-ref>.supabase.co/auth/v1/callback`) as its redirect URI.
   Use basic openid/email/profile scopes. Set Google client ID/secret only in Supabase's
   server-side provider settings. Enable Google; leave unrelated sign-in methods disabled
   for the intended Google-only rollout. Do not weaken S1 identity validation.
3. Set Supabase Site URL and the exact allowed app return URL. This app returns to
   `window.location.origin + BASE_URL` (normally `/`), not a new callback route.
   Include the exact authorized local app URL for testing if needed; avoid broad wildcards.
4. Put only hosted browser URL/publishable key into the intended build environment.
   The ignored `.env.development.local` currently overrides development with local values;
   intentionally update it only when authorized to switch targets. Restart Vite/rebuild.
5. The first trusted administrator signs in with Google, producing a Supabase Auth UUID.
   Verify that exact UUID and verified Google email in the dashboard. Before submitting
   student registration, an authorized database operator may run the narrowly scoped
   bootstrap below. No public admin signup, frontend allowlist, or browser service key.
6. Live-test a new Google student: `/signup`, duplicate ID rejection, pending access
   restrictions, refresh persistence, admin approval/rejection, role separation, logout
   confirmation and protected-route denial after logout. Verify Google identity data
   satisfies S1 rather than changing the rules to accept incomplete identity claims.
   Check desktop/mobile presentation and interrupted/expired OAuth attempts.

Manual bootstrap template for an authorized operator only (NOT executed):

```sql
-- Replace the UUID only after independently verifying the intended Google account.
-- Inspect the matching auth.users/auth.identities row first. No UPSERT or role promotion.
insert into public.profiles
  (id, full_name, email, role, status, department, approved_at, approved_by)
select u.id, 'Verified Administrator Name', u.email,
       'admin', 'approved', 'BSIT Department', now(), null
from auth.users u
where u.id = '<verified-supabase-auth-uuid>'::uuid
  and u.email_confirmed_at is not null
  and exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'google'
      and i.identity_data ->> 'email_verified' = 'true'
      and lower(i.identity_data ->> 'email') = lower(u.email)
  )
  and not exists (select 1 from public.profiles p where p.id = u.id)
returning id, role, status;
```

If no row is returned or a profile already exists, stop and inspect; do not overwrite
the existing account or relax validation. Firebase Auth UIDs/admin profiles do not
automatically become Supabase accounts. Existing account/data transfer is not performed.

References: [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google),
[PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange).

Local S2 implementation is complete subject to the final validation results above.
Hosted configuration and live verification remain gated. S3 was not started.

## Exact files changed in S2

Created:

- `src/supabase/config.js`
- `src/supabase/supabase.js`
- `src/firebase/reference/auth.js`
- `src/firebase/reference/users.js`
- `src/firebase/reference/accountPolicy.js`
- `tests/supabaseAuth.test.js`
- `tests/supabaseAccounts.local.test.js`
- `docs/supabase-s2-auth.md`
- `.env.development.local` (ignored; local browser-safe configuration only)

Modified:

- `.env.supabase.example`
- `package.json`
- `package-lock.json`
- `src/services/auth.js`
- `src/services/users.js`
- `src/services/accountPolicy.js`
- `src/services/studentAttendanceMixin.js` (compatibility gate only)
- `src/router/index.js`
- `src/components/PendingRegistrations.vue`
- `src/views/auth/LoginView.vue`
- `src/views/auth/SignupView.vue`
- `src/views/student/StudentProfileView.vue`
- `src/views/admin/AdminProfileView.vue`
- `tests/auth.test.js` (retarget preserved Firebase reference implementations)

Other dirty/untracked files already existed before this task and were not S2 edits.
Generated `dist/` build output and ignored emulator logs are not source changes.
