import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { presentAttendance, formatAttendanceRows } from '../src/services/supabaseAttendancePresentation.js'
import * as presentation from '../src/services/supabaseAttendancePresentation.js'

function synthetic(exports) {
  return new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
  })
}
async function load(name, imports) {
  const module = new SourceTextModule(await readFile(new URL(`../src/services/${name}.js`, import.meta.url), 'utf8'))
  await module.link(specifier => synthetic(imports[specifier]))
  await module.evaluate()
  return module.namespace
}
const service = await load('supabaseAttendance', { '../supabase/supabase.js': { supabase: null } })
const { attendanceUiState, createStudentAttendanceController } = await load('supabaseAttendanceController', { './supabaseAttendance.js': service })
const fresh = () => ({ open_session_id: null, open_time_in: null, started_today: false, completed_seconds: 0, completed_sessions: 0, manila_day:'2026-09-30',starts_today:0,next_action:'time_in',today_sessions:[],open_session_ordinal:null,today_completed_seconds:0,days_present:0 })
const row = { id: 'session', student_uid: 'alice', time_in: '2026-09-30T00:02:00+00:00', time_out: null }
const receipt = (action = 'time_in') => ({ student_uid: 'alice', attendance_session_id: 'session', action_type: action, official_punch_at: row.time_in })
const closed = { ...row, time_out: '2026-09-30T01:02:00+00:00' }
const opened = () => ({ ...fresh(), open_session_id: row.id, open_time_in: row.time_in, started_today: true, starts_today:1,next_action:'time_out',today_sessions:[row],open_session_ordinal:1,days_present:1 })
const completed = () => ({ ...fresh(), started_today: true, completed_seconds: 3600, completed_sessions: 2, starts_today:2,next_action:'none',today_sessions:[closed],today_completed_seconds:3600,days_present:1 })
const profile = { fullName: 'Student', requiredHours: 486 }
const display = model => presentAttendance(model.state, model.records, profile, Date.parse('2026-09-30T04:00:00Z'))
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function fixture(state = fresh(), records = []) {
  const model = attendanceUiState()
  const calls = []
  let access = 0
  const api = {
    waitForAttendanceWrite: async () => {},
    getAttendanceSummary: async () => { calls.push('summary'); return {...state,today_sessions:records} },
    getAttendanceHistory: async uid => { assert.equal(uid, 'alice'); calls.push('history'); return records },
  }
  const controller = createStudentAttendanceController(model, 'alice', () => { access++ }, api)
  return { model, calls, api, controller, access: () => access }
}

test('initial load remains unknown/disabled until summary resolves', async () => {
  const f=fixture(), gate=deferred()
  f.api.getAttendanceSummary=()=>gate.promise
  const load=f.controller.start()
  assert.equal(f.model.ready,false); assert.equal(f.model.loading,true)
  assert.equal(f.controller.submit,undefined); assert.ok(!f.calls.includes('in'))
  gate.resolve(fresh()); await load
  assert.equal(f.model.ready,true); assert.equal(f.model.loading,false)
})
test('fresh student exposes Time In from authoritative summary', async () => {
  const f=fixture(); await f.controller.start()
  assert.ok(f.calls.includes('summary')); assert.equal(display(f.model).action,'Time In'); assert.equal(display(f.model).completedToday,false)
})
test('open session restores real server Time In and Time Out action', async () => {
  const f=fixture(opened(),[row]); await f.controller.start()
  assert.equal(display(f.model).status,'IN'); assert.equal(display(f.model).timeIn,'8:02 AM'); assert.equal(display(f.model).action,'Time Out')
})
for (const closing of [false,true]) {
 test(`${closing?'Time Out':'Time In'} proof receipt triggers single-flight trusted reconciliation`,async()=>{
 const f=fixture(closing?completed():opened(),closing?[closed]:[row]);await f.controller.start()
 const gate=deferred();f.api.getAttendanceSummary=()=>gate.promise
 const first=f.controller.confirmProof(receipt(closing?'time_out':'time_in'))
 await f.controller.confirmProof(receipt());assert.equal(f.model.busy,true);assert.equal(f.model.ready,false)
 gate.resolve({... (closing?completed():opened()),today_sessions:closing?[closed]:[row]});await first
 assert.equal(f.model.busy,false);assert.equal(f.model.ready,true);assert.equal(f.model.confirmedSession.id,row.id)
 assert.equal(display(f.model).status,closing?'OUT':'IN');assert.equal(display(f.model).completedToday,closing)
 assert.ok(!f.calls.includes('in'));assert.ok(!f.calls.includes('out'))
 })
}
test('read controller has no proof-free writes and rejects foreign receipts',async()=>{
 const f=fixture();await f.controller.start();assert.equal(f.controller.submit,undefined)
 await f.controller.confirmProof({...receipt(),student_uid:'bob'});assert.equal(f.model.confirmedSession,null)
 assert.equal(service.timeIn,undefined);assert.equal(service.timeOut,undefined)
})
test('failed trusted refresh blocks actions and preserves confirmed receipt',async()=>{
 const f=fixture();await f.controller.start();f.api.getAttendanceSummary=async()=>{throw new Error('private database detail')}
 await f.controller.confirmProof(receipt());assert.equal(f.model.ready,false);assert.equal(f.model.busy,false)
 assert.equal(f.model.confirmedSession.id,row.id);assert.match(f.model.notice,/Time In recorded/);assert.doesNotMatch(f.model.error,/private database/)
 f.api.getAttendanceSummary=async()=>fresh();await f.controller.start();assert.equal(f.model.ready,true)
})
test('revoked access during trusted refresh invokes profile reconciliation',async()=>{
 const f=fixture();f.api.getAttendanceSummary=async()=>{throw new Error('APPROVED_STUDENT_REQUIRED')}
 await f.controller.start();assert.equal(f.model.ready,false);assert.equal(f.access(),1)
})
test('stop/account change clears data and ignores late reads', async () => {
  const f=fixture(),gate=deferred(); f.api.getAttendanceSummary=()=>gate.promise
  const loading=f.controller.start(); await new Promise(resolve=>setImmediate(resolve))
  f.controller.stop(); gate.resolve(opened()); await loading
  assert.equal(f.model.state,null); assert.deepEqual(f.model.records,[]); assert.equal(f.model.ready,false)
})
test('stop during receipt reconciliation cannot restore previous account data',async()=>{
 const f=fixture();await f.controller.start();const gate=deferred();f.api.getAttendanceSummary=()=>gate.promise
 const pending=f.controller.confirmProof(receipt());f.controller.stop();gate.resolve(opened());await pending
 assert.equal(f.model.confirmedSession,null);assert.equal(f.model.state,null);assert.equal(f.model.ready,false)
})
test('remount waits for an earlier view write before requesting history', async () => {
  const f=fixture(opened(),[row]),gate=deferred(); f.api.waitForAttendanceWrite=()=>gate.promise
  const loading=f.controller.start(); assert.deepEqual(f.calls,[])
  gate.resolve(); await loading; assert.equal(display(f.model).status,'IN')
})
test('cross-user rows and inconsistent snapshots fail closed', async () => {
  for (const records of [[{...row,student_uid:'bob'}],[row,row]]) {
    const f=fixture(opened(),records); await f.controller.start(); assert.equal(f.model.ready,false)
  }
})
test('offline invalidates state until refreshed', async () => {
  const f=fixture(); await f.controller.start(); f.controller.offline()
  assert.equal(f.model.ready,false); assert.ok(!f.calls.includes('in'))
  await f.controller.start(); assert.equal(f.model.ready,true)
})
test('summary total is authoritative; history is not summed for total hours', () => {
  const result=presentAttendance({...completed(),completed_seconds:7200.5},[closed],profile,Date.now())
  assert.equal(result.totalHours,'2h 00m'); assert.equal(result.todayHours,'1h 00m')
})
test('browser date does not override started_today policy; overnight remains open', () => {
  assert.equal(presentAttendance(completed(),[closed],profile,Date.parse('2030-01-01')).completedToday,true)
  const result=presentAttendance({...opened(),started_today:false,manila_day:'2026-10-01'},[row],profile,Date.parse('2026-10-01T01:00Z'))
  assert.equal(result.action,'Time Out'); assert.equal(result.carriedOver,true)
  assert.match(formatAttendanceRows([{...row,time_out:'2026-10-01T00:00:00Z'}])[0].timeOut,/October 1, 2026/)
})
test('shared write tracker prevents parallel finalizations and read waits',async()=>{
 const gate=deferred();const first=service.trackAttendanceWrite(()=>gate.promise)
 await assert.rejects(service.trackAttendanceWrite(async()=>{}),/ATTENDANCE_BUSY/)
 let done=false;const waiting=service.waitForAttendanceWrite().then(()=>done=true)
 await Promise.resolve();assert.equal(done,false);gate.resolve('receipt');assert.equal(await first,'receipt');await waiting;assert.equal(done,true)
})
test('history requests one bounded server day page with date/cursor filters', async () => {
 const calls=[];const api=await load('supabaseAttendance',{'../supabase/supabase.js':{supabase:{rpc(name,args){calls.push([name,args]);return {retry(){return this},abortSignal(){return {data:{days:[],next_before_day:null},error:null}}}}}}})
 await api.getAttendanceDays({day_limit:15,before_day:'2026-09-30',on_day:'2026-09-01'})
 assert.equal(calls.length,1);assert.equal(calls[0][0],'attendance_days');assert.equal(calls[0][1].day_limit,15);assert.equal(calls[0][1].on_day,'2026-09-01')
})

test('active Options API mixin loads Supabase for an approved student and resets on account change', async () => {
  const authState={provider:'supabase',user:{id:'alice'},profile:{uid:'alice',role:'student',status:'approved'}}
  let starts=0,stops=0
  const { default:mixin }=await load('studentAttendanceMixin',{
    './supabaseAttendance.js':{getAttendanceDays:async()=>({days:[]})},
    './auth':{authState,refreshProfile:async()=>{}},
    './accountPolicy':{accountDestination:()=>'/student'},
    './supabaseAttendancePresentation.js':presentation,
    './supabaseAttendanceController.js':{attendanceUiState,createStudentAttendanceController(model,uid){
      assert.equal(uid,authState.user.id)
      return {start(){starts++;model.ready=true},stop(){stops++}}
    }},
  })
  const vm={...mixin.data(),...mixin.methods}
  Object.defineProperty(vm,'attendanceEligible',{get:()=>mixin.computed.attendanceEligible.call(vm)})
  await vm.startAttendance()
  assert.equal(starts,1); assert.equal(vm.attendanceUi.ready,true)
  authState.user={id:'bob'}
  // Owner mismatch prevents starting a read with Alice's trusted profile.
  await mixin.watch.attendanceAccountKey.call(vm)
  assert.equal(stops,1);assert.equal(vm.attendanceUi.ready,false);assert.equal(starts,1)
  authState.profile={uid:'bob',role:'student',status:'approved'}
  await vm.startAttendance();assert.equal(starts,2)
  authState.profile.status='pending';await vm.startAttendance();assert.equal(vm.attendanceUi.ready,false)
})

test('active student attendance modules never import Firebase attendance references', async () => {
  for(const name of ['studentAttendanceMixin','supabaseAttendanceController','supabaseAttendance','supabaseAttendancePresentation']) {
    const source=await readFile(new URL(`../src/services/${name}.js`,import.meta.url),'utf8')
    assert.doesNotMatch(source, /from\s+['"][^'"]*(?:firebase|\/attendance\.js|\/attendancePresentation\.js|\/studentAttendanceController\.js)|import\(['"][^'"]*firebase/)
    assert.doesNotMatch(source,/localStorage|\.insert\(|\.update\(|\.delete\(/)
  }
})

for (const [starts,open,action,label] of [[0,false,'time_in','Time In'],[1,true,'time_out','Time Out'],[1,false,'time_in','Time In Again'],[2,true,'time_out','Time Out'],[2,false,'none','Time In']]) test(`U3 state starts=${starts} open=${open}`,()=>{
 const state={...fresh(),starts_today:starts,next_action:action,today_sessions:starts?[closed]:[],open_session_id:open?'session':null,open_time_in:open?row.time_in:null,open_session_ordinal:starts,today_completed_seconds:starts===2?28800:0,days_present:starts?1:0}
 const result=presentAttendance(state,[],profile,Date.now());assert.equal(result.action,label);assert.equal(result.completedToday,action==='none');assert.equal(result.days,starts?1:0);if(starts===2)assert.equal(result.todayHours,'8h 00m')
})
test('U3 first closed session allows a second Time In without history read',async()=>{
 const f=fixture({...completed(),starts_today:1,next_action:'time_in'},[closed]);await f.controller.start();assert.equal(display(f.model).action,'Time In Again');assert.ok(!f.calls.includes('history'))
})
