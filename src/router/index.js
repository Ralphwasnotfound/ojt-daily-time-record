import { createRouter, createWebHistory, isNavigationFailure, NavigationFailureType } from 'vue-router'
import { watch } from 'vue'
import { authReady, authState, refreshProfile } from '../services/auth'
import { routeRedirect } from '../services/accountPolicy'
import SignupView from '../views/auth/SignupView.vue'
import PendingView from '../views/auth/PendingView.vue'
import LoginView from '../views/auth/LoginView.vue'
import StudentLayout from '../layouts/StudentLayout.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import StudentDashboard from '../views/student/StudentDashboard.vue'
import AttendanceView from '../views/student/AttendanceView.vue'
import ActivityView from '../views/student/ActivityView.vue'
import HistoryView from '../views/student/HistoryView.vue'
import JournalView from '../views/student/JournalView.vue'
import AdminDashboard from '../views/admin/AdminDashboard.vue'
import StudentsView from '../views/admin/StudentsView.vue'
import StudentDetailsView from '../views/admin/StudentDetailsView.vue'
import ActivityMonitorView from '../views/admin/ActivityMonitorView.vue'
import StudentProfileView from '../views/student/StudentProfileView.vue'
import AdminProfileView from '../views/admin/AdminProfileView.vue'

// Supabase profiles supply role/status; RLS and trusted RPCs enforce database access.
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'login', component: LoginView },
    { path: '/signup', name: 'signup', component: SignupView, meta: { requiresAuth: true } },
    { path: '/pending', name: 'pending', component: PendingView, meta: { requiresAuth: true } },
    {
      path: '/student',
      meta: { requiresAuth: true, role: 'student' },
      component: StudentLayout,
      children: [
        { path: '', name: 'student-dashboard', component: StudentDashboard },
        { path: 'attendance', name: 'student-attendance', component: AttendanceView },
        { path: 'activity', name: 'student-activity', component: ActivityView },
        { path: 'history', name: 'student-history', component: HistoryView },
        { path: 'journal', name: 'student-journal', component: JournalView },
        { path: 'profile', name: 'student-profile', component: StudentProfileView },
      ],
    },
    {
      path: '/admin',
      meta: { requiresAuth: true, role: 'admin' },
      component: AdminLayout,
      children: [
        { path: '', name: 'admin-dashboard', component: AdminDashboard },
        { path: 'students', name: 'admin-students', component: StudentsView },
        { path: 'students/:id', name: 'admin-student-details', component: StudentDetailsView, props: true },
        { path: 'activity', name: 'admin-activity', component: ActivityMonitorView },
        { path: 'profile', name: 'admin-profile', component: AdminProfileView },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

let navigating = false
router.beforeEach(async to => {
  navigating = true
  await authReady
  // Read from the server on navigation, never authorize using an offline cached profile.
  if (authState.user && !authState.registering) await refreshProfile()
  return routeRedirect(to, authState.user, authState.profile, authState.profileError) || undefined
})

// Do not start a competing redirect while a guard is fetching its profile.
function enforceAccountRoute() {
  if (navigating || !authState.initialized || authState.profileLoading || authState.registering) return
  const target = routeRedirect(router.currentRoute.value, authState.user, authState.profile, authState.profileError)
  if (target) router.replace(target)
}
router.afterEach((_to, _from, failure) => {
  // A cancelled navigation was superseded; the newer navigation still owns this state.
  if (isNavigationFailure(failure, NavigationFailureType.cancelled)) return
  navigating = false
  enforceAccountRoute()
})
watch(() => [authState.user, authState.profile, authState.profileError, authState.profileLoading], enforceAccountRoute)

export default router

