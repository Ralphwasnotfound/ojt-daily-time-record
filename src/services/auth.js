import { shallowReactive } from 'vue'
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, setPersistence,
  browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, deleteUser,
} from 'firebase/auth'
import { auth } from '../firebase/firebase'
import { readProfile, createStudentProfile } from './users'
import { validateSignup } from './accountPolicy'

export const authState = shallowReactive({
  user: null, profile: null, initialized: false, profileLoading: false,
  error: '', profileError: '', registering: false,
})
let generation = 0
let loading = null

export function refreshProfile() {
  if (!authState.user) return Promise.resolve()
  if (loading) return loading
  const uid = authState.user.uid
  const version = generation
  authState.profileLoading = true
  authState.profileError = ''
  loading = (async () => {
    try {
      const profile = await readProfile(uid)
      if (version === generation) authState.profile = profile
    } catch {
      if (version === generation) {
        authState.profile = null
        authState.profileError = 'Unable to load your account. Check your connection or contact the BSIT administrator.'
      }
    } finally {
      if (version === generation) {
        authState.profileLoading = false
        loading = null
      }
    }
  })()
  return loading
}

export const authReady = new Promise(resolve => {
  onAuthStateChanged(auth, async user => {
    generation++
    loading = null
    authState.user = user
    authState.profile = null
    authState.profileError = ''
    authState.error = ''
    authState.profileLoading = false
    if (user && !authState.registering) await refreshProfile()
    authState.initialized = true
    resolve()
  }, () => {
    generation++
    loading = null
    authState.user = null
    authState.profile = null
    authState.profileLoading = false
    authState.error = 'Unable to restore your sign-in session. Please reload and try again.'
    authState.initialized = true
    resolve()
  })
})

export async function login(email, password, rememberMe) {
  await authReady
  if (authState.error) throw new Error('Authentication is unavailable.')
  await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence)
  const result = await signInWithEmailAndPassword(auth, email.trim(), password)
  await refreshProfile()
  return result
}

export async function registerStudent(form) {
  const validation = validateSignup(form)
  if (validation) throw new Error(validation)
  await authReady
  if (authState.user || authState.registering) throw new Error('Log out before registering a student.')
  authState.registering = true
  let createdUser = null
  try {
    await setPersistence(auth, browserSessionPersistence)
    const result = await createUserWithEmailAndPassword(auth, form.email.trim(), form.password)
    createdUser = result.user
    await createStudentProfile(createdUser, form)
    await refreshProfile()
  } catch (error) {
    if (createdUser) {
      // Auth and Firestore are not atomic. Confirm the batch did NOT commit before deletion.
      let profile
      try { profile = await readProfile(createdUser.uid) } catch {
        throw new Error('Registration could not be verified. Do not register again yet. Contact the administrator to check your account.')
      }
      if (profile && profile.uid === createdUser.uid && profile.role === 'student') {
        await refreshProfile()
        return
      }
      if (!profile && auth.currentUser?.uid === createdUser.uid) {
        try { await deleteUser(createdUser) } catch {
          throw new Error('Registration failed and account cleanup could not finish. Contact the administrator before trying again.')
        }
      }
      throw new Error('Registration could not be completed. The Student ID may already be reserved. Contact the administrator if this continues.')
    }
    if (error.code === 'auth/weak-password' || error.code === 'auth/password-does-not-meet-requirements') {
      throw new Error('Choose a stronger password that meets the account password policy.')
    }
    throw new Error('Unable to register. Check your information and connection, or contact the administrator.')
  } finally {
    authState.registering = false
  }
}

export function logout() { return signOut(auth) }

export function loginErrorMessage(error) {
  if (error.code === 'auth/network-request-failed') return 'Unable to connect. Check your internet connection and try again.'
  if (error.code === 'auth/too-many-requests') return 'Sign-in is temporarily unavailable. Please wait and try again.'
  return 'Unable to sign in. Check your email and password.'
}
