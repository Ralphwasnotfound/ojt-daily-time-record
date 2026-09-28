import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/auth/LoginView.vue'
import StudentLayout from '../layouts/StudentLayout.vue'
import AdminLayout from '../layouts/AdminLayout.vue'
import StudentDashboard from '../views/student/StudentDashboard.vue'
import AttendanceView from '../views/student/AttendanceView.vue'
import ActivityView from '../views/student/ActivityView.vue'
import HistoryView from '../views/student/HistoryView.vue'
import AdminDashboard from '../views/admin/AdminDashboard.vue'
import StudentsView from '../views/admin/StudentsView.vue'
import StudentDetailsView from '../views/admin/StudentDetailsView.vue'
import ActivityMonitorView from '../views/admin/ActivityMonitorView.vue'

// Routes are public during Phase 1. Authentication will be added later.
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'login', component: LoginView },
    {
      path: '/student',
      component: StudentLayout,
      children: [
        { path: '', name: 'student-dashboard', component: StudentDashboard },
        { path: 'attendance', name: 'student-attendance', component: AttendanceView },
        { path: 'activity', name: 'student-activity', component: ActivityView },
        { path: 'history', name: 'student-history', component: HistoryView },
      ],
    },
    {
      path: '/admin',
      component: AdminLayout,
      children: [
        { path: '', name: 'admin-dashboard', component: AdminDashboard },
        { path: 'students', name: 'admin-students', component: StudentsView },
        { path: 'students/:id', name: 'admin-student-details', component: StudentDetailsView, props: true },
        { path: 'activity', name: 'admin-activity', component: ActivityMonitorView },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})

export default router
