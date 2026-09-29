import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { shallowReactive } from 'vue'
import * as policy from '../src/firebase/reference/accountPolicy.js'
const googleUser = { uid: 'google-user', email: 'student@example.com', displayName: 'Student', emailVerified: true, providerData: [{ providerId: 'google.com' }] }
const form = { fullName: 'Student', studentId: '2026-015', program: 'BS Information Technology' }
async function service(options = {}) {
  let listener, errorListener
  const calls = []
  const auth = { currentUser: null }
  const emit = user => { auth.currentUser = user; return listener(user) }
  const sdk = {
    onAuthStateChanged(a, next, error) { listener = next; errorListener = error },
    async setPersistence(a, mode) { calls.push(['persistence', mode]) },
    GoogleAuthProvider: class { setCustomParameters(value) { calls.push(['parameters', value]) } },
    async signInWithPopup() { calls.push(['google']); await emit(googleUser); return { user: googleUser } },
    async signOut() { calls.push(['logout']); await emit(null) },
    browserLocalPersistence: 'local',
  }
  const users = {
    readProfile: options.readProfile || (async () => null),
    createStudentProfile: options.createStudentProfile || (async (user, input) => { calls.push(['register', user, input]) }),
  }
  const module = new SourceTextModule(await readFile(new URL('../src/firebase/reference/auth.js', import.meta.url), 'utf8'), {
    initializeImportMeta(meta) { meta.env = { DEV: options.dev ?? false } },
  })
  await module.link(specifier => {
    const exports = specifier === 'vue' ? { shallowReactive } : specifier === 'firebase/auth' ? sdk : specifier === './users' ? users : specifier === './accountPolicy' ? policy : { auth }
    return new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) })
  })
  await module.evaluate()
  return { api: module.namespace, calls, restore: emit, fail: () => errorListener() }
}
test('Auth initialization waits for the server profile', async () => {
  let finish
  const { api, restore } = await service({ readProfile: () => new Promise(resolve => { finish = resolve }) })
  const loading = restore(googleUser)
  assert.equal(api.authState.initialized, false)
  assert.equal(api.authState.profileLoading, true)
  finish({ uid: googleUser.uid, role: 'admin', status: 'approved' })
  await loading
  await api.authReady
  assert.equal(api.authState.profile.role, 'admin')
})
test('Google sign-in uses persistent Firebase session; logout clears it', async () => {
  const { api, restore, calls } = await service()
  await restore(null)
  await api.loginWithGoogle()
  assert.deepEqual(calls[0], ['persistence', 'local'])
  assert.ok(calls.some(call => call[0] === 'google'))
  assert.equal(policy.accountDestination(api.authState.user, api.authState.profile), '/signup')
  await api.logout()
  assert.equal(api.authState.user, null)
})
test('routing separates incomplete, pending, approved and invalid accounts', () => {
  const student = { uid: googleUser.uid, role: 'student', status: 'approved' }
  const admin = { ...student, role: 'admin' }
  const studentRoute = { path: '/student/history', meta: { requiresAuth: true, role: 'student' } }
  const adminRoute = { path: '/admin/students', meta: { requiresAuth: true, role: 'admin' } }
  assert.equal(policy.routeRedirect(studentRoute, null, null), '/')
  assert.equal(policy.routeRedirect({ path: '/signup', meta: { requiresAuth: true } }, null, null), '/')
  assert.equal(policy.routeRedirect(studentRoute, googleUser, null), '/signup')
  assert.equal(policy.routeRedirect({ path: '/signup', meta: {} }, googleUser, null), null)
  assert.equal(policy.routeRedirect(adminRoute, googleUser, student), '/student')
  assert.equal(policy.routeRedirect(studentRoute, googleUser, admin), '/admin')
  assert.equal(policy.routeRedirect(studentRoute, googleUser, student), null)
  for (const profile of [{ ...student, status: 'pending' }, { ...student, status: 'rejected' }, { ...student, role: 'unknown' }, { ...student, uid: 'other' }]) {
    assert.equal(policy.routeRedirect(adminRoute, googleUser, profile), '/pending')
    assert.equal(policy.routeRedirect({ path: '/signup', meta: {} }, googleUser, profile), '/pending')
  }
  assert.equal(policy.accountDestination(googleUser, null, 'offline'), '/pending')
  assert.equal(policy.accountDestination({ uid: 'legacy' }, null), '/pending')
})
test('registration validates only requested student fields', () => {
  assert.equal(policy.validateSignup(form), '')
  for (const patch of [{ fullName: ' ' }, { studentId: '../bad' }, { program: 'Other' }]) assert.ok(policy.validateSignup({ ...form, ...patch }))
  assert.equal(policy.normalizeStudentId(' ab-123 '), 'AB-123')
})
test('registration requires verified Google identity', async () => {
  const { api, restore } = await service()
  await restore(null)
  await assert.rejects(api.registerStudent(form), /Continue with Google/)
  await restore({ ...googleUser, emailVerified: false })
  await assert.rejects(api.registerStudent(form), /Continue with Google/)
})
test('registration persists profile and preserves Google identity', async () => {
  let profile = null
  const { api, restore } = await service({
    readProfile: async () => profile,
    createStudentProfile: async user => { profile = { uid: user.uid, role: 'student', status: 'pending' } },
  })
  await restore(googleUser)
  await api.registerStudent(form)
  assert.equal(policy.accountDestination(api.authState.user, api.authState.profile), '/pending')
  assert.equal(api.authState.registering, false)
})
test('existing approved admin profile is never replaced by student registration', async () => {
  const profile = { uid: googleUser.uid, role: 'admin', status: 'approved' }
  const { api, restore, calls } = await service({ readProfile: async () => profile })
  await restore(googleUser)
  await api.registerStudent(form)
  assert.ok(!calls.some(call => call[0] === 'register'))
  assert.equal(api.authState.profile.role, 'admin')
})
test('failed batch retains Google user and permits retry', async () => {
  const { api, restore } = await service({ createStudentProfile: async () => { throw new Error('duplicate') } })
  await restore(googleUser)
  await assert.rejects(api.registerStudent(form), /could not be completed/)
  assert.equal(api.authState.user.uid, googleUser.uid)
  assert.equal(api.authState.registering, false)
  assert.equal(policy.accountDestination(api.authState.user, api.authState.profile), '/signup')
})
test('late profile reads cannot restore access after logout', async () => {
  let finish
  const { api, restore } = await service({ readProfile: () => new Promise(resolve => { finish = resolve }) })
  const restoring = restore(googleUser)
  await restore(null)
  finish({ uid: googleUser.uid, role: 'admin', status: 'approved' })
  await restoring
  assert.equal(api.authState.profile, null)
})
test('observer and popup errors are friendly and fail closed', async () => {
  const { api, fail } = await service()
  fail()
  await api.authReady
  await assert.rejects(api.loginWithGoogle())
  for (const code of ['auth/popup-blocked', 'auth/popup-closed-by-user', 'auth/unauthorized-domain', 'auth/account-exists-with-different-credential']) {
    assert.ok(api.loginErrorMessage({ code }))
    assert.ok(!api.loginErrorMessage({ code, message: 'private SDK details' }).includes('private SDK'))
  }
})

test('registration diagnostics retain only original error fields and identify each stage', async t => {
  const logs = []
  t.mock.method(console, 'error', (...args) => logs.push(args))
  const original = Object.assign(new Error('Diagnostic test failure'), {
    code: 'permission-denied', name: 'FirebaseError', credential: 'must-not-log',
  })
  for (const failure of ['read', 'batch']) {
    logs.length = 0
    let failRead = false
    const { api, restore } = await service({
      dev: true,
      readProfile: async () => { if (failRead) throw original; return null },
      createStudentProfile: async () => { throw original },
    })
    await restore(googleUser)
    failRead = failure === 'read'
    await assert.rejects(api.registerStudent(form), /Registration could not be completed/)
    assert.deepEqual(logs[0], ['[Registration]', {
      stage: failure === 'read' ? 'PROFILE_READ_FAILED' : 'REGISTRATION_BATCH_FAILED',
      code: original.code, message: original.message, name: original.name,
    }])
    if (failure === 'read') assert.equal(logs[1][1].stage, 'PROFILE_REFRESH_FAILED')
    assert.ok(!JSON.stringify(logs).includes('must-not-log'))
  }
})

test('registration diagnostic logging is disabled outside development', async t => {
  const logs = []
  t.mock.method(console, 'error', (...args) => logs.push(args))
  const { api, restore } = await service({
    dev: false,
    createStudentProfile: async () => { throw new Error('failure') },
  })
  await restore(googleUser)
  await assert.rejects(api.registerStudent(form), /Registration could not be completed/)
  assert.deepEqual(logs, [])
})
