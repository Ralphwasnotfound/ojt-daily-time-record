# U1 — Authorized Student Roster and Registration Validation

Local implementation and validation complete. No hosted database operation, deployment, reset, U2 work, CSV import, or account-reassignment workflow was performed. Google OAuth, routes, review_student, attendance, activities, private proofs and audit protections remain unchanged.

## Migration and schema

`supabase/migrations/20261004000100_u1_authorized_students.sql` is the only new forward migration. It creates `private.authorized_students` with:

- `student_id text PRIMARY KEY`, uppercase ASCII letters/numbers/hyphens, 3–30 characters, same canonical format as profiles.
- `expected_name text NULL`, trimmed, 1–100 characters when present; a reference for human review only.
- `is_active boolean NOT NULL DEFAULT true`.
- `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`.
- `created_by uuid NULL REFERENCES public.profiles(id) ON DELETE RESTRICT`.

Claim UID/time and registration state are derived by joining profiles on its unique Student ID. There are no duplicate claim fields. Student IDs are immutable through the provided APIs. No delete, release, rename or reassignment API exists. Future bounded batch import can reuse the same canonical key and validation; U1 implements single additions only.

## Backfill

The migration locks profiles against concurrent writes, inserts every existing student ID (pending, approved and rejected), then replaces the registration function in the same transaction. Existing names become reference names, not independently verified names. Backfilled creator is NULL and roster creation time is migration time; actual claim time remains profile.created_at.

No existing profile or dependent row is updated. The integration test replays the actual migration in a rollback-only transaction with all three statuses and compares profiles, attendance, activities, activity revisions and Storage object records before/after. It restores the already-migrated local schema when that transaction rolls back. Historical migration files are unchanged.

The table lock alone is NOT a guarantee against a registration request already executing the old function. Hosted deployment must block new registration calls and drain old transactions before applying U1.

## Registration and locking

`complete_student_registration(full_name text, student_id text)` preserves its profile return contract. It requires auth.uid(), a confirmed Auth email and a matching verified Google identity from Auth-managed data. It locks the caller's Auth row, rejects any existing profile, validates canonical input, then SELECTs the matching roster row FOR UPDATE.

Missing/inactive authorization raises `STUDENT_ID_NOT_ELIGIBLE`. An existing profile for the ID raises `STUDENT_ID_ALREADY_REGISTERED`. Successful insertion still fixes student/pending/BS Information Technology/486 hours and trusted email on the server. No authority fields are accepted from the browser.

Both the roster lock and existing profiles_student_id_key protect competing accounts; the Auth lock serializes competing requests by one account. Only that named profile uniqueness constraint is remapped in the exception handler; unrelated unique violations propagate normally. Failed statements roll back and leave no reserved claim.

Deactivation UPDATE takes the same roster row lock. If deactivation commits first, a waiting registration fails. If registration commits first, the pending profile remains and deactivation only blocks future registrations. Approval/rejection does not release claims. Deactivating an existing ID does not revoke account access or block normal Admin review.

## Admin API and security

- `admin_authorized_students(search_text text DEFAULT NULL, page_size integer DEFAULT 25, after_student_id text DEFAULT NULL) RETURNS jsonb`
- `admin_add_authorized_student(student_id text, expected_name text DEFAULT NULL) RETURNS void`
- `admin_set_authorized_student_active(student_id text, is_active boolean) RETURNS void`

List pages are bounded to 1–100 rows, ordered by canonical Student ID, using an exclusive keyset cursor. Search is literal case-insensitive substring matching against ID, reference name and registered name; it is not SQL wildcard input. Search text is bounded to 100 characters. The list derives not_registered/pending/approved/rejected from profiles and keeps eligibility separate. A full page is a next-page hint; the next page may be empty. Concurrent changes are reflected on refresh, not a frozen snapshot across pages.

The list uses existing private.require_admin(). Mutations hold FOR SHARE on the authenticated approved Admin's profile and assign creator/server time themselves. Duplicate addition raises `STUDENT_ID_ALREADY_AUTHORIZED`; it does not overwrite or reactivate a row. There is no coordinator role added: management uses the existing approved Admin role.

RLS is enabled with no direct roster policies; table privileges are revoked from PUBLIC, anon and authenticated. Private schema is not exposed as a REST directory. Public RPCs are SECURITY DEFINER with empty search_path, qualified relations and no dynamic SQL. PUBLIC/anon execution is revoked. Granting authenticated execution does not bypass each function's trusted authorization checks. Students cannot list, add, activate, directly read or mutate roster rows. The registration result does not include roster reference names or other claimants' details. No service credentials were added to browser code.

## UI and errors

AuthorizedStudents.vue adds a responsive section to Admin Students while preserving Pending Registrations and the full Student Directory. It supports optional reference names, add, activate/deactivate, submitted server search, 25-row keyset pages and refresh. Pending review also refreshes the roster's derived state.

The component uses Vue Options API and the existing Admin API/page controller. Mutations disable duplicate submissions, account/unmount generations suppress late results, and logout clears form/list state. RPC requests retain the existing timeout and account-identity checks. Uncertain mutation results ask the Admin to refresh before retrying; no automatic write retry is introduced. No histories, photos or revisions are eagerly fetched.

Signup retains form values on failure and displays department-authorization guidance. Missing and inactive IDs share the same friendly message. Already-registered IDs receive the requested contact-Admin message. Other errors stay generic; an arbitrary 23505 is no longer mistaken for a claimed ID. There is no availability check, autocomplete or client-side roster authorization.

## Validation

| Check | Result |
| --- | --- |
| Focused U1 frontend suite | 11 passed |
| Full frontend/unit suite (including U1 auth mapping) | 164 passed |
| Account integration | 7 passed |
| U1 roster/backfill/concurrency integration | 7 passed |
| Attendance concurrency integration | 5 passed |
| Activity/Storage/Admin integration | 18 passed |
| Full pgTAP suite | 473 assertions passed across 6 files; 80 new U1 assertions |
| Local schema lint | No errors |
| Production build | Passed |
| git diff --check | Passed |

U1 concurrency tests use independent local PostgreSQL connections and inspect lock waits before release, rather than relying on timing alone. Both activation race orders and competing claims passed. Integration fixtures are synthetic local identities and are cleaned in finally. No existing security assertions were removed. S1/account registration fixtures now authorize their test IDs before registration.

Commands used (local database already running):

```powershell
node node_modules/supabase/dist/supabase.js migration up --local
node --experimental-vm-modules --test tests/supabaseRoster.test.js
npm test
npm run test:supabase:accounts
npm run test:supabase:roster
npm run test:supabase:attendance
npm run test:supabase:activities
npm run test:supabase
npm run supabase:lint
npm run build
git diff --check
```

Docker/CLI checks required permission outside the filesystem sandbox. The initial migration syntax error was corrected before successful local application; the failed transaction rolled back. No database reset was needed. Frontend coverage includes compiled component rendering and method/controller behavior, not live hosted OAuth or a visual browser session.

## Hosted rollout gate — not executed

1. Obtain separate deployment approval. Independently confirm the intended linked project's identity, existing S1–S7 migration history and backup/recovery readiness. Never print service credentials or copy local test identities to hosted Auth.
2. Inspect the planned deployment with `npx supabase migration list --linked` and `npx supabase db push --linked --dry-run`. Stop if anything other than the reviewed U1 migration is pending or schema drift is unexplained.
3. Establish a short registration maintenance window at the server boundary. A trusted operator can temporarily `REVOKE EXECUTE ON FUNCTION public.complete_student_registration(text,text) FROM authenticated;` and commit it before migration. Confirm old in-flight registration transactions have finished; do not assume a frontend maintenance banner drains direct RPC calls. Pause other privileged profile provisioning too. If rollout is cancelled, explicitly restore the prior grant after review.
4. With separate authorization, run `npx supabase db push --linked`. The migration backfills/replaces atomically and restores authenticated registration execution at commit; only roster-qualified registration is then allowed. Do not reset hosted data. If migration fails, keep the registration gate in place and inspect the failure rather than bypassing roster checks.
5. Verify backfill coverage, unchanged profile status/identity/counts, all RPC signatures/grants, private table denial and current migration history. Do not change old accounts to make a check pass.
6. Separately release the frontend with correct production Supabase browser configuration. Development-only environment variables do not configure production builds. No new variable or secret is required by U1.
7. Using designated accounts/IDs, verify Admin add/search/pagination, duplicate ID error, unauthorized and inactive denial with identical student messages, authorized pending registration, duplicate claim rejection, existing approval/rejection, and inactive existing-account continuity. Verify logout/refresh and desktop/mobile usability. Check attendance, activity/private photos and audit monitoring still work.
8. Preserve test claims or clean only narrowly identified synthetic fixtures through an approved operator procedure. U1 deliberately has no public release/delete API. Do not remove legitimate users or history.

## Limitations

- An authorized ID is permission to request registration, not proof of identity. Someone knowing an unclaimed ID can submit it; human Admin review remains mandatory.
- No public roster enumeration exists, but registration success/failure necessarily reveals some eligibility. Rate limiting, invitations or stronger identity binding are separate future work.
- Existing rejection remains terminal under review_student; no reassignment/re-registration workflow is added.
- Substring search may need indexing at larger scale; result size is bounded now. CSV import is deferred.
- Backfill records prior student profiles, including rejected profiles, without asserting independently verified roster membership.
- Hosted deployment, real Google OAuth and manual desktop/mobile verification remain outstanding. U2 has not started.
