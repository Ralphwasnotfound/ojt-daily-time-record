# OJT Monitoring & DTR

Vue 3 Options API, JavaScript, Vite, Tailwind CSS and Vue Router. Supabase provides Google authentication, trusted profiles, attendance, activities, private activity photos and Admin reporting/audit reads.

## Run locally

Use Node.js ^20.19.0 or >=22.12.0 and npm.

1. Run npm ci.
2. Copy .env.supabase.example to an ignored .env.local and supply the intended Supabase browser configuration.
3. Run npm run dev.

Required browser variables: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY. VITE_SUPABASE_ANON_KEY is supported as a legacy alternative; a publishable key takes precedence. Never put secret/service-role keys or Google client secrets in VITE_* variables.

Vite loads .env.local in all modes. .env.development.local overrides development only; production builds do not load it. Configure production through .env.production.local or the build environment. Existing process environment values take precedence. Restart Vite after environment changes and rebuild for production. A successful build alone does not validate backend configuration or connectivity.

## Accounts and access

Google OAuth uses Supabase PKCE session persistence. Profiles are read from Supabase before role/status routing. New Google identities complete /signup using complete_student_registration with a Student ID and Last Name matching the active department-authorized roster, then wait at /pending. Approved Admins manage Authorized Students on the Students page; roster eligibility never auto-approves an account. Admin additions require Student Name in Last Name, First Name Middle Name/Suffix format. Missing/inactive IDs and surname mismatches cannot register; rejected accounts retain their ID claims. Deactivation blocks new registration and pending approval, while already-approved students retain access. Ambiguous legacy roster names require Admin correction before new registration or approval. Approved students enter /student; approved administrators enter /admin. Rejected and pending accounts cannot access approved workspaces. Administrators review registrations through review_student. Logout retains the confirmation dialog and signs out the local Supabase session.

See [U1.1 surname verification and rollout gate](docs/supabase-u11-roster-surname.md) before deploying the new forward migration. The old two-argument registration RPC is retired; deploy the matching frontend and reload old tabs.

Enable Google in the intended Supabase project's Auth provider settings. Configure the Google OAuth client's redirect URI to the exact callback shown by Supabase. Store the Google client secret only in provider settings. Set Supabase Site URL and allow the exact application return URL (origin plus Vite BASE_URL). Google OAuth requires browser verification with designated test accounts.

There is no public Admin signup. A trusted operator must independently verify the first administrator's Supabase UUID and verified Google identity before inserting an approved Admin profile. The guarded provisioning template in docs/supabase-s2-auth.md remains a reference; review its prerequisites and actual account before use. Never derive privileges from an email suffix or overwrite an existing student profile to bootstrap an administrator.

## Data and security

Attendance uses server-side Time In/Out/summary RPCs and Asia/Manila days. Activity creation/finalization requires the student's open attendance session. Edits use revision checks; private proof replacement commits before replacing the existing attachment. Admin pages use approved-Admin, bounded read RPCs. Activity revisions provide audit history; photos remain in private Storage and are downloaded on demand.

All schema, RLS, RPC and Storage definitions are versioned under supabase/migrations. Cleanup does not change these definitions or deploy them. Student profile workplace/progress preview fields remain explicitly labeled; profile editing is not enabled by this cleanup.

## Local validation

Docker Desktop is required for the local Supabase stack. Commands below target local validation; they do not authorize hosted deployment.

~~~powershell
npm run supabase:start
npm test
npm run test:supabase:accounts
npm run test:supabase:attendance
npm run test:supabase:activities
npm run test:supabase
npm run supabase:lint
npm run build
git diff --check
~~~

Account and Activity/Storage/Admin integration suites use synthetic local fixtures. Attendance tests use independent connections to the local Docker database. The pgTAP suite covers schema and security. Do not reset a database merely to run frontend tests. npm run supabase:reset is destructive to LOCAL data and is only for a confirmed disposable local database.

## Production verification

Before release, supply the intended production browser configuration, build, and preview the generated app. Verify Google login, session restoration, registration/review, role routing, logout, attendance, activity create/edit, private photos, Admin filters/pagination and audit history at desktop/mobile widths. Verify denied access with pending/rejected/unauthorized accounts. Do not deploy or run hosted mutations without separate authorization.

## Project history

The docs directory preserves phase reports, including historical Firebase implementation records. Their phase-specific state, test counts and superseded deployment commands are historical, not current setup instructions. Supabase is the sole current backend; Firebase configuration, SDK, emulator scripts and legacy tests are no longer required.
