import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm'
import { parse, compileTemplate } from '@vue/compiler-sfc'
import * as vue from 'vue'
import * as icons from 'lucide-vue-next'
import { renderToString } from '@vue/server-renderer'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const original = () => ({
  student: { id: 'student-internal', full_name: 'Trusted Student', student_id: 'TEST-001' },
  proof: { student_uid: 'student-internal', attendance_session_id: 'session-internal', action_type: 'time_in', official_punch_at: '2026-10-01T16:02:03.123456+00:00', latitude: 14.612346, longitude: 121.123456, accuracy: 12.4, photo_path: 'student-internal/session-internal/private-path/proof' },
  ordinal: 1,
})
async function load(file, { client = {}, api, globals = {}, key = () => 'admin', state = {} } = {}) {
  const context = createContext({ AbortController, setTimeout, clearTimeout, Blob, URL, ...globals }), cache = new Map()
  const synthetic = values => new SyntheticModule(Object.keys(values), function () { for (const [k,v] of Object.entries(values)) this.setExport(k,v) }, { context })
  async function module(filename) {
    if (cache.has(filename)) return cache.get(filename)
    const pending = (async () => {
      let source = await readFile(filename, 'utf8')
      if (filename.endsWith('.vue')) { const { descriptor } = parse(source); const result = compileTemplate({ source: descriptor.template.content, filename, id: 'u44' }); assert.deepEqual(result.errors, []); source = descriptor.script.content + '\n' + result.code }
      const m = new SourceTextModule(source, { context })
      await m.link(s => {
        if (s === 'vue') return synthetic(vue)
        if (s === 'lucide-vue-next') return synthetic(icons)
        if (s.endsWith('.png')) return synthetic({ default: '/bsit-logo.png' })
        if (s.endsWith('supabase/supabase.js')) return synthetic({ supabase: client })
        if (s === './auth') return synthetic({ authState: state })
        if (api && s.endsWith('studentAttendanceProof.js')) return synthetic({ studentAttendanceProofApi: api, studentProofKey: key })
        if (s.endsWith('supabaseAdmin.js')) return synthetic({ adminKey: key })
        if (api && s.endsWith('adminAttendanceProof.js')) return synthetic({ adminAttendanceProofApi: api, formatProof: e => e.formatted || {} })
        return module(path.resolve(path.dirname(filename), s))
      })
      return m
    })()
    cache.set(filename, pending); return pending
  }
  const m = await module(path.resolve(file)); await m.evaluate()
  for (const [name, pending] of cache) if (name.endsWith('.vue')) { const v = await pending; v.namespace.default.render = v.namespace.render }
  return m.namespace
}
function clientFor(e = original(), overrides = {}) {
  const calls = []
  const session = { id: e.proof.attendance_session_id, student_uid: e.student.id, time_in: e.proof.official_punch_at, time_out: null }
  if (e.proof.action_type === 'time_out') { session.time_in = '2026-10-01T16:00:00+00:00'; session.time_out = e.proof.official_punch_at }
  const client = {
    from(table) {
      const filters = {}; calls.push({ table, filters })
      const result = () => ({ data: Object.hasOwn(overrides, table) ? overrides[table] : table === 'attendance_proofs' ? e.proof : table === 'profiles' ? e.student : session, error: overrides.error || null })
      return { select() { return this }, abortSignal() { return this }, eq(k,v) { filters[k] = v; return this }, maybeSingle: result, single: result }
    },
    rpc(name, args) {
      calls.push({ name, args })
      return {
        retry(v) { assert.equal(v, false); return this },
        abortSignal() {
          const data = name === 'admin_students' ? [e.student] : { days: [{ start_day: '2026-10-02', sessions: [{ ...session, session_ordinal: e.ordinal }] }] }
          return { data, error: null }
        },
      }
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'attendance-proofs')
        return {
          download(path, options, params) {
            calls.push({ download: path }); assert.equal(params.cache, 'no-store')
            return { data: new Blob(['image'], { type: 'image/jpeg' }), error: null }
          },
        }
      },
    },
  }
  return { client, calls }
}

for (const ordinal of [1,2]) for (const action of ['time_in','time_out']) test(`trusted ${action} proof and U3 Session ${ordinal} mapping`, async () => {
  const e = original(); e.ordinal = ordinal; e.proof.action_type = action
  const { client, calls } = clientFor(e), { adminAttendanceProofApi: api, formatProof } = await load('src/services/adminAttendanceProof.js', { client })
  const result = await api.evidence(e.student.id, e.proof.attendance_session_id, action)
  assert.equal(result.ordinal, ordinal); assert.equal(result.proof.action_type, action)
  assert.equal(result.student.full_name, 'Trusted Student'); assert.equal(calls[0].filters.action_type, action)
  assert.equal(calls.find(c => c.name === 'admin_students').args.target_uid, e.student.id)
  assert.equal(calls.find(c => c.name === 'admin_attendance_days').args.on_day, '2026-10-02')
  assert.equal(calls.find(c => c.name === 'admin_attendance_days').args.day_limit, 1)
  const display = formatProof(result)
  assert.equal(display.date, 'October 2, 2026'); assert.equal(display.time, '12:02:03 AM'); assert.equal(display.location, '14.61235, 121.12346'); assert.equal(display.accuracy, '±12 m')
  assert.doesNotMatch(JSON.stringify(display), /internal|private-path|upload|request/)
  await api.download(result.proof.photo_path); assert.equal(calls.at(-1).download, e.proof.photo_path)
})
test('historical proofless record does not fetch image or fabricate metadata', async () => {
  const { client, calls } = clientFor(original(), { attendance_proofs: null }), { adminAttendanceProofApi: api } = await load('src/services/adminAttendanceProof.js', { client })
  assert.equal(await api.evidence('student-internal','session-internal','time_in'), null); assert.equal(calls.length, 1)
})
for (const mutation of ['owner','session','action','timestamp','coordinates','accuracy','path','ordinal']) test(`inconsistent ${mutation} is rejected before Storage access`, async () => {
  const e = original(), { client, calls } = clientFor(e)
  if (mutation === 'owner') e.proof.student_uid = 'another-student'
  if (mutation === 'session') e.proof.attendance_session_id = 'another-session'
  if (mutation === 'action') e.proof.action_type = 'time_out'
  if (mutation === 'timestamp') e.proof.official_punch_at = '2026-10-01T16:02:04Z'
  if (mutation === 'coordinates') e.proof.latitude = 91
  if (mutation === 'accuracy') e.proof.accuracy = -1
  if (mutation === 'path') e.proof.photo_path = 'another-student/private'
  if (mutation === 'ordinal') e.ordinal = 3
  const { adminAttendanceProofApi: api } = await load('src/services/adminAttendanceProof.js', { client })
  await assert.rejects(api.evidence('student-internal','session-internal','time_in'), /INVALID_EVIDENCE/)
  assert.equal(calls.some(c => c.download), false)
})
test('non-admin and cancelled reads do not query; stale account response is rejected', async () => {
  const { client, calls } = clientFor(); let key = ''
  const { adminAttendanceProofApi: api } = await load('src/services/adminAttendanceProof.js', { client, key: () => key })
  await assert.rejects(api.evidence('s','s','time_in'), /APPROVED_ADMIN_REQUIRED/); assert.equal(calls.length, 0)
  key = 'admin'; const abort = new AbortController(); abort.abort()
  await assert.rejects(api.evidence('s','s','time_in', abort.signal), /CANCELLED/)
  const wait = deferred(); client.from = () => ({ select() { return this }, abortSignal() { return this }, eq() { return this }, maybeSingle() { return wait.promise } })
  const pending = api.evidence('s','s','time_in'); key = ''; wait.resolve({ data: original().proof, error: null })
  await assert.rejects(pending, /ACCOUNT_CHANGED/)
})

async function viewer(api = {}, globals = {}) {
  const revoked = [], calls = [], document = { body: { style: { overflow: 'auto' } } }
  const { default: c } = await load('src/components/AttendanceProofViewer.vue', { api, globals: { document, URL: { createObjectURL() { calls.push('object-url'); return 'blob:private-image' }, revokeObjectURL(u) { revoked.push(u) } }, ...globals } })
  const instance = { ...c.data(), studentUid: 'student-internal', sessionId: 'session-internal', action: 'time_in', accountKey: 'admin', proofApi: api, $nextTick: async () => {}, $refs: { dialog: { showModal() { calls.push('show') }, close() { calls.push('close') } }, close: { focus() { calls.push('focus') } } } }
  for (const [k,v] of Object.entries(c.methods)) instance[k] = v.bind(instance)
  return { c, instance, revoked, calls, document }
}
const image = () => new Blob(['selfie'], { type: 'image/jpeg' })
test('View Proof opens modal lazily, shows correct blob and closes with cleanup', async () => {
  const calls = [], api = { async evidence(...args) { calls.push(args); return original() }, async download(path) { calls.push(path); return image() } }
  const v = await viewer(api); assert.equal(calls.length, 0)
  await v.instance.show(); assert.equal(v.instance.open, true); assert.equal(v.instance.url, 'blob:private-image')
  assert.equal(calls[0][2], 'time_in'); assert.equal(calls[1], original().proof.photo_path); assert.deepEqual(v.calls.slice(0,2), ['show','focus'])
  v.instance.close(); assert.equal(v.instance.open, false); assert.equal(v.instance.evidence, null); assert.deepEqual(v.revoked, ['blob:private-image']); assert.equal(v.document.body.style.overflow, 'auto')
  v.instance.action = 'time_out'; await v.instance.show(); assert.equal(calls[2][2], 'time_out'); v.instance.close()
})
test('missing historical proof is neutral and never downloads', async () => {
  const v = await viewer({ evidence: async () => null, download() { assert.fail('unexpected image read') } })
  await v.instance.show(); assert.equal(v.instance.missing, true); assert.equal(v.instance.error, ''); assert.equal(v.instance.url, ''); v.instance.close()
})
for (const kind of ['missing-image','network','unauthorized','malformed-image']) test(`viewer handles ${kind} without raw sensitive errors`, async () => {
  const v = await viewer({ evidence: async () => { if (kind === 'unauthorized') throw Error('private-path 42501'); return original() }, download: async () => { if (kind === 'malformed-image') return new Blob(['invalid'], { type: 'text/html' }); throw Error('private-path network') } })
  await v.instance.show(); assert.match(v.instance.error, /Unable to load/); assert.doesNotMatch(v.instance.error, /private-path|42501/); assert.equal(v.instance.loading, false); assert.equal(v.instance.url, ''); v.instance.close()
})
test('image decode failure revokes private URL and permits retry', async () => {
  const v = await viewer({ evidence: async () => original(), download: async () => image() })
  await v.instance.show(); v.instance.imageFailed(); assert.equal(v.instance.url, ''); assert.match(v.instance.error, /selfie could not/); assert.equal(v.revoked.length, 1)
  await v.instance.load(); assert.equal(v.instance.error, ''); assert.equal(v.instance.url, 'blob:private-image'); v.instance.close()
})
for (const event of ['close','unmount','accountKey','studentUid','sessionId','action','audience','$route.fullPath']) test(`${event} aborts load and ignores late private response`, async () => {
  const wait = deferred(), v = await viewer({ evidence: async () => original(), download: () => wait.promise })
  const pending = v.instance.show(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  assert.equal(v.instance.loading, true); const signal = v.instance.abort.signal
  if (event === 'close') v.instance.close(); else if (event === 'unmount') v.c.beforeUnmount.call(v.instance); else v.c.watch[event].call(v.instance)
  assert.equal(signal.aborted, true); wait.resolve(image()); await pending
  assert.equal(v.instance.url, ''); assert.equal(v.instance.evidence, null); assert.equal(v.instance.loading, false); assert.equal(v.calls.includes('object-url'), false)
})
test('bounded timeout releases loading and allows close even if request ignores abort', async () => {
  let fire; const v = await viewer({ evidence: () => new Promise(() => {}) }, { setTimeout(fn) { fire = fn; return 1 }, clearTimeout() {} })
  const pending = v.instance.show(); await new Promise(resolve => setImmediate(resolve)); fire(); await pending
  assert.equal(v.instance.loading, false); assert.match(v.instance.error, /Unable/); v.instance.close(); assert.equal(v.instance.open, false)
})
test('branded presentation renders trusted fields, not internal identifiers', async () => {
  const { default: c } = await load('src/components/AttendanceProofViewer.vue')
  const context = {}, html = await renderToString(vue.createSSRApp({ ...c, data() { return { ...c.data(), open: true, evidence: original(), url: 'blob:private-image' } } }, { studentUid: 'student-internal', sessionId: 'session-internal', action: 'time_in' }), context)
  const modal = context.teleports.body
  for (const text of ['Torres Capitol College','OJT Monitoring','Trusted Student','TEST-001','TIME IN','Session 1','October 2, 2026','12:02:03 AM','14.61235','±12 m','Private attendance selfie']) assert.ok(modal.includes(text), text)
  assert.doesNotMatch(html + modal, /student-internal|session-internal|private-path|request_id|upload_id/)
  assert.match(modal, /object-contain/); assert.match(modal, /max-w-2xl/)
})
test('attendance grouping/pagination unchanged and proof slot only appears for completed actions', async () => {
  const { default: c } = await load('src/components/AttendanceDays.vue')
  const sessions = [{ id:'one',time_in:'2026-10-02T00:00:00Z',time_out:'2026-10-02T01:00:00Z',session_ordinal:1 }, { id:'two',time_in:'2026-10-02T02:00:00Z',time_out:null,session_ordinal:2 }]
  const wrapped = { ...c, data() { return { ...c.data(), days:[{ start_day:'2026-10-02',completed_seconds:3600,sessions }] } } }
  const rendered = []
  const app = vue.createSSRApp({ render: () => vue.h(wrapped, { identity:'admin', load:async()=>{} }, { proof: ({session,action}) => { rendered.push([session.id,action]); return vue.h('button','View Proof') } }) })
  const html = await renderToString(app)
  assert.deepEqual(rendered,[['one','time_in'],['one','time_out'],['two','time_in']]); assert.match(html,/15 start-days per page/); assert.match(html,/Daily completed total · 1h 00m/); assert.match(html,/Session 2/)
  const studentHtml = await renderToString(vue.createSSRApp(wrapped,{identity:'student',load:async()=>{}})); assert.doesNotMatch(studentHtml,/View Proof|<img/)
})

const studentState = () => ({ provider: 'supabase', user: { id: 'student-internal' }, profile: { uid: 'student-internal', role: 'student', status: 'approved' } })
for (const ordinal of [1,2]) for (const action of ['time_in','time_out']) test(`student own ${action} Session ${ordinal} uses student-only trusted reads`, async () => {
  const e = original(); e.ordinal = ordinal; e.proof.action_type = action
  const { client, calls } = clientFor(e)
  const { studentAttendanceProofApi: api } = await load('src/services/studentAttendanceProof.js', { client, state: studentState() })
  const result = await api.evidence(e.student.id, e.proof.attendance_session_id, action)
  assert.equal(result.student.full_name, 'Trusted Student'); assert.equal(result.ordinal, ordinal)
  assert.equal(result.proof.official_punch_at, e.proof.official_punch_at)
  await api.download(result.proof.photo_path); assert.equal(calls.at(-1).download, e.proof.photo_path)
  assert.ok(calls.some(c => c.table === 'profiles' && c.filters.id === e.student.id))
  assert.ok(calls.some(c => c.name === 'attendance_days' && !Object.hasOwn(c.args,'target_uid')))
  assert.equal(calls.some(c => c.name?.startsWith('admin_')),false)
})
for (const variant of ['other-student','anonymous','pending','rejected','admin','mismatched-profile']) test(`student reader rejects ${variant} before proof reads`, async () => {
  const state = studentState(), {client,calls} = clientFor()
  if (variant === 'anonymous') state.user = null
  if (['pending','rejected'].includes(variant)) state.profile.status = variant
  if (variant === 'admin') state.profile.role = 'admin'
  if (variant === 'mismatched-profile') state.profile.uid = 'another'
  const {studentAttendanceProofApi: api} = await load('src/services/studentAttendanceProof.js',{client,state})
  await assert.rejects(api.evidence(variant === 'other-student' ? 'another' : 'student-internal','session-internal','time_in'),/OWN_PROOF_REQUIRED/)
  assert.equal(calls.length,0)
})
test('student availability reads only current-page flags and handles legacy/no-proof without eager download', async () => {
  const calls = [], client = { from(table) { assert.equal(table,'attendance_proofs'); return {
    select(fields) { assert.equal(fields,'attendance_session_id,action_type'); return this },
    eq(k,v) { assert.equal(k,'student_uid'); assert.equal(v,'student-internal'); return this },
    in(k,ids) { calls.push([...ids]); assert.equal(k,'attendance_session_id'); return this },
    limit(n) { assert.equal(n,124); return this },
    abortSignal() { return {data:[{attendance_session_id:'one',action_type:'time_in'},{attendance_session_id:'two',action_type:'time_out'}],error:null} },
  } } }
  const {withStudentProofAvailability: decorate} = await load('src/services/studentAttendanceProof.js',{client,state:studentState()})
  const history = {days:[{start_day:'2026-10-02',sessions:[{id:'one'},{id:'two'},{id:'legacy'}]}],next_before_day:'2026-10-01'}
  const result = await decorate(history,'student-internal')
  assert.deepEqual(calls,[['one','two','legacy']]); assert.equal(result.next_before_day,history.next_before_day)
  assert.equal(JSON.stringify(result.days[0].sessions.map(s=>s.proofActions)),JSON.stringify([['time_in'],['time_out'],[]]))
  assert.equal(history.days[0].sessions[0].proofActions,undefined)
})
test('availability failure preserves history and hides unconfirmed controls', async () => {
  const {withStudentProofAvailability: decorate} = await load('src/services/studentAttendanceProof.js',{client:{from(){throw Error('offline')}},state:studentState()})
  const result = await decorate({days:[{sessions:[{id:'one'}]}],next_before_day:null},'student-internal')
  assert.equal(result.days[0].sessions[0].id,'one'); assert.equal(result.days[0].sessions[0].proofActions.length,0)
})
test('switching already-loaded proofs releases old bytes before the next read; route close also revokes', async () => {
  const calls = [], v = await viewer({evidence:async(s,id,action)=>{calls.push(action);return original()},download:async()=>image()})
  await v.instance.show(); v.c.watch.action.call(v.instance); assert.equal(v.instance.url,''); assert.equal(v.revoked.length,1)
  v.instance.action='time_out'; await v.instance.show(); assert.deepEqual(calls,['time_in','time_out'])
  v.c.watch['$route.fullPath'].call(v.instance); assert.equal(v.revoked.length,2); assert.equal(v.instance.evidence,null)
})

for (const audience of ['student', 'admin']) for (const action of ['time_in', 'time_out']) for (const ordinal of [1, 2]) test(`U5 shared watermark: ${audience} ${action} Session ${ordinal}`, async () => {
  const e = original(); e.proof.action_type = action; e.ordinal = ordinal
  const { default: c } = await load('src/components/AttendanceProofViewer.vue')
  const context = {}
  await renderToString(vue.createSSRApp({ ...c, data() { return { ...c.data(), open: true, imageLoading: false, evidence: e, url: 'blob:private-image' } } }, { studentUid: e.student.id, sessionId: e.proof.attendance_session_id, action, audience }), context)
  const modal = context.teleports.body
  const overlay = modal.match(/<div[^>]*aria-label="Attendance photo evidence summary"[^>]*>([\s\S]*?)<\/div>/)?.[1]
  assert.ok(overlay)
  for (const text of ['BSIT–TCC', action === 'time_in' ? 'TIME IN' : 'TIME OUT', `Session ${ordinal}`, 'October 2, 2026', '12:02:03 AM', 'Manila']) assert.ok(overlay.includes(text), text)
  // Card and overlay share the same strings, including Manila midnight rollover/seconds.
  assert.equal(modal.split('October 2, 2026').length - 1, 2)
  assert.equal(modal.split('12:02:03 AM').length - 1, 2)
  assert.doesNotMatch(overlay, /14\.61235|121\.12346|TEST-001/)
  assert.match(modal, /Inspect original/)
})

test('U5 inspect original hides/restores overlay without touching image URL or evidence', async () => {
  const { default: c } = await load('src/components/AttendanceProofPhoto.vue')
  const { formatProof } = await load('src/services/attendanceProofReader.js')
  const e = original(), display = formatProof(e), src = 'blob:unchanged-original'
  async function render(inspectingOriginal) {
    return renderToString(vue.createSSRApp({ ...c, data() { return { ...c.data(), inspectingOriginal } } }, { src, display }))
  }
  const visible = await render(false), hidden = await render(true), restored = await render(false)
  assert.match(visible, /Attendance photo evidence summary/)
  assert.doesNotMatch(hidden, /Attendance photo evidence summary/)
  assert.match(hidden, /Return to evidence view/)
  assert.match(hidden, /aria-pressed="true"/)
  for (const html of [visible, hidden, restored]) assert.match(html, /src="blob:unchanged-original"/)
  assert.equal(visible, restored)
  assert.equal(display.time, '12:02:03 AM')
  assert.equal(e.proof.official_punch_at, original().proof.official_punch_at)
  const state = { inspectingOriginal: true }; c.watch.src.call(state); assert.equal(state.inspectingOriginal, false)
})

test('U5 photo component is visibility-only and has no clock, formatter or image side effects', async () => {
  const source = await readFile('src/components/AttendanceProofPhoto.vue', 'utf8')
  assert.doesNotMatch(source, /Date\.now|new Date|Intl\.|createObjectURL|revokeObjectURL|fetch\(|canvas|\.upload\(/)
  assert.match(source, /@click="inspectingOriginal = !inspectingOriginal"/)
  assert.match(source, /focus-visible:outline/)
  assert.match(source, /max-height: 45dvh/)
  assert.match(source, /max-width: 100%/)
})

for (const audience of ['student', 'admin']) for (const state of ['loading', 'resolved', 'partial', 'unavailable']) test(`U5.3 ${audience} ${state} keeps authoritative evidence visible`, async () => {
  const { default: c } = await load('src/components/AttendanceProofViewer.vue')
  const context = {}, place = state === 'resolved' ? 'Locality A, City B, Philippines' : 'Philippines'
  await renderToString(vue.createSSRApp({ ...c, data() { return { ...c.data(), open: true, imageLoading: false, evidence: original(), url: 'blob:private-image', locationLoading: state === 'loading', location: ['resolved','partial'].includes(state) ? { status: 'resolved', displayLocation: place } : null } } }, { studentUid: 'student-internal', sessionId: 'session-internal', action: 'time_in', audience }), context)
  const modal = context.teleports.body
  for (const text of ['14.61235', '±12 m', '12:02:03 AM', 'BSIT–TCC', 'Inspect original', 'Approximate address derived from recorded coordinates']) assert.ok(modal.includes(text), text)
  assert.ok(modal.includes(state === 'loading' ? 'Resolving approximate location' : state === 'unavailable' ? 'Address unavailable' : place))
  if (['resolved','partial'].includes(state)) { assert.match(modal, /Powered by Geoapify/); assert.match(modal, /OpenStreetMap contributors/) }
})
test('U5.3 proof renders before location resolves; close/reopen ignores previous lookup', async () => {
  const first = deferred(), second = deferred(); let count = 0, signal
  const api = { evidence: async () => ({ ...original(), proof: { ...original().proof, id: '11111111-1111-4111-8111-111111111111' } }), download: async () => image(), location: (_, s) => { signal = s; return ++count === 1 ? first.promise : second.promise } }
  const v = await viewer(api); await v.instance.show(); await Promise.resolve()
  assert.equal(v.instance.loading, false); assert.equal(v.instance.url, 'blob:private-image'); assert.equal(v.instance.locationLoading, true)
  v.instance.close(); assert.equal(signal.aborted, true); assert.equal(v.instance.location, null)
  await v.instance.show(); await Promise.resolve(); first.resolve({ status: 'resolved', displayLocation: 'Stale Proof A' }); await new Promise(r => setImmediate(r)); assert.equal(v.instance.location, null)
  second.resolve({ status: 'resolved', displayLocation: 'Current Proof B' }); await new Promise(r => setImmediate(r)); assert.equal(v.instance.location.displayLocation, 'Current Proof B'); assert.equal(v.instance.evidence.proof.official_punch_at, original().proof.official_punch_at); v.instance.close()
})
test('U5.3 location failure remains neutral; account change aborts lookup and clears address', async () => {
  const v = await viewer({ evidence: async () => original(), download: async () => image(), location: async () => { throw Error('private provider failure') } })
  await v.instance.show(); await new Promise(r => setImmediate(r)); assert.equal(v.instance.error, ''); assert.equal(v.instance.locationLoading, false); assert.equal(v.instance.location, null); assert.equal(v.instance.url, 'blob:private-image')
  const wait = deferred(); v.instance.proofApi.location = () => wait.promise; const pending = v.instance.resolveLocation('proof', v.instance.generation, v.instance.accountKey); const signal = v.instance.locationAbort.signal
  v.c.watch.accountKey.call(v.instance); assert.equal(signal.aborted, true); wait.resolve({ status: 'resolved', displayLocation: 'old account' }); await pending; assert.equal(v.instance.location, null)
})
