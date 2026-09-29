<script>
import { authState } from '../../services/auth'
import { UserRound, Pencil, Save } from 'lucide-vue-next'
export default {
  name: 'AdminProfileView',
  components: { UserRound, Pencil, Save },
  data() {
    return {
      // In-memory mock profile only; edits are discarded when this view is left.
      profile: {
  "fullName": "Jamie Reyes",
  "email": "admin@example.com",
  "role": "Administrator",
  "department": "BSIT Department",
  "status": "Active"
},
      draft: {},
      editing: false,
      notice: '',
    }
  },
  created() {
    // Identity comes from Supabase profiles. Remaining workplace/progress fields are preview data.
    const account = authState.profile
    for (const field of ['fullName', 'studentId', 'email', 'role', 'status', 'program', 'yearLevel', 'requiredHours', 'department']) {
      if (account && account[field] !== undefined) this.profile[field] = account[field]
    }
  },
  methods: {
    editProfile() {
      this.notice = 'Profile editing is not available yet. Contact the BSIT administrator for account corrections.'
    },
    saveChanges() {
      this.editProfile()
    },
    cancelChanges() {
      this.finishEditing('Unsaved changes discarded.')
    },
    finishEditing(message) {
      this.draft = {}
      this.editing = false
      this.notice = message
      this.$nextTick(() => this.$refs.editButton.focus())
    },
  },
}
</script>
<template>
  <div class="space-y-6">
    <header><h1 class="text-2xl font-semibold text-stone-900 sm:text-3xl">Profile</h1><p class="mt-2 text-sm leading-6 text-stone-600">Manage your administrator profile and account information.</p></header>
    <p class="border-l-2 border-brand-gold pl-3 text-xs leading-5 text-stone-500">Identity and account status are loaded from Supabase. Profile editing is unavailable until a trusted update service is added. Other OJT fields remain preview data.</p>
    <section aria-label="Profile summary" class="flex flex-wrap items-center gap-4 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-stone-100 text-brand"><UserRound :size="32" aria-hidden="true" /></div>
      <div class="min-w-0 flex-1"><h2 class="break-words text-xl font-semibold">{{ profile.fullName }}</h2><p class="mt-1 text-sm text-stone-500">{{ profile.role }}</p><span class="mt-2 inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">{{ profile.status }}</span></div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="min-h-11 rounded-lg border border-stone-200 px-3 py-2 text-sm font-semibold text-brand hover:bg-stone-50" @click="notice = 'Photo changes are not connected yet. No file picker was opened.'">Change Photo</button>
        <button v-if="!editing" ref="editButton" type="button" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark" @click="editProfile"><Pencil :size="16" aria-hidden="true" />Edit Profile</button>
      </div>
    </section>
    <form ref="form" class="space-y-6" @submit.prevent="saveChanges">
      <section aria-labelledby="personal-heading" class="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
        <h2 id="personal-heading" class="text-lg font-semibold">Account Information</h2>
        <div class="mt-5 grid gap-5 sm:grid-cols-2"><div><label for="fullName" class="mb-2 block text-sm font-medium text-stone-700">Full Name</label><input id="fullName" :value="editing ? draft.fullName : profile.fullName" @input="draft.fullName = $event.target.value" :readonly="!editing" required type="text" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm read-only:bg-stone-50 read-only:text-stone-500" /></div>
<div><label for="email" class="mb-2 block text-sm font-medium text-stone-700">Email Address</label><input id="email" :value="editing ? draft.email : profile.email" @input="draft.email = $event.target.value" :readonly="!editing" required type="email" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm read-only:bg-stone-50 read-only:text-stone-500" /></div>
<div><label for="role" class="mb-2 block text-sm font-medium text-stone-700">Role <span class="font-normal text-stone-400">(read-only)</span></label><input id="role" :value="editing ? draft.role : profile.role" readonly type="text" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm read-only:bg-stone-50 read-only:text-stone-500" /></div>
<div><label for="department" class="mb-2 block text-sm font-medium text-stone-700">Department <span class="font-normal text-stone-400">(read-only)</span></label><input id="department" :value="editing ? draft.department : profile.department" readonly type="text" class="min-h-12 w-full min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm read-only:bg-stone-50 read-only:text-stone-500" /></div></div>
      </section>
      
      <div v-if="editing" class="flex flex-wrap justify-end gap-3"><button type="button" class="min-h-12 rounded-lg border border-stone-300 px-5 py-3 text-sm font-semibold hover:bg-stone-50" @click="cancelChanges">Cancel</button><button type="submit" class="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 py-3 text-sm font-semibold text-white hover:bg-brand-dark"><Save :size="18" aria-hidden="true" />Save Changes</button></div>
    </form>
    <p role="status" aria-live="polite" :class="notice ? 'rounded-lg border border-brand-gold/50 bg-brand-gold/10 p-4 text-sm leading-6 text-stone-700' : 'sr-only'">{{ notice }}</p>
  </div>
</template>
