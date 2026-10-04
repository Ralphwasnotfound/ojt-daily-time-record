// Blob retrieval is independent of the DOM so later exporters can reuse it.
export function createJournalProofReader({ download, validate, identity, concurrency = 2 }) {
  const queue = []
  let active = 0
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift()
      if (job.signal?.aborted || identity() !== job.key) { job.reject(Error('PROOF_CANCELLED')); continue }
      active++
      Promise.resolve().then(async () => {
        if (job.signal?.aborted || identity() !== job.key) throw Error('PROOF_CANCELLED')
        const blob = await download(job.path)
        if (job.signal?.aborted || identity() !== job.key) throw Error('PROOF_CANCELLED')
        await validate(blob)
        if (job.signal?.aborted || identity() !== job.key) throw Error('PROOF_CANCELLED')
        return blob
      }).then(job.resolve, job.reject).finally(() => { active--; drain() })
    }
  }
  return {
    read(path, signal) {
      const key = identity()
      if (!key || typeof path !== 'string' || !path) return Promise.reject(Error('PROOF_UNAVAILABLE'))
      if (signal?.aborted) return Promise.reject(Error('PROOF_CANCELLED'))
      return new Promise((resolve, reject) => {
        const job = { path, key, signal, resolve, reject }
        const abort = () => {
          const index = queue.indexOf(job)
          if (index >= 0) queue.splice(index, 1)
          job.reject(Error('PROOF_CANCELLED'))
        }
        job.resolve = value => { signal?.removeEventListener('abort', abort); resolve(value) }
        job.reject = error => { signal?.removeEventListener('abort', abort); reject(error) }
        signal?.addEventListener('abort', abort, { once: true })
        queue.push(job); drain()
      })
    },
  }
}
export function journalProofState() { return { url: '', loading: false, error: '' } }
export function createJournalProofController(state, { read, association, identity, urls = URL }) {
  let generation = 0, pending = null
  function clear() {
    generation++; pending?.abort(); pending = null
    if (state.url) urls.revokeObjectURL(state.url)
    state.url = ''; state.loading = false; state.error = ''
  }
  return {
    clear,
    async show() {
      if (state.loading || state.url) return
      const path = association(), key = identity()
      if (!path || !key) return
      const current = ++generation, abort = new AbortController(); pending = abort
      const valid = () => current === generation && !abort.signal.aborted && identity() === key && association() === path
      state.loading = true; state.error = ''
      try {
        const blob = await read(path, abort.signal)
        if (valid()) state.url = urls.createObjectURL(blob)
      } catch {
        if (valid()) state.error = 'Proof photo unavailable. Please try again.'
      } finally { if (current === generation) { state.loading = false; pending = null } }
    },
  }
}
