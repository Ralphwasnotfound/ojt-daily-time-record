// U4.1 LOCAL Auth/Storage integration. Never reads .env or accepts a hosted target.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function localConfig() {
  try {
    const config = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }))
    assert.equal(config.API_URL, 'http://127.0.0.1:54321')
    assert.ok(config.ANON_KEY && config.SERVICE_ROLE_KEY)
    return config
  } catch { throw new Error('Local Supabase required at 127.0.0.1:54321; no hosted fallback or credential output.') }
}
function sql(statement) {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_ojt-dtr-s1-local', 'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch { throw new Error('Local U4.1 fixture SQL failed; credentials not logged.') }
}
async function success(query) { const { data, error } = await query; assert.equal(error, null); return data }
async function failure(query, message) { const { error } = await query; assert.ok(error); if (message) assert.equal(error.message, message); return error }
// U4.1 fixture-only adapter: historical proofless rows, never restored browser grants.
function legacyFixture(who, action) {
  try {
    const data = JSON.parse(sql(`begin; set local "request.jwt.claim.sub"='${who.id}';
      select row_to_json(r) from public.attendance_time_${action}() r; commit;`))
    return { data, error: null }
  } catch { return { error: { message: 'Legacy local fixture failed' } } }
}
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

test('U4.1 local attendance proof foundation and private Storage', async t => {
  const config = localConfig()
  const client = (key = config.ANON_KEY) => createClient(config.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const root = client(config.SERVICE_ROLE_KEY), anonymous = client(), fixtures = [], paths = new Set()
  const bucket = who => who.client.storage.from('attendance-proofs')
  async function fixture(role = 'student', status = 'approved', adminId = null) {
    const email = `u41-${randomUUID()}@example.invalid`, password = randomUUID() + 'aA1!'
    const { user } = await success(root.auth.admin.createUser({ email, password, email_confirm: true }))
    const item = { id: user.id, client: client() }; fixtures.push(item)
    sql(`insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
      values('${item.id}','U41 Fixture','${email}',${role === 'admin' ? 'null' : `'U41-${item.id.slice(0, 8).toUpperCase()}'`},
      '${role}','${status}',${role === 'admin' ? 'null' : "'BS Information Technology'"},${role === 'admin' ? 'null' : '486'},
      ${status === 'approved' ? 'clock_timestamp()' : 'null'},${adminId && status === 'approved' ? `'${adminId}'` : 'null'});`)
    await success(item.client.auth.signInWithPassword({ email, password }))
    return item
  }
  async function prepare(who, action = 'time_in', request = randomUUID()) {
    const rows = await success(who.client.rpc('attendance_proof_prepare', { request_id: request, action_type: action }))
    paths.add(rows[0].photo_path)
    return rows[0]
  }
  const upload = (who, draft, bytes = png, contentType = 'image/png', upsert = false) => bucket(who).upload(draft.photo_path, bytes, { contentType, upsert })
  try {
    const admin = await fixture('admin'), alice = await fixture('student', 'approved', admin.id), bob = await fixture('student', 'approved', admin.id)
    const pending = await fixture('student', 'pending'), rejected = await fixture('student', 'rejected')
    let draft, closeDraft, discardDraft
    await t.test('authorization denies anonymous, pending, rejected and admin preparation/discard', async () => {
      for (const who of [admin, pending, rejected]) {
        await failure(who.client.rpc('attendance_proof_prepare', { request_id: randomUUID(), action_type: 'time_in' }), 'APPROVED_STUDENT_REQUIRED')
        await failure(who.client.rpc('attendance_proof_discard', { upload_id: randomUUID() }), 'APPROVED_STUDENT_REQUIRED')
      }
      await failure(anonymous.rpc('attendance_proof_prepare', { request_id: randomUUID(), action_type: 'time_in' }))
    })
    await t.test('concurrent retry returns one reservation without attendance or Admin presence', async () => {
      const request = randomUUID()
      const [first, second] = await Promise.all([prepare(alice, 'time_in', request), prepare(alice, 'time_in', request)])
      assert.deepEqual(first, second); draft = first
      assert.equal(sql(`select count(*) from private.attendance_proof_uploads where student_uid='${alice.id}'`), '1')
      const [summary] = await success(alice.client.rpc('attendance_summary'))
      assert.equal(summary.starts_today, 0); assert.equal(summary.open_session_id, null); assert.equal(summary.days_present, 0)
      assert.deepEqual(await success(admin.client.from('attendance_sessions').select('id').eq('student_uid', alice.id)), [])
    })
    await t.test('only exact own reserved paths accept uploads', async () => {
      for (const who of [bob, pending, rejected, admin, { client: anonymous }]) await failure(upload(who, draft))
      const arbitrary = { photo_path: `${alice.id}/${randomUUID()}/${randomUUID()}/proof` }; paths.add(arbitrary.photo_path)
      await failure(upload(alice, arbitrary))
      await success(upload(alice, draft))
    })
    await t.test('private bytes cannot be overwritten, made public or read by another identity', async () => {
      await failure(upload(alice, draft)); await failure(upload(alice, draft, png, 'image/png', true))
      await success(bucket(alice).download(draft.photo_path))
      for (const who of [bob, pending, rejected, admin, { client: anonymous }]) await failure(bucket(who).download(draft.photo_path))
      const { data } = bucket(alice).getPublicUrl(draft.photo_path)
      assert.equal(new URL(data.publicUrl).origin, config.API_URL)
      const response = await fetch(data.publicUrl); assert.equal(response.ok, false)
    })
    await t.test('bucket rejects unsupported MIME and oversized bytes', async () => {
      discardDraft = await prepare(alice)
      await failure(upload(alice, discardDraft, Buffer.from('<svg/>'), 'image/svg+xml'))
      await failure(upload(alice, discardDraft, Buffer.from('text'), 'text/plain'))
      await failure(upload(alice, discardDraft, Buffer.alloc(5242881), 'image/png'))
      await success(upload(alice, discardDraft))
    })
    await t.test('pending deletion denied; discard tombstones before idempotent object removal', async () => {
      await success(bucket(alice).remove([discardDraft.photo_path])) // Storage can return [] for RLS-hidden deletions.
      await success(bucket(alice).download(discardDraft.photo_path))
      await failure(bob.client.rpc('attendance_proof_discard', { upload_id: discardDraft.upload_id }), 'INVALID_UPLOAD')
      for (let i = 0; i < 2; i++) assert.equal(await success(alice.client.rpc('attendance_proof_discard', { upload_id: discardDraft.upload_id })), discardDraft.photo_path)
      await success(bucket(alice).remove([discardDraft.photo_path])); await failure(bucket(alice).download(discardDraft.photo_path))
      await failure(upload(alice, discardDraft))
    })
    await t.test('Time Out binds the exact open session; legacy fixture setup preserves exact session binding', async () => {
      await failure(alice.client.rpc('attendance_proof_prepare', { request_id: randomUUID(), action_type: 'time_out' }), 'NO_OPEN_ATTENDANCE')
      const session = await success(legacyFixture(alice,'in'))
      closeDraft = await prepare(alice, 'time_out'); assert.equal(closeDraft.attendance_session_id, session.id)
      await success(upload(alice, closeDraft))
      await success(legacyFixture(alice,'out'))
    })
    await t.test('trusted local proof fixture is private and immutable; direct proof INSERT is denied', async () => {
      // Root-only fixture isolates U4.1 attachment constraints; U4.2 separately tests
      // an already-mutated punch solely to test proof constraints and Storage reads.
      sql(`insert into public.attendance_proofs(attendance_session_id,student_uid,action_type,photo_path,upload_id,official_punch_at,latitude,longitude,accuracy)
        select p.attendance_session_id,p.student_uid,p.action_type,p.photo_path,p.id,s.time_out,14.6,121,15
        from private.attendance_proof_uploads p join public.attendance_sessions s on s.id=p.attendance_session_id where p.id='${closeDraft.upload_id}';`)
      const rows = await success(alice.client.from('attendance_proofs').select('*'))
      assert.equal(rows.length, 1); assert.equal(rows[0].upload_id, closeDraft.upload_id)
      await failure(alice.client.from('attendance_proofs').insert({ ...rows[0], id: randomUUID() }))
      await failure(alice.client.from('attendance_proofs').update({ latitude: 0 }).eq('id', rows[0].id))
      await failure(alice.client.from('attendance_proofs').delete().eq('id', rows[0].id))
      for (const who of [bob, pending, rejected]) assert.deepEqual(await success(who.client.from('attendance_proofs').select('*')), [])
      assert.equal((await success(admin.client.from('attendance_proofs').select('*').eq('student_uid', alice.id))).length, 1)
      await success(bucket(admin).download(closeDraft.photo_path))
      for (const who of [bob, pending, rejected, { client: anonymous }]) await failure(bucket(who).download(closeDraft.photo_path))
    })
    await t.test('attached proof cannot be discarded, deleted, replaced or mutated by Admin', async () => {
      await failure(alice.client.rpc('attendance_proof_discard', { upload_id: closeDraft.upload_id }), 'PROOF_IN_USE')
      await failure(upload(alice, closeDraft, png, 'image/png', true))
      for (const who of [alice, admin]) {
        await success(bucket(who).remove([closeDraft.photo_path]))
        await success(bucket(who).download(closeDraft.photo_path))
      }
      await failure(admin.client.from('attendance_proofs').update({ accuracy: 0 }).eq('upload_id', closeDraft.upload_id))
    })
    await t.test('expired reservations cannot authorize Storage and can be safely discarded', async () => {
      const id = randomUUID(), session = randomUUID(), request = randomUUID()
      const expired = { upload_id: id, photo_path: `${bob.id}/${session}/${id}/proof` }; paths.add(expired.photo_path)
      sql(`insert into private.attendance_proof_uploads(id,request_id,student_uid,action_type,attendance_session_id,
        expected_starts_today,prepared_manila_day,photo_path,created_at,expires_at)
        values('${id}','${request}','${bob.id}','time_in','${session}',0,(clock_timestamp() at time zone 'Asia/Manila')::date,
        '${expired.photo_path}',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour');`)
      await failure(upload(bob, expired))
      await failure(bob.client.rpc('attendance_proof_prepare', { request_id: request, action_type: 'time_in' }), 'UPLOAD_EXPIRED_OR_DISCARDED')
      assert.equal(await success(bob.client.rpc('attendance_proof_discard', { upload_id: id })), expired.photo_path)
    })
    await t.test('stale Time In intent cannot silently consume a later session slot', async () => {
      const request = randomUUID()
      await prepare(bob, 'time_in', request)
      await success(legacyFixture(bob,'in')); await success(legacyFixture(bob,'out'))
      await failure(bob.client.rpc('attendance_proof_prepare', { request_id: request, action_type: 'time_in' }), 'ATTENDANCE_STATE_CHANGED')
    })
    await t.test('second session remains available and third Time In remains denied', async () => {
      await success(legacyFixture(alice,'in')); await success(legacyFixture(alice,'out'))
      await failure(alice.client.rpc('attendance_time_in')) // U4.2 browser bypass revoked
      await failure(alice.client.rpc('attendance_proof_prepare', { request_id: randomUUID(), action_type: 'time_in' }), 'DAILY_ATTENDANCE_LIMIT_REACHED')
      const [summary] = await success(alice.client.rpc('attendance_summary'))
      assert.equal(summary.starts_today, 2); assert.equal(summary.completed_sessions, 2); assert.equal(summary.days_present, 1)
    })
  } finally {
    // Only objects and identities allocated by this LOCAL test. No shared/hosted cleanup.
    if (paths.size) await success(root.storage.from('attendance-proofs').remove([...paths]))
    if (fixtures.length) {
      const ids = fixtures.map(f => `'${f.id}'`).join(',')
      sql(`begin;
        alter table public.attendance_proofs disable trigger attendance_proof_immutable;
        delete from public.attendance_proofs where student_uid in (${ids});
        alter table public.attendance_proofs enable trigger attendance_proof_immutable;
        delete from private.attendance_proof_uploads where student_uid in (${ids});
        delete from public.attendance_sessions where student_uid in (${ids});
        delete from public.profiles where id in (${ids}) and role='student';
        delete from public.profiles where id in (${ids}); commit;`)
      for (const f of fixtures) { await f.client.auth.signOut(); await success(root.auth.admin.deleteUser(f.id)) }
    }
  }
})
