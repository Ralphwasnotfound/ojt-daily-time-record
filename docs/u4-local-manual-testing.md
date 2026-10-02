# U4 local manual testing environment

The failed manual attempt was made by the localhost frontend against **hosted**
Supabase. Browser evidence showed `attendance_days` HTTP 200 to the hosted project.
No proof RPC was observed during that retry. The local database contained no users,
reservations, proofs, objects or attendance sessions, so that attempt was not a
local U4 attempt. Its hosted outcome was not inspected or changed. The user
authorized abandoning its browser-only checkpoint for this environment switch.

## Environment arrangement

Before setup, `.env.development.local` held hosted Supabase values. `.env.local`
had no active assignments; `.env.supabase.example` was a reference file, not a
loaded environment. Vite development uses its mode-specific override.

After setup:

- `.env.development.local`: local URL `http://127.0.0.1:54321`, local **anon** key,
  and an explicitly empty publishable-key override to avoid preferring a hosted key.
- `.env.production.local`: exact copy of the prior hosted development file.
- `.env.hosted-backup.local`: exact backup of that prior file.
- `.env.local` and `.env.supabase.example`: unchanged.
- `.env.u4-test-account.local`: ignored local manual test credentials; not a loaded
  development/production env file and not imported into frontend code.

All `.local` files are git-ignored. The hosted backup, production file and test
credential file return HTTP 403 when requested from Vite. Vercel settings were
not accessed or changed; its existing production variables remain authoritative.
Never upload these local files or copy local development values into Vercel.

## Local fixture

`scripts/setup-u4-local.mjs` refuses any CLI API URL except 127.0.0.1:54321.
Privileged local credentials are read into its Node process only, never printed,
written into Vite variables or sent to hosted services.

The setup created one bootstrap approved local Admin and one local student. It
uses the existing account test harness convention: a synthetic verified Google
identity in **local** Auth, with password login for the local harness only.
This does not test real Google OAuth and does not change the Google-only login UI.

The Admin adds the authorized student/surname through `admin_add_authorized_student`.
The student calls `complete_student_registration` and becomes pending. The Admin
calls `review_student` to approve. The final profile has a trusted approving Admin,
BS Information Technology program and the existing required-hours default.
No attendance session, proof reservation or photo is created by setup.

The identities/roster are intentionally retained for manual testing. Do not run
`supabase db reset` or fixture cleanup while testing. The setup script can be rerun
against this same intact stack; it preserves the existing accounts and attendance.
After a database reset, inspect the ignored credential file and local state before
re-provisioning rather than assuming saved UIDs still exist.

## Exact login and test steps

1. Keep Docker/local Supabase running. If needed, run `npm run supabase:start`.
   Run `npm run dev` if Vite is stopped, then open **http://localhost:5173/**.
   Reload the old hosted-backed page now to abandon only its in-memory attempt.
   Do not click hosted cleanup/logout or attempt to reconcile hosted proof.
2. Open `.env.u4-test-account.local` in your editor. Use only the nested **student**
   email/password. Do not paste the file, credentials, keys or tokens into chat.
3. Open Chrome DevTools Console at localhost:5173. Run the following snippet.
   Enter the local student values in the prompts. It reuses the existing client,
   refuses a hosted destination, and does not print a session/token.

```javascript
{
  const { supabase } = await import('/src/supabase/supabase.js')
  if (supabase?.supabaseUrl !== 'http://127.0.0.1:54321') {
    throw new Error('Stop: this frontend is not using local Supabase.')
  }
  const email = prompt('Local test student email from .env.u4-test-account.local')
  const password = prompt('Local test student password')
  if (email && password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) console.info('Local login failed. Check local credentials/services.')
    else location.assign('/student/attendance')
  }
}
```

4. Do **not** use Continue with Google for this test: the local Google provider is
   intentionally unconfigured. The snippet is a local testing procedure, not a new
   application authentication feature. Normal role/status guards still apply.
5. Confirm DevTools Network shows Auth/profile/attendance calls to
   **http://127.0.0.1:54321**. Stop if any proof operation targets hosted Supabase.
6. Click Time In; allow webcam/location, capture, preview, Retake, capture again,
   and Continue. Expect local `attendance_proof_prepare`, private Storage upload,
   `attendance_proof_finalize`, then trusted summary/history reads.
7. Verify Time Out, Time In Again and final Time Out using new selfies/location;
   a third Time In stays unavailable. Test cancellation and permission denial.
   Server time/Asia-Manila day rules remain unchanged. Do not reset the database
   to bypass daily limits; use the next Manila day or separately authorized fixtures.

## Verified setup

- Local database/Auth/Storage/gateway/Realtime containers running; Auth, Storage
  and REST endpoints reachable.
- U4.1 `20261007000100` and U4.2 `20261008000100` applied locally.
- `attendance-proofs` bucket exists with public=false.
- One approved student, one approving Admin, authorized roster entry; initial
  summary next_action=time_in, no attendance records created by setup.
- Vite's **served** development module contains the local API URL, not the hosted URL.
- Vite production environment still resolves to hosted values, matching the backup.
- Credentials are browser test-user credentials only; no service-role frontend key.

Hosted resources, hosted users/data, Vercel and production settings were untouched.
No U4 migration deployment, attendance punch, U4.4 work or UI/auth refactor performed.
