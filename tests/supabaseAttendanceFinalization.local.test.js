// U4.2 real LOCAL Auth/Storage/PostgREST only. No .env or hosted fallback.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { proofCleanupSql } from './helpers/attendanceProofFixtures.js'
function config() {
  try {
    const result = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js','status','-o','json'], { encoding:'utf8',stdio:['ignore','pipe','pipe'] }))
    assert.equal(result.API_URL,'http://127.0.0.1:54321'); assert.ok(result.ANON_KEY && result.SERVICE_ROLE_KEY)
    return result
  } catch { throw Error('Local Supabase required at 127.0.0.1:54321; no hosted fallback or credential output.') }
}
function sql(statement) {
  try { return execFileSync('docker',['exec','-i','supabase_db_ojt-dtr-s1-local','psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'], { input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe'] }).trim() }
  catch { throw Error('Local U4.2 fixture SQL failed; credentials not logged.') }
}
async function success(query) { const {data,error}=await query; assert.equal(error,null); return data }
async function failure(query,message) { const {error}=await query; assert.ok(error); if(message)assert.equal(error.message,message); return error }
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
test('U4.2 real proof-backed attendance and retry recovery',async t=>{
  const c=config(), make=(key=c.ANON_KEY)=>createClient(c.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const root=make(c.SERVICE_ROLE_KEY), anonymous=make(), fixtures=[],paths=new Set()
  async function fixture(role='student',status='approved',admin=null) {
    const email=`u42-${randomUUID()}@example.invalid`,password=randomUUID()+'aA1!'
    const {user}=await success(root.auth.admin.createUser({email,password,email_confirm:true}))
    const who={id:user.id,client:make()};fixtures.push(who)
    sql(`insert into profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
    values('${who.id}','U42 Fixture','${email}',${role==='admin'?'null':`'U42-${who.id.slice(0,8).toUpperCase()}'`},'${role}','${status}',
    ${role==='admin'?'null':"'BS Information Technology'"},${role==='admin'?'null':'486'},${status==='approved'?'clock_timestamp()':'null'},${admin&&status==='approved'?`'${admin.id}'`:'null'});`)
    await success(who.client.auth.signInWithPassword({email,password}));return who
  }
  async function prepare(who,action='time_in',upload=true) {
    const [draft]=await success(who.client.rpc('attendance_proof_prepare',{request_id:randomUUID(),action_type:action}));paths.add(draft.photo_path)
    if(upload)await success(who.client.storage.from('attendance-proofs').upload(draft.photo_path,png,{contentType:'image/png',upsert:false}))
    return draft
  }
  const finalize=(who,draft,extra={})=>who.client.rpc('attendance_proof_finalize',{upload_id:draft.upload_id,latitude:14.6,longitude:121,accuracy:10,...extra})
  async function session(who,id) { return success(who.client.from('attendance_sessions').select('*').eq('id',id).single()) }
  try {
    const admin=await fixture('admin'),alice=await fixture('student','approved',admin),bob=await fixture('student','approved',admin)
    const pending=await fixture('student','pending'),rejected=await fixture('student','rejected'),legacy=await fixture('student','approved',admin)
    let first,staleIn,receipt,out,staleOut,outReceipt
    await t.test('all browser roles lose old proofless RPC access',async()=>{
      for(const who of [alice,admin,pending,rejected,{client:anonymous}]) {
        await failure(who.client.rpc('attendance_time_in'));await failure(who.client.rpc('attendance_time_out'))
      }
    })
    await t.test('missing upload and invalid location never mutate attendance',async()=>{
      first=await prepare(alice,'time_in',false)
      await failure(finalize(alice,first),'PROOF_REQUIRED')
      for(const extra of [{latitude:null},{longitude:null},{accuracy:null},{latitude:91},{longitude:-181},{accuracy:-1}]) await failure(finalize(alice,first,extra),'INVALID_LOCATION')
      assert.deepEqual(await success(alice.client.from('attendance_sessions').select('id')),[])
      await success(alice.client.storage.from('attendance-proofs').upload(first.photo_path,png,{contentType:'image/png'}))
      staleIn=await prepare(alice)
    })
    await t.test('unauthorized and cross-owner finalization rejected; identity/path/time arguments unsupported',async()=>{
      for(const who of [admin,pending,rejected])await failure(finalize(who,first),'APPROVED_STUDENT_REQUIRED')
      await failure(finalize({client:anonymous},first));await failure(finalize(bob,first),'INVALID_UPLOAD')
      for(const extra of [{student_uid:bob.id},{official_punch_at:new Date().toISOString()},{attendance_session_id:randomUUID()},{photo_path:first.photo_path}]) await failure(finalize(alice,first,extra))
    })
    await t.test('concurrent same-reservation finalization returns one immutable committed receipt',async()=>{
      const results=await Promise.all([success(finalize(alice,first)),success(finalize(alice,first))])
      assert.deepEqual(results[0],results[1]);receipt=results[0]
      const row=await session(alice,receipt.attendance_session_id)
      assert.equal(row.time_in,receipt.official_punch_at);assert.equal(row.time_out,null)
      assert.equal(receipt.attendance_session_id,first.attendance_session_id)
      assert.equal((await success(alice.client.from('attendance_proofs').select('id'))).length,1)
      assert.equal(sql(`select state from private.attendance_proof_uploads where id='${first.upload_id}'`),'attached')
    })
    await t.test('uncertain response is recovered without another start; different location conflicts',async()=>{
      const recovered=await success(finalize(alice,first));assert.deepEqual(recovered,receipt)
      const rows=await success(alice.client.from('attendance_proofs').select('*').eq('upload_id',first.upload_id));assert.deepEqual(rows,[receipt])
      await failure(finalize(alice,first,{accuracy:11}),'REQUEST_CONFLICT')
      const [summary]=await success(alice.client.rpc('attendance_summary'));assert.equal(summary.starts_today,1)
      await failure(finalize(alice,staleIn),'ALREADY_TIMED_IN')
    })
    await t.test('concurrent different Time Out tickets close exactly their bound session once',async()=>{
      out=await prepare(alice,'time_out');staleOut=await prepare(alice,'time_out')
      assert.equal(out.attendance_session_id,receipt.attendance_session_id)
      const results=await Promise.all([finalize(alice,out),finalize(alice,staleOut)])
      assert.equal(results.filter(r=>!r.error).length,1);assert.equal(results.find(r=>r.error).error.message,'ATTENDANCE_STATE_CHANGED')
      outReceipt=results.find(r=>!r.error).data
      if(outReceipt.upload_id!==out.upload_id)[out,staleOut]=[staleOut,out]
      assert.equal((await session(alice,receipt.attendance_session_id)).time_out,outReceipt.official_punch_at)
      assert.deepEqual(await success(finalize(alice,out)),outReceipt)
      await failure(finalize(alice,staleIn),'ATTENDANCE_STATE_CHANGED')
    })
    await t.test('second proof-backed session succeeds; stale Time Out never retargets it',async()=>{
      const second=await success(finalize(alice,await prepare(alice)))
      assert.notEqual(second.attendance_session_id,receipt.attendance_session_id)
      await failure(finalize(alice,staleOut),'ATTENDANCE_STATE_CHANGED')
      assert.equal((await session(alice,second.attendance_session_id)).time_out,null)
      await success(finalize(alice,await prepare(alice,'time_out')))
      assert.deepEqual(await success(finalize(alice,first)),receipt)
      const [summary]=await success(alice.client.rpc('attendance_summary'))
      assert.equal(summary.starts_today,2);assert.equal(summary.days_present,1);assert.equal(summary.next_action,'none')
      const days=await success(alice.client.rpc('attendance_days'));assert.deepEqual(days.days[0].sessions.map(s=>s.session_ordinal),[1,2])
      assert.equal((await success(alice.client.from('attendance_proofs').select('id'))).length,4)
    })
    await t.test('third prepare/finalize denied and attached proof cannot discard/delete',async()=>{
      await failure(alice.client.rpc('attendance_proof_prepare',{request_id:randomUUID(),action_type:'time_in'}),'DAILY_ATTENDANCE_LIMIT_REACHED')
      await failure(finalize(alice,staleIn),'DAILY_ATTENDANCE_LIMIT_REACHED')
      await failure(alice.client.rpc('attendance_proof_discard',{upload_id:first.upload_id}),'PROOF_IN_USE')
      await success(alice.client.storage.from('attendance-proofs').remove([first.photo_path]))
      await success(alice.client.storage.from('attendance-proofs').download(first.photo_path))
    })
    await t.test('legacy overnight session receives only Time Out proof and retains original grouping',async()=>{
      const id=randomUUID()
      sql(`insert into attendance_sessions(id,student_uid,time_in) values('${id}','${legacy.id}',(((clock_timestamp() at time zone 'Asia/Manila')::date-1)::timestamp at time zone 'Asia/Manila'));`)
      const before=await session(legacy,id),proof=await success(finalize(legacy,await prepare(legacy,'time_out')))
      assert.equal(proof.attendance_session_id,id);assert.equal(proof.action_type,'time_out')
      assert.equal((await session(legacy,id)).time_in,before.time_in)
      assert.equal((await success(legacy.client.from('attendance_proofs').select('id'))).length,1)
      const [summary]=await success(legacy.client.rpc('attendance_summary'));assert.equal(summary.starts_today,0);assert.equal(summary.days_present,1)
    })
    await t.test('revocation after preparation denies finalization; signed-out client cannot replay',async()=>{
      const ticket=await prepare(bob)
      sql(`update profiles set status='rejected',approved_at=null,approved_by=null where id='${bob.id}';`)
      await failure(finalize(bob,ticket),'APPROVED_STUDENT_REQUIRED')
      assert.equal(sql(`select count(*) from attendance_sessions where student_uid='${bob.id}'`),'0')
      await success(alice.client.auth.signOut())
      await failure(finalize(alice,first))
    })
  } finally {
    if(paths.size)await success(root.storage.from('attendance-proofs').remove([...paths]))
    if(fixtures.length) {
      const ids=fixtures.map(f=>`'${f.id}'`).join(',')
      sql(`begin; ${proofCleanupSql(ids)} delete from attendance_sessions where student_uid in (${ids});
        delete from profiles where id in (${ids}) and role='student';delete from profiles where id in (${ids});commit;`)
      for(const who of fixtures){await who.client.auth.signOut();await success(root.auth.admin.deleteUser(who.id))}
    }
  }
})
