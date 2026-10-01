<script>
import AdminActivityProof from './AdminActivityProof.vue'
import { activityDate, activityTime } from '../services/supabaseActivityData.js'
export default {
  name: 'AdminActivityCard',
  components: { AdminActivityProof },
  props: { activity: { type: Object, required: true } },
  methods: { activityDate, activityTime },
}
</script>
<template>
  <div class="min-w-0">
    <slot name="context"><p class="text-xs text-stone-500">Submitted {{ activityDate(activity.created_at) }} · {{ activityTime(activity.created_at) }}</p></slot>
    <h4 class="mt-3 break-words text-sm font-semibold text-brand">{{ activity.category }}</h4>
    <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-stone-600">{{ activity.description }}</p>
    <AdminActivityProof :path="activity.photo_path" />
  </div>
</template>
