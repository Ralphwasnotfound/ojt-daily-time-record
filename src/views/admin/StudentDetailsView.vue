<script>
import PlaceholderPage from '../../components/PlaceholderPage.vue'

export default {
  name: 'StudentDetailsView',
  components: { PlaceholderPage },
  props: {
    id: { type: String, required: true },
  },
}
</script>

<template>
  <PlaceholderPage
    title="Student details"
    description="Individual attendance, activities, and accumulated OJT hours will appear here."
  >
    <p class="break-all text-sm text-slate-600">Student ID: {{ id }}</p>
    <RouterLink to="/admin/students" class="mt-4 inline-block text-sm font-medium text-brand underline underline-offset-4">Back to students</RouterLink>
  </PlaceholderPage>
</template>
