// Independent PostgreSQL connections against the fixed local Docker container only.
// No environment URL, hosted link, browser SDK or credentials are used.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { proofCleanupSql } from './helpers/attendanceProofFixtures.js'

function connection() {
  const child = spawn('docker', ['exec', '-i', 'supabase_db_ojt-dtr-s1-local',
    'psql', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'])
  let output = '', errors = ''
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { errors += data })
    child.on('close', code => resolve({ code, output: output.trim(), errors }))
  })
  return { child, done, output: () => output }
}
function run(sql) {
  const conn = connection()
  conn.child.stdin.end(`set statement_timeout='10s';\n${sql}`)
  return conn.done
}
async function successful(sql) {
  const result = await run(sql)
  assert.equal(result.code, 0, result.errors)
  return result.output
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, message) {
  for (let i=0; i<100; i++) { if (await check()) return; await delay(30) }
  throw Error(message)
}
function rpc(uid, name, appName) {
  // Metadata-only proof fixture; actual Storage bytes are covered by API tests.
  // The production prepare/finalize functions still enforce identity and locks.
  return run(`set application_name='${appName}'; begin;
    create function pg_temp.proof_punch(action text) returns public.attendance_sessions
    language plpgsql security definer set search_path='' as $$
    declare ticket record; receipt public.attendance_proofs; result public.attendance_sessions;
    begin
      select * into ticket from public.attendance_proof_prepare(gen_random_uuid(),action);
      insert into storage.objects(bucket_id,name,owner_id,metadata)
        values('attendance-proofs',ticket.photo_path,auth.uid()::text,'{"mimetype":"image/png","size":68}');
      receipt:=public.attendance_proof_finalize(ticket.upload_id,14.6,121,10);
      select * into result from public.attendance_sessions where id=receipt.attendance_session_id;
      return result;
    end; $$;
    set local role authenticated; set local "request.jwt.claim.sub"='${uid}';
    select row_to_json(r) from pg_temp.proof_punch('${name.endsWith('_in') ? 'time_in' : 'time_out'}') r; commit;`)
}
async function withProfileLock(uid, label, work, revoke = false) {
  const lock = connection()
  lock.child.stdin.write(`begin; set local statement_timeout='10s'; set local idle_in_transaction_session_timeout='15s';
    select id from public.profiles where id='${uid}' for update;
    ${revoke ? `update public.profiles set status='rejected',approved_at=null,approved_by=null where id='${uid}';` : ''}
    select 'LOCKED';\n`)
  try {
    await until(() => lock.output().includes('LOCKED'), 'Profile lock was not acquired')
    const pending = work()
    await until(async () => Number(await successful(`select count(*) from pg_stat_activity
      where application_name in ('${label}-a','${label}-b') and wait_event_type='Lock';`)) === 2,
    'Both RPC transactions must demonstrably wait on the profile lock')
    lock.child.stdin.end("select 'RELEASED:' || extract(epoch from clock_timestamp()); commit;\n")
    const released = await lock.done
    assert.equal(released.code,0,released.errors)
    const releasedAt = Number(released.output.match(/RELEASED:([\d.]+)/)[1])
    return { results: await pending, releasedAt }
  } finally {
    if (!lock.child.stdin.writableEnded) lock.child.stdin.end('rollback;\n')
    await lock.done
  }
}

async function readyDraft(uid, action) {
  return successful(`begin; set local "request.jwt.claim.sub"='${uid}';
    create temp table ticket as select * from public.attendance_proof_prepare(gen_random_uuid(),'${action}');
    insert into storage.objects(bucket_id,name,owner_id,metadata)
      select 'attendance-proofs',photo_path,'${uid}','{"mimetype":"image/png","size":68}'::jsonb from ticket;
    select upload_id from ticket; commit;`)
}
function finalize(uid, upload, appName) {
  return run(`set application_name='${appName}'; begin;
    set local role authenticated; set local "request.jwt.claim.sub"='${uid}';
    select row_to_json(r) from public.attendance_proof_finalize('${upload}',14.6,121,10) r; commit;`)
}

test('local attendance writes serialize on the profile row', async t => {
  const admin = randomUUID(), student = randomUUID(), revoked = randomUUID(), prepared = randomUUID()
  const ids = [admin, student, revoked, prepared].map(id => `'${id}'`).join(',')
  const label = 's3-' + randomUUID().slice(0,8)
  await successful(`begin;
    insert into auth.users(id,email) values
    ('${admin}','${admin}@example.invalid'),('${student}','${student}@example.invalid'),('${revoked}','${revoked}@example.invalid'),('${prepared}','${prepared}@example.invalid');
    insert into public.profiles(id,full_name,email,role,status,approved_at)
    values ('${admin}','S3 Test Admin','${admin}@example.invalid','admin','approved',now());
    insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
    select id,'S3 Student',email,'S3-' || upper(left(id::text,8)),'student','approved','BS Information Technology',486,now(),'${admin}'
    from auth.users where id in ('${student}','${revoked}','${prepared}'); commit;`)
  let opened
  try {
    await t.test('two queued Time Ins create exactly one session with a post-lock server timestamp', async () => {
      const { results, releasedAt } = await withProfileLock(student,label,() => Promise.all([
        rpc(student,'attendance_time_in',label+'-a'),rpc(student,'attendance_time_in',label+'-b'),
      ]))
      assert.equal(results.filter(r=>r.code===0).length,1)
      assert.match(results.find(r=>r.code!==0).errors,/ALREADY_TIMED_IN/)
      opened=JSON.parse(results.find(r=>r.code===0).output)
      assert.equal(opened.student_uid,student)
      assert.equal(opened.time_out,null)
      assert.equal(await successful(`select count(*) from public.attendance_sessions where student_uid='${student}';`),'1')
      assert.equal(await successful(`select time_in >= to_timestamp(${releasedAt}) from public.attendance_sessions where id='${opened.id}';`),'t')
    })
    await t.test('two queued Time Outs close exactly that session once with a post-lock timestamp', async () => {
      const { results, releasedAt } = await withProfileLock(student,label,() => Promise.all([
        rpc(student,'attendance_time_out',label+'-a'),rpc(student,'attendance_time_out',label+'-b'),
      ]))
      assert.equal(results.filter(r=>r.code===0).length,1)
      assert.match(results.find(r=>r.code!==0).errors,/NO_OPEN_ATTENDANCE/)
      const closed=JSON.parse(results.find(r=>r.code===0).output)
      assert.equal(closed.id,opened.id)
      assert.equal(closed.time_in,opened.time_in)
      assert.equal(await successful(`select time_out >= to_timestamp(${releasedAt}) from public.attendance_sessions where id='${closed.id}';`),'t')
    })
    await t.test('concurrent second starts serialize, then third starts fail', async () => {
      const second=await withProfileLock(student,label,()=>Promise.all([rpc(student,'attendance_time_in',label+'-a'),rpc(student,'attendance_time_in',label+'-b')]))
      assert.equal(second.results.filter(r=>r.code===0).length,1)
      assert.match(second.results.find(r=>r.code!==0).errors,/ALREADY_TIMED_IN/)
      const race=await withProfileLock(student,label,()=>Promise.all([rpc(student,'attendance_time_in',label+'-a'),rpc(student,'attendance_time_out',label+'-b')]))
      assert.equal(race.results[1].code,0)
      assert.match(race.results[0].errors,/ALREADY_TIMED_IN|DAILY_ATTENDANCE_LIMIT_REACHED/)
      assert.match((await rpc(student,'attendance_time_out',label+'-a')).errors,/NO_OPEN_ATTENDANCE/)
      const results=await Promise.all([rpc(student,'attendance_time_in',label+'-a'),rpc(student,'attendance_time_in',label+'-b')])
      for (const result of results) { assert.notEqual(result.code,0); assert.match(result.errors,/DAILY_ATTENDANCE_LIMIT_REACHED/) }
      assert.equal(await successful(`select count(*) from public.attendance_sessions where student_uid='${student}';`),'2')
    })
    await t.test('approval revoked while requests wait is rechecked before either write', async () => {
      await successful(`insert into public.attendance_sessions(student_uid,time_in) values ('${revoked}',clock_timestamp()-interval '1 day');`)
      const { results } = await withProfileLock(revoked,label,()=>Promise.all([
        rpc(revoked,'attendance_time_in',label+'-a'),rpc(revoked,'attendance_time_out',label+'-b'),
      ]),true)
      for (const result of results) { assert.notEqual(result.code,0); assert.match(result.errors,/APPROVED_STUDENT_REQUIRED/) }
      assert.equal(await successful(`select count(*) from public.attendance_sessions where student_uid='${revoked}' and time_out is null;`),'1')
    })
    await t.test('already-uploaded same-ticket finalizers wait on profile and return one post-lock receipt', async () => {
      const ticket = await readyDraft(prepared,'time_in')
      const { results, releasedAt } = await withProfileLock(prepared,label,()=>Promise.all([
        finalize(prepared,ticket,label+'-a'),finalize(prepared,ticket,label+'-b'),
      ]))
      for(const result of results)assert.equal(result.code,0,result.errors)
      const receipt=JSON.parse(results[0].output)
      assert.deepEqual(JSON.parse(results[1].output),receipt)
      assert.equal(await successful(`select official_punch_at>=to_timestamp(${releasedAt}) from public.attendance_proofs where id='${receipt.id}'`),'t')
      assert.equal(await successful(`select count(*) from public.attendance_sessions where student_uid='${prepared}'`),'1')
      assert.equal(await successful(`select count(*) from public.attendance_proofs where student_uid='${prepared}'`),'1')
    })
    await t.test('revocation after upload is checked by blocked finalizers, not only preparation', async () => {
      const first=await readyDraft(prepared,'time_out'),second=await readyDraft(prepared,'time_out')
      const { results }=await withProfileLock(prepared,label,()=>Promise.all([
        finalize(prepared,first,label+'-a'),finalize(prepared,second,label+'-b'),
      ]),true)
      for(const result of results){assert.notEqual(result.code,0);assert.match(result.errors,/APPROVED_STUDENT_REQUIRED/)}
      assert.equal(await successful(`select count(*) from public.attendance_sessions where student_uid='${prepared}' and time_out is null`),'1')
      assert.equal(await successful(`select count(*) from public.attendance_proofs where student_uid='${prepared}'`),'1')
    })
  } finally {
    await successful(`begin;
      set local storage.allow_delete_query='true';
      delete from storage.objects where bucket_id='attendance-proofs' and owner_id in (${ids});
      ${proofCleanupSql(ids)}
      delete from public.attendance_sessions where student_uid in (${ids});
      delete from public.profiles where id in ('${student}','${revoked}','${prepared}');
      delete from public.profiles where id='${admin}';
      delete from auth.users where id in (${ids}); commit;`)
  }
})
