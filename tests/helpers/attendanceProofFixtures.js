// Test-only adapter. Uses the supplied authenticated local client and real Storage.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
export async function proofPunch(client, action, paths) {
  const draft = await client.rpc('attendance_proof_prepare', { request_id: randomUUID(), action_type: action })
  if (draft.error) return draft
  const ticket = draft.data[0]; paths.add(ticket.photo_path)
  const uploaded = await client.storage.from('attendance-proofs').upload(ticket.photo_path, png, { contentType: 'image/png', upsert: false })
  if (uploaded.error) return uploaded
  const result = await client.rpc('attendance_proof_finalize', { upload_id: ticket.upload_id, latitude: 14.6, longitude: 121, accuracy: 10 })
  if (result.error) return result
  assert.equal(result.data.action_type, action)
  return client.from('attendance_sessions').select('*').eq('id', result.data.attendance_session_id).single()
}
export function proofCleanupSql(ids) {
  // Caller supplies only generated local fixture UUID literals in a transaction.
  return `alter table public.attendance_proofs disable trigger attendance_proof_immutable;
    delete from public.attendance_proofs where student_uid in (${ids});
    alter table public.attendance_proofs enable trigger attendance_proof_immutable;
    delete from private.attendance_proof_uploads where student_uid in (${ids});`
}
