import { shallowReactive } from 'vue'
import {
  onAuthStateChanged, signOut, setPersistence,
  browserLocalPersistence, GoogleAuthProvider, signInWithPopup,
} from 'firebase/auth'
import { auth } from '../firebase'
import { readProfile, createStudentProfile } from './users'
import { validateSignup, isGoogleUser } from './accountPolicy'

export const authState = shallowReactive({
  user: null, profile: null, initialized: false, profileLoading: false,
  error: '', profileError: '', registering: false,
})
let generation = 0
let loading = null

function logRegistrationError(stage, error) {
  if (import.meta.env.DEV) {
    // Log only diagnostic fields, never the user, form, tokens or full error object.
    console.error('[Registration]', {
      stage, code: error?.code, message: error?.message, name: error?.name,
    })
  }
}

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
    } catch (error) {
      if (authState.registering) logRegistrationError('PROFILE_REFRESH_FAILED', error)
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


// Google proves identity only. Firestore remains the role/status authority.
export async function loginWithGoogle() {
  await authReady
  if (authState.error) throw new Error('Authentication is unavailable.')
  await setPersistence(auth, browserLocalPersistence)
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const result = await signInWithPopup(auth, provider)
  await refreshProfile()
  return result
}

export async function registerStudent(form) {
  const validation = validateSignup(form)
  if (validation) throw new Error(validation)
  await authReady
  const user = auth.currentUser
  if (!user || !isGoogleUser(user) || !user.emailVerified || !user.email) {
    throw new Error('Continue with Google before completing registration.')
  }
  if (authState.registering) throw new Error('Registration is already being submitted.')
  authState.registering = true
  let stage = 'PROFILE_READ_FAILED'
  try {
    // Never replace a pre-authorized admin or any existing student profile.
    const existing = await readProfile(user.uid)
    stage = 'PROFILE_ALREADY_EXISTS'
    if (existing) throw new Error('profile-exists')
    stage = 'REGISTRATION_BATCH_FAILED'
    await createStudentProfile(user, form)
    stage = 'PROFILE_REFRESH_FAILED'
    await refreshProfile()
  } catch (error) {
    logRegistrationError(stage, error)
    // Preserve the Google identity on failure. A retry is safe: the batch and rules
    // prevent duplicate profiles/reservations. Never delete an existing Google user.
    await refreshProfile()
    if (!authState.profile || authState.profile.uid !== user.uid) {
      throw new Error('Registration could not be completed. Your Student ID may be reserved, or the connection is unavailable. Check your details and retry, or contact the administrator.')
    }
  } finally {
    authState.registering = false
  }
}
export function logout() { return signOut(auth) }
export function loginErrorMessage(error) {
  if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') return 'Google sign-in was cancelled. Try again when you are ready.'
  if (error.code === 'auth/popup-blocked') return 'Allow pop-ups for this site, then continue with Google again.'
  if (['auth/operation-not-allowed', 'auth/unauthorized-domain'].includes(error.code)) return 'Google sign-in is not configured for this site. Contact the administrator.'
  if (error.code === 'auth/account-exists-with-different-credential') return 'This account uses another sign-in method. Contact the administrator to migrate it safely.'
  if (error.code === 'auth/network-request-failed') return 'Unable to connect. Check your internet connection and try again.'
  if (error.code === 'auth/too-many-requests') return 'Sign-in is temporarily unavailable. Please wait and try again.'
  return 'Unable to sign in with Google. Please try again or contact the administrator.'
}
