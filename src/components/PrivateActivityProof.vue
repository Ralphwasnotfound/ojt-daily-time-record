<script>
import { Image } from 'lucide-vue-next'
import { activityApi, activityAccountKey } from '../services/supabaseActivities.js'
import { validatePhoto } from '../services/activityPhoto.js'
export default {
  name: 'PrivateActivityProof', components: { Image }, props: { path: { type: String, required: true } },
  data() { return { url: '', busy: false, error: '', version: 0 } },
  computed: { accountKey() { return activityAccountKey() } },
  watch: { path() { this.clear() }, accountKey() { this.clear() } },
  beforeUnmount() { this.clear() },
  methods: {
    clear() { this.version++; if (this.url) URL.revokeObjectURL(this.url); this.url = ''; this.busy = false; this.error = '' },
    async show() {
      if (this.busy) return
      if (this.url) { this.clear(); return }
      const version = ++this.version
      this.busy = true; this.error = ''
      try {
        const blob = await activityApi.download(this.path)
        await validatePhoto(blob)
        if (version === this.version) this.url = URL.createObjectURL(blob)
      } catch { if (version === this.version) this.error = 'The private photo could not be loaded. Please try again.' }
      finally { if (version === this.version) this.busy = false }
    },
  },
}
</script>
<template>
  <div class="mt-2">
    <button type="button" :disabled="busy" :aria-expanded="!!url" class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand disabled:opacity-50" @click="show"><Image :size="16" aria-hidden="true" />{{ busy ? 'Loading photo…' : url ? 'Hide photo' : 'View private photo' }}</button>
    <p v-if="error" role="alert" class="text-sm text-brand">{{ error }}</p>
    <img v-if="url" :src="url" alt="Activity proof" class="mt-2 max-h-80 w-full rounded-lg bg-stone-50 object-contain" />
  </div>
</template>
