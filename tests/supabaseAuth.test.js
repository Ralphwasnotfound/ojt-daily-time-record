import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { shallowReactive } from 'vue'
import * as vue from 'vue'
import { createRouter, createMemoryHistory, isNavigationFailure, NavigationFailureType } from 'vue-router'
import * as policy from '../src/services/accountPolicy.js'
import { browserConfig } from '../src/supabase/config.js'

const user = { id: 'student-uuid', email: 'student@example.com', identities: [{ provider: 'google' }], user_metadata: { role: 'admin' } }
const form = { fullName: 'Student', lastName: 'Reference', studentId: ' ab-123 ', program: 'BS Information Technology' }
const student = { uid: user.id, role: 'student', status: 'pending' }
const tick = () => new Promise(resolve => setTimeout(resolve, 10))
const synthetic = exports => new SyntheticModule(Object.keys(exports), function () {
  for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
})
async function service(options = {}) {
  let listener
  const calls = []
  const sdk = { auth: {
    onAuthStateChange(callback) { listener = callback },
    async initialize() { return { error: options.callbackError } },
    async getSession() {
      return { data: { session: options.user ? { user: options.user } : null }, error: options.sessionError }
    },
    async signInWithOAuth(input) { calls.push(['oauth', input]); return { error: options.loginError } },
    async signOut(input) {
      calls.push(['logout', input])
      if (!options.logoutError) listener('SIGNED_OUT', null)
      return { error: options.logoutError }
    },
  } }
  const users = {
    readProfile: options.readProfile || (async () => options.profile || null),
    createStudentProfile: options.createStudentProfile || (async input => { calls.push(['register', input]); return student }),
  }
  const module = new SourceTextModule(await readFile(new URL('../src/services/auth.js', import.meta.url), 'utf8'), {
    initializeImportMeta(meta) { meta.env = { DEV: false, BASE_URL: '/' } },
  })
  await module.link(specifier => synthetic(specifier === 'vue' ? { shallowReactive }
    : specifier === './users' ? users : specifier === './accountPolicy' ? policy
    : { supabase: options.missingConfig ? null : sdk, supabaseConfigurationError: 'Missing configuration' }))
  await module.evaluate()
  return { api: module.namespace, calls, emit: (next, event = 'SIGNED_IN') => listener(event, next ? { user: next } : null) }
}

test('browser config accepts only publishable or legacy anon keys and never echoes secrets', () => {
  const url = 'http://127.0.0.1:54321'
  assert.equal(browserConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }).url, url)
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`
  assert.equal(browserConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: jwt('anon') }).key, jwt('anon'))
  for (const key of ['sb_secret_do-not-echo', jwt('service_role'), 'invalid']) {
    assert.throws(() => browserConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key }), error => !error.message.includes(key))
  }
  assert.throws(() => browserConfig({}), /incomplete/)
})

test('session restoration waits for profile and distinguishes loading from missing profile', async () => {
  let finish
  const { api } = await service({ user, readProfile: () => new Promise(resolve => { finish = resolve }) })
  await tick()
  assert.equal(api.authState.initialized, false)
  assert.equal(api.authState.profileLoading, true)
  finish(student)
  await api.authReady
  assert.deepEqual(api.authState.profile, student)
  assert.equal(api.authState.profileLoading, false)
})

test('auth callback is synchronous and profile requests run after it returns', async () => {
  let reads = 0
  const { api, emit } = await service({ readProfile: async () => { reads++; return student } })
  await api.authReady
  assert.equal(emit(user), undefined)
  assert.equal(reads, 0)
  await tick()
  assert.equal(reads, 1)
})

test('Google OAuth starts redirect without pretending to log in', async t => {
  const original = globalThis.window
  globalThis.window = { location: { origin: 'http://127.0.0.1:5173' } }
  t.after(() => { globalThis.window = original })
  const { api, calls } = await service()
  await api.authReady
  await api.loginWithGoogle()
  assert.deepEqual(calls[0], ['oauth', { provider: 'google', options: { redirectTo: 'http://127.0.0.1:5173/', queryParams: { prompt: 'select_account' } } }])
  assert.equal(api.authState.user, null)
})

test('route decisions cover all account states without trusting metadata or wrong-owner profiles', () => {
  const states = [
    [null, null, '', '/'], [user, null, '', '/signup'],
    [user, student, '', '/pending'], [user, { ...student, status: 'rejected' }, '', '/pending'],
    [user, { ...student, status: 'approved' }, '', '/student'],
    [user, { ...student, role: 'admin', status: 'approved' }, '', '/admin'],
    [user, { ...student, uid: 'other', status: 'approved' }, '', '/pending'],
    [user, null, 'read failed', '/pending'],
    [{ id: user.id, user_metadata: { provider: 'google', role: 'admin' } }, null, '', '/pending'],
  ]
  for (const [identity, profile, error, home] of states) {
    assert.equal(policy.accountDestination(identity, profile, error), home)
    for (const path of ['/', '/signup', '/pending', '/student', '/admin']) {
      const meta = { requiresAuth: path !== '/', role: ['/student', '/admin'].includes(path) ? path.slice(1) : undefined }
      assert.equal(policy.routeRedirect({ path, meta }, identity, profile, error), path === home ? null : home)
    }
  }
})

test('profile errors fail closed and successful refresh recovers approval', async () => {
  let fail = true
  const { api } = await service({ user, readProfile: async () => { if (fail) throw Error('offline'); return { ...student, status: 'approved' } } })
  await api.authReady
  assert.ok(api.authState.profileError)
  assert.equal(policy.accountDestination(user, api.authState.profile, api.authState.profileError), '/pending')
  fail = false
  await api.refreshProfile()
  assert.equal(policy.accountDestination(user, api.authState.profile, api.authState.profileError), '/student')
})

test('registration invokes RPC helper then refreshes trusted profile', async () => {
  let profile = null
  const { api } = await service({ user, readProfile: async () => profile,
    createStudentProfile: async input => { assert.deepEqual(input, form); profile = student; return student } })
  await api.authReady
  await api.registerStudent(form)
  assert.equal(policy.accountDestination(user, api.authState.profile), '/pending')
  assert.equal(api.authState.registering, false)
})

test('registration maps expected database failures and preserves session for retry', async () => {
  for (const error of [
    { code: '23505' }, { message: 'VERIFIED_GOOGLE_IDENTITY_REQUIRED' },
    { message: 'PROFILE_ALREADY_EXISTS' }, { message: 'AUTHENTICATION_REQUIRED' },
    { code: '23514' }, { code: 'network' },
  ]) {
    const { api } = await service({ user, createStudentProfile: async () => { throw error } })
    await api.authReady
    await assert.rejects(api.registerStudent(form), e => e.message === api.registrationErrorMessage(error))
    assert.equal(api.authState.user.id, user.id)
    assert.equal(api.authState.registering, false)
  }
  const { api } = await service()
  await api.authReady
  await assert.rejects(api.registerStudent(form), /Continue with Google/)
  assert.ok(policy.validateSignup({ ...form, fullName: ' ' }))
  assert.ok(policy.validateSignup({ ...form, studentId: '../bad' }))
  assert.equal(policy.validateSignup({ ...form, fullName: '😀'.repeat(100) }), '')
})

test('logout clears session, blocks routes, and ignores late profile responses', async () => {
  let finish
  const { api, emit, calls } = await service()
  await api.authReady
  // A separate instance with an unresolved initial profile tests the stale read.
  const pending = await service({ user, readProfile: () => new Promise(resolve => { finish = resolve }) })
  await tick()
  await pending.api.logout()
  finish({ ...student, role: 'admin', status: 'approved' })
  await pending.api.authReady
  assert.equal(pending.api.authState.user, null)
  assert.equal(pending.api.authState.profile, null)
  emit(user)
  await tick()
  await api.logout()
  assert.deepEqual(calls.at(-1), ['logout', { scope: 'local' }])
  assert.equal(policy.routeRedirect({ path: '/admin', meta: { requiresAuth: true, role: 'admin' } }, api.authState.user, api.authState.profile), '/')
})

test('failed logout keeps account; cross-tab sign-out clears it immediately', async () => {
  const { api, emit } = await service({ user, profile: student, logoutError: Error('offline') })
  await api.authReady
  await assert.rejects(api.logout())
  assert.equal(api.authState.user.id, user.id)
  emit(null, 'SIGNED_OUT')
  assert.equal(api.authState.user, null)
  assert.equal(api.authState.profile, null)
})

test('missing configuration and restore errors settle initialization; callback errors are friendly', async () => {
  for (const options of [{ missingConfig: true }, { sessionError: Error('offline') }]) {
    const { api } = await service(options)
    await api.authReady
    assert.ok(api.authState.error)
    assert.equal(api.authState.user, null)
  }
  const { api } = await service({ callbackError: { code: 'flow_state_expired', message: 'sensitive SDK detail' } })
  await api.authReady
  assert.match(api.authState.loginNotice, /expired/)
  assert.doesNotMatch(api.authState.loginNotice, /sensitive/)
})

test('profile adapters read RLS-filtered profiles; writes use only approved RPC arguments', async () => {
  const calls = []
  const row = { id: user.id, full_name: 'Student', student_id: 'AB-123', role: 'student', status: 'pending', created_at: '2026-09-30T00:00:00Z' }
  const chain = {
    select(...args) { calls.push(['select', ...args]); return this },
    eq(...args) { calls.push(['eq', ...args]); return this },
    order(...args) { calls.push(['order', ...args]); return this },
    async range(...args) { calls.push(['range', ...args]); return { data: [row] } },
    async maybeSingle() { return { data: row } },
  }
  const supabase = {
    from(name) { calls.push(['from', name]); return chain },
    async rpc(name, args) { calls.push(['rpc', name, args]); return { data: row } },
  }
  const module = new SourceTextModule(await readFile(new URL('../src/services/users.js', import.meta.url), 'utf8'))
  await module.link(specifier => synthetic(specifier.includes('accountPolicy') ? policy : { supabase }))
  await module.evaluate()
  const api = module.namespace
  assert.equal((await api.readProfile(user.id)).uid, user.id)
  await api.createStudentProfile({ ...form, role: 'admin', email: 'forged', uid: 'forged', status: 'approved' })
  assert.deepEqual(calls.at(-1), ['rpc', 'complete_student_registration', { full_name: 'Student', student_id: 'AB-123', last_name: 'Reference' }])
  await api.reviewStudent(user.id, 'approved', 'forged-admin')
  assert.deepEqual(calls.at(-1), ['rpc', 'review_student', { student_uid: user.id, decision: 'approved' }])
  await assert.rejects(api.reviewStudent(user.id, 'admin'))
  assert.equal((await api.listPendingStudents()).length, 1)
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'status' && call[2] === 'pending'))
})

test('real router guards finish navigation without loops and react to account status/sign-out', async () => {
  const state = shallowReactive({ user: null, profile: null, profileError: '', initialized: true, profileLoading: false, registering: false })
  let row = null
  let reads = 0
  const refreshProfile = async () => {
    if (++reads > 30) throw Error('Unexpected navigation loop')
    state.profileLoading = true
    await Promise.resolve()
    state.profile = row ? { ...row } : null
    state.profileLoading = false
  }
  const module = new SourceTextModule(await readFile(new URL('../src/router/index.js', import.meta.url), 'utf8'), {
    initializeImportMeta(meta) { meta.env = { BASE_URL: '/' } },
  })
  await module.link(specifier => synthetic(specifier === 'vue-router' ? { createRouter, createWebHistory: createMemoryHistory, isNavigationFailure, NavigationFailureType }
    : specifier === 'vue' ? vue
    : specifier.includes('services/auth') ? { authReady: Promise.resolve(), authState: state, refreshProfile }
    : specifier.includes('accountPolicy') ? policy : { default: { render() {} } }))
  const scope = vue.effectScope()
  await scope.run(() => module.evaluate())
  const router = module.namespace.default
  try {
    await router.push('/student/history')
    assert.equal(router.currentRoute.value.path, '/')
    state.user = user
    await tick()
    assert.equal(router.currentRoute.value.path, '/signup')
    row = student
    await refreshProfile()
    await tick()
    assert.equal(router.currentRoute.value.path, '/pending')
    row = { ...student, status: 'approved' }
    await refreshProfile()
    await tick()
    assert.equal(router.currentRoute.value.path, '/student')
    await router.push('/admin')
    assert.equal(router.currentRoute.value.path, '/student')
    await router.push('/student/profile')
    assert.equal(router.currentRoute.value.path, '/student/profile')
    row = { ...student, role: 'admin', status: 'approved' }
    await refreshProfile()
    await tick()
    assert.equal(router.currentRoute.value.path, '/admin')
    state.user = null
    state.profile = null
    await tick()
    assert.equal(router.currentRoute.value.path, '/')
  } finally { scope.stop() }
})

test('competing logout redirects settle without cancelled navigations restarting enforcement', async t => {
  for (const [path, profile] of [
    ['/pending', student], ['/pending', { ...student, status: 'rejected' }],
    ['/signup', null], ['/student', { ...student, status: 'approved' }],
    ['/admin', { ...student, role: 'admin', status: 'approved' }],
  ]) {
    await t.test(`${path}: ${profile?.status || 'no profile'}`, async () => {
      const state = shallowReactive({ user, profile, profileError: '', initialized: true, profileLoading: false, registering: false })
      const module = new SourceTextModule(await readFile(new URL('../src/router/index.js', import.meta.url), 'utf8'), {
        initializeImportMeta(meta) { meta.env = { BASE_URL: '/' } },
      })
      const scope = vue.effectScope()
      await module.link(specifier => synthetic(specifier === 'vue-router'
        ? { createRouter, createWebHistory: createMemoryHistory, isNavigationFailure, NavigationFailureType }
        : specifier === 'vue' ? vue
        : specifier.includes('services/auth') ? { authReady: Promise.resolve(), authState: state, refreshProfile: async () => {} }
        : specifier.includes('accountPolicy') ? policy : { default: { render() {} } }))
      await scope.run(() => module.evaluate())
      const router = module.namespace.default
      try {
        await router.push(path)
        const replace = router.replace.bind(router)
        const navigations = []
        let replacements = 0, cancellations = 0
        router.replace = target => {
          replacements++
          // Bound the old infinite loop so regression failures cannot hang the test runner.
          if (replacements > 12) return Promise.resolve()
          const navigation = replace(target)
          navigations.push(navigation)
          return navigation
        }
        router.afterEach((_to, _from, failure) => {
          if (isNavigationFailure(failure, NavigationFailureType.cancelled)) {
            cancellations++
            // A reactive change must not start a third redirect while the newer one is active.
            state.profileError = 'Session cleared'
          }
        })
        // Model SIGNED_OUT during await logout(), followed by the view's own redirect.
        let busy = true
        state.user = null
        state.profile = null
        await Promise.resolve()
        try { await router.replace('/') } finally { busy = false }
        await Promise.all(navigations)
        await vue.nextTick()
        assert.ok(cancellations >= 1, 'must exercise the cancelled-navigation path')
        assert.equal(replacements, 2, 'only the auth watcher and view may initiate redirects')
        assert.equal(router.currentRoute.value.path, '/')
        assert.equal(busy, false)
        await router.push('/student/history')
        assert.equal(router.currentRoute.value.path, '/')
      } finally { scope.stop() }
    })
  }
})

test('same-user token refresh does not clear the registration form state or trusted profile', async () => {
  const { api, emit } = await service({ user, profile: student })
  await api.authReady
  const profile = api.authState.profile
  emit({ ...user }, 'TOKEN_REFRESHED')
  assert.equal(api.authState.profileLoading, false)
  assert.equal(api.authState.profile, profile)
})

test('S4 attendance remains restricted to approved Supabase students', async () => {
  let started = 0
  const module = new SourceTextModule(await readFile(new URL('../src/services/studentAttendanceMixin.js', import.meta.url), 'utf8'))
  await module.link(specifier => synthetic(specifier === './auth'
    ? { authState: { provider: 'supabase', user, profile: { ...student, status: 'approved' } }, refreshProfile: async () => {} }
    : specifier === './accountPolicy' ? policy
    : specifier.includes('Controller') ? { attendanceUiState: () => ({}), createStudentAttendanceController: () => { started++ } }
    : { getAttendanceDays() {}, displayTimestamp() {}, formatManilaDate() {}, formatAttendanceRows() {}, presentAttendance() {} }))
  await module.evaluate()
  const mixin = module.namespace.default
  const vm = { attendanceController: { stop() {} }, attendanceEligible: false }
  mixin.methods.startAttendance.call(vm)
  assert.equal(started, 0)
  assert.equal(vm.attendanceController, null)
  assert.equal(vm.attendanceUi.loading, false)
  assert.match(vm.attendanceUi.error, /approved student/)
  assert.equal(mixin.computed.attendanceEligible(), true)
})


test('U1 maps roster errors without treating unrelated uniqueness failures as claimed IDs', async () => {
  const {api}=await service(); await api.authReady
  assert.match(api.registrationErrorMessage({message:'STUDENT_IDENTITY_NOT_ELIGIBLE'}),/could not be verified/)
  assert.match(api.registrationErrorMessage({message:'STUDENT_ID_ALREADY_REGISTERED',code:'23505'}),/already registered/)
  assert.doesNotMatch(api.registrationErrorMessage({code:'23505',message:'other constraint'}),/already registered/)
})
