<script>
import PlaceholderPage from '../../components/PlaceholderPage.vue'

export default {
  name: 'StudentsView',
  components: { PlaceholderPage },
}
</script>

<template>
  <PlaceholderPage
    title="Students"
    description="Registered students and their current IN or OUT status will appear here."
  >
    <RouterLink to="/admin/students/preview" class="text-sm font-medium text-brand underline underline-offset-4">Preview student details</RouterLink>
  </PlaceholderPage>
</template>
