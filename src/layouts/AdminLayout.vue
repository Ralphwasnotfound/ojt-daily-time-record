<script>
import WorkspaceLayout from '../components/WorkspaceLayout.vue'

export default {
  name: 'AdminLayout',
  components: { WorkspaceLayout },
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
