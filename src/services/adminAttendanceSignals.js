import { supabase } from '../supabase/supabase.js'
import { adminKey } from './supabaseAdmin.js'

// Signals only: never retain event rows or calculate attendance from their data.
export function createAttendanceSignals(client, identity, delay = 300, maxDelay = 1000) {
  const listeners = new Set()
  let channel = null, owner = '', generation = 0, trailing = null, maximum = null
  function clearTimers() { clearTimeout(trailing); clearTimeout(maximum); trailing = maximum = null }
  async function run(entry) {
    if (!entry.active || entry.running || !owner || identity() !== owner) return
    entry.running = true; entry.dirty = false
    try { await entry.read() } catch { /* Each read owns its friendly error state. */ }
    finally {
      entry.running = false
      if (entry.active && owner && identity() === owner && entry.dirty) run(entry)
    }
  }
  function flush() { clearTimers(); for (const entry of listeners) { entry.dirty = true; run(entry) } }
  function signal() {
    if (!owner || identity() !== owner) return
    clearTimeout(trailing); trailing = setTimeout(flush, delay)
    if (!maximum) maximum = setTimeout(flush, maxDelay)
  }
  function stop() {
    generation++; owner = ''; clearTimers()
    for (const entry of listeners) entry.dirty = false
    const old = channel; channel = null
    if (old) Promise.resolve(client.removeChannel(old)).catch(() => {})
  }
  return {
    register(read) {
      const entry = { read, running: false, dirty: false, active: true }; listeners.add(entry)
      return () => { entry.active = false; entry.dirty = false; listeners.delete(entry) }
    },
    start() {
      const key = identity()
      if (channel && owner === key) return
      stop(); if (!key || !client) return
      owner = key; const version = generation
      const receive = payload => { if (version === generation && !payload?.errors?.length) signal() }
      try {
        channel = client.channel('admin-attendance-' + key)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_sessions' }, receive)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance_sessions' }, receive)
          .subscribe(status => { if (status === 'SUBSCRIBED' && version === generation) signal() })
      } catch { stop() } // Initial/focus/manual reads remain independent.
    },
    signal, stop,
  }
}
export const adminAttendanceSignals = createAttendanceSignals(supabase, adminKey)
