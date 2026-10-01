<script>
import { adminKey } from '../services/supabaseAdmin.js'
import { adminAttendanceSignals } from '../services/adminAttendanceSignals.js'
import WorkspaceLayout from '../components/WorkspaceLayout.vue'

export default {
  name: 'AdminLayout',
  components: { WorkspaceLayout },
  computed: { attendanceIdentity() { return adminKey() } },
  watch: { attendanceIdentity() { adminAttendanceSignals.start() } },
  mounted() { adminAttendanceSignals.start(); window.addEventListener('online', adminAttendanceSignals.signal) },
  beforeUnmount() { adminAttendanceSignals.stop(); window.removeEventListener('online', adminAttendanceSignals.signal) },
  data() {
    return {
      navigation: [
        {
          "to": "/admin",
          "label": "Dashboard",
          "icon": "LayoutDashboard",
          "exact": true
        },
        {
          "to": "/admin/students",
          "label": "Students",
          "icon": "Users"
        },
        {
          "to": "/admin/activity",
          "label": "Activity Monitor",
          "icon": "Activity"
        }
      ],
    }
  },
}
</script>

<template>
  <WorkspaceLayout role="Admin" :items="navigation">
    <RouterView />
  </WorkspaceLayout>
</template>
