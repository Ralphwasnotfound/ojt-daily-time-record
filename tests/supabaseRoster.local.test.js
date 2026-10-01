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


import { spawn } from 'node:child_process'
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

test('U1 local roster, claim races and backfill', async t => {
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
  const stem='U1-'+prefix.toUpperCase()
  const as=(uid,statement,label='u1-'+prefix)=>run(`set application_name='${label}'; begin; set local role authenticated; set local "request.jwt.claim.sub"='${uid}'; ${statement}; commit;`)
  try {
    const admin=await fixture('admin'),alice=await fixture('alice'),bob=await fixture('bob'),carol=await fixture('carol'),dave=await fixture('dave')
    sql(`insert into public.profiles(id,full_name,email,role,status,approved_at) values('${admin.id}','U1 Admin','${admin.email}','admin','approved',now());`)
    const add=async suffix=>{const result=await admin.client.rpc('admin_add_authorized_student',{student_id:stem+'-'+suffix,expected_name:'Reference, U1 Student'});assert.equal(result.error,null)}
    const registration=id=>({fullName:'Student', lastName: 'Reference',studentId:id,program:'BS Information Technology'})
    await t.test('migration backfills all statuses without changing existing profiles or dependent records',async()=>{
      const migration=await readFile('supabase/migrations/20261004000100_u1_authorized_students.sql','utf8')
      const body=migration.replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
      const setup=[alice,bob,carol].map((entry,i)=>`insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by) values('${entry.id}','Backfill Reference','${entry.email}','${stem}-BACK-${i}','student','${['pending','approved','rejected'][i]}','BS Information Technology',486,${i===1?'now()':'null'},${i===1?"'"+admin.id+"'":'null'});`).join('\n')
      sql(`begin;
        drop function public.admin_authorized_students(text,integer,text);
        drop function public.admin_add_authorized_student(text,text);
        drop function public.admin_set_authorized_student_active(text,boolean);
        drop table private.authorized_students;
        ${setup}
        create temporary table before_u1 as select 'profiles' as kind,to_jsonb(p) as record from public.profiles p
          union all select 'attendance',to_jsonb(a) from public.attendance_sessions a
          union all select 'activities',to_jsonb(a) from public.activities a
          union all select 'audit',to_jsonb(a) from public.activity_revisions a
          union all select 'storage',to_jsonb(a) from storage.objects a;
        ${body}
        do $$ begin
          if (select count(*) from private.authorized_students where student_id like '${stem}-BACK-%' and created_by is null and expected_name='Backfill Reference')<>3 then raise exception 'backfill incomplete'; end if;
          if exists(select 1 from public.profiles p where role='student' and not exists(select 1 from private.authorized_students r where r.student_id=p.student_id)) then raise exception 'missing backfill'; end if;
          if exists(with after_u1 as (select 'profiles' as kind,to_jsonb(p) as record from public.profiles p
            union all select 'attendance',to_jsonb(a) from public.attendance_sessions a
            union all select 'activities',to_jsonb(a) from public.activities a
            union all select 'audit',to_jsonb(a) from public.activity_revisions a
            union all select 'storage',to_jsonb(a) from storage.objects a)
            (select * from before_u1 except all select * from after_u1) union all
            (select * from after_u1 except all select * from before_u1)) then raise exception 'existing data changed'; end if;
        end $$;
        rollback;`)
    })
    await t.test('U1.1 forward replay preserves legacy rows/profiles and only derives unambiguous surnames',async()=>{
      const u1=(await readFile('supabase/migrations/20261004000100_u1_authorized_students.sql','utf8')).replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
      const u11=(await readFile('supabase/migrations/20261005000100_u11_roster_surname.sql','utf8')).replace(/^begin;\s*$/m,'').replace(/^commit;\s*$/m,'')
      sql(`begin;
        drop function public.admin_authorized_students(text,integer,text);
        drop function public.admin_add_authorized_student(text,text);
        drop function public.admin_set_authorized_student_active(text,boolean);
        drop function public.admin_update_authorized_student_name(text,text);
        drop function public.complete_student_registration(text,text,text);
        drop table private.authorized_students;
        drop function private.roster_last_name(text);
        drop function private.normalize_last_name(text);
        insert into public.profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by)
          values('${alice.id}','Unstructured Legacy Name','${alice.email}','${stem}-EXISTING','student','approved','BS Information Technology',486,now(),'${admin.id}');
        ${u1}
        insert into private.authorized_students(student_id,expected_name,is_active) values
          ('${stem}-GOOD','De La Cruz, Student',true),('${stem}-AMBIG','Unknown Last First',true),
          ('${stem}-EMPTY',null,false),('${stem}-COMMAS','Name, First, II',true);
        create temporary table legacy_roster as select to_jsonb(r) as row from private.authorized_students r;
        create temporary table legacy_data as select 'profile' as kind,to_jsonb(p) as row from public.profiles p
          union all select 'attendance',to_jsonb(a) from public.attendance_sessions a
          union all select 'activity',to_jsonb(a) from public.activities a
          union all select 'audit',to_jsonb(a) from public.activity_revisions a
          union all select 'proof',to_jsonb(a) from storage.objects a;
        ${u11}
        do $$ begin
          if (select normalized_last_name from private.authorized_students where student_id='${stem}-GOOD') is distinct from 'de la cruz' then raise exception 'safe surname not derived'; end if;
          if exists(select 1 from private.authorized_students where student_id in ('${stem}-AMBIG','${stem}-EMPTY','${stem}-COMMAS','${stem}-EXISTING') and normalized_last_name is not null) then raise exception 'ambiguous surname guessed'; end if;
          if to_regprocedure('public.complete_student_registration(text,text)') is not null then raise exception 'old RPC survived'; end if;
          if exists((select row from legacy_roster except all select to_jsonb(r)-'normalized_last_name' from private.authorized_students r)
            union all (select to_jsonb(r)-'normalized_last_name' from private.authorized_students r except all select row from legacy_roster)) then raise exception 'legacy roster changed'; end if;
          if exists(with after_data as (select 'profile' as kind,to_jsonb(p) as row from public.profiles p
            union all select 'attendance',to_jsonb(a) from public.attendance_sessions a
            union all select 'activity',to_jsonb(a) from public.activities a
            union all select 'audit',to_jsonb(a) from public.activity_revisions a
            union all select 'proof',to_jsonb(a) from storage.objects a)
            (select * from legacy_data except all select * from after_data) union all
            (select * from after_data except all select * from legacy_data)) then raise exception 'existing records changed'; end if;
        end $$;
        rollback;`)
    })
    await t.test('Admin HTTP API adds, searches, paginates and rejects duplicate without overwriting',async()=>{
      for(const suffix of ['A','B','C'])await add(suffix)
      const duplicate=await admin.client.rpc('admin_add_authorized_student',{student_id:' '+stem.toLowerCase()+'-a ',expected_name:'Overwrite, Student'})
      assert.equal(duplicate.error?.message,'STUDENT_ID_ALREADY_AUTHORIZED')
      const page1=await admin.client.rpc('admin_authorized_students',{search_text:stem,page_size:2})
      assert.equal(page1.error,null);assert.deepEqual(page1.data.map(r=>r.student_id),[stem+'-A',stem+'-B'])
      assert.equal(page1.data[0].expected_name,'Reference, U1 Student');assert.equal(page1.data[0].created_by,admin.id)
      const page2=await admin.client.rpc('admin_authorized_students',{search_text:stem,page_size:2,after_student_id:page1.data.at(-1).student_id})
      assert.equal(page2.error,null);assert.deepEqual(page2.data.map(r=>r.student_id),[stem+'-C'])
      const name=await admin.client.rpc('admin_authorized_students',{search_text:'Reference, U1 Student',page_size:100})
      assert.ok(name.data.some(r=>r.student_id===stem+'-A'))
      const forged=await admin.client.rpc('admin_add_authorized_student',{student_id:stem+'-FORGE',role:'admin'})
      assert.ok(forged.error)
    })
    await t.test('HTTP caller cannot enumerate or manage roster; failed registration leaves ID available',async()=>{
      for(const c of [alice.client,client()])for(const [name,args] of [
        ['admin_authorized_students',{}],['admin_add_authorized_student',{student_id:stem+'-FORGED'}],['admin_set_authorized_student_active',{student_id:stem+'-A',is_active:false}],
      ])assert.ok((await c.rpc(name,args)).error)
      assert.ok((await alice.client.schema('private').from('authorized_students').select('*')).error)
      await assert.rejects(alice.api.createStudentProfile(registration(stem+'-ABSENT')),e=>e.message==='STUDENT_IDENTITY_NOT_ELIGIBLE')
      await assert.rejects(alice.api.createStudentProfile({...registration(stem+'-A'),fullName:''}),e=>e.code==='23514')
      const row=await alice.api.createStudentProfile(registration(stem+'-A'))
      assert.equal(row.status,'pending');assert.equal(row.role,'student');assert.equal(row.requiredHours,486)
      const listed=await admin.client.rpc('admin_authorized_students',{search_text:stem+'-A'})
      assert.equal(listed.data[0].registration_state,'pending');assert.equal(listed.data[0].claimed_by,alice.id)
    })
    await t.test('two queued claimants demonstrably wait on roster lock and exactly one succeeds',async()=>{
      const lock=connection(),label='u1-'+prefix+'-claim'
      lock.child.stdin.write(`begin; set local idle_in_transaction_session_timeout='15s'; select student_id from private.authorized_students where student_id='${stem}-B' for update; select 'LOCKED';\n`)
      try {
        await until(()=>lock.output().includes('LOCKED'),'roster lock not acquired')
        const pending=Promise.all([bob,carol].map((entry,i)=>as(entry.id,`select public.complete_student_registration('Student','${stem}-B','Reference')`,label+i)))
        await until(async()=>Number(await successful(`select count(*) from pg_stat_activity where application_name in ('${label}0','${label}1') and wait_event_type='Lock'`))===2,'claimants must both wait')
        lock.child.stdin.end('commit;\n');assert.equal((await lock.done).code,0)
        const results=await pending;assert.equal(results.filter(r=>r.code===0).length,1);assert.match(results.find(r=>r.code!==0).errors,/STUDENT_ID_ALREADY_REGISTERED/)
      } finally {if(!lock.child.stdin.writableEnded)lock.child.stdin.end('rollback;\n');await lock.done}
    })
    await t.test('deactivation commits before waiting registration: registration fails',async()=>{
      const lock=connection(),label='u1-'+prefix+'-inactive'
      lock.child.stdin.write(`begin; set local idle_in_transaction_session_timeout='15s'; set local role authenticated; set local "request.jwt.claim.sub"='${admin.id}'; select public.admin_set_authorized_student_active('${stem}-C',false); select 'LOCKED';\n`)
      try {
        await until(()=>lock.output().includes('LOCKED'),'deactivation lock not acquired')
        const pending=as(dave.id,`select public.complete_student_registration('Student','${stem}-C','Reference')`,label)
        await until(async()=>Number(await successful(`select count(*) from pg_stat_activity where application_name='${label}' and wait_event_type='Lock'`))===1,'registration must wait')
        lock.child.stdin.end('commit;\n');assert.equal((await lock.done).code,0)
        const result=await pending;assert.notEqual(result.code,0);assert.match(result.errors,/STUDENT_IDENTITY_NOT_ELIGIBLE/)
        assert.equal(await dave.api.readProfile(dave.id),null)
      } finally {if(!lock.child.stdin.writableEnded)lock.child.stdin.end('rollback;\n');await lock.done}
    })
    await t.test('registration commits before waiting deactivation: profile survives and review works',async()=>{
      assert.equal((await admin.client.rpc('admin_set_authorized_student_active',{student_id:stem+'-C',is_active:true})).error,null)
      const lock=connection(),label='u1-'+prefix+'-register'
      lock.child.stdin.write(`begin; set local idle_in_transaction_session_timeout='15s'; set local role authenticated; set local "request.jwt.claim.sub"='${dave.id}'; select public.complete_student_registration('Student','${stem}-C','Reference'); select 'LOCKED';\n`)
      try {
        await until(()=>lock.output().includes('LOCKED'),'registration did not finish within transaction')
        const pending=as(admin.id,`select public.admin_set_authorized_student_active('${stem}-C',false)`,label)
        await until(async()=>Number(await successful(`select count(*) from pg_stat_activity where application_name='${label}' and wait_event_type='Lock'`))===1,'deactivation must wait')
        lock.child.stdin.end('commit;\n');assert.equal((await lock.done).code,0);assert.equal((await pending).code,0)
        assert.equal((await dave.api.readProfile(dave.id)).status,'pending')
        await assert.rejects(admin.api.reviewStudent(dave.id,'approved'),e=>e.message==='ROSTER_APPROVAL_NOT_ELIGIBLE')
        assert.equal((await admin.client.rpc('admin_set_authorized_student_active',{student_id:stem+'-C',is_active:true})).error,null)
        await admin.api.reviewStudent(dave.id,'approved')
        assert.equal((await admin.client.rpc('admin_set_authorized_student_active',{student_id:stem+'-C',is_active:false})).error,null)
        const row=(await admin.client.rpc('admin_authorized_students',{search_text:stem+'-C'})).data[0]
        assert.equal(row.registration_state,'approved');assert.equal(row.is_active,false)
      } finally {if(!lock.child.stdin.writableEnded)lock.child.stdin.end('rollback;\n');await lock.done}
    })
  } finally {
    const ids=fixtures.map(entry=>`'${entry.id}'`).join(',')
    if(ids){sql(`delete from private.authorized_students where created_by in (${ids}); delete from public.profiles where id in (${ids}) and role='student'; delete from public.profiles where id in (${ids}) and role='admin';`)
      for(const entry of fixtures)assert.equal((await root.auth.admin.deleteUser(entry.id)).error,null,'local fixture cleanup')}
  }
})
