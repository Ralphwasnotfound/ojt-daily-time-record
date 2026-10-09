# U7.5F.3E — Local backend recovery contracts

## Baselines and scope

Web repository `/run/media/lazarus/New Volume/CODE/DTR`: main, HEAD `8dec76cd90bafdec0c4a6a374b7a5dc4d205c6ab`, origin `https://github.com/Ralphwasnotfound/ojt-daily-time-record.git`. Existing modified `supabase/config.toml` and untracked U6 journal/functions/migrations/tests/experiment documents were fingerprinted before edits and preserved byte-for-byte. No existing file edited.

Mobile `/run/media/lazarus/New Volume/CODE/DTR MOBILE`: main, HEAD `f48f4d59cdedcccc26bc07d80e7b00497a7006f1`, expected mobile origin. Only existing untracked F.3C/F.3D docs; all mobile files unchanged. Both readiness/design documents and Android recovery schema/receipt/current-session fences were inspected read-only. No applicable AGENTS.md in checked repository/SQL/docs parent paths.

New files only:

1. `supabase/migrations/20261013000100_u73e_attendance_recovery_reads.sql`
2. `supabase/tests/database/015_u73e_attendance_recovery.test.sql`
3. `tests/local/u73eRecoveryRaces.py`
4. This document.

Local-only validation used existing `supabase_db_ojt-dtr-s1-local` container, with a separate empty-data `u73e_recovery_local_review` database restored from a **schema-only** dump. No retained app users, proofs, attendance or objects were copied. Synthetic fixture identities were created only in the scratch DB. Retained manual-test database was not reset, migrated or modified; no hosted service connection, Storage HTTP upload/delete, real proof bytes or production credentials. The scratch DB and fresh reader role were removed after verification.

## Independent design review

F.3D is safe for snapshot read-only observation, not for automatic mutation resumption or abandonment. NOT_FOUND can race a later prepare commit; MISSING can race a later object commit; PRESENT describes metadata, not an attendance punch; a missing receipt never proves finalize failed. No read locks can prevent a request that has not yet arrived. These APIs intentionally contain no cancellation, reset, expiry-based release or fencing mutation. Safe no-receipt abandonment remains a separate blocker requiring explicit administrator procedure or server-side terminalization/writer fencing design and authorization.

Design refinements during implementation:

- Public wrappers remain SQL STABLE SECURITY DEFINER; one private PL/pgSQL STABLE SECURITY INVOKER helper performs checked authorization and snapshot reads. It does not call the existing profile-locking mutation helper.
- Dedicated reader role has exact column SELECT plus role-targeted owner RLS; no broad direct client privileges or inherited mutation role. Local tests proved metadata can be read with this boundary.
- Managed auth schema/uid grants need an authorized schema administrator. The ordinary local postgres migration role logged ineffective auth grants during an initial run. Migration now explicitly checks critical granted privileges and fails closed; final validation ran under the local schema administrator. No broadening of client grants was used.
- Temporary owner-transfer membership is revoked only after function ownership, grants and comments are finalized; final tests prove postgres membership removed. No preexisting role is reused: an existing name aborts the migration.
- Schema-valid infinite expiry cannot be a strict Android wire timestamp; it returns UNKNOWN with no partial identity. Metadata size text is capped at 32 characters before regex/numeric conversion.

## Exact implemented signatures and response

```sql
public.attendance_proof_recovery_lookup(request_id uuid) RETURNS jsonb
public.attendance_proof_recovery_upload_status(request_id uuid, upload_id uuid) RETURNS jsonb
```

Fixed JSON object keys: contract_version (1), observed_at, student_uid (auth.uid), request_id, lookup_status, reservation, object_status, receipt_status, receipt. Nested reservation: upload_id, attendance_session_id, action_type, state, expires_at, expired. Nested confirmed receipt: id, student_uid, upload_id, attendance_session_id, action_type, official_punch_at, attached_at. Null fields are explicit. No photo path/bucket/URL, arbitrary object metadata, GPS/image/token or user-supplied owner returned. PostgREST response shape is an object, distinct from the existing Android receipt array.

| Outcome | Meaning and boundary |
| --- | --- |
| lookup `found` | Valid original caller-owned reservation, no new identity generated. |
| lookup `not_found` | No own row visible in statement snapshot. Foreign and nonexistent requests indistinguishable; not a safe retry/reset result. |
| lookup `unknown` | Inspected invariant conflict, attached-without-valid-receipt, nonfinite timestamps or inconsistent identity. No partial reservation/receipt returned. |
| object `not_checked` | Request-only lookup skips objects; no reservation also cannot probe arbitrary object. |
| object `missing` | No metadata row at fixed bucket/exact original path visible in snapshot; upload can still finish later. |
| object `present` | Same reservation path, matching owner, supported MIME, bounded positive size observed. No bytes/digest/durability/punch assertion. |
| object `invalid` | Existing exact-path object fails ownership/MIME/size validation. Remains unresolved. |
| object `unknown` | Ambiguous/conflicting object evidence. Remains unresolved. |
| receipt `missing` | Owned reservation has no visible immutable receipt; no inference of server rollback. |
| receipt `confirmed` | Exact owner/upload/session/action/path and ordered finite official timestamps match an attached reservation. Only positive punch evidence. |
| receipt `unknown` | No recovered identity or evidence inconsistency; no fabricated attendance. |

Auth/approval denied -> fixed 42501; missing UUID input -> fixed 22023 RECOVERY_ID_REQUIRED; mismatched upload on own request -> fixed 22023 RECOVERY_IDENTITY_MISMATCH. Foreign request is not_found before inspecting upload. Other DB errors propagate, never become false missing/success. Errors contain no sensitive values. Runtime Android must map errors to safe fixed states.

## Security boundary

Migration creates `attendance_recovery_reader`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, no replication/role/database creation. Only schema USAGE and required column SELECT on profiles, private reservations, receipt projection and Storage metadata; auth.uid execute. Owner-targeted SELECT policies apply solely to this role. It cannot read GPS or unrelated profile fields or execute prepare/finalize/discard; it cannot mutate attendance/Storage. No authenticated membership. Temporary public/private CREATE is removed. No anonymous/PUBLIC execution of wrappers; authenticated gets EXECUTE only. Private helper inaccessible to authenticated/anon/PUBLIC.

All functions now use explicit catalog-first, temporary-schema-last `search_path=pg_catalog,pg_temp`, explicit qualified relations/built-ins, no dynamic SQL, no path/UID argument or external calls. Helper derives auth.uid, checks student/approved before any sensitive query; revoked/completed/archived/unknown profiles fail approval check. Admin excluded despite existing receipt admin RLS. Reserved path is checked server-side then used only against fixed attendance-proofs bucket. SELECT role may inspect a wrong-owner object at the own reserved path to report INVALID, never expose its metadata/identity. No arbitrary object lookup.

All statements STABLE, no FOR UPDATE, no profile-locking helper, sequences, data-modifying CTEs, writer RPCs, object bytes or notifications. Dedicated role policies do not loosen existing authenticated Storage/RLS policies. A read-only transaction test and whole-row fixture fingerprints demonstrate no write side effects. Authorization is statement-snapshot authorization, not an instantaneous revocation guarantee; future client and server writers must independently enforce current authority.

Existing evidence: U4.1 private identity/grants/receipt FK/RLS at `20261007000100_u41_attendance_proof_foundation.sql:5-51`, approval/conditional prepare idempotency `:54-106`, Storage metadata policy `:173-195`; U4.2 finalization/time/receipt transaction at `20261008000100_u42_attendance_proof_finalization.sql:4-81`, retired writer grants `:83-91`. Vue `src/services/supabaseAttendanceProofs.js:34-64` uses same preparation/upload/finalization semantics; its byte comparison requires held Blob. Browser cleanup's repeat prepare/discard (`attendanceProofController.js:121-145`) is not used by these readers. Hosted definitions/policies remain unverified.

## Original implementation verification (historical)

Final migration compiled/committed only to the scratch DB with **no warnings/errors**, pgTAP extension only there. The shared app DB was never migrated. Repository Supabase CLI wrapper was discovered, but a --version attempt failed on sandboxed telemetry file creation; no CLI reset/start/push was attempted. Actual executed integration evidence comes from the local Supabase PostgreSQL container's psql/pgTAP, not static inspection or a mock DB.

- New pgTAP suite: **62/62 passed**, transaction rolled back. Covers approved owner, collision A/B, foreign request/upload, pending/rejected/admin/anon/missing user, null inputs, role/grants/RLS/private helper, Storage private flag, missing/present/wrong owner, MIME/size/NaN/null/oversized text, identity preservation, no fabricated receipt, minimal data, duplicate read/valid exact receipt, restricted columns, actual reader RLS and infinite-expiry UNKNOWN.
- Deterministic multi-connection driver: **10/10 checks passed**. No sleep/poll-based race assertions. Writer holds an uncommitted actual prepare for synthetic local account; observer reports NOT_FOUND, then FOUND after commit with same upload. Separate metadata fixture transaction yields MISSING before commit and PRESENT afterward; no attendance receipt invented. This is catalog-commit visibility, **not** an actual Storage HTTP acknowledgment/byte-upload test. Both functions executed inside an actual BEGIN READ ONLY transaction. Whole-row fingerprints across profiles/reservations/attendance/receipts/objects unchanged by read reconciliation.
- Existing U4.1 proof foundation suite: **80/80 passed**, rollback. Its unchanged legacy fixture helper was expanded into a temporary stdin script because container psql cannot resolve the host-side relative include.
- Existing U4.2 finalization suite: **78/78 passed**, rollback. Synthetic local SQL/metadata only, no production punch or Storage upload.
- Total: **220 pgTAP assertions + 10 deterministic checks passed**. No static check counted as an integration test.
- Whitespace/scope checks passed. Android tests/build/lint not rerun: Android is read-only. No Samsung/emulator tests this phase.

Logs: `/tmp/u73e-migration.log`, `/tmp/u73e-pgtap.log`, `/tmp/u73e-races.log`, `/tmp/u73e-u41-regression.log`, `/tmp/u73e-u42-regression.log`. Early test setup errors were corrected and final runs above passed: missing schema-only bucket fixture, ineffective ordinary auth grants, pgTAP function lookup under the intentionally restricted reader role, and host-relative include. An intermediate attempt to delete a scratch metadata row was rejected by Storage's protective trigger; the test was removed rather than bypassing the guard. No Storage API delete occurred and the failed test transaction rolled back.

## Reproduction and deployment prerequisites

Do not run a reset against retained manual-test data. Use an isolated database in the local Supabase DB container, restore schema only, and verify auth/storage catalog prerequisites. Create pgTAP in extensions there. Apply the new migration with an authorized schema administrator using psql ON_ERROR_STOP. Run the pgTAP file under a local fixture administrator (reader-role SET ROLE test requires this), then the Python driver. Driver pins container/database names and has no URL/credential/production fallback. It creates synthetic rows only in the scratch DB; drop that DB and fresh test role after execution. Do not point it at the shared postgres DB. Migration role collision should abort, not auto-drop/reuse.

Deployment is **not approved**: independently review definer grants/role compatibility/RLS and exact JSON contract, then separately authorize environment migration. Verify actual migration history, complete effective policies, metadata formats, bucket/legacy grants and endpoint behavior using read-only approved/denied identities. Local tests do not prove hosted Supabase permission compatibility. No hosted credentials introduced into Android and no remote activation switch.

## Required Android integration — not implemented

Current RecoveryJournal schema 1 (`recovery/RecoveryJournal.kt:11-21`) permits no IDs in PrepareIntent. New strict JSON envelope decoder and separately reviewed schema enrichment are required; server identity recovery must not masquerade as acknowledgment or authorize later mutation. Validate current owner/request/action/session/upload at every boundary and perform identity/revision CAS with the existing coordinator client/session/authorization generation. Reject malformed/unknown/contradictory envelopes and enforce the existing 64 KiB streaming bound before decoding. Negative reads keep same durable attempt and block new work. No path/image/GPS persistence.

Current SdkRecoveryReader only GETs receipt arrays; it cannot consume these new object RPCs unchanged. New read-only POST RPC transport needs pre-dispatch redirect rejection and current lease fencing. Existing confirmAndClear remains receipt-only and cannot accept mere FOUND/PRESENT. UI exposes generic statuses, trusted attendance summary alone updates hours/widgets. DisabledProofBackend remains hardcoded; no Android activation or mutation retry.

## Remaining blockers and verdict

- Safe terminal abandonment/fencing of no-receipt unresolved requests still undesigned/unapproved. Lookup does not solve permanent single-slot blockage for expired/discarded/absent evidence.
- Android envelope client/schema enrichment not implemented; live adapter/redirect/factory activation remains disabled.
- Hosted schema/grants/Storage metadata and production OAuth unverified; isolated actual Samsung process-death recovery unverified.
- Metadata presence is not proof of intended bytes, physical blob durability or remote request completion; no direct Storage API integration test executed.
- Reader role/managed schema compatibility and all effective grants require independent review before deployment. Unexpected existing role name stops migration.

Final web scope: **four new files only**, nothing staged; preexisting config/U6 work preserved. Mobile remains unchanged with only prior F.3C/F.3D untracked docs. No commit/push, migration deployment, hosted changes, real proof uploads, production attendance mutations or emulator.

**READY FOR ADVERSARIAL SQL REVIEW: YES.**

**READY FOR DEPLOYMENT: NO.**

**READY FOR LIVE ATTENDANCE: NO.**

## Independent adversarial SQL review and correction

The follow-up reviewed actual migration, RLS, grants, original writer/receipt constraints, Android contracts (read-only), and local catalog behavior. No hosted introspection or deployment occurred.

### Medium — temporary type shadowing (corrected)

Original migration functions at lines 42, 115 and 119 used an empty search_path. PostgreSQL implicitly searches the temporary schema first for types when it is not explicitly placed. An authenticated direct-SQL caller with TEMP privileges could define a temporary uuid domain whose CHECK executes attacker-defined code. The wrapper's `null::uuid` and helper's local uuid declaration resolved that domain; the probe executed as attendance_recovery_reader even before authentication/approval rejection. This violates the intended fixed read-only definer call graph. The role is narrowly privileged, not a superuser, and ordinary RPC HTTP access does not itself provide arbitrary DDL/TEMP access.

Minimal correction: all three function search paths explicitly put pg_catalog first and pg_temp last. Qualified relations and function calls, signatures, ownership, grants and response semantics remain unchanged. Three malicious-domain regressions run BEFORE the first RPC compilation in the test backend, covering pending lookup, pending upload status and approved lookup. A pre-fix probe recorded privileged execution; the initial regression run failed two assertions with UNTRUSTED_DOMAIN_EXECUTED. All final regressions pass against the applied corrected scratch migration. This fixes the confirmed blocker.

### Privilege, ownership and contract assessment

Reader role is NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS; no client membership, no retained migration membership or schema CREATE. Column-restricted SELECT and owner RLS exclude unrelated profiles/GPS and foreign reservations/receipts. It cannot execute prepare/finalize/discard or mutate attendance/Storage. Helper is invoker and callable only by its owner. Public wrappers are definer and STABLE. Actual local default ACLs also retain EXECUTE for trusted postgres/service_role operators, besides authenticated/owner; PUBLIC and anon have none. Operator calls still run the same derived-identity/approved-student gate. Deployment review must inspect effective environment default grants rather than assuming authenticated is the only ACL entry.

Storage PRESENT proves only observed catalog metadata at the exact reserved path and fixed private bucket with matching owner and valid MIME/size. It does not prove physical bytes, intended-image digest, durability, immutable contents or successful attendance. A later replacement/removal can change evidence. Reads never lock or call writers. Missing/negative observations never authorize retry, reset or abandonment. JSON projection remains fixed and omits proof paths, content, GPS, credentials and other-owner identity.

### Targeted tests and actual final results

- Recovery pgTAP: **69/69 passed** (62 original + 3 temp-type + 4 missing-profile/revocation/role-change assertions), rolled back.
- Foundation pgTAP: **80/80 passed**, rolled back.
- Finalization pgTAP: **78/78 passed**, rolled back.
- **227 pgTAP assertions total; zero final failures.**
- Deterministic driver: **14/14 checks passed** (10 original + uncommitted finalize/missing receipt, committed finalize/confirmed receipt, authorized READ ONLY snapshot, concurrent approval revocation denied on next READ COMMITTED statement).
- Actual finalize in this driver is synthetic SQL only in the scratch DB, using a synthetic metadata fixture; no live/hosted attendance mutation or Storage HTTP upload.
- Python syntax compilation and whitespace checks passed. The earlier nested-quote edit failed at parsing before any write and made no changes.

Commands executed: schema-only pg_dump piped into scratch psql; psql -X -v ON_ERROR_STOP=1 on the migration, expanded unchanged 009 foundation suite, 010 finalization suite and 015 recovery suite; python3 tests/local/u73eRecoveryRaces.py. All target the pinned local container and u73e_recovery_local_review database. Because psql exit status alone does not detect pgTAP assertion failures, final logs were explicitly checked for `not ok`, errors and failed plans.

Final logs: /tmp/u73e-review-migration.log, /tmp/u73e-review-after.log, /tmp/u73e-review-u41.log, /tmp/u73e-review-u42.log, /tmp/u73e-review-races.log. Early legacy reruns had one assertion failure each due to committed race fixtures affecting global counts; a subsequent fresh run had one bucket-restriction assertion failure because its scratch bucket fixture omitted size/MIME restrictions. Both setup issues were corrected without changing the legacy suites; final clean runs above passed.

### Remaining findings and unexecuted scenarios

- Low test-harness limitation: query() waits without an overall read deadline; a stalled database could hang this local harness. No production defect demonstrated, unchanged and deferred.
- SQL fixtures set trusted request identity GUCs; they do not exercise real JWT verification/expired-session rejection at the HTTP gateway. Expired-session HTTP tests were NOT RUN.
- Dedicated simultaneous-read barriers, metadata replacement/lookup-timeout injection and owner-change/corrupt-receipt fixture probes were NOT RUN in this correction. Snapshot/read-only/grant analysis and existing cross-account/identity assertions cover part of these risks, not complete live integration evidence.
- Approval is statement-snapshot authority. A transaction with repeatable-read or a statement already in progress can observe earlier approval; future client lease fencing and writer authorization remain mandatory. READ COMMITTED revocation between statements was executed and denied safely.
- Hosted permissions/metadata behavior, HTTP error redaction, Android envelope decoder/schema enrichment, safe terminal abandonment, Storage byte delivery and process-death integration remain unverified/unimplemented as documented above.

Only the four U7.5F.3E files were edited in this review: migration, recovery SQL tests, deterministic Python driver and this verification document. No Android/iOS/Vue source changes, staging, commit, push, credentials, proof images or GPS records introduced. Unrelated web work and mobile documents were checked by byte fingerprints. Final scratch database and fresh reader role cleanup is verified separately; the retained local app database was not migrated.

**READY FOR GIT CHECKPOINT: YES — corrected local backend scope only.**

**READY FOR DEPLOYMENT: NO — environment/HTTP/integration prerequisites remain.**

**READY FOR LIVE ATTENDANCE: NO.**
