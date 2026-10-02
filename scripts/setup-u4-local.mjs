// Manual U4 fixture setup. Local CLI credentials stay in this Node process only.
// Never import this file into the frontend. No hosted URL/env fallback is allowed.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync, existsSync, constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import assert from 'node:assert/strict'

const config = JSON.parse(execFileSync(process.execPath,
  ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
assert.equal(config.API_URL, 'http://127.0.0.1:54321', 'Only the local stack is allowed')
assert.equal(JSON.parse(Buffer.from(config.ANON_KEY.split('.')[1], 'base64url')).role, 'anon')
const development = '.env.development.local', backup = '.env.hosted-backup.local', production = '.env.production.local'
const before = loadEnv('development', process.cwd())
if (before.VITE_SUPABASE_URL !== config.API_URL) {
  assert.ok(new URL(before.VITE_SUPABASE_URL).hostname.endsWith('.supabase.co'), 'Unexpected environment; inspect manually')
  if (!existsSync(backup)) copyFileSync(development, backup, constants.COPYFILE_EXCL)
  else assert.equal(readFileSync(backup, 'utf8'), readFileSync(development, 'utf8'), 'Do not overwrite a different backup')
  if (!existsSync(production)) copyFileSync(development, production, constants.COPYFILE_EXCL)
  else assert.equal(loadEnv('production', process.cwd()).VITE_SUPABASE_URL, before.VITE_SUPABASE_URL, 'Production mismatch; inspect manually')
}
writeFileSync(development, '# Local U4 manual testing only. Production values are preserved separately.\n' +
  `VITE_SUPABASE_URL=${config.API_URL}\nVITE_SUPABASE_PUBLISHABLE_KEY=\nVITE_SUPABASE_ANON_KEY=${config.ANON_KEY}\n`)
assert.equal(loadEnv('development', process.cwd()).VITE_SUPABASE_URL, config.API_URL)
assert.ok(new URL(loadEnv('production', process.cwd()).VITE_SUPABASE_URL).hostname.endsWith('.supabase.co'))
console.log('Development: LOCAL. Production: hosted values preserved. No keys logged.')

function sql(input) {
  try { return execFileSync('docker', ['exec', '-i', 'supabase_db_ojt-dtr-s1-local', 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() }
  catch { throw new Error('Local fixture SQL failed. No secrets logged; inspect local state before retrying.') }
}
async function ok(operation, label) {
  const { data, error } = await operation
  if (error) throw new Error(`${label} failed (${String(error.code || error.status || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')})`)
  return data
}
const client = key => createClient(config.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const root = client(config.SERVICE_ROLE_KEY)
// Vite denies .env.* files; the credentials must never be served as a dev asset.
const credentialsFile = '.env.u4-test-account.local'
let fixture
if (existsSync(credentialsFile)) {
  fixture = JSON.parse(readFileSync(credentialsFile, 'utf8'))
  assert.equal(fixture.url, config.API_URL)
} else {
  fixture = { url: config.API_URL, studentId: 'U4-MANUAL-' + randomUUID().slice(0, 8).toUpperCase(),
    admin: { email: `u4-admin-${randomUUID()}@example.invalid`, password: randomUUID() + 'aA1!' },
    student: { email: `u4-student-${randomUUID()}@example.invalid`, password: randomUUID() + 'aA1!' } }
  writeFileSync(credentialsFile, JSON.stringify(fixture, null, 2), { flag: 'wx' })
}
function save() { writeFileSync(credentialsFile, JSON.stringify(fixture, null, 2)) }
assert.match(fixture.studentId, /^U4-MANUAL-[A-F0-9]{8}$/)
for (const role of ['admin', 'student']) {
  const who = fixture[role]
  assert.match(who.email, /^u4-(admin|student)-[0-9a-f-]{36}@example\.invalid$/)
  if (!who.id) {
    const { user } = await ok(root.auth.admin.createUser({ email: who.email, password: who.password, email_confirm: true }), `Create local ${role}`)
    who.id = user.id; save()
  }
  assert.match(who.id, /^[0-9a-f-]{36}$/)
}
// Same explicit local bootstrap/synthetic Google identity convention as existing
// account integration tests. This does not change auth rules or fake a Google flow.
sql(`insert into public.profiles(id,full_name,email,role,status,approved_at)
  values('${fixture.admin.id}','U4 Local Test Admin','${fixture.admin.email}','admin','approved',now()) on conflict(id) do nothing;
  insert into auth.identities(id,user_id,provider_id,provider,identity_data,created_at,updated_at)
  select gen_random_uuid(),'${fixture.student.id}','${fixture.student.id}','google',
  jsonb_build_object('sub','${fixture.student.id}','email','${fixture.student.email}','email_verified',true),now(),now()
  where not exists(select 1 from auth.identities where user_id='${fixture.student.id}' and provider='google');`)
const admin = client(config.ANON_KEY), student = client(config.ANON_KEY)
await ok(admin.auth.signInWithPassword(fixture.admin), 'Local admin sign-in')
await ok(student.auth.signInWithPassword(fixture.student), 'Local student sign-in')
if (sql(`select count(*) from private.authorized_students where student_id='${fixture.studentId}'`) === '0') {
  await ok(admin.rpc('admin_add_authorized_student', { student_id: fixture.studentId, expected_name: 'Tester, U4 Local' }), 'Roster authorization')
}
let profile = await ok(student.from('profiles').select('id,role,status,approved_by').eq('id', fixture.student.id).maybeSingle(), 'Read local profile')
if (!profile) profile = await ok(student.rpc('complete_student_registration', { full_name: 'U4 Local Tester', last_name: 'Tester', student_id: fixture.studentId }), 'Trusted registration')
if (profile.status === 'pending') profile = await ok(admin.rpc('review_student', { student_uid: fixture.student.id, decision: 'approved' }), 'Trusted approval')
assert.equal(profile.role, 'student'); assert.equal(profile.status, 'approved'); assert.equal(profile.approved_by, fixture.admin.id)
const summary = await ok(student.rpc('attendance_summary'), 'Local attendance summary')
console.log(JSON.stringify({ localStudent: 'approved', roster: 'authorized', nextAction: summary[0].next_action,
  credentialsFile, attendanceRecordsCreatedBySetup: 0 }))
await admin.auth.signOut(); await student.auth.signOut()
