// Shared bounded read state; an account/route change invalidates all late responses.
export function adminPageState() { return { rows: [], loading: false, error: '', page: 0, next: false } }
export function createAdminPage(state, load, identity, size = 25) {
  let generation = 0, stopped = false, cursors = [null]
  async function read(page, reset = false) {
    if (stopped || (!reset && state.loading)) return
    const version = ++generation, key = identity()
    if (reset) { cursors = [null]; state.page = 0 }
    state.rows = []; state.next = false; state.error = ''; state.loading = !!key
    if (!key) return
    try {
      const rows = await load(cursors[page], size)
      if (stopped || version !== generation || identity() !== key) return
      state.rows = rows; state.page = page; state.next = rows.length === size
      cursors[page + 1] = rows.at(-1) || null
    } catch { if (!stopped && version === generation && identity() === key) state.error = 'Unable to load records. Check your connection and administrator access, then refresh.' }
    finally { if (!stopped && version === generation) state.loading = false }
  }
  return { refresh: () => read(0, true), next: () => state.next ? read(state.page + 1) : undefined,
    previous: () => state.page ? read(state.page - 1) : undefined,
    stop() { stopped = true; generation++; Object.assign(state, adminPageState()) } }
}
