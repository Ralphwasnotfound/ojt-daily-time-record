import { activityApi, activityAccountKey, approvedActivityStudent } from './supabaseActivities.js'
import { validatePhoto } from './activityPhoto.js'
import { createJournalProofReader } from './journalProofController.js'
export function journalProofIdentity() { return approvedActivityStudent() ? activityAccountKey() : '' }
// No persistent cache, public URLs, or provider. Reuse existing private Storage RLS.
const reader = createJournalProofReader({
  download: path => activityApi.download(path), validate: validatePhoto,
  identity: journalProofIdentity,
})
export function readJournalActivityProof(path, signal) { return reader.read(path, signal) }
