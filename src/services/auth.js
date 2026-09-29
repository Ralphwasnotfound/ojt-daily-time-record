import { shallowReactive } from 'vue'
import { supabase, supabaseConfigurationError } from '../supabase/supabase'
import { readProfile, createStudentProfile } from './users'
import { validateSignup, isGoogleUser } from './accountPolicy'

export const authState = shallowReactive({
  provider: 'supabase', user: null, profile: null, initialized: false, profileLoading: false,
  error: '', profileError: '', registering: false, loginNotice: '',
})
let generation = 0
let loading = null
let resolveReady
export const authReady = new Promise(resolve => { resolveReady = resolve })

function finishInitialization() {
  authState.initialized = true
  resolveReady()
}
export function refreshProfile() {
  if (!authState.user) return Promise.resolve()
  if (loading) return loading
  const id = authState.user.id
  const version = generation
  authState.profileLoading = true
  authState.profileError = ''
  loading = (async () => {
    try {
      const profile = await readProfile(id)
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
function acceptSession(session) {
  const version = ++generation
  loading = null
  authState.user = session?.user || null
  authState.profile = null
  authState.profileError = ''
  authState.profileLoading = !!session?.user
  // The SDK holds its auth lock in onAuthStateChange. Invalidate stale reads now,
  // but perform profile queries outside the callback to avoid deadlocks.
  setTimeout(async () => {
    if (version !== generation) return
    if (authState.user) await refreshProfile()
    if (version === generation) finishInitialization()
  }, 0)
}
async function initialize() {
  if (!supabase) {
    authState.error = supabaseConfigurationError || 'Supabase is unavailable.'
    finishInitialization()
    return
  }
  let eventSeen = false
  supabase.auth.onAuthStateChange((event, session) => {
    eventSeen = true
    // Refresh/focus events for the same identity must not discard a registration form.
    if (authState.initialized && session?.user?.id === authState.user?.id && session?.user) {
      authState.user = session.user
      if (event === 'USER_UPDATED' && !authState.registering) setTimeout(() => refreshProfile(), 0)
      return
    }
    acceptSession(session)
  })
  try {
    // Initialization completes the automatic PKCE URL exchange first.
    const { error: initializationError } = await supabase.auth.initialize()
    if (initializationError) authState.loginNotice = loginErrorMessage(initializationError)
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    if (!eventSeen) acceptSession(data.session)
  } catch {
    acceptSession(null)
    authState.error = 'Unable to restore your sign-in session. Please reload and try again.'
  }
}
void initialize()

export async function loginWithGoogle() {
  await authReady
  if (authState.error) throw new Error('Authentication is unavailable.')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw error
  // This initiates a full-page redirect, not a completed login.
}
export function registrationErrorMessage(error) {
  if (error?.message === 'AUTHENTICATION_REQUIRED') return 'Continue with Google before completing registration.'
  if (error?.message === 'VERIFIED_GOOGLE_IDENTITY_REQUIRED') return 'A verified Google identity is required. Sign out and continue with Google again.'
  if (error?.message === 'PROFILE_ALREADY_EXISTS') return 'Your account already has a profile. Refresh your account status to continue.'
  if (error?.code === '23505') return 'That Student ID is already registered. Check your Student ID or contact the administrator.'
  if (error?.code === '23514' || error?.code === '23502') return 'Check your full name and Student ID, then try again.'
  return 'Registration could not be completed. Check your connection and details, then retry or contact the administrator.'
}
export async function registerStudent(form) {
  const validation = validateSignup(form)
  if (validation) throw new Error(validation)
  await authReady
  if (!authState.user || !isGoogleUser(authState.user)) throw new Error('Continue with Google before completing registration.')
  if (authState.registering) throw new Error('Registration is already being submitted.')
  authState.registering = true
  const version = generation
  try {
    const profile = await createStudentProfile(form)
    if (version !== generation || profile?.uid !== authState.user?.id) throw new Error('SESSION_CHANGED')
    await refreshProfile()
  } catch (error) {
    if (import.meta.env.DEV) console.error('[Registration]', {
      stage: 'REGISTRATION_RPC_FAILED', code: error?.code, message: error?.message, name: error?.name,
    })
    if (version === generation) await refreshProfile()
    throw new Error(registrationErrorMessage(error))
  } finally {
    authState.registering = false
  }
}
export async function logout() {
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw error
  acceptSession(null)
}
export function loginErrorMessage(error) {
  if (['access_denied', 'user_cancelled'].includes(error?.code)) return 'Google sign-in was cancelled. Try again when you are ready.'
  if (['provider_disabled', 'validation_failed'].includes(error?.code)) return 'Google sign-in is not configured for this site. Contact the administrator.'
  if (['bad_code_verifier', 'flow_state_expired', 'flow_state_not_found'].includes(error?.code)) return 'Your sign-in attempt expired. Continue with Google again in this browser.'
  if (error?.status === 429) return 'Sign-in is temporarily unavailable. Please wait and try again.'
  return 'Unable to sign in with Google. Please try again or contact the administrator.'
}
