export function accountDestination(user, profile, error = '') {
  if (!user) return '/'
  if (error || !profile || profile.uid !== user.uid) return '/pending'
  if (profile.status === 'approved' && profile.role === 'student') return '/student'
  if (profile.status === 'approved' && profile.role === 'admin') return '/admin'
  return '/pending'
}

export function routeRedirect(to, user, profile, error = '') {
  const home = accountDestination(user, profile, error)
  if (!user) return to.meta.requiresAuth ? '/' : null
  if (to.path === '/' || to.path === '/signup') return home
  if (to.path === '/pending') return home === '/pending' ? null : home
  if (to.meta.role && home !== '/' + to.meta.role) return home
  return null
}

// ASCII uppercase IDs with a single canonical format; spaces are trimmed, not removed.
export function normalizeStudentId(value) { return value.trim().toUpperCase() }
export const yearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year']
export function validateSignup(form) {
  if (!form.fullName?.trim() || form.fullName.trim().length > 100) return 'Enter your full name (up to 100 characters).'
  if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(normalizeStudentId(form.studentId || ''))) return 'Use 3–30 letters, numbers, or hyphens for your Student ID.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email || '') || form.email.length > 254) return 'Enter a valid email address.'
  if (form.program !== 'BS Information Technology' || !yearLevels.includes(form.yearLevel)) return 'Select a valid program and year level.'
  if (!form.password || form.password.length < 8) return 'Use a password with at least 8 characters.'
  if (form.password !== form.confirmPassword) return 'Your passwords do not match.'
  return ''
}
