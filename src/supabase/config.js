// Only publishable keys or legacy anon JWTs belong in a browser bundle.
export function browserConfig(env) {
  const url = env.VITE_SUPABASE_URL?.trim()
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim()
  if (!url || !key) throw new Error('Supabase configuration is incomplete. Set the browser URL and publishable key in .env.local, then restart Vite.')
  const parsed = new URL(url)
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid Supabase URL.')
  let browserSafe = key.startsWith('sb_publishable_')
  if (!browserSafe) {
    try {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      browserSafe = payload.role === 'anon'
    } catch { /* Not a browser-safe legacy anon key. */ }
  }
  if (!browserSafe) throw new Error('Use only a Supabase publishable or legacy anon key. Secret and service-role keys are forbidden in the frontend.')
  return { url, key }
}
