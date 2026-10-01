// Local-only websocket/RLS test. Never reads project .env or hosted credentials.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function sql(statement) {
 try { return execFileSync('docker',['exec','-i','supabase_db_ojt-dtr-s1-local','psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim() }
 catch { throw Error('Local U3 fixture SQL failed; no credentials logged') }
}
async function success(request) {const {data,error}=await request;assert.equal(error,null);return data}
test('U3 real local Realtime INSERT/UPDATE honors attendance RLS',async()=>{
 let config
 try {config=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))} catch {throw Error('Local Supabase unavailable; no hosted fallback')}
 assert.equal(config.API_URL,'http://127.0.0.1:54321')
 assert.equal(JSON.parse(Buffer.from(config.ANON_KEY.split('.')[1],'base64url')).role,'anon')
 assert.equal(sql("select pubinsert and pubupdate and not pubdelete and not pubtruncate from pg_publication where pubname='supabase_realtime';"),'t')
 const make=key=>createClient(config.API_URL,key||config.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
 const root=make(config.SERVICE_ROLE_KEY),fixtures=[],clients=[root]
 async function fixture(role,status,adminId) {
  const email=`u3-${randomUUID()}@example.invalid`,password=randomUUID()+'aA1!'
  const {user}=await success(root.auth.admin.createUser({email,password,email_confirm:true}));fixtures.push(user.id)
  sql(`insert into profiles(id,full_name,email,role,status,student_id,program,required_hours,approved_at,approved_by) values('${user.id}','U3 Test','${email}','${role}','${status}',${role==='admin'?'null':`'U3-${user.id.slice(0,8).toUpperCase()}'`},${role==='admin'?'null':"'BS Information Technology'"},${role==='admin'?'null':486},${status==='approved'?'now()':'null'},${adminId&&status==='approved'?`'${adminId}'`:'null'});`)
  const client=make();clients.push(client);await success(client.auth.signInWithPassword({email,password}));return {id:user.id,client,events:[],label:role+'-'+status}
 }
 try {
  const admin=await fixture('admin','approved'),alice=await fixture('student','approved',admin.id),bob=await fixture('student','approved',admin.id),pending=await fixture('student','pending'),rejected=await fixture('student','rejected'),anonymous={client:make(),events:[],label:'anonymous'};clients.push(anonymous.client)
  assert.equal((await anonymous.client.auth.getSession()).data.session,null)
  for(const who of [admin,alice,bob,pending,rejected,anonymous]) {
   await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Local Realtime subscription timed out')),15000)
    who.client.channel('u3-'+randomUUID()).on('postgres_changes',{event:'INSERT',schema:'public',table:'attendance_sessions'},event=>who.events.push(event)).on('postgres_changes',{event:'UPDATE',schema:'public',table:'attendance_sessions'},event=>who.events.push(event)).subscribe(status=>{
     if(status==='SUBSCRIBED'||(who===anonymous&&status==='CHANNEL_ERROR')){clearTimeout(timeout);resolve()}
     else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timeout);reject(Error('Local Realtime subscription failed'))}
    })
   })
  }
  const summaryState=async(expected,starts)=>{const s=(await success(alice.client.rpc('attendance_summary')))[0];assert.equal(s.next_action,expected);assert.equal(Number(s.starts_today),starts)}
  await summaryState('time_in',0)
  await success(alice.client.rpc('attendance_time_in'));await summaryState('time_out',1)
  await success(alice.client.rpc('attendance_time_out'));await summaryState('time_in',1)
  await success(alice.client.rpc('attendance_time_in'));await summaryState('time_out',2)
  await success(alice.client.rpc('attendance_time_out'));await summaryState('none',2)
  const denied=await alice.client.rpc('attendance_time_in');assert.equal(denied.error?.message,'DAILY_ATTENDANCE_LIMIT_REACHED')
  for(let i=0;i<100&&admin.events.length<4;i++)await sleep(100)
  await sleep(1000)
  assert.equal(admin.events.length,4);assert.equal(alice.events.length,4)
  assert.deepEqual(admin.events.map(e=>e.eventType),['INSERT','UPDATE','INSERT','UPDATE'])
  for(const who of [bob,pending,rejected])assert.equal(who.events.length,0,who===bob?'other-approved-student':who.label)
  // Local Realtime emits 401 envelopes for anon, but no attendance row data.
  for(const event of anonymous.events){assert.ok(event.errors?.some(e=>e.includes('Unauthorized')));assert.deepEqual(event.new,{});assert.deepEqual(event.old,{})}
  assert.ok(admin.events.every(e=>e.new.student_uid===alice.id))
  const summary=(await success(alice.client.rpc('attendance_summary')))[0];assert.equal(summary.next_action,'none');assert.equal(Number(summary.days_present),1)
  const days=await success(admin.client.rpc('admin_attendance_days',{target_uid:alice.id}));assert.equal(days.days[0].sessions.length,2)
 } finally {
  for(const client of clients)await client.removeAllChannels()
  if(fixtures.length){const ids=fixtures.map(id=>`'${id}'`).join(',');sql(`delete from attendance_sessions where student_uid in (${ids});delete from profiles where id in (${ids}) and role='student';delete from profiles where id in (${ids});`)}
  for(const id of fixtures)await success(root.auth.admin.deleteUser(id))
 }
})
