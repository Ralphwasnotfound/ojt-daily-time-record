// Isolated LOCAL fixtures only. Existing manual attendance/photos are never touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { createClient } from '@supabase/supabase-js'
import * as proofReader from '../src/services/attendanceProofReader.js'
import { proofPunch, proofCleanupSql } from './helpers/attendanceProofFixtures.js'

const module = new SourceTextModule(await readFile(new URL('../src/services/adminAttendanceProof.js', import.meta.url), 'utf8'))
await module.link(s => {
  const values = s.endsWith('attendanceProofReader.js') ? proofReader : s.endsWith('supabaseAdmin.js') ? { adminKey: () => '' } : { supabase: null }
  return new SyntheticModule(Object.keys(values), function () { for (const [k,v] of Object.entries(values)) this.setExport(k,v) })
})
await module.evaluate()
function sql(input) {
  try { return execFileSync('docker', ['exec','-i','supabase_db_ojt-dtr-s1-local','psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'], { input, encoding:'utf8', stdio:['pipe','pipe','pipe'] }).trim() }
  catch { throw Error('Local U4.4 fixture SQL failed; private details not logged.') }
}
async function ok(query) { const {data,error} = await query; assert.equal(error, null); return data }
test('U4.4 real local Admin evidence service and private access', async t => {
  const config = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js','status','-o','json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}))
  assert.equal(config.API_URL, 'http://127.0.0.1:54321')
  const make = (key = config.ANON_KEY) => createClient(config.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const root = make(config.SERVICE_ROLE_KEY), anonymous = make(), fixtures = [], paths = new Set()
  async function fixture(role = 'student', status = 'approved', admin = null) {
    const email = `u44-${randomUUID()}@example.invalid`, password = randomUUID() + 'aA1!'
    const {user} = await ok(root.auth.admin.createUser({email,password,email_confirm:true}))
    const who = {id:user.id,client:make()}; fixtures.push(who)
    sql(`insert into profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by) values('${who.id}','U44 Review Fixture','${email}',${role === 'admin' ? 'null' : `'U44-${who.id.slice(0,8).toUpperCase()}'`},'${role}','${status}',${role === 'admin' ? 'null' : "'BS Information Technology'"},${role === 'admin' ? 'null' : '486'},${status === 'approved' ? 'clock_timestamp()' : 'null'},${admin && status === 'approved' ? `'${admin.id}'` : 'null'});`)
    await ok(who.client.auth.signInWithPassword({email,password})); return who
  }
  try {
    const admin = await fixture('admin'), student = await fixture('student','approved',admin), other = await fixture('student','approved',admin), pending = await fixture('student','pending'), rejected = await fixture('student','rejected')
    const api = module.namespace.createAdminAttendanceProofApi(admin.client, () => admin.id)
    const sessions = []
    for (let i = 0; i < 2; i++) { const row = await ok(proofPunch(student.client,'time_in',paths)); await ok(proofPunch(student.client,'time_out',paths)); sessions.push(row.id) }
    const proofs = []
    await t.test('all four actions read trusted identity, server time, ordinal and private bytes', async () => {
      for (let i = 0; i < 2; i++) for (const action of ['time_in','time_out']) {
        const evidence = await api.evidence(student.id,sessions[i],action,new AbortController().signal)
        assert.equal(evidence.student.id, student.id); assert.equal(evidence.student.full_name, 'U44 Review Fixture')
        assert.equal(evidence.ordinal, i + 1); assert.equal(evidence.proof.action_type, action)
        const blob = await api.download(evidence.proof.photo_path)
        assert.equal(blob.type,'image/png'); assert.ok(blob.size > 0)
        const bytes = new Uint8Array(await blob.arrayBuffer()); assert.equal(bytes[0],137); assert.equal(bytes[1],80)
        const display = module.namespace.formatProof(evidence); assert.equal(display.session, `Session ${i + 1}`)
        proofs.push(evidence.proof)
      }
      assert.equal(new Set(proofs.map(p => p.photo_path)).size,4)
    })
    await t.test('cross-student, pending, rejected and anonymous reads are denied by RLS', async () => {
      for (const who of [other,pending,rejected]) {
        const rows = await ok(who.client.from('attendance_proofs').select('id').eq('student_uid',student.id)); assert.equal(rows.length,0)
        const {error} = await who.client.storage.from('attendance-proofs').download(proofs[0].photo_path); assert.ok(error)
      }
      assert.ok((await anonymous.from('attendance_proofs').select('id')).error)
      assert.ok((await anonymous.storage.from('attendance-proofs').download(proofs[0].photo_path)).error)
      assert.equal((await ok(student.client.from('attendance_proofs').select('id').eq('student_uid',student.id))).length,4)
    })
    await t.test('student reader opens own four proofs with matching private images and trusted presentation', async () => {
      const reader = proofReader.createAttendanceProofReader(student.client, () => student.id, 'student')
      const flags = await reader.available(student.id, sessions)
      assert.equal(flags.length,4)
      for (let i = 0; i < 2; i++) for (const action of ['time_in','time_out']) {
        const evidence = await reader.evidence(student.id,sessions[i],action)
        assert.equal(evidence.ordinal,i+1); assert.equal(evidence.student.full_name,'U44 Review Fixture')
        const adminProof = proofs.find(p => p.attendance_session_id === sessions[i] && p.action_type === action)
        assert.equal(evidence.proof.photo_path,adminProof.photo_path)
        assert.equal(evidence.proof.official_punch_at,adminProof.official_punch_at)
        const display = proofReader.formatProof(evidence)
        assert.equal(display.location,'14.60000, 121.00000'); assert.equal(display.accuracy,'±10 m')
        const bytes = await reader.download(evidence.proof.photo_path)
        assert.deepEqual(await bytes.arrayBuffer(),await (await api.download(adminProof.photo_path)).arrayBuffer())
      }
      await assert.rejects(reader.evidence(other.id,sessions[0],'time_in'),/OWN_PROOF_REQUIRED/)
    })
    await t.test('student direct proof update/delete and attached Storage removal remain blocked', async () => {
      const proof = proofs[0]
      assert.ok((await student.client.from('attendance_proofs').update({accuracy:1}).eq('attendance_session_id',sessions[0])).error)
      assert.ok((await student.client.from('attendance_proofs').delete().eq('attendance_session_id',sessions[0])).error)
      await student.client.storage.from('attendance-proofs').remove([proof.photo_path])
      assert.ok((await ok(student.client.storage.from('attendance-proofs').download(proof.photo_path))).size>0)
      assert.equal((await ok(student.client.from('attendance_proofs').select('id').eq('student_uid',student.id))).length,4)
    })
    await t.test('bucket remains private, public bytes denied, only attendance signal published', async () => {
      assert.equal(sql("select not public from storage.buckets where id='attendance-proofs'"),'t')
      const url = student.client.storage.from('attendance-proofs').getPublicUrl(proofs[0].photo_path).data.publicUrl
      assert.equal(new URL(url).origin, 'http://127.0.0.1:54321')
      assert.equal((await fetch(url,{method:'HEAD'})).ok,false)
      assert.equal(sql("select string_agg(schemaname||'.'||tablename,',' order by tablename) from pg_publication_tables where pubname='supabase_realtime'"),'public.attendance_sessions')
      assert.equal(sql("select has_table_privilege('authenticated','public.attendance_proofs','INSERT') or has_table_privilege('authenticated','public.attendance_proofs','UPDATE') or has_table_privilege('authenticated','public.attendance_proofs','DELETE')"),'f')
      assert.equal(sql("select has_function_privilege('authenticated','public.attendance_time_in()','EXECUTE') or has_function_privilege('authenticated','public.attendance_time_out()','EXECUTE')"),'f')
    })
    await t.test('historical proofless attendance returns neutral absence', async () => {
      // Separate student, test-only historical row. No grants or live records changed.
      const id = randomUUID()
      sql(`insert into attendance_sessions(id,student_uid,time_in,time_out) values('${id}','${other.id}',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days'+interval '1 hour')`)
      assert.equal(await api.evidence(other.id,id,'time_in'),null)
    })
    await t.test('read-only viewer leaves finalized proof rows unchanged', async () => {
      assert.equal((await ok(student.client.from('attendance_proofs').select('id').eq('student_uid',student.id))).length,4)
      assert.equal(sql(`select count(*) from private.attendance_proof_uploads where student_uid='${student.id}' and state='attached'`),'4')
    })
  } finally {
    if (paths.size) await ok(root.storage.from('attendance-proofs').remove([...paths]))
    if (fixtures.length) {
      const ids = fixtures.map(f => `'${f.id}'`).join(',')
      sql(`begin;${proofCleanupSql(ids)}delete from attendance_sessions where student_uid in(${ids});delete from profiles where id in(${ids});commit;`)
      for (const who of fixtures) { await who.client.auth.signOut(); await ok(root.auth.admin.deleteUser(who.id)) }
    }
  }
})
