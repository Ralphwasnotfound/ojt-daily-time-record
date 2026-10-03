# U5 controlled production release plan

Prepared 2026-10-04. No commit, push, secret update or deployment executed.
Baseline: dca381b365beffe2b0636245acd3a8f3882023c3; main and origin/main aligned.
Current accepted Ready production: dpl_BKgg4ZzGHwDGNe4YBGpGsJajiRuT.
Hosted project verified read-only: OJT-DTR, nqzjjrjuxqeutdblwejn; matches production URL.

## Proposed release set (approval required)

- package.json (test command only; no new dependencies)
- src/components/AttendanceProofPhoto.vue
- src/components/AttendanceProofViewer.vue
- src/services/attendanceProofReader.js
- src/services/attendanceProofLocation.js
- supabase/functions/attendance-proof-location/core.js
- supabase/functions/attendance-proof-location/index.ts
- tests/adminAttendanceProof.test.js
- tests/attendanceProofLocation.test.js
- docs/u5-attendance-proof-watermark.md
- docs/u5-attendance-proof-location.md
- docs/u5-production-release-plan.md

Proposed message: feat: add attendance proof watermark and location
Exclude the entirety of supabase/config.toml: local Google env references/callback,
localhost return URLs and enabled local Edge runtime. Preserve this working file.
Exclude .env, all *.local credentials/config, node_modules, dist and temporary files.
No migration, database/Storage/RLS/publication/evidence change belongs in this release.

## Hosted private configuration (user action; not yet executed)

In the Supabase Dashboard, open OJT-DTR (verify project ref), then Edge Functions →
Secrets. Privately configure GEOAPIFY_API_KEY and ATTENDANCE_LOCATION_ALLOWED_ORIGINS.
The latter must be exactly https://bsit-tcc-ojt-dtr.vercel.app. Do not copy local
Google credentials or localhost origins into hosted settings. Do not use VITE_*.
Dashboard entry avoids placing the API key in shell history or process arguments.

Alternative: create an ignored permission-restricted .env.geocoding.production.local
containing only these two variables, via a local editor. Never reuse the local env
file, whose allowed origins target localhost. Confirm Git ignores the production
secret file; do not print it. The future authorized command is:

```sh
npx supabase secrets set --project-ref nqzjjrjuxqeutdblwejn --env-file .env.geocoding.production.local
```

No secret value appears in this command. Do not run it before approval. Existing
local key may be reused only if provider/account approval permits; a separate key
is preferable for independent restriction/rotation. Project secrets are shared
function environment: preserve unrelated entries and never print values/digests.

## Deployment order (each gate verified before the next)

1. Approve exact release set; stage explicit files, inspect cached diff and audit again.
2. Commit accepted source; preserve local-only config unstaged. Do not push yet.
3. User privately configures hosted secrets and confirms completion.
4. Deploy only this function:

```sh
npx supabase functions deploy attendance-proof-location --project-ref nqzjjrjuxqeutdblwejn
```

Keep default JWT verification. Do not use --prune, --no-verify-jwt, db push/reset or
seed operations. Local OAuth/Edge runtime config must never be remotely pushed.
5. Verify function exists, unauthenticated requests fail, and approved caller
   authorization/CORS work with the exact production origin. Do not auto-submit real
   coordinates to the provider before the approved acceptance step. Gateway OPTIONS
   may use wildcard CORS; inspect authenticated POST behavior rather than claiming
   the gateway preflight proves handler origin enforcement. Never weaken authentication
   to resolve a deployment issue; stop and diagnose any JWT/signing compatibility error.
6. Normal fast-forward push main. Let Git-connected Vercel build; do not deploy manually.
7. Inspect Ready source commit/domain, root/deep routes, assets and secret-free hosted
   configuration. Existing U4 backend remains compatible; U5 location failure is optional.
8. Legitimate Student/Admin manually open the same existing production proof: verify
   original selfie, watermark/official Manila timestamp/session, Inspect original,
   derived location/attribution, preserved coordinates/accuracy and close/reopen.
   No new attendance is needed. Test failures locally/mocked; do not disrupt the shared
   production key/function merely to demonstrate fallback. Do not expose bearer headers.

## Rollback (separate approval; never delete evidence)

Frontend: re-promote retained U4 deployment dpl_BKgg4ZzGHwDGNe4YBGpGsJajiRuT after
verifying it remains Ready. This restores old frontend behavior without changing U4
backend. Git reconciliation, if needed, is an ordinary revert commit, never history
rewriting or force pushing; it needs separate approval.

Edge Function: no predecessor is currently deployed. With frontend restored to U4,
the new function can remain deployed and unused. If disabling it is required, remove
only this function after separate authorization; do not touch database/RLS/Storage.
For future updates, preserve/redeploy the preceding function source/config.

Secrets/config: record which names existed before setup (currently none listed).
Privately restore previous values if any; otherwise remove only new U5 custom names
after approval when the function is unused. No reset or secret printing. Provider-key
rotation/revocation is a private provider action, separately authorized.

## Validation and limitations

65 proof/viewer tests, 28 location/handler/cache tests, 11 frontend test files,
production build and diff checks pass. Existing local Edge runtime successfully
bundled index.ts/core.js as eszip without executing a provider request. This is bundle
validation, not a separate full Deno typecheck or hosted runtime acceptance.
Candidate secret scan finds no actual local provider/Google/service credentials.
Browser bundle has no provider key variable or direct provider endpoint.

CORS must be explicitly configured hosted; localhost fallback alone is insufficient.
Per-worker burst limiting is not a global quota guarantee. Monitor provider usage.
Province formatting intentionally omits unclassified county/state fields. Provider
request logging/coordinate disclosure remains subject to school's provider approval.
