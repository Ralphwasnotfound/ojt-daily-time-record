# U5.3 approximate attendance proof location

## Evidence boundary

Readable location is derived/non-authoritative. Finalized coordinates, accuracy,
`official_punch_at` and the original private selfie remain authoritative and unchanged.
No address is written to attendance evidence. No schema, Storage, RLS, attendance
submission, watermark, export or Realtime change is required.

## Architecture and authorization

The shared Student/Admin viewer reads the proof's UUID with its existing evidence
query, then independently invokes `attendance-proof-location` with `{ proofId }`.
The function verifies the JWT via Auth, checks the caller's approved Student/Admin
profile, and SELECTs the proof using the caller's JWT and anon key. Existing proof
RLS remains authoritative; an additional ownership check applies to Students.
There is no service-role key, promotion RPC or arbitrary-coordinate endpoint.
Missing and inaccessible proofs have the same neutral response. CORS is restricted
to explicitly configured application origins; responses are private/no-store.

Only finalized lat/lon plus Geoapify's required API key and fixed formatting options
are sent upstream. No JWT, student identity, timestamp, image or email is forwarded.
Application code never logs provider URLs, coordinates, addresses or raw errors.
Infrastructure may still keep request metadata; do not enable verbose/debug tracing.

`core.js` contains portable normalization/authorization/request code tested with
mocked requests. `index.ts` is the Deno Edge runtime entrypoint with a pinned
Supabase JS import. Live Edge runtime/provider acceptance remains pending.

## Provider and normalization

Geoapify: `https://api.geoapify.com/v1/geocode/reverse`, GET, `apiKey` authentication,
`format=json`, `limit=1`, English. Free plan: 3,000 credits/day, up to 5 requests/sec;
reverse lookup costs one credit. Pricing documentation permits free production use
within limits; older Terms phrase production eligibility more cautiously. Confirm
applicable terms when creating the account and again before hosted rollout.

UI attribution: Powered by Geoapify and © OpenStreetMap contributors with fixed
links; no arbitrary provider HTML/URLs are rendered. Provider privacy policy says
request details are recorded; successful request records are generally retained
no longer than 24 hours. A proxy minimizes identifying context but still discloses
coordinates to Geoapify. School approval of that processing is needed before rollout.

Normalization returns status, displayLocation, locality, cityOrMunicipality,
province, country and attribution; never the raw payload. Locality retains provider
suburb/quarter wording without inventing a Barangay label. City/town/village is
used as returned. County is called a province only if its returned wording explicitly
identifies a province; state/region and unclassified county are conservatively omitted.
This intentionally may produce municipality/country only. Missing components are
not invented; duplicates are removed. All results are labeled approximate, never
an exact building or independent presence verification.

References (checked 2026-10-04):
- https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/
- https://www.geoapify.com/pricing/
- https://www.geoapify.com/terms-and-conditions/
- https://www.geoapify.com/privacy-policy/

## Lifecycle, cache and failure

The selfie/card loads before and independently of location. A loading label then
changes to readable location or Address unavailable. Coordinates/accuracy always
remain. Close, route/identity/proof changes, retries and reopen abort or invalidate
old requests; a 9-second viewer deadline bounds unavailable functions. Provider
fetch is bounded to 6 seconds. Provider 429/5xx, malformed JSON, missing key and
network errors all give neutral unavailable behavior, without changing proof errors.

Each reader has a 32-entry memory cache keyed by proof UUID and account context,
with five-minute TTL. Vue identity watching synchronously clears it on logout or
account changes even with no viewer mounted. No localStorage/sessionStorage or DB
cache. Cache hits still follow a fresh authorized proof read when opening the viewer.
Errors are not cached. A per-worker four-lookup/second guard is conservative but
not a global/distributed quota guarantee. Monitor total provider usage before hosted
rollout; do not assume per-worker throttling enforces an account-wide quota.

## Private local setup checkpoint (not performed)

1. Create a Geoapify Free account/project and obtain an API key privately. Do not
   paste it into chat. Review provider terms/privacy and location processing first.
2. Create `.env.geocoding.local` at the repository root (already covered by `*.local`).
   In your local editor configure `GEOAPIFY_API_KEY` and
   `ATTENDANCE_LOCATION_ALLOWED_ORIGINS` (comma-separated origins such as
   `http://localhost:5173,http://127.0.0.1:5173`). Never prefix the key with VITE_.
   Verify `git check-ignore .env.geocoding.local`; restrict file permissions as appropriate.
   This file is supplied to the Edge runtime, not to Vite or a hosted secrets command.
3. Current config has `[edge_runtime] enabled = false`. Change only that local flag
   to true, preserving existing OAuth config. Restart local stack with
   `npx supabase stop` then `npx supabase start`. Do not reset or delete volumes.
4. Run `npx supabase functions serve attendance-proof-location --env-file .env.geocoding.local`
   from this repository. Keep default JWT verification enabled; do not use --no-verify-jwt.
   Restart the function serve process after changing its env file. No deployment needed.
5. Run `npm run dev`. Verify all Auth/REST/functions requests target LOCAL Supabase.

For a future separately approved hosted release, configure the same secret names
in the intended hosted project's Edge Function secrets and set allowed origins to
exact production origins. Do not set hosted secrets or deploy in this checkpoint.

## Manual local acceptance after private setup

Use the existing real LOCAL approved Student/Admin and finalized proof; create no
attendance records just to test address presentation. Open View Proof for each role.
Confirm POST body contains only proofId; proof/watermark/time/coordinates/accuracy
remain available while resolving, and an approximate address/attribution appears.
Test Inspect original, close/reopen and different proofs. Do not copy tokens or full
network headers into reports. Test function stop/offline/invalid provider setup:
Address unavailable should never block proof viewing. Verify signout/account switch
cannot retain a previous account's address. Test portrait/mobile address wrapping.
No example student coordinates are embedded or geocoded by automated tests.
