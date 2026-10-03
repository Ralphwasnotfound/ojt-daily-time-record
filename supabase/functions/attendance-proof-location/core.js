// Provider-independent derived presentation. Never persist into attendance evidence.
const text = value => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 100) : ''
export const attribution = Object.freeze([
  { label: 'Powered by Geoapify', url: 'https://www.geoapify.com/' },
  { label: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
])
export function normalizeLocation(payload) {
  const p = payload?.results?.[0]
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { status: 'unavailable' }
  // Keep locality wording as returned. Never invent "Barangay" or map state to province.
  const locality = text(p.suburb || p.quarter), cityOrMunicipality = text(p.city || p.town || p.village)
  const county = text(p.county)
  // A Philippine county is not universally a province; accept explicit province wording only.
  const province = /^province\b|\bprovince$/i.test(county) ? county : ''
  const country = p.country_code === 'ph' ? 'Philippines' : text(p.country)
  const seen = new Set(), parts = [locality, cityOrMunicipality, province, country].filter(value => {
    const key = value.toLocaleLowerCase('en-US'); if (!value || seen.has(key)) return false; seen.add(key); return true
  })
  if (!parts.length) return { status: 'unavailable' }
  return { status: 'resolved', displayLocation: parts.join(', '), locality, cityOrMunicipality, province, country, attribution }
}

export function createLocationHandler({ authorize, apiKey, fetchProvider = fetch, allowedOrigins = [], timeoutMs = 6000, allowLookup = () => true }) {
  return async request => {
    const origin = request.headers.get('origin')
    const cors = { 'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : '',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })
    if (origin && !allowedOrigins.includes(origin)) return reply({ status: 'unavailable' }, 403)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return reply({ status: 'unavailable' }, 405)
    const authorization = request.headers.get('authorization')
    if (!/^Bearer \S+$/i.test(authorization || '')) return reply({ status: 'unavailable' }, 401)
    let body
    try { if (Number(request.headers.get('content-length')) > 1024) throw Error(); const raw = await request.text(); if (raw.length > 1024) throw Error(); body = JSON.parse(raw) } catch { return reply({ status: 'unavailable' }, 400) }
    if (!body || Object.keys(body).length !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.proofId || '')) return reply({ status: 'unavailable' }, 400)
    let proof
    try { proof = await authorize(authorization, body.proofId, request.signal) } catch { return reply({ status: 'unavailable' }, 403) }
    if (!proof) return reply({ status: 'unavailable' }, 403) // No distinction between absent/inaccessible proof.
    const { latitude, longitude } = proof
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return reply({ status: 'unavailable' })
    if (!apiKey || !allowLookup()) return reply({ status: 'unavailable' })
    const controller = new AbortController(), cancel = () => controller.abort()
    request.signal.addEventListener('abort', cancel, { once: true })
    if (request.signal.aborted) controller.abort()
    const timer = setTimeout(cancel, timeoutMs)
    try {
      const url = new URL('https://api.geoapify.com/v1/geocode/reverse')
      url.search = new URLSearchParams({ lat: String(latitude), lon: String(longitude), format: 'json', lang: 'en', limit: '1', apiKey }).toString()
      const result = await fetchProvider(url, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } })
      if (!result.ok) return reply({ status: 'unavailable' })
      return reply(normalizeLocation(await result.json()))
    } catch { return reply({ status: 'unavailable' }) }
    finally { clearTimeout(timer); request.signal.removeEventListener('abort', cancel) }
  }
}

export function createProofAuthorizer(createClient, url, anonKey) {
  return async (authorization, proofId, signal) => {
    const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false } })
    const { data: { user }, error: authError } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
    if (authError || !user || signal.aborted) return null
    const { data: profile, error: profileError } = await client.from('profiles').select('role,status').eq('id', user.id).single().abortSignal(signal)
    if (profileError || profile?.status !== 'approved' || !['student', 'admin'].includes(profile.role)) return null
    // Caller-scoped SELECT is enforced by existing attendance_proofs RLS.
    const { data: proof, error } = await client.from('attendance_proofs').select('student_uid,latitude,longitude').eq('id', proofId).maybeSingle().abortSignal(signal)
    if (error || !proof || (profile.role === 'student' && proof.student_uid !== user.id)) return null
    return proof
  }
}
