import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { SourceTextModule, SyntheticModule } from 'node:vm'
import { shallowReactive } from 'vue'
import * as policy from '../src/services/accountPolicy.js'

// Isolated SDK substitutes test service behavior; they do not authenticate with Firebase.
async function service(options = {}) {
  let listener
  let errorListener
  const calls = []
  const auth = { currentUser: null }
  const emit = user => { auth.currentUser = user; return listener(user) }
  const users = {
    readProfile: options.readProfile || (async uid => ({ uid, role: 'student', status: 'approved' })),
    createStudentProfile: options.createStudentProfile || (async () => {}),
  }
  const sdk = {
    onAuthStateChanged(auth, next, error) { listener = next; errorListener = error },
    async setPersistence(auth, mode) { calls.push(['persistence', mode]) },
    async signInWithEmailAndPassword(auth, email, password) {
      calls.push(['login', email, password])
      const user = { uid: 'test-user' }
      emit(user)
      return { user }
    },
    async signOut() { calls.push(['logout']); emit(null) },
    async createUserWithEmailAndPassword() {
      const user = { uid: 'new-user', email: 'student@example.com' }
      emit(user)
      return { user }
    },
    async deleteUser() { calls.push(['delete']); emit(null) },
    browserLocalPersistence: 'local',
    browserSessionPersistence: 'session',
  }
  const module = new SourceTextModule(await readFile(new URL('../src/services/auth.js', import.meta.url), 'utf8'))
  await module.link(specifier => {
    const exports = specifier === 'vue' ? { shallowReactive }
      : specifier === 'firebase/auth' ? sdk
      : specifier === './users' ? users
      : specifier === './accountPolicy' ? policy : { auth }
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    })
  })
  await module.evaluate()
  return { api: module.namespace, calls, restore: emit, fail: () => errorListener() }
}

test('waits for the observer before declaring authentication initialized', async () => {
  const { api, restore } = await service()
  assert.equal(api.authState.initialized, false)
  let ready = false
  api.authReady.then(() => { ready = true })
  await Promise.resolve()
  assert.equal(ready, false)
  restore({ uid: 'restored-user' })
  await api.authReady
  assert.equal(api.authState.initialized, true)
  assert.equal(api.authState.user.uid, 'restored-user')
  restore(null)
  assert.equal(api.authState.user, null)
})

test('login delegates persistence and credentials to the SDK; logout delegates signOut', async () => {
  const { api, calls, restore } = await service()
  restore(null)
  await api.login(' preview@example.com ', 'test-only', true)
  assert.deepEqual(calls[0], ['persistence', 'local'])
  assert.deepEqual(calls[1], ['login', 'preview@example.com', 'test-only'])
  await api.logout()
  assert.equal(api.authState.user, null)
  assert.deepEqual(calls[2], ['logout'])
  await api.login('preview@example.com', 'test-only', false)
  assert.deepEqual(calls[3], ['persistence', 'session'])
})

test('observer failure settles readiness and fails closed', async () => {
  const { api, fail } = await service()
  fail()
  await api.authReady
  assert.equal(api.authState.user, null)
  assert.ok(api.authState.error)
  await assert.rejects(api.login('preview@example.com', 'test-only', false))
})

test('credential errors do not disclose account existence or raw messages', async () => {
  const { api } = await service()
  const codes = ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/user-disabled']
  const messages = codes.map(code => api.loginErrorMessage({ code, message: 'raw SDK details' }))
  assert.equal(new Set(messages).size, 1)
  assert.equal(messages[0], 'Unable to sign in. Check your email and password.')
  assert.match(api.loginErrorMessage({ code: 'auth/network-request-failed' }), /connection/)
})

const signup = {
  fullName: 'Test Student', studentId: '2026-015', email: 'student@example.com',
  program: 'BS Information Technology', yearLevel: '4th Year',
  password: 'test-only-password', confirmPassword: 'test-only-password',
}

test('routing fails closed and sends each approved role to its own workspace', () => {
  const user = { uid: 'student' }
  const student = { uid: user.uid, role: 'student', status: 'approved' }
  const admin = { ...student, role: 'admin' }
  const studentRoute = { path: '/student/history', meta: { requiresAuth: true, role: 'student' } }
  const adminRoute = { path: '/admin/students', meta: { requiresAuth: true, role: 'admin' } }
  assert.equal(policy.routeRedirect(studentRoute, null, null), '/')
  assert.equal(policy.routeRedirect(adminRoute, user, student), '/student')
  assert.equal(policy.routeRedirect(studentRoute, user, admin), '/admin')
  assert.equal(policy.routeRedirect(studentRoute, user, student), null)
  assert.equal(policy.routeRedirect(adminRoute, user, admin), null)
  for (const profile of [null, { ...student, status: 'pending' }, { ...student, status: 'rejected' }, { ...student, role: 'unknown' }, { ...student, uid: 'other' }]) {
    assert.equal(policy.routeRedirect(studentRoute, user, profile), '/pending')
    assert.equal(policy.routeRedirect(adminRoute, user, profile), '/pending')
    assert.equal(policy.routeRedirect({ path: '/pending', meta: {} }, user, profile), null)
  }
  assert.equal(policy.accountDestination(user, admin, 'offline'), '/pending')
  for (const path of ['/', '/signup']) {
    assert.equal(policy.routeRedirect({ path, meta: {} }, user, student), '/student')
    assert.equal(policy.routeRedirect({ path, meta: {} }, user, admin), '/admin')
  }
})

test('signup validates identity, allowed program/year and passwords', () => {
  assert.equal(policy.validateSignup(signup), '')
  for (const patch of [{ fullName: ' ' }, { studentId: '../bad' }, { email: 'invalid' }, { program: 'Other' }, { yearLevel: 'Other' }, { password: 'short' }, { confirmPassword: 'different' }]) {
    assert.ok(policy.validateSignup({ ...signup, ...patch }))
  }
  assert.equal(policy.normalizeStudentId(' ab-123 '), 'AB-123')
})

test('failed profile creation cleans up only a verified missing profile', async () => {
  const { api, restore, calls } = await service({
    readProfile: async () => null,
    createStudentProfile: async () => { throw new Error('denied') },
  })
  restore(null)
  await assert.rejects(api.registerStudent(signup), /could not be completed/)
  assert.ok(calls.some(call => call[0] === 'delete'))
  assert.equal(api.authState.user, null)
  assert.equal(api.authState.registering, false)
})

test('uncertain profile commit does not delete the Auth user', async () => {
  const { api, restore, calls } = await service({
    readProfile: async () => { throw new Error('offline') },
    createStudentProfile: async () => { throw new Error('offline') },
  })
  restore(null)
  await assert.rejects(api.registerStudent(signup), /could not be verified/)
  assert.ok(!calls.some(call => call[0] === 'delete'))
  assert.equal(policy.accountDestination(api.authState.user, api.authState.profile), '/pending')
})

test('late profile reads cannot restore access after logout', async () => {
  let finish
  const { api, restore } = await service({ readProfile: () => new Promise(resolve => { finish = resolve }) })
  const restoring = restore({ uid: 'old' })
  await restore(null)
  finish({ uid: 'old', role: 'admin', status: 'approved' })
  await restoring
  assert.equal(api.authState.profile, null)
  assert.equal(api.authState.user, null)
})
