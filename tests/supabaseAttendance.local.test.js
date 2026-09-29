// Independent PostgreSQL connections against the fixed local Docker container only.
// No environment URL, hosted link, browser SDK or credentials are used.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

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
  return run(`set application_name='${appName}'; begin;
    set local role authenticated; set local "request.jwt.claim.sub"='${uid}';
    select row_to_json(r) from public.${name}() r; commit;`)
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

test('local attendance writes serialize on the profile row', async t => {
  const admin = randomUUID(), student = randomUUID(), revoked = randomUUID()
  const ids = [admin, student, revoked].map(id => `'${id}'`).join(',')
  const label = 's3-' + randomUUID().slice(0,8)
  await successful(`begin;
    insert into auth.users(id,email) values
    ('${admin}','${admin}@example.invalid'),('${student}','${student}@example.invalid'),('${revoked}','${revoked}@example.invalid');
    insert into public.profiles(id,full_name,email,role,status,approved_at)
    values ('${admin}','S3 Test Admin','${admin}@example.invalid','admin','approved',now());
    insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
    select id,'S3 Student',email,'S3-' || upper(left(id::text,8)),'student','approved','BS Information Technology',486,now(),'${admin}'
    from auth.users where id in ('${student}','${revoked}'); commit;`)
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
    await t.test('concurrent retries after closing cannot bypass the Manila-day policy', async () => {
      const results=await Promise.all([rpc(student,'attendance_time_in',label+'-a'),rpc(student,'attendance_time_in',label+'-b')])
      for (const result of results) { assert.notEqual(result.code,0); assert.match(result.errors,/ALREADY_STARTED_TODAY/) }
      assert.equal(await successful(`select count(*) from public.attendance_sessions where student_uid='${student}';`),'1')
    })
    await t.test('approval revoked while requests wait is rechecked before either write', async () => {
      await successful(`insert into public.attendance_sessions(student_uid,time_in) values ('${revoked}',clock_timestamp()-interval '1 day');`)
      const { results } = await withProfileLock(revoked,label,()=>Promise.all([
        rpc(revoked,'attendance_time_in',label+'-a'),rpc(revoked,'attendance_time_out',label+'-b'),
      ]),true)
      for (const result of results) { assert.notEqual(result.code,0); assert.match(result.errors,/APPROVED_STUDENT_REQUIRED/) }
      assert.equal(await successful(`select count(*) from public.attendance_sessions where student_uid='${revoked}' and time_out is null;`),'1')
    })
  } finally {
    await successful(`begin;
      delete from public.attendance_sessions where student_uid in (${ids});
      delete from public.profiles where id in ('${student}','${revoked}');
      delete from public.profiles where id='${admin}';
      delete from auth.users where id in (${ids}); commit;`)
  }
})
