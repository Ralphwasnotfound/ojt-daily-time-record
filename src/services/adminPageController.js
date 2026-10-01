// Shared bounded read state; an account/route change invalidates all late responses.
export function adminPageState() { return { rows: [], loading: false, error: '', page: 0, next: false } }
export function createAdminPage(state, load, identity, size = 25) {
  let generation = 0, stopped = false, cursors = [null]
  async function read(page, reset = false, reconcile = false) {
    if (stopped || (!reset && !reconcile && state.loading)) return false
    const version = ++generation, key = identity()
    if (reset) { cursors = [null]; state.page = 0 }
    if (!reconcile || !key) { state.rows = []; state.next = false }
    state.error = ''; state.loading = !!key
    if (!key) return false
    try {
      const rows = await load(cursors[page], size)
      if (stopped || version !== generation || identity() !== key) return false
      state.rows = rows; state.page = page; state.next = rows.length === size
      cursors[page + 1] = rows.at(-1) || null
      if (reconcile) cursors.length = page + 2
      return true
    } catch {
      if (!stopped && version === generation && identity() === key) state.error = 'Unable to load records. Check your connection and administrator access, then refresh.'
      return false
    }
    finally { if (!stopped && version === generation) state.loading = false }
  }
  return { refresh: () => read(0, true),
    // Mutation reconciliation supersedes older reads without removing the inline editor.
    reload: () => read(state.page, false, true),
    next: () => state.next ? read(state.page + 1) : undefined,
    previous: () => state.page ? read(state.page - 1) : undefined,
    stop() { stopped = true; generation++; Object.assign(state, adminPageState()) } }
}
