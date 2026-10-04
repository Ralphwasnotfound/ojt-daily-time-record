<script>
import { Image } from 'lucide-vue-next'
import { journalProofIdentity, readJournalActivityProof } from '../services/journalActivityProof.js'
import { activityAccountKey } from '../services/supabaseActivities.js'
import { journalProofState, createJournalProofController } from '../services/journalProofController.js'
export default {
  name: 'JournalActivityProof', components: { Image },
  props: { path: { type: String, default: '' } },
  data() { return { proof: journalProofState(), controller: null } },
  computed: { accountKey() { return activityAccountKey() } },
  watch: { path() { this.controller?.clear() }, accountKey() { this.controller?.clear() } },
  mounted() {
    this.controller = createJournalProofController(this.proof, {
      read: readJournalActivityProof, association: () => this.path, identity: journalProofIdentity,
    })
  },
  beforeUnmount() { this.controller?.clear() },
  methods: {
    show() { this.controller?.show() },
    hide() { this.controller?.clear() },
    imageFailed() { this.controller?.clear(); this.proof.error = 'Proof photo unavailable. Please try again.' },
  },
}
</script>
<template>
  <div class="mt-3">
    <p v-if="!path" class="text-xs text-stone-500">No proof photo available.</p>
    <template v-else>
      <button v-if="!proof.url" type="button" :disabled="proof.loading" :aria-busy="proof.loading" :aria-expanded="false" class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 px-3 text-sm font-medium text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50" @click="show"><Image :size="16" aria-hidden="true" />{{ proof.loading ? 'Loading proof photo…' : proof.error ? 'Retry proof photo' : 'View proof photo' }}</button>
      <p v-if="proof.loading" role="status" class="mt-2 text-xs text-stone-500">Loading proof photo…</p>
      <p v-if="proof.error" role="alert" class="mt-2 text-sm text-stone-600">{{ proof.error }}</p>
      <figure v-if="proof.url" class="rounded-lg border border-stone-200 bg-stone-50 p-2"><img :src="proof.url" alt="Recorded activity proof photo" loading="lazy" class="max-h-80 w-full rounded-lg object-contain" @error="imageFailed" /><figcaption class="mt-2 flex items-center justify-between gap-2 text-xs text-stone-500"><span>Activity proof photo</span><button type="button" :aria-expanded="true" class="min-h-11 px-3 font-medium text-brand focus-visible:outline-2 focus-visible:outline-brand" @click="hide">Hide photo</button></figcaption></figure>
    </template>
  </div>
</template>
