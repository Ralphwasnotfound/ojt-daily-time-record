export function isGoogleUser(user) {
  // UI eligibility only; the registration RPC verifies Auth-managed identities.
  return !!user?.identities?.some(identity => identity.provider === 'google')
}
export function accountDestination(user, profile, error = '') {
  if (!user) return '/'
  if (error) return '/pending'
  if (!profile) return isGoogleUser(user) ? '/signup' : '/pending'
  if (!user.id || profile.uid !== user.id) return '/pending'
  if (profile.status === 'approved' && profile.role === 'student') return '/student'
  if (profile.status === 'approved' && profile.role === 'admin') return '/admin'
  return '/pending'
}
export function routeRedirect(to, user, profile, error = '') {
  const home = accountDestination(user, profile, error)
  if (!user) return to.meta.requiresAuth ? '/' : null
  if (['/', '/signup', '/pending'].includes(to.path)) return to.path === home ? null : home
  if (to.meta.role && home !== '/' + to.meta.role) return home
  return null
}
export function normalizeStudentId(value) { return value.trim().toUpperCase() }
export function validateSignup(form) {
  if (!form.fullName?.trim() || [...form.fullName.trim()].length > 100) return 'Enter your full name (up to 100 characters).'
  if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(normalizeStudentId(form.studentId || ''))) return 'Use 3–30 letters, numbers, or hyphens for your Student ID.'
  if (form.program !== 'BS Information Technology') return 'Program must be BS Information Technology.'
  return ''
}
