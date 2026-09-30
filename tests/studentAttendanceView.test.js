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

const profile = { uid: 'alice', fullName: 'Real Student', role: 'student', status: 'approved', requiredHours: 486 }
const model = () => ({ ready: false, loading: true, busy: false, error: '', notice: '', state: { open_session_id: null, open_time_in: null, started_today: false, completed_seconds: 0, completed_sessions: 0 }, records: [] })
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
      if (specifier === './auth') return synthetic({ authState: { provider: 'supabase', user: { id: 'alice' }, profile }, refreshProfile: async () => {} })
      if (specifier === './accountPolicy') return synthetic({ accountDestination: () => '/student' })
      if (specifier.endsWith('supabaseAttendanceController.js')) return synthetic({ attendanceUiState: model, createStudentAttendanceController: () => {} })
      if (specifier.endsWith('supabaseAttendancePresentation.js')) return synthetic(presentation)
      if (specifier.endsWith('supabaseActivities.js')) return synthetic({ activityApi: {}, activityAccountKey: () => 'alice', approvedActivityStudent: () => true })
      if (specifier.endsWith('supabaseAttendance.js')) return synthetic({ getAttendanceSummary: async () => ({ open_session_id: null }) })
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

export async function renderStudentView(name, fixture) {
  const component = await loadComponent(`src/views/student/${name}.vue`)
  const original = component.data
  const rendered = { ...component, data() {
    return { ...(original ? original.call(this) : {}), attendanceUi: fixture, displayNow: Date.parse('2026-09-29T08:00:00Z') }
  } }
  const app = vue.createSSRApp(rendered)
  app.component('RouterLink', { props: ['to'], setup(props, { slots }) { return () => vue.h('a', { href: props.to }, slots.default?.()) } })
  return renderToString(app)
}

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
      assert.match(empty, /No attendance recorded yet/)
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
  const state = { open_session_id: null, open_time_in: null, started_today: true, completed_seconds: 3600, completed_sessions: 1 }
  const record = { id: 'real', student_uid: 'alice', time_in: '2026-09-29T00:00:00Z', time_out: '2026-09-29T01:00:00Z' }
  const html = await renderStudentView('AttendanceView', { ...model(), ready: true, loading: false, state, records: [record] })
  assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?Completed for today/)
  assert.match(html, /1h 00m/)
  assert.match(html, /8:00 AM/)
  assert.match(html, /9:00 AM/)
})

test('open Supabase session renders enabled Time Out and real server timestamp', async () => {
  const record = { id: 'open', student_uid: 'alice', time_in: '2026-09-29T00:02:00Z', time_out: null }
  const state = { open_session_id: 'open', open_time_in: record.time_in, started_today: true, completed_seconds: 0, completed_sessions: 0 }
  const html = await renderStudentView('AttendanceView', { ...model(), ready: true, loading: false, state, records: [record] })
  assert.match(html, /CURRENTLY IN/)
  assert.match(html, /8:02 AM/)
  assert.match(html, /<button type="button" aria-busy="false"[^>]*>[\s\S]*?Time Out<\/button>/)
  assert.match(html, /Not completed/)
})
