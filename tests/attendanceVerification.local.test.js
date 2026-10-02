// Runs real U4.3 service/controller against LOCAL Auth, PostgREST and Storage.
// Credentials are obtained only from the local CLI, never .env/hosted settings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { createClient } from '@supabase/supabase-js'
import { checkSelfie } from '../src/services/attendanceCapture.js'
import { validAttendanceLocation } from '../src/services/attendanceLocation.js'
import { attendanceProofState, createAttendanceProofController } from '../src/services/attendanceProofController.js'
import { proofCleanupSql } from './helpers/attendanceProofFixtures.js'
function synthetic(values){return new SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v)})}
const reads=new SourceTextModule(await readFile(new URL('../src/services/supabaseAttendance.js',import.meta.url),'utf8'))
await reads.link(()=>synthetic({supabase:null}));await reads.evaluate()
const service=new SourceTextModule(await readFile(new URL('../src/services/supabaseAttendanceProofs.js',import.meta.url),'utf8'))
await service.link(s=>synthetic(s.includes('supabase/supabase')?{supabase:null}:s==='./auth'?{authState:{}}:s.includes('Capture')?{checkSelfie}:s.includes('Location')?{validAttendanceLocation}:reads.namespace));await service.evaluate()
function config(){
 const c=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
 assert.equal(c.API_URL,'http://127.0.0.1:54321');assert.ok(c.ANON_KEY&&c.SERVICE_ROLE_KEY);return c
}
function sql(input){try{return execFileSync('docker',['exec','-i','supabase_db_ojt-dtr-s1-local','psql','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}catch{throw Error('Local U4.3 fixture SQL failed')}}
async function ok(query){const {data,error}=await query;assert.equal(error,null);return data}
// Valid 2x2 JPEG fixture; no real student selfie/location is used.
const jpeg='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlqKKK8c9Q/9k='
const blob=new Blob([Buffer.from(jpeg,'base64')],{type:'image/jpeg'}),location={latitude:14.6,longitude:121,accuracy:12}
test('U4.3 real local proof service/controller lifecycle',async t=>{
 const c=config(),make=(key=c.ANON_KEY)=>createClient(c.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
 const root=make(c.SERVICE_ROLE_KEY),client=make(),paths=new Set();let uid,adminId
 try{
 const adminEmail=`u43-admin-${randomUUID()}@example.invalid`
 const admin=await ok(root.auth.admin.createUser({email:adminEmail,password:randomUUID()+'aA1!',email_confirm:true}));adminId=admin.user.id
 sql(`insert into profiles(id,full_name,email,role,status,approved_at) values('${adminId}','U43 Local Admin','${adminEmail}','admin','approved',clock_timestamp());`)
 const email=`u43-${randomUUID()}@example.invalid`,password=randomUUID()+'aA1!'
 const {user}=await ok(root.auth.admin.createUser({email,password,email_confirm:true}));uid=user.id
 sql(`insert into profiles(id,full_name,email,student_id,role,status,program,required_hours,approved_at,approved_by) values('${uid}','U43 Local Fixture','${email}','U43-${uid.slice(0,8).toUpperCase()}','student','approved','BS Information Technology',486,clock_timestamp(),'${adminId}');`)
 await ok(client.auth.signInWithPassword({email,password}))
 const base=service.namespace.createAttendanceProofApi(client,()=>({id:uid,approved:true}))
 const tracked={...base,prepare:async(...args)=>{const draft=await base.prepare(...args);paths.add(draft.photo_path);return draft}}
 const flow=(action,api=tracked)=>{const state=attendanceProofState();return {state,controller:createAttendanceProofController(state,{api,owner:uid,action,allowed:()=>true,locate:async()=>location,uuid:randomUUID})}}
 let first
 await t.test('lost immutable upload response downloads matching bytes and finalizes once',async()=>{
 let uploads=0,prepares=0;const f=flow('time_in',{...tracked,prepare:async(...args)=>{prepares++;return tracked.prepare(...args)},upload:async(...args)=>{uploads++;await tracked.upload(...args);throw Error('RESULT_UNKNOWN')}})
 await f.controller.submit(blob);assert.equal(f.state.unresolved,true);const request=f.state.attempt.requestId
 await f.controller.submit(blob);assert.ok(f.state.saved);first=f.state.saved;assert.equal(uploads,1);assert.equal(prepares,1);assert.ok(request)
 const [summary]=await ok(client.rpc('attendance_summary'));assert.equal(summary.open_session_id,first.attendance_session_id);assert.equal(summary.starts_today,1)
 })
 await t.test('lost finalize response reads immutable receipt and does not repeat attendance',async()=>{
 let finalizations=0;const f=flow('time_out',{...tracked,finalize:async(...args)=>{finalizations++;await tracked.finalize(...args);throw Error('RESULT_UNKNOWN')}})
 await f.controller.submit(blob);assert.ok(f.state.saved);assert.equal(finalizations,1);assert.equal(f.state.saved.attendance_session_id,first.attendance_session_id)
 const [summary]=await ok(client.rpc('attendance_summary'));assert.equal(summary.open_session_id,null);assert.equal(summary.next_action,'time_in')
 })
 await t.test('cancel discards uploaded unattached proof without opening second session',async()=>{
 const f=flow('time_in',{...tracked,upload:async(...args)=>{await tracked.upload(...args);throw Error('RESULT_UNKNOWN')}})
 await f.controller.submit(blob);const draft=f.state.attempt.draft;assert.equal(await f.controller.cancel(),true)
 assert.equal(sql(`select state from private.attendance_proof_uploads where id='${draft.upload_id}'`),'discarded')
 assert.equal(await base.uploaded(draft,blob),false)
 const [summary]=await ok(client.rpc('attendance_summary'));assert.equal(summary.starts_today,1);assert.equal(summary.open_session_id,null)
 })
 await t.test('unknown prepare response recovers same request reservation on retry',async()=>{
 let n=0;const ids=[];const f=flow('time_in',{...tracked,prepare:async(...args)=>{ids.push(args[0]);const ticket=await tracked.prepare(...args);if(!n++)throw Error('RESULT_UNKNOWN');return ticket}})
 await f.controller.submit(blob);await f.controller.submit(blob);assert.ok(f.state.saved);assert.equal(ids.length,2);assert.equal(ids[0],ids[1])
 const [summary]=await ok(client.rpc('attendance_summary'));assert.equal(summary.starts_today,2)
 })
 await t.test('final Time Out succeeds and server prevents third Time In',async()=>{
 const f=flow('time_out');await f.controller.submit(blob);assert.ok(f.state.saved)
 const third=flow('time_in');await third.controller.submit(blob);assert.equal(third.state.blocked,true);assert.equal(third.state.saved,null);assert.equal(await third.controller.cancel(),true)
 const [summary]=await ok(client.rpc('attendance_summary'));assert.equal(summary.next_action,'none')
 const days=await ok(client.rpc('attendance_days'));assert.equal(days.days[0].sessions.length,2)
 })
 }finally{
 if(paths.size)await ok(root.storage.from('attendance-proofs').remove([...paths]))
 if(uid){sql(`begin;${proofCleanupSql(`'${uid}'`)} delete from attendance_sessions where student_uid='${uid}';delete from profiles where id='${uid}';commit;`);await client.auth.signOut();await ok(root.auth.admin.deleteUser(uid))}
 if(adminId){sql(`delete from profiles where id='${adminId}';`);await ok(root.auth.admin.deleteUser(adminId))}
 }
})
