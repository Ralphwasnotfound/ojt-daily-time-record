// Local-only HTTP integration. Synthetic identities are deleted in finally.
// Never accepts a hosted URL or service key from the environment.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { createClient } from '@supabase/supabase-js'
import * as policy from '../src/services/accountPolicy.js'

function localConfig() {
  try {
    const config = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }))
    assert.equal(config.API_URL, 'http://127.0.0.1:54321')
    assert.ok(config.ANON_KEY && config.SERVICE_ROLE_KEY)
    return config
  } catch {
    throw new Error('Local Supabase must be running at 127.0.0.1:54321 and Docker must be accessible. No hosted fallback is permitted.')
  }
}
function sql(statement) {
  try {
    return execFileSync('docker', ['exec', '-i', 'supabase_db_ojt-dtr-s1-local', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], {
      input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch { throw new Error('Local fixture SQL failed; no credentials were logged.') }
}
async function accountService(client) {
  const module = new SourceTextModule(await readFile(new URL('../src/services/users.js', import.meta.url), 'utf8'))
  await module.link(specifier => {
    const exports = specifier.includes('accountPolicy') ? policy : { supabase: client }
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    })
  })
  await module.evaluate()
  return module.namespace
}

test('local SDK registration, RLS, review, session persistence and logout', async t => {
  const config = localConfig()
  const client = (key = config.ANON_KEY, storage) => createClient(config.API_URL, key, {
    auth: { persistSession: !!storage, storage, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' },
  })
  const root = client(config.SERVICE_ROLE_KEY)
  const fixtures = []
  const prefix = randomUUID().slice(0, 8)
  const storageValues = new Map()
  const storage = { getItem: key => storageValues.get(key) || null, setItem: (key, value) => storageValues.set(key, value), removeItem: key => storageValues.delete(key) }
  async function fixture(label, persistent = false) {
    const email = `s2-${prefix}-${label}@example.invalid`
    const password = randomUUID() + 'aA1!'
    const { data, error } = await root.auth.admin.createUser({ email, password, email_confirm: true })
    assert.equal(error, null)
    const entry = { id: data.user.id, email, client: client(undefined, persistent ? storage : undefined) }
    fixtures.push(entry)
    // UUID/email are generated test constants. Never run against hosted Auth.
    sql(`insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
      values (gen_random_uuid(), '${entry.id}', '${entry.id}', 'google',
      jsonb_build_object('sub', '${entry.id}', 'email', '${email}', 'email_verified', true), now(), now());`)
    // Password login exists ONLY in this local harness, not the application's OAuth flow.
    const signed = await entry.client.auth.signInWithPassword({ email, password })
    assert.equal(signed.error, null)
    entry.api = await accountService(entry.client)
    return entry
  }
  try {
    const admin = await fixture('admin')
    const alice = await fixture('alice', true)
    const bob = await fixture('bob')
    const carol = await fixture('carol')
    sql(`insert into public.profiles(id, full_name, email, role, status, department, approved_at)
      values ('${admin.id}', 'Local Test Admin', '${admin.email}', 'admin', 'approved', 'BSIT Department', now());`)
    const registration = id => ({ fullName: ' Local Student ', studentId: id, program: 'BS Information Technology', role: 'admin', status: 'approved', email: 'forged@example.invalid' })

    await t.test('RPC owns authority fields and duplicate student IDs cannot create a second profile', async () => {
      const profile = await alice.api.createStudentProfile(registration(` s2-${prefix}-a `))
      assert.equal(profile.uid, alice.id)
      assert.equal(profile.email, alice.email)
      assert.equal(profile.fullName, 'Local Student')
      assert.equal(profile.studentId, `S2-${prefix.toUpperCase()}-A`)
      assert.equal(profile.role, 'student')
      assert.equal(profile.status, 'pending')
      assert.equal(profile.requiredHours, 486)
      assert.equal(profile.program, 'BS Information Technology')
      await assert.rejects(bob.api.createStudentProfile(registration(profile.studentId)), error => error.code === '23505')
      assert.equal(await bob.api.readProfile(bob.id), null)
      await assert.rejects(alice.api.createStudentProfile(registration(`S2-${prefix}-X`)), error => error.message === 'PROFILE_ALREADY_EXISTS')
    })
    await t.test('RLS permits own profile and denies cross-student reads/direct writes/admin RPC', async () => {
      assert.equal((await alice.api.readProfile(alice.id)).status, 'pending')
      assert.equal(await bob.api.readProfile(alice.id), null)
      assert.ok((await alice.client.from('profiles').update({ status: 'approved' }).eq('id', alice.id)).error)
      await assert.rejects(alice.api.reviewStudent(alice.id, 'approved'), error => error.message === 'APPROVED_ADMIN_REQUIRED')
      const anonymous = client()
      assert.ok((await anonymous.from('profiles').select('*')).error)
    })
    await t.test('two simultaneous registrations for the same Student ID have exactly one winner', async () => {
      const results = await Promise.allSettled([
        bob.api.createStudentProfile(registration(`S2-${prefix}-RACE`)),
        carol.api.createStudentProfile(registration(`S2-${prefix}-RACE`)),
      ])
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(results.find(result => result.status === 'rejected').reason.code, '23505')
    })
    await t.test('admin list and approval use trusted database metadata, pending-only review', async () => {
      assert.ok((await admin.api.listPendingStudents()).some(profile => profile.uid === alice.id))
      const approved = await admin.api.reviewStudent(alice.id, 'approved')
      assert.equal(approved.approvedBy, admin.id)
      assert.ok(approved.approvedAt)
      assert.equal((await alice.api.readProfile(alice.id)).status, 'approved')
      await assert.rejects(admin.api.reviewStudent(alice.id, 'rejected'), error => error.message === 'REGISTRATION_NOT_PENDING')
    })
    await t.test('simultaneous review decisions have exactly one winner', async () => {
      const target = await bob.api.readProfile(bob.id) || await carol.api.readProfile(carol.id)
      const results = await Promise.allSettled([
        admin.api.reviewStudent(target.uid, 'approved'), admin.api.reviewStudent(target.uid, 'rejected'),
      ])
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
      assert.equal(results.find(result => result.status === 'rejected').reason.message, 'REGISTRATION_NOT_PENDING')
    })
    await t.test('persisted local Auth session restores in a new client and logout removes access', async () => {
      const restored = client(undefined, storage)
      const { data, error } = await restored.auth.getSession()
      assert.equal(error, null)
      assert.equal(data.session?.user.id, alice.id)
      assert.equal((await (await accountService(restored)).readProfile(alice.id)).status, 'approved')
      assert.equal((await restored.auth.signOut({ scope: 'local' })).error, null)
      assert.equal((await restored.auth.getSession()).data.session, null)
      assert.ok((await restored.from('profiles').select('*')).error)
      assert.equal((await client(undefined, storage).auth.getSession()).data.session, null)
    })
  } finally {
    const ids = fixtures.map(entry => `'${entry.id}'`).join(',')
    if (ids) {
      sql(`delete from public.profiles where id in (${ids}) and role = 'student';
        delete from public.profiles where id in (${ids}) and role = 'admin';`)
      for (const entry of fixtures) {
        const { error } = await root.auth.admin.deleteUser(entry.id)
        assert.equal(error, null, 'Temporary local identity cleanup must succeed')
      }
    }
  }
})
