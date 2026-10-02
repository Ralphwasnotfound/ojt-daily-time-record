import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import * as icons from 'lucide-vue-next'
import * as presentation from '../src/services/supabaseAttendancePresentation.js'
import * as proofController from '../src/services/attendanceProofController.js'

const profile = { uid: 'alice', fullName: 'Real Student', role: 'student', status: 'approved', requiredHours: 486 }
const model = () => ({ ready: false, loading: true, busy: false, error: '', notice: '', state: { open_session_id: null, open_time_in: null, started_today: false, completed_seconds: 0, completed_sessions: 0,manila_day:"2026-09-29",starts_today:0,next_action:"time_in",today_sessions:[],today_completed_seconds:0,days_present:0 }, records: [] })
export async function loadComponent(filename) {
  const cache = new Map()
  function synthetic(exports) {
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    })
  }
  async function load(file) {
    if (cache.has(file)) return cache.get(file)
    let source = await readFile(file, 'utf8')
    if (file.endsWith('.vue')) {
      const { descriptor } = parse(source)
      const template = compileTemplate({ source: descriptor.template.content, filename: file, id: 'attendance-test' })
      assert.deepEqual(template.errors, [])
      source = descriptor.script.content + '\n' + template.code
    }
    const module = new SourceTextModule(source)
    cache.set(file, module)
    await module.link(async specifier => {
      if (specifier === 'vue') return synthetic(vue)
      if (specifier === 'lucide-vue-next') return synthetic(icons)
      if (specifier.endsWith('.png')) return synthetic({ default: '/logo.png' })
      if (specifier.endsWith('adminAttendanceProof.js')) return synthetic({ adminAttendanceProofApi: {}, formatProof: () => ({}) })
      if (specifier.endsWith('supabaseAdmin.js')) return synthetic({ adminKey: () => '' })
      if (specifier.endsWith('studentAttendanceProof.js')) return synthetic({ studentAttendanceProofApi: {}, studentProofKey: () => 'alice', withStudentProofAvailability: async history => history })
      if (specifier === './auth') return synthetic({ authState: { provider: 'supabase', user: { id: 'alice' }, profile }, refreshProfile: async () => {} })
      if (specifier === './accountPolicy') return synthetic({ accountDestination: () => '/student' })
      if (specifier.endsWith('supabaseAttendanceController.js')) return synthetic({ attendanceUiState: model, createStudentAttendanceController: () => {} })
      if (specifier.endsWith('attendanceProofController.js')) return synthetic(proofController)
      if (specifier.endsWith('supabaseAttendancePresentation.js')) return synthetic(presentation)
      if (specifier.endsWith('supabaseAttendanceProofs.js')) return synthetic({ attendanceProofApi: () => ({}) })
      if (specifier.endsWith('supabaseActivities.js')) return synthetic({ activityApi: {}, activityAccountKey: () => 'alice', approvedActivityStudent: () => true })
      if (specifier.endsWith('supabaseAttendance.js')) return synthetic({ getAttendanceDays: async () => ({days:[],next_before_day:null}), getAttendanceSummary: async () => ({ open_session_id: null }) })
      let target = path.resolve(path.dirname(file), specifier)
      if (!path.extname(target)) target += '.js'
      return load(target)
    })
    return module
  }
  const root = await load(path.resolve(filename))
  await root.evaluate()
  for (const [file, module] of cache) if (file.endsWith('.vue')) module.namespace.default.render = module.namespace.render
  return root.namespace.default
}

export async function renderStudentView(name, fixture, extra = {}) {
  const component = await loadComponent(`src/views/student/${name}.vue`)
  const original = component.data
  const rendered = { ...component, data() {
    return { ...(original ? original.call(this) : {}), attendanceUi: fixture, displayNow: Date.parse('2026-09-29T08:00:00Z'), ...extra }
  } }
  const app = vue.createSSRApp(rendered)
  app.component('RouterLink', { props: ['to'], setup(props, { slots }) { return () => vue.h('a', { href: props.to }, slots.default?.()) } })
  return renderToString(app)
}

test('student history shows proof actions only for confirmed existing proofs, without a gallery', async () => {
  const component = await loadComponent('src/views/student/AttendanceView.vue')
  const days = component.components.AttendanceDays, original = days.data
  days.data = function () { return { ...original(), days: [{start_day:'2026-10-02',completed_seconds:3600,sessions:[
    {id:'one',time_in:'2026-10-02T00:00:00Z',time_out:'2026-10-02T01:00:00Z',session_ordinal:1,proofActions:['time_in','time_out']},
    {id:'legacy',time_in:'2026-10-02T02:00:00Z',time_out:'2026-10-02T03:00:00Z',session_ordinal:2,proofActions:[]},
  ]}] } }
  const app = vue.createSSRApp(component)
  const html = await renderToString(app)
  assert.equal((html.match(/>View Proof<\/button>/g)||[]).length,2)
  assert.match(html,/View Time In Proof/); assert.match(html,/View Time Out Proof/); assert.match(html,/Session 2/)
  assert.doesNotMatch(html,/Private attendance selfie|Branded attendance evidence/)
})

test('student views render explicit loading and real empty attendance without old mock totals', async () => {
  for (const name of ['AttendanceView', 'StudentDashboard', 'HistoryView']) {
    const loading = await renderStudentView(name, model())
    assert.match(loading, /Loading attendance history/)
    if (name === 'AttendanceView') assert.match(loading, /<button[^>]*disabled[^>]*aria-busy="false"/)
    assert.doesNotMatch(loading, /126h 15m|4h 32m|5h 14m/)
    const empty = await renderStudentView(name, { ...model(), ready: true, loading: false })
    assert.match(empty, /0h 00m/)
    if (name === 'AttendanceView') {
      assert.match(empty, /Time In/)
      assert.match(empty, /<button type="button" aria-busy="false"/)
      assert.match(empty, /No attendance recorded for this selection/)
      assert.doesNotMatch(empty, /Captured:/)
    }
    if (name === 'StudentDashboard') assert.match(empty, /Real Student/)
    if (name === 'HistoryView') {
      assert.match(empty, /25 records per page/)
      assert.doesNotMatch(empty, /Sample activity data only|Activity Updates \(sample\)/)
    }
  }
})
test('completed attendance disables another Time In and renders actual duration', async () => {
  const state = { open_session_id: null, open_time_in: null, started_today: true, completed_seconds: 3600, completed_sessions: 1,manila_day:"2026-09-29",starts_today:2,next_action:"none",today_sessions:[],today_completed_seconds:3600,days_present:1 }
  const record = { id: 'real', student_uid: 'alice', time_in: '2026-09-29T00:00:00Z', time_out: '2026-09-29T01:00:00Z' }
  state.today_sessions=[record]
  const html = await renderStudentView('AttendanceView', { ...model(), ready: true, loading: false, state, records: [record] })
  assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?Completed for today/)
  assert.match(html, /1h 00m/)
  assert.match(html, /8:00 AM/)
  assert.match(html, /9:00 AM/)
})

test('open Supabase session renders enabled Time Out and real server timestamp', async () => {
  const record = { id: 'open', student_uid: 'alice', time_in: '2026-09-29T00:02:00Z', time_out: null }
  const state = { open_session_id: 'open', open_time_in: record.time_in, started_today: true, completed_seconds: 0, completed_sessions: 0,manila_day:"2026-09-29",starts_today:1,next_action:"time_out",today_sessions:[],open_session_ordinal:1,today_completed_seconds:0,days_present:1 }
  state.today_sessions=[record]
  const html = await renderStudentView('AttendanceView', { ...model(), ready: true, loading: false, state, records: [record] })
  assert.match(html, /CURRENTLY IN/)
  assert.match(html, /8:02 AM/)
  assert.match(html, /<button type="button" aria-busy="false"[^>]*>[\s\S]*?Time Out<\/button>/)
  assert.match(html, /Session 1/)
})

test('attendance actions open verification only, map Time In Again, and reject repeated/disabled clicks',async()=>{
 const component=await loadComponent('src/views/student/AttendanceView.vue')
 for(const action of ['time_in','time_out','time_in','time_out']){
  const vm={verification:null,attendanceActionDisabled:false,attendanceUi:{state:{next_action:action}},attendanceStudentUid:'alice'}
  component.methods.submitAttendance.call(vm);assert.deepEqual(vm.verification,{action,owner:'alice'})
  const first=vm.verification;component.methods.submitAttendance.call(vm);assert.equal(vm.verification,first)
 }
 const disabled={verification:null,attendanceActionDisabled:true};component.methods.submitAttendance.call(disabled);assert.equal(disabled.verification,null)
})
test('successful verification closes dialog and forwards receipt for trusted summary/history refresh',async()=>{
 const component=await loadComponent('src/views/student/AttendanceView.vue');const receipt={id:'proof'};let confirmed
 const vm={verification:{},restoreDeferredVerification(){},attendanceController:{confirmProof:async value=>{confirmed=value}}}
 await component.methods.attendanceVerified.call(vm,receipt);assert.equal(vm.verification,null);assert.equal(confirmed,receipt)
 // History reloads when the controller replaces the authoritative summary.
 const source=await readFile('src/views/student/AttendanceView.vue','utf8');assert.match(source,/:refresh-key="attendanceUi.state"/)
 vm.verification={};component.watch.attendanceAccountKey.call(vm);assert.equal(vm.verification,null)
})
test('deferred verification survives view recreation and opens recovery instead of another attendance action',async()=>{
 const state=proofController.attendanceProofState()
 const api={prepare:async()=>{throw Error('offline')}}
 const options={api,owner:'alice',action:'time_out',allowed:()=>true,locate:async()=>({latitude:14,longitude:121,accuracy:1}),uuid:()=> 'deferred-view-test'}
 const controller=proofController.createAttendanceProofController(state,options)
 await controller.submit(new Blob(['selfie'],{type:'image/jpeg'}));await controller.cancel();assert.equal(controller.defer(),true)
 const component=await loadComponent('src/views/student/AttendanceView.vue')
 const vm={...component.data(),...component.methods,attendanceStudentUid:'alice',attendanceEligible:true,attendanceActionDisabled:true}
 vm.restoreDeferredVerification();assert.ok(vm.deferredVerification);vm.submitAttendance()
 assert.equal(vm.verification.action,'time_out');assert.equal(vm.verification.recovery,vm.deferredVerification)
 const html=await renderStudentView('AttendanceView',model(),{deferredVerification:vm.deferredVerification})
 // The handler checks the shared checkpoint directly, including before mount.
 assert.match(html,/Resolve previous verification/);assert.match(html,/No new punch will be started/);assert.equal(vm.verification.recovery.attempt.requestId,'deferred-view-test')
 const recoveryState=proofController.attendanceProofState();recoveryState.attempt={...vm.deferredVerification.attempt};recoveryState.recoveryOnly=true
 api.prepare=async()=>{throw Error('UPLOAD_EXPIRED_OR_DISCARDED')}
 assert.equal(await proofController.createAttendanceProofController(recoveryState,options).cancel(),true);assert.equal(proofController.getDeferredAttendanceProof('alice'),null)
})
