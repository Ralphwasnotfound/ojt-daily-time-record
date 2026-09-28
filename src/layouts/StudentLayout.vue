<script>
import WorkspaceLayout from '../components/WorkspaceLayout.vue'

export default {
  name: 'StudentLayout',
  components: { WorkspaceLayout },
  data() {
    return {
      navigation: [
        {
          "to": "/student",
          "label": "Dashboard",
          "icon": "LayoutDashboard",
          "exact": true
        },
        {
          "to": "/student/attendance",
          "label": "Attendance",
          "icon": "Clock"
        },
        {
          "to": "/student/activity",
          "label": "Activity Update",
          "icon": "ClipboardPen"
        },
        {
          "to": "/student/history",
          "label": "History",
          "icon": "History"
        }
      ],
    }
  },
}
</script>

<template>
  <WorkspaceLayout role="Student" :items="navigation">
    <RouterView />
  </WorkspaceLayout>
</template>
