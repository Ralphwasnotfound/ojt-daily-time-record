# U1.1 — Student ID + Last Name roster verification

Implemented and validated locally only. Hosted Supabase was not accessed or modified. No deployment, reset, U2 work, CSV import, notification, failed-registration queue, or identity reassignment was added. The deployed U1 migration is unchanged.

## Forward schema evolution

`20261005000100_u11_roster_surname.sql` adds nullable `normalized_last_name` to the existing private roster. A check constraint ensures any non-NULL stored value agrees with the structured expected_name. Existing keys, eligibility flags, creator metadata and reference names are preserved. RLS/table privileges remain private and deny direct browser access.

Admin additions now require a nonblank Student Name in `Last Name, First Name Middle Name/Suffix` format, at most 100 characters. Exactly one comma and nonempty surname/given-name sides are required. Examples: `Batiancila, Ralph Joseph R.` and `Lantong, Joseph A. II`. The stored expected_name retains the trimmed Admin-entered text; the surname is derived once on add/correction and stored for registration comparison.

## Normalization

The private server helper trims/collapses whitespace, applies Unicode NFC and PostgreSQL lowercase. Whitespace includes ordinary whitespace and the explicit Unicode whitespace set already handled by the existing trim helper. Repeated internal whitespace becomes a single space. Matching is exact after normalization, not fuzzy.

- Batiancila / BATIANCILA / batiancila / surrounding spaces match.
- Compound surnames preserve word boundaries; `De   La Cruz` matches `de la cruz`.
- Composed/decomposed Unicode accents match (tested with Peña).
- Accents are not removed: Pena is different from Peña.
- Hyphens, apostrophes and other punctuation are preserved, including differences between straight and curly apostrophes.
- No compatibility normalization, transliteration, punctuation stripping, substring matching or edit-distance matching occurs.
- Case behavior follows PostgreSQL's database locale; this is not an unrestricted Unicode case-folding algorithm. Unexpected name variants should be corrected with the department, not silently approximated.

## Registration signature and atomicity

The migration drops `complete_student_registration(text,text)` and exposes only:

`complete_student_registration(full_name text, student_id text, last_name text) RETURNS public.profiles`

There is no default surname or executable two-argument overload. PUBLIC and anon execution are revoked; authenticated execution is granted. Tests verify both absence of the old function and failure of a two-argument call. Old browser tabs must reload after rollout; restoring the legacy function is not a permitted compatibility fix.

Verified Google/Auth identity checks, Auth-row lock, existing-profile rejection, canonical ID validation, roster-row FOR UPDATE lock and profile UNIQUE constraint remain. The locked roster must be active, have a stored verification surname, and exactly match the submitted normalized last name before claim checks/profile insertion. UID/email/student role/pending status/program/required hours remain server-owned.

Unknown ID, inactive ID, missing migrated surname and wrong/blank surname all produce `STUDENT_IDENTITY_NOT_ELIGIBLE`. The UI says: “The Student ID or last name could not be verified. Please check your information or contact the BSIT Department.” No expected values or existence details are returned. Claimed-ID errors occur only after surname eligibility succeeds. Failed verification creates no profile or Admin pending request and sends no notification.

Signup retains Full Name as the profile/display name and adds required Last Name solely for verification. It does not parse Google names or make roster availability requests. Local required-field validation does not determine eligibility; failed submissions preserve all entered values.

## Existing data and correction

Backfill derives a surname only from a name satisfying the explicit one-comma format with nonblank sides and the length limit. It does not guess the last word of a Google/display name. Ambiguous, blank, multiple-comma or otherwise invalid old names keep normalized_last_name NULL. No roster entry is deleted; active flags remain as recorded. A NULL surname fails closed for new registration and pending approval even if active=true.

The Admin list returns `verification_ready`, not normalized surname. The UI labels unresolved rows “Name correction required before registration or pending approval.” A new approved-Admin-only RPC corrects the structured name:

`admin_update_authorized_student_name(student_id text, expected_name text) RETURNS void`

It takes a shared authorization lock on the approved Admin profile, then updates the existing roster row (serializing against registration/approval). It changes only expected_name and normalized_last_name. Corrections are permitted for claimed IDs, but cannot change the Student ID, profile name, role, approval status, UID or claimant. Correcting a claimed reference does not require an existing student to register again. Invalid correction leaves the original row unchanged.

## Pending approval guard

The existing bounded `admin_students` RPC now includes `roster_eligible` from current active + surname-ready roster state. No public/student lookup endpoint was added. Pending cards show green AUTHORIZED / ROSTER VERIFIED or red NOT CURRENTLY ELIGIBLE. Red disables Approve and its confirmation action; Reject stays available. Local handlers also fail closed on missing eligibility. Roster changes on the same page refresh pending cards; external changes appear on refresh.

`review_student` retains its Admin authorization lock, pending-target lock and approval metadata. Approval additionally locks the matching roster row FOR UPDATE and rejects missing/inactive/unresolved authorization with `ROSTER_APPROVAL_NOT_ELIGIBLE`. Rejection does not require current eligibility. A stale green UI cannot bypass this check. Eligibility changes and approval serialize on the same row: approval that commits first remains valid; a prior deactivation blocks approval.

Green indicates current roster validity for the already-claimed profile ID, not independent real-world identity proof or a comparison against the editable display name. Pre-U1.1 pending profiles with unresolved roster names need Admin correction before approval; the migration does not fabricate historical surname verification. Existing approved accounts never gain a continuous roster check: workspace, history, attendance and activities remain profile-role/status controlled.

## Security and scope

All new/updated RPCs retain SECURITY DEFINER, empty search_path, qualified objects and fixed queries. Helper execution is revoked from browser roles. Admin correction uses the existing approved Admin model; no coordinator role or email-based privilege is introduced. Student roster enumeration, direct reads/writes and authority-field injection remain denied. No browser service key or new dependency was added.

Knowing an ID and surname is still not proof of identity; final human Admin approval remains necessary. There is no rate limiter in this change, and successful registration inherently reveals some eligibility. No claim-release or reassignment workflow exists. Bulk import and U2 remain deferred.

## Validation

| Check | Result |
| --- | --- |
| Focused U1.1 frontend tests | 6 passed |
| Complete frontend/unit suite | 170 passed |
| Account integration | 7 passed |
| U1/U1.1 roster/backfill/concurrency | 8 passed |
| Attendance concurrency | 5 passed |
| Activity/Storage/Admin integration | 18 passed |
| Full database pgTAP | 521 assertions passed across 7 files |
| Schema lint | No errors |
| Production build | Passed |
| git diff --check | Passed |

The actual U1 and U1.1 migrations are replayed inside rollback-only local integration transactions. U1.1 replay compares pre/post roster fields and profiles, attendance, activity, Storage and audit records and checks ambiguous/NULL/multi-comma names stay unresolved. Roster claim tests demonstrably queue competing transactions on row locks. The approval tests verify deactivation denial, reactivation, rejection while inactive, and continued attendance/activity preparation after approval followed by deactivation and name correction. Synthetic identities are cleaned up. No deployed migration was edited, and no local reset was needed.

Commands run against the fixed disposable local environment:

```powershell
node node_modules/supabase/dist/supabase.js migration up --local
node --experimental-vm-modules --test tests/supabaseRosterSurname.test.js
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

Frontend tests compile/render components and exercise handlers; they are not a hosted browser/OAuth or visual device test.

## Hosted rollout gate — not executed

1. Obtain separate authorization. Confirm the linked project, a recovery backup and synchronized history through U1. Inspect `npx supabase migration list --linked`, then `npx supabase db push --linked --dry-run`. Only `20261005000100_u11_roster_surname.sql` should be pending; stop on unexplained drift.
2. Coordinate a brief registration/review maintenance window. A privileged operator should revoke authenticated execution on the old `complete_student_registration(text,text)` and `review_student(uuid,text)` and commit that gate. Block new requests and wait for in-flight registration/review transactions to finish. Pause other privileged profile/roster writes. A UI banner alone cannot gate direct RPC callers.
3. With deployment approval, apply `npx supabase db push --linked`. The transaction preserves the roster, adds/backfills the surname, retires the old RPC and creates the new path. Do not reset hosted data. The migration grants the new registration signature at commit. If it fails, investigate while the maintenance gate remains in place; do not reintroduce a bypass.
4. The maintenance revocation of review_student is retained by CREATE OR REPLACE. After verifying the guarded definition, explicitly restore `GRANT EXECUTE ON FUNCTION public.review_student(uuid,text) TO authenticated;` through the trusted operator. If rollout is abandoned before migration, restore only the appropriate prior grants after review.
5. Verify the two-argument registration function is absent, the three-argument function is the only registration overload, and PUBLIC/anon cannot execute it. Verify private roster privileges/RLS. Check original row counts/IDs/statuses and correction-required counts without exporting student data.
6. Release the matching frontend with the intended production Supabase configuration. Force/recommend reloading old tabs. Correct ambiguous unregistered or pending roster names in the Admin UI; do not invent surnames. Already-approved users need no correction to retain access.
7. With designated test accounts, check correct/case/whitespace surnames, generic missing/inactive/wrong failures, no pending request after failure, duplicate claims, pending green/red, direct approval denial while inactive, reactivation, rejection, and continued approved-account attendance/activity access after deactivation. Verify desktop/mobile usability and existing OAuth/logout/history/private-photo/audit flows.
8. Keep or clean only explicitly designated synthetic fixtures through an approved operator procedure. Never delete legitimate profiles/history or restore the old surname-free RPC as a rollback shortcut.

Hosted verification and manual browser/device checks remain outstanding. U2 has not started.
