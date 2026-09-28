<script>
import { CalendarDays, Camera, Image, Send } from 'lucide-vue-next'

export default {
  name: 'ActivityView',
  components: { CalendarDays, Camera, Image, Send },
  data() {
    return {
      date: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
      activityForm: { type: '', description: '' },
      attendanceStatus: { status: 'IN', timeIn: '8:02 AM' },
      categories: ['Programming / Development', 'IT Support', 'Hardware / Maintenance', 'Documentation', 'Training / Seminar', 'Meeting', 'Administrative Work', 'Other'],
      notice: '',
    }
  },
  methods: {
    previewPhoto() {
      this.notice = 'Photo tools are not connected yet. No camera or file picker was opened.'
    },
    previewSubmit() {
      this.notice = 'This is a UI preview. Your activity has not been sent or saved.'
    },
  },
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h1 class="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">Activity Update</h1>
      <p class="mt-2 text-sm leading-6 text-stone-600">Share your current OJT activity and photo proof.</p>
      <p class="mt-3 flex items-center gap-2 text-sm text-stone-500"><CalendarDays :size="16" aria-hidden="true" />{{ date }}</p>
    </header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">UI preview only. Photos and activity updates are not uploaded or stored.</p>

    <form class="grid items-start gap-6 xl:grid-cols-2" @submit.prevent="previewSubmit">
      <section aria-labelledby="photo-heading" class="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <h2 id="photo-heading" class="text-lg font-semibold text-stone-900">Photo Proof</h2>
        <div class="mt-5 flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 text-center">
          <Camera :size="36" class="text-stone-400" aria-hidden="true" />
          <p class="text-sm font-medium text-stone-600">Your photo preview will appear here</p>
          <p class="text-xs text-stone-500">No photo attached</p>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" class="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark" @click="previewPhoto"><Camera :size="18" aria-hidden="true" />Take Photo</button>
          <button type="button" class="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-700 hover:bg-stone-50" @click="previewPhoto"><Image :size="18" aria-hidden="true" />Choose Photo</button>
        </div>
        <p class="mt-3 text-xs leading-5 text-stone-500">A photo will be attached to this activity update.</p>
      </section>

      <section aria-labelledby="details-heading" class="min-w-0 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <h2 id="details-heading" class="text-lg font-semibold text-stone-900">Activity Details</h2>
        <div class="mt-5">
          <label for="activity-type" class="mb-2 block text-sm font-medium text-stone-700">Activity Type</label>
          <select id="activity-type" v-model="activityForm.type" required class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm">
            <option disabled value="">Select an activity type</option>
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </div>
        <div class="mt-5">
          <label for="activity-description" class="mb-2 block text-sm font-medium text-stone-700">Activity Description</label>
          <textarea id="activity-description" v-model="activityForm.description" required maxlength="500" rows="6" aria-describedby="description-count" placeholder="Briefly describe what you are currently working on..." class="w-full resize-y rounded-lg border border-stone-300 px-3 py-3 text-sm leading-6 placeholder:text-stone-400"></textarea>
          <p id="description-count" class="mt-1 text-right text-xs text-stone-500">{{ activityForm.description.length }} / 500</p>
        </div>
        <dl class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-stone-50 p-4 text-sm">
          <div class="flex items-center gap-2"><dt class="text-stone-500">Current Status:</dt><dd class="inline-flex items-center gap-1.5 font-semibold text-emerald-800"><span class="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden="true"></span>{{ attendanceStatus.status }}</dd></div>
          <div class="flex gap-2"><dt class="text-stone-500">Time In:</dt><dd class="font-medium">{{ attendanceStatus.timeIn }}</dd></div>
        </dl>
        <button type="submit" class="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark"><Send :size="18" aria-hidden="true" />Send Activity Update</button>
        <p class="mt-3 text-xs leading-5 text-stone-500">Preview only. Sending is not connected yet.</p>
      </section>
      <p role="status" aria-live="polite" :class="notice ? 'rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4 text-sm leading-6 text-stone-700 xl:col-span-2' : 'sr-only'">{{ notice }}</p>
    </form>
  </div>
</template>
