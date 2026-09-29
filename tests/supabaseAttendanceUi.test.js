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
const fresh = () => ({ open_session_id: null, open_time_in: null, started_today: false, completed_seconds: 0, completed_sessions: 0 })
const row = { id: 'session', student_uid: 'alice', time_in: '2026-09-30T00:02:00+00:00', time_out: null }
const closed = { ...row, time_out: '2026-09-30T01:02:00+00:00' }
const opened = () => ({ ...fresh(), open_session_id: row.id, open_time_in: row.time_in, started_today: true })
const completed = () => ({ ...fresh(), started_today: true, completed_seconds: 3600, completed_sessions: 1 })
const profile = { fullName: 'Student', requiredHours: 486 }
const display = model => presentAttendance(model.state, model.records, profile, Date.parse('2026-09-30T04:00:00Z'))
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function fixture(state = fresh(), records = []) {
  const model = attendanceUiState()
  const calls = []
  let access = 0
  const api = {
    waitForAttendanceWrite: async () => {},
    getAttendanceSummary: async () => { calls.push('summary'); return state },
    getAttendanceHistory: async uid => { assert.equal(uid, 'alice'); calls.push('history'); return records },
    timeIn: async () => { calls.push('in'); state=opened(); records=[row]; return row },
    timeOut: async () => { calls.push('out'); state=completed(); records=[closed]; return closed },
  }
  const controller = createStudentAttendanceController(model, 'alice', () => { access++ }, api)
  return { model, calls, api, controller, access: () => access }
}

test('initial load remains unknown/disabled until summary resolves', async () => {
  const f=fixture(), gate=deferred()
  f.api.getAttendanceSummary=()=>gate.promise
  const load=f.controller.start()
  assert.equal(f.model.ready,false); assert.equal(f.model.loading,true)
  await f.controller.submit(); assert.ok(!f.calls.includes('in'))
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
  test(`${closing?'Time Out':'Time In'} is single-flight and reconciles success`, async () => {
    const f=fixture(closing?opened():fresh(),closing?[row]:[]); await f.controller.start()
    const gate=deferred(), operation=closing?'timeOut':'timeIn', original=f.api[operation]
    let writes=0
    f.api[operation]=async()=>{ writes++; await gate.promise; return original() }
    const first=f.controller.submit()
    await f.controller.submit(); await f.controller.submit()
    assert.equal(writes,1); assert.equal(f.model.busy,true); assert.equal(f.model.ready,false)
    gate.resolve(); await first
    assert.equal(f.model.busy,false); assert.equal(f.model.ready,true)
    assert.equal(f.model.confirmedSession.id,row.id)
    assert.equal(f.calls.filter(x=>x==='summary').length,2)
    assert.equal(display(f.model).status,closing?'OUT':'IN')
    assert.equal(display(f.model).completedToday,closing)
  })
}
test('completed today cannot submit either operation even after refresh', async () => {
  const f=fixture(completed(),[closed]); await f.controller.start(); await f.controller.submit(); await f.controller.start()
  assert.equal(display(f.model).completedToday,true); assert.ok(!f.calls.includes('in')); assert.ok(!f.calls.includes('out'))
})
for (const [message, expected] of [
  ['ALREADY_TIMED_IN','You are already timed in.'],
  ['ALREADY_STARTED_TODAY','You have already completed your attendance for today.'],
  ['NO_OPEN_ATTENDANCE','There is no active attendance session to time out.'],
  ['APPROVED_STUDENT_REQUIRED','Attendance requires an approved student account. Please check your account status.'],
]) test(`${message} has friendly feedback and reconciles`, async () => {
  const f=fixture(); await f.controller.start()
  f.api.timeIn=async()=>{ throw { code:'P0001',message } }
  await f.controller.submit()
  assert.equal(f.model.error,expected); assert.equal(f.calls.filter(x=>x==='summary').length,2)
  if(message==='APPROVED_STUDENT_REQUIRED') { assert.equal(f.model.ready,false); assert.equal(f.access(),1) }
})
test('unknown committed write reconciles before allowing the next action; never replays', async () => {
  const f=fixture(); await f.controller.start()
  let writes=0; const gate=deferred()
  f.api.timeIn=async()=>{ writes++; throw new TypeError('Failed to fetch') }
  f.api.getAttendanceHistory=async()=>[row]
  f.api.getAttendanceSummary=()=>gate.promise
  const mutation=f.controller.submit()
  await new Promise(resolve=>setImmediate(resolve))
  await f.controller.submit(); assert.equal(writes,1); assert.equal(f.model.ready,false)
  gate.resolve(opened()); await mutation
  assert.equal(f.model.ready,true); assert.equal(display(f.model).action,'Time Out'); assert.equal(writes,1)
})
test('failed reconciliation blocks writes until explicit successful refresh', async () => {
  const f=fixture(); await f.controller.start()
  f.api.timeIn=async()=>{ throw new Error('private database detail') }
  f.api.getAttendanceSummary=async()=>{ throw new Error('network') }
  await f.controller.submit()
  assert.equal(f.model.ready,false); assert.equal(f.model.busy,false); assert.doesNotMatch(f.model.error,/private database/)
  await f.controller.submit()
  f.api.getAttendanceSummary=async()=>fresh(); await f.controller.start(); assert.equal(f.model.ready,true)
})
test('confirmed receipt survives summary failure without re-enabling actions', async () => {
  const f=fixture(); await f.controller.start()
  f.api.getAttendanceSummary=async()=>{throw new Error('network')}
  await f.controller.submit()
  assert.equal(f.model.confirmedSession.id,row.id); assert.match(f.model.notice,/Time In recorded/); assert.equal(f.model.ready,false)
})
test('stop/account change clears data and ignores late reads', async () => {
  const f=fixture(),gate=deferred(); f.api.getAttendanceSummary=()=>gate.promise
  const loading=f.controller.start(); await new Promise(resolve=>setImmediate(resolve))
  f.controller.stop(); gate.resolve(opened()); await loading
  assert.equal(f.model.state,null); assert.deepEqual(f.model.records,[]); assert.equal(f.model.ready,false)
})
test('stop during mutation cannot restore the previous account data', async () => {
  const f=fixture(); await f.controller.start(); const gate=deferred(); f.api.timeIn=()=>gate.promise
  const pending=f.controller.submit(); f.controller.stop(); gate.resolve(row); await pending
  assert.equal(f.model.confirmedSession,null); assert.equal(f.model.state,null); assert.equal(f.model.ready,false)
})
test('remount waits for an earlier view write before requesting history', async () => {
  const f=fixture(opened(),[row]),gate=deferred(); f.api.waitForAttendanceWrite=()=>gate.promise
  const loading=f.controller.start(); assert.deepEqual(f.calls,[])
  gate.resolve(); await loading; assert.equal(display(f.model).status,'IN')
})
test('cross-user rows and inconsistent snapshots fail closed', async () => {
  for (const records of [[{...row,student_uid:'bob'}],[],[row,row]]) {
    const f=fixture(opened(),records); await f.controller.start(); assert.equal(f.model.ready,false)
  }
})
test('offline invalidates state until refreshed', async () => {
  const f=fixture(); await f.controller.start(); f.controller.offline(); await f.controller.submit()
  assert.equal(f.model.ready,false); assert.ok(!f.calls.includes('in'))
  await f.controller.start(); assert.equal(f.model.ready,true)
})
test('summary total is authoritative; history is not summed for total hours', () => {
  const result=presentAttendance({...completed(),completed_seconds:7200.5},[closed],profile,Date.now())
  assert.equal(result.totalHours,'2h 00m'); assert.equal(result.todayHours,'1h 00m')
})
test('browser date does not override started_today policy; overnight remains open', () => {
  assert.equal(presentAttendance(completed(),[closed],profile,Date.parse('2030-01-01')).completedToday,true)
  const result=presentAttendance({...opened(),started_today:false},[row],profile,Date.parse('2026-10-01T01:00Z'))
  assert.equal(result.action,'Time Out'); assert.equal(result.carriedOver,true)
  assert.match(formatAttendanceRows([{...row,time_out:'2026-10-01T00:00:00Z'}])[0].timeOut,/October 1, 2026/)
})
test('RPC service sends no identity/time arguments and prevents parallel writes', async () => {
  const gate=deferred(),calls=[]
  const query={ retry(enabled){assert.equal(enabled,false);return this},abortSignal(signal){assert.ok(signal instanceof AbortSignal);return gate.promise} }
  const api=await load('supabaseAttendance', {'../supabase/supabase.js':{supabase:{rpc(...args){calls.push(args);return query}}}})
  const first=api.timeIn(); await assert.rejects(api.timeOut(),/ATTENDANCE_BUSY/)
  gate.resolve({data:row,error:null}); assert.deepEqual(await first,row)
  assert.deepEqual(calls,[['attendance_time_in']])
})
test('history service pages through RLS reads using stable ordering', async () => {
  const ranges=[],filters=[],orders=[]
  const query={select(){return this},eq(...args){filters.push(args);return this},order(...args){orders.push(args);return this},
    range(a,b){ranges.push([a,b]);this.offset=a;return this},retry(){return this},
    async abortSignal(){return {data:this.offset===0?Array.from({length:200},(_,i)=>({...row,id:String(i)})):[closed],error:null}}}
  const api=await load('supabaseAttendance',{'../supabase/supabase.js':{supabase:{from(name){assert.equal(name,'attendance_sessions');return query}}}})
  assert.equal((await api.getAttendanceHistory('alice')).length,201)
  assert.deepEqual(ranges,[[0,199],[200,399]]); assert.deepEqual(filters[0],['student_uid','alice']); assert.equal(orders[0][0],'time_in'); assert.equal(orders[1][0],'id')
})

test('active Options API mixin loads Supabase for an approved student and resets on account change', async () => {
  const authState={provider:'supabase',user:{id:'alice'},profile:{uid:'alice',role:'student',status:'approved'}}
  let starts=0,stops=0
  const { default:mixin }=await load('studentAttendanceMixin',{
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
