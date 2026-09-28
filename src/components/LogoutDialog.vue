<script>
export default {
  name: 'LogoutDialog',
  emits: ['cancel', 'confirm'],
  props: {
    busy: { type: Boolean, default: false },
    error: { type: String, default: '' },
  },
  data() {
    return { previousOverflow: '' }
  },
  mounted() {
    this.previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    this.$refs.dialog.showModal()
    this.$refs.cancel.focus()
  },
  beforeUnmount() {
    this.$refs.dialog.close()
    document.body.style.overflow = this.previousOverflow
  },
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" aria-labelledby="logout-title" aria-describedby="logout-description" :aria-busy="busy" class="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-stone-200 bg-white p-6 text-stone-800 backdrop:bg-stone-950/50" @cancel.prevent="!busy && $emit('cancel')">
      <h2 id="logout-title" class="text-xl font-semibold">Log out?</h2>
      <p id="logout-description" class="mt-3 text-sm text-stone-600">You will return to the login screen.</p>
      <p v-if="error" role="alert" class="mt-3 text-sm text-brand">{{ error }}</p>
      <div class="mt-6 flex justify-end gap-3">
        <button ref="cancel" type="button" :disabled="busy" class="min-h-11 rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50 disabled:opacity-60" @click="$emit('cancel')">Cancel</button>
        <button type="button" :disabled="busy" class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:cursor-wait disabled:opacity-60" @click="$emit('confirm')">{{ busy ? 'Logging Out...' : 'Log Out' }}</button>
      </div>
    </dialog>
  </Teleport>
</template>
