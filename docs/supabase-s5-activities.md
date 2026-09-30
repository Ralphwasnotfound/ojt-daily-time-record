# S5 — Student activities and private Storage foundation

S5 is backend-only. No Vue page or active frontend service has changed. S2 account
flow, S3 attendance RPCs, S4 attendance integration and Firebase references remain
intact. There is no activity deletion API, attendance photo proof, Admin UI change,
S6 integration, or Realtime publication change. No hosted command was executed.

## Existing design and policy decisions

S1 already provided `activities(id, student_uid, attendance_session_id, category,
description, photo_path, created_at)`, a composite session/owner FK, exact category
allowlist, trimmed 1–500 PostgreSQL Unicode-character description, unique canonical
photo paths, student history indexes, RLS reads, and no browser table writes. It had
no activity mutation RPC, Storage bucket, Storage policies, or proof-existence check.
The mock Activity Update page supports both Take Photo and Choose Photo; it remains
unchanged. Activity history/dashboard activities remain mock records.

The S0 request and S1 documentation explicitly require the student's session to be
open at creation. Preparation and finalization both enforce this; upload completion
does not grant permission to submit after Time Out. Multiple activities per session
remain allowed. No session ID is accepted by a mutation RPC.

S5 intentionally supersedes the old immutable-activity policy for category,
description and proof replacement only. Editing after Time Out is allowed, as
confirmed in the S5 continuation request. Owner, session and original creation
timestamp stay fixed. Only an approved student may mutate their own activity.
S1 defines student/admin only; no coordinator role or email-based authority is added.

## Schema and migration

Migration: `supabase/migrations/20261001000100_s5_activities.sql`.

- `activities.updated_at timestamptz` starts NULL and is assigned by the edit RPC.
- `activities.revision integer NOT NULL DEFAULT 0` supports optimistic concurrency.
  Revision zero requires NULL updated_at; positive revisions require a nonnull
  timestamp at or after created_at. Existing S1 rows receive revision zero.
- The photo path check retains `student_uid/activity_uuid/proof` and additionally
  permits versioned `student_uid/activity_uuid/upload_uuid/proof` paths.
- `private.activity_proof_uploads` is the only new table. It holds server-generated
  upload/activity IDs, owner, fixed session, unique retry token per owner, exact path,
  optional base revision for replacements, timestamps, one-hour expiry, and state:
  `pending`, `attached`, `retired`, `discarded`.
- A pending reservation is not a public activity. No incomplete activities enter
  student/admin feeds. The reservation table has RLS and no browser table grants;
  private schema is not exposed by PostgREST. FK deletes restrict evidence removal.
- The cleanup index covers state/expiry. Existing activity history/session/category
  indexes and unique paths are retained.

The reservation table is needed to bind upload permission to a server-approved
activity/session, authorize immutable replacement versions, and tombstone paths
before byte deletion. A bare client-chosen path cannot provide those guarantees.

## Bucket and Storage authorization

`activity-proofs` is private, with a 5,242,880-byte limit and MIME allowlist:
`image/jpeg`, `image/png`, `image/webp`. Local Storage is enabled in config.toml;
the S3-compatible upload protocol and Realtime remain disabled locally.

- INSERT: approved student, own owner_id, exact pending unexpired reserved path.
- SELECT: approved owner under their UID prefix; approved admins may read proofs
  currently referenced by activities. Admins cannot read unsubmitted upload drafts.
- DELETE: approved owner, exact reservation already marked discarded.
- No UPDATE policy: overwrite, upsert and move of proof bytes are unavailable.
- Pending/rejected students, anonymous callers and admins cannot upload student proofs.
- No public URL access. Prefer authenticated downloads in S6. If signed download
  links are later used, keep expiry short; an issued link is a bearer capability
  until expiry and may outlive a subsequent account-status change.

The extensionless path is intentional and compatible with S1. Storage checks the
declared MIME and measured upload size, and finalization checks service-managed
metadata/owner/path. It does not authenticate camera provenance or inspect image
magic bytes. The local test demonstrates that PNG bytes declared as JPEG/WebP pass:
MIME restrictions are not malicious-content detection. S6 should decode/validate
images for UX; strict trusted content inspection would need additional server-side
processing and is not implemented here. Zero-byte objects cannot be finalized.
Live camera and gallery/file uploads use the same backend lifecycle.

Storage references: [access control](https://supabase.com/docs/guides/storage/security/access-control),
[private buckets and upload restrictions](https://supabase.com/docs/guides/storage/buckets/fundamentals),
[read-only Storage metadata guidance](https://supabase.com/docs/guides/storage/schema/design).
Production functions only read/lock Storage metadata; byte deletion uses Storage API,
never SQL DELETE from storage.objects. SQL tests use rollback-only metadata fixtures;
HTTP tests separately verify real bytes and Storage authorization.

## RPC contract

All signatures are in public. Only authenticated gets EXECUTE, with explicit
PUBLIC/anon revocations. The mutation functions are SECURITY DEFINER with empty
search_path, qualified objects, identity from auth.uid(), and a locked approved
student profile. No UID, authoritative timestamp, role or session write parameter
exists. Internal definer helpers are not callable by browser roles except the narrow
boolean predicate needed by Storage RLS.

| RPC | Arguments | Result |
| --- | --- | --- |
| activity_prepare | request_id uuid, existing_activity_id uuid DEFAULT NULL | One-row array: upload_id, activity_id, attendance_session_id, photo_path, expires_at, base_revision |
| activity_create | upload_id uuid, category text, description text | Activity row |
| activity_edit | activity_id uuid, expected_revision integer, category text, description text, replacement_upload_id uuid DEFAULT NULL | Updated activity row |
| activity_discard_proof | upload_id uuid | Exact object path now safe to remove through Storage |
| activity_history | page_size integer DEFAULT 25, before_created_at timestamptz DEFAULT NULL, before_id uuid DEFAULT NULL | Activity rows, newest first, at most 100 |

request_id is an opaque UUID retry token generated once by the caller. It does not
choose the activity ID or owner. Retrying preparation with that token returns the
same descriptor; changing its creation/replacement purpose fails REQUEST_CONFLICT.
A returned descriptor may already have expired or completed: it never renews expiry
or silently changes to a newer attendance session.

Mutations serialize on the same profile row used by S3. Creation additionally locks
the reserved attendance session and verifies it is still open. A racing Time Out
therefore either follows a completed activity insertion or wins and makes creation
fail. Edits lock the owned activity, check revision, and increment revision only on
success. Times use clock_timestamp after locks; content trims Unicode whitespace and
uses char_length, not UTF-8 bytes or JavaScript UTF-16 code-unit length.

## Create lifecycle

1. Retain one request_id per intended submission. Call activity_prepare(request_id).
   It resolves the caller's open session and allocates the exact object path.
2. Upload image bytes to activity-proofs at that path with upsert:false. No public
   activity exists yet. Do not upload inside an automatic retrying DB operation.
3. Call activity_create(upload_id, category, description). It rechecks approval,
   reservation state/expiry, own open session and committed Storage metadata.
   It inserts the activity and marks the proof attached in one DB transaction.
4. If the response is lost, read the own activity by the returned activity_id first.
   An identical create replay returns the existing revision-zero row. Conflicting
   content or an already-edited record returns ACTIVITY_ALREADY_EXISTS and requires
   rereading, never overwrites. Do not discard proof on an uncertain write result.

If the upload fails, no public activity is inserted. If finalization fails because
Time Out won or the reservation expired, the upload stays private and tracked for
discard/cleanup. The system does not reopen attendance or invent another session.

## Edit and replacement lifecycle

1. Read the own activity and its revision. Metadata-only editing calls activity_edit
   with replacement_upload_id omitted. Session/owner/created_at are never updated.
2. For a replacement, prepare using a new request_id and existing_activity_id. The
   reservation records the activity's current revision and fixed attendance session.
3. Upload to the new immutable version path. The old proof remains active throughout.
4. Call activity_edit with the revision and replacement upload_id. The transaction
   validates ownership, reservation/activity/session/revision and object metadata,
   switches photo_path, marks the old proof retired, attaches the new one, and sets
   updated_at/revision. Any failure rolls back all these changes.
5. Reconcile a lost edit response by reading the activity and comparing revision,
   content and photo_path. Blind edit replay is not idempotent: the old revision is
   rejected with ACTIVITY_CHANGED. Never delete either proof based only on a timeout.
6. Discard the retired proof, then remove its exact path via Storage API. If an
   upload succeeded but edit failed, the original remains attached and the new
   reservation can be discarded. Concurrent edits reject stale reservations.

No automatic deletion of a previous proof occurs. No activity delete RPC exists.
There is no edit audit-history table in S5; only created_at, updated_at and revision.

## Reads, errors and Realtime

activity_history is SECURITY INVOKER and uses RLS, auth.uid(), stable descending
(created_at,id) keyset pagination with page size 1–100. Supply both cursor fields
or neither. Editing preserves the pagination key. Details may use an RLS SELECT
by activity ID with maybeSingle; its associated session can be fetched through
the existing own-session RLS policy. Admin reads remain available for later S7.
Do not design S6 around unbounded history loading. S1 indexes already cover the
relevant owner/history/session/category queries; no speculative Admin index is added.

Expected error messages include AUTHENTICATION_REQUIRED, APPROVED_STUDENT_REQUIRED,
NO_OPEN_ATTENDANCE, INVALID_CATEGORY, INVALID_DESCRIPTION, INVALID_UPLOAD,
PROOF_REQUIRED, INVALID_PROOF, UPLOAD_EXPIRED_OR_DISCARDED, ACTIVITY_ALREADY_EXISTS,
ACTIVITY_NOT_FOUND, ACTIVITY_CHANGED, PROOF_IN_USE, REQUEST_CONFLICT, INVALID_PAGE.
S6 must map these to friendly messages rather than expose raw database details.

Realtime publication is deferred to S7 along with subscriptions and Admin feeds.
RLS-protected read models and stable identities are ready; no unnecessary realtime
infrastructure or frontend listener is added in S5.

## Consistency, cleanup and limitations

Storage bytes and Postgres do not form one atomic transaction. Immutable uploads,
committed-object metadata checks, DB transaction finalization, revisions and tracked
reservations provide consistency. Privileged dashboard/service maintenance can
bypass policies; it must never remove currently referenced proofs.

For an approved owner with a known upload_id: first call activity_discard_proof.
It serializes with creation/edit, rejects attached proofs, and irreversibly changes
pending/retired to discarded. Only after success may Storage remove the returned
path. Failed byte deletion is safe to retry. Discarded paths cannot be reuploaded
or attached. Keep reservation tombstones; do not delete them to recycle paths.

There is no scheduled garbage collector. Abandoned uploads, expired reservations,
retired proofs whose original upload IDs are no longer known to the browser, and
revoked accounts need trusted maintenance. They are private and tracked, not public
unowned objects. Storage quotas/reservation-rate limiting need operational monitoring.
Do not assume that expiry automatically deletes bytes.

Trusted maintenance procedure (future hosted execution needs separate authorization):

1. Identify exact owner/upload IDs in private.activity_proof_uploads for expired
   pending or retired candidates. Never collect an attached/currently referenced proof.
2. In a short database transaction lock that owner's profiles row FOR UPDATE, then
   re-read/lock the exact reservation. Recheck pending-and-expired or retired, and no
   activities.photo_path references it. Mark it discarded; commit. This follows the
   same profile lock as the RPCs and prevents a cleanup/finalization race.
3. Delete only the verified discarded path via the Storage dashboard/API in a trusted
   environment. Never expose service-role credentials to the browser or paste them
   into frontend configuration. Never delete storage.objects rows using SQL.
4. Keep the tombstone. If an in-flight upload arrives late, it cannot finalize and
   may need another Storage removal after the upload settles. Recheck before removal.

Example transaction for one explicitly reviewed candidate (replace UUID placeholders
only; this is not an automatically executed task):

```sql
begin;
select id from public.profiles where id = '<owner-uuid>'::uuid for update;
update private.activity_proof_uploads p set state = 'discarded'
where p.id = '<upload-uuid>'::uuid and p.student_uid = '<owner-uuid>'::uuid
  and (p.state = 'retired' or (p.state = 'pending' and p.expires_at <= clock_timestamp()))
  and not exists (select 1 from public.activities a where a.photo_path = p.photo_path)
returning p.photo_path;
commit;
```

If no path is returned, do not delete anything. State already discarded can be
inspected separately for retrying a previously authorized byte removal.

## Files and validation

S5 phase files, including the prior WIP commit:
- Created migration 20261001000100_s5_activities.sql.
- Created database/003_s5_activities.test.sql.
- Created tests/supabaseActivities.local.test.js.
- Created this document.
- Modified supabase/config.toml to enable local Storage/5MiB limit.
- Modified package.json to add test:supabase:activities; no dependencies installed.
- Modified database/001_s1_foundation.test.sql fixture to name S1 columns so S5's
  revision default applies; existing assertions and S1 behavior are unchanged.

Continuation fixes: the S1 composite fixture previously injected NULL into every
new column; it now lets schema defaults apply. The S5 edited-revision CHECK now
explicitly rejects NULL updated_at, with regression assertions. No S1/S3 migration,
auth/frontend/attendance implementation or Firebase reference was modified.

Final local validation:

| Check | Result |
| --- | --- |
| Local reset/migration replay | Passed, S1/S3/S5 applied in order |
| S1/S3/S5 pgTAP | 283 passed: 147 S1 + 61 S3 + 75 S5 |
| S5 real Auth/REST/Storage security suite | 16 passed (parent plus 15 cases) |
| Existing S3 concurrency suite | 5 passed |
| Existing S2 Auth/accounts integration | 7 passed |
| Normal frontend/unit suite including S2/S4 and Firebase references | 89 passed |
| Supabase schema lint | No errors |
| Production build | Passed |
| git diff --check | Passed; only normal Windows line-ending notices |

Docker was initially stopped; the installed runtime was started without installing
new software. All database/API tests use the fixed local project/loopback endpoint,
not frontend .env URLs. Real Storage tests create synthetic local Auth identities,
use ordinary tokens for permission assertions, then trusted local-only cleanup.
pgTAP fixtures roll back. No hosted credentials were requested and no hosted test
records, migrations or settings were changed. There is no separate frontend lint
script. Frontend build/test validation was not repeatedly rerun after SQL-only fixes.
The final local cleanup check confirmed zero Auth users, profiles, attendance rows,
activities, upload reservations and activity-proofs object metadata rows.

## Hosted deployment gate — commands not executed

Only after separately approving S5 deployment:

1. Confirm the existing linked target is the intended hosted test project without
   exposing credentials. Never reset hosted data. Preserve a backup and inspect
   existing activity rows/bucket/policies for unexpected manual drift. Existing S1
   legacy rows receive revision zero; missing legacy proof reservations/bytes require
   deliberate migration review, not invented proof or destructive cleanup.
2. Run `npx supabase migration list --linked`. Expected remote history contains
   20260929000100 and 20260930000100; S5 is local-only and pending. Stop for any drift.
3. Run `npx supabase db push --linked --dry-run`. The plan must contain only
   20261001000100_s5_activities.sql. Stop for unexpected migrations or changes.
4. After reviewing that exact plan, run `npx supabase db push --linked` and rerun
   `npx supabase migration list --linked`. This task does not execute either push.
5. Inspect activity-proofs: private, 5MiB, three image MIME types. Check Storage RLS
   has only the intended effective access for this bucket; permissive unrelated
   policies must not grant overwrite, arbitrary paths or broad reads. Do not delete
   unrelated bucket policies blindly. Ensure the hosted global upload limit permits
   5MiB. Keep private outside API-exposed schemas; audit RPC/table grants.
6. Use ordinary authenticated designated test students/admin/pending/rejected users
   for the checks below. Do not use service-role credentials to test user permissions.
   Do not run the local test script against hosted; it deliberately rejects that URL.

## Hosted verification checklist

These calls create real test records; obtain approval for the designated accounts and
use the minimum records. No activity UI is integrated until S6. Use the authenticated
browser client in a controlled dev console/harness; never log tokens or full sessions.

```js
// `supabase` is the existing authenticated browser client, not a service-role client.
const requestId = crypto.randomUUID() // retain across uncertain preparation retries
const prepared = await supabase.rpc('activity_prepare', { request_id: requestId })
// Check prepared.error before proceeding. Keep the returned descriptor.
const draft = prepared.data[0]
const uploaded = await supabase.storage.from('activity-proofs')
  .upload(draft.photo_path, imageFile, { contentType: imageFile.type, upsert: false })
// Check uploaded.error. imageFile is a selected/captured JPEG/PNG/WebP <=5MiB.
const created = await supabase.rpc('activity_create', {
  upload_id: draft.upload_id, category: 'Documentation', description: 'S5 designated test',
})
// Check created.error and reconcile uncertain responses by ID before cleanup/retry.
const page = await supabase.rpc('activity_history', { page_size: 25 })
const details = await supabase.from('activities').select('*').eq('id', draft.activity_id).maybeSingle()
```

- Fresh designated approved student: Time In using the existing attendance flow;
  prepare/upload/finalize one activity. A student who completed attendance today
  must wait for the next Manila day or use another approved test account; never
  delete attendance just to enable testing.
- Confirm owner/session/server created_at, exact category and Unicode 500/501 rules,
  required proof, private download, no public URL, wrong-owner paths denied, invalid
  MIME/>5MiB denied. Test both genuine image-file selection and later capture via the
  same backend, without requiring camera-only metadata.
- Retry preparation with the same token and identical creation with the same upload:
  no duplicate activity. Changed create content must not overwrite the record.
- Time Out; a reservation for a not-yet-created activity must now fail finalization.
  Existing activity metadata edits must succeed with its current revision, preserve
  owner/session/created_at, and set server updated_at. A stale revision must fail.
- Prepare a replacement with a new request_id and existing_activity_id. Failed
  upload/edit must retain the original. Successful upload/edit must atomically switch
  the path while retaining old bytes until explicit discard/Storage cleanup.
- Verify pending/rejected/admin/anonymous student mutation denial, own activity
  isolation, approved-admin read, direct table-write denial, overwrite denial,
  referenced-proof deletion denial, and discarded-proof removal/reuse rejection.
- Simulate lost create/edit responses: read by activity ID, never blindly delete or
  reallocate. Check the actual committed path/revision before deciding cleanup.
- Review pagination, S2 routing/logout and S4 attendance after deployment. Preserve
  test activity evidence unless separately approved for trusted maintenance; there
  is deliberately no browser activity deletion endpoint.

Stop at S5. S6, Admin integration, attendance camera/location/watermark proof and
hosted deployment remain separate work.
