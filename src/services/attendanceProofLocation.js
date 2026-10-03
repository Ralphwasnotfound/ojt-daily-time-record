import { watch } from 'vue'
// Account-scoped, bounded memory only. No persistent coordinate/address cache.
export function createProofLocationResolver(client, identity) {
  let owner = '', epoch = 0, cache = new Map()
  const clear = () => { epoch++; owner = ''; cache.clear() }
  // Observe logout/login even while no viewer is mounted, including return to same UID.
  watch(identity, clear, { flush: 'sync' })
  return {
    clear,
    async resolve(proofId, signal) {
      const key = identity()
      if (key !== owner) { clear(); owner = key }
      const version = epoch
      if (!key || signal?.aborted || !/^[0-9a-f-]{36}$/i.test(proofId || '')) return { status: 'unavailable' }
      const hit = cache.get(proofId)
      if (hit && hit.expires > Date.now()) return hit.value
      const { data, error } = await client.functions.invoke('attendance-proof-location', { body: { proofId }, signal, timeout: 8000 })
      if (signal?.aborted || identity() !== key || owner !== key || version !== epoch) throw Error('ACCOUNT_CHANGED')
      if (error || data?.status !== 'resolved' || typeof data.displayLocation !== 'string' || !data.displayLocation.trim() || data.displayLocation.length > 500) return { status: 'unavailable' }
      // Fixed attribution URLs; never render arbitrary provider-supplied HTML/links.
      const value = { status: 'resolved', displayLocation: data.displayLocation }
      cache.delete(proofId); cache.set(proofId, { value, expires: Date.now() + 300000 })
      while (cache.size > 32) cache.delete(cache.keys().next().value)
      return value
    },
  }
}
