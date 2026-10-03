import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocationHandler, createProofAuthorizer, normalizeLocation } from '../supabase/functions/attendance-proof-location/core.js'
import { createProofLocationResolver } from '../src/services/attendanceProofLocation.js'
const id = '11111111-1111-4111-8111-111111111111'
const proof = { student_uid: 'owner', latitude: 14, longitude: 121 }
const payload = { results: [{ suburb: 'Locality A', city: 'Municipality B', county: 'Province C', country: 'Philippines', country_code: 'ph', state: 'Region D', formatted: 'unnecessary building details' }] }
const request = (body = { proofId: id }, auth = true) => new Request('http://localhost/function', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer mocked-user' } : {}) }, body: JSON.stringify(body) })
function fixture(options = {}) {
  const calls = []
  const handler = createLocationHandler({ apiKey: 'mocked-provider-key', authorize: async () => proof,
    fetchProvider: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(payload)) }, ...options })
  return { calls, handler }
}
for (const [name, body, auth, status] of [ ['unauthenticated', { proofId: id }, false, 401], ['malformed', { proofId: 'invalid' }, true, 400], ['browser coordinates', { proofId: id, latitude: 0, longitude: 0 }, true, 400] ]) test(`location rejects ${name} without provider call`, async () => {
  const { handler, calls } = fixture(); const r = await handler(request(body, auth)); assert.equal(r.status, status); assert.equal(calls.length, 0)
})
for (const role of ['student', 'admin']) for (const status of ['approved', 'pending', 'rejected']) test(`authorizer ${role} ${status}`, async () => {
  const selections = []
  const make = (url, key, options) => {
    assert.equal(key, 'anon-only'); assert.equal(options.global.headers.Authorization, 'Bearer mocked-user')
    return { auth: { getUser: async token => { assert.equal(token, 'mocked-user'); return { data: { user: { id: 'owner' } } } } }, from(table) {
      return { select(fields) { selections.push([table, fields]); return this }, eq() { return this }, single() { return this }, maybeSingle() { return this }, abortSignal: async () => ({ data: table === 'profiles' ? { role, status } : proof }) }
    } }
  }
  const authorize = createProofAuthorizer(make, 'http://localhost', 'anon-only')
  const result = await authorize('Bearer mocked-user', id, new AbortController().signal)
  assert.equal(!!result, status === 'approved'); assert.ok(selections.every(([, fields]) => !/email|name|photo_path|official_punch_at/.test(fields)))
})
test('student foreign proof and RLS-denied Admin proof rejected', async () => {
  for (const [role, row] of [['student', { ...proof, student_uid: 'other' }], ['admin', null]]) {
    const make = () => ({ auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) }, from(table) { return { select() { return this }, eq() { return this }, single() { return this }, maybeSingle() { return this }, abortSignal: async () => ({ data: table === 'profiles' ? { role, status: 'approved' } : row }) } } })
    const { handler, calls } = fixture({ authorize: createProofAuthorizer(make, 'local', 'anon') }); assert.equal((await handler(request())).status, 403); assert.equal(calls.length, 0)
  }
})
test('provider receives finalized coordinates only; normalized response contains no secrets/raw metadata', async () => {
  const { handler, calls } = fixture(); const r = await handler(request()); const result = await r.json()
  assert.equal(result.displayLocation, 'Locality A, Municipality B, Province C, Philippines')
  const params = calls[0].url.searchParams
  assert.equal(params.get('lat'), '14'); assert.equal(params.get('lon'), '121')
  assert.deepEqual([...params.keys()].sort(), ['apiKey', 'format', 'lang', 'lat', 'limit', 'lon'].sort())
  assert.deepEqual(calls[0].init.headers, { Accept: 'application/json' })
  assert.doesNotMatch(JSON.stringify(result), /mocked-provider-key|owner|Region D|building|latitude|longitude/)
  assert.equal(r.headers.get('cache-control'), 'private, no-store')
})
test('partial Philippine result, duplicates and conservative province handling', () => {
  assert.equal(normalizeLocation({ results: [{ city: 'City A', country_code: 'ph', state: 'Region X', county: 'Unclassified County' }] }).displayLocation, 'City A, Philippines')
  assert.equal(normalizeLocation({ results: [{ suburb: 'City A', city: 'city a', country_code: 'ph' }] }).displayLocation, 'City A, Philippines')
  assert.equal(normalizeLocation({ results: [{ country_code: 'ph' }] }).displayLocation, 'Philippines')
  assert.equal(normalizeLocation({ results: [{ district: 'District X', state: 'Region X' }] }).status, 'unavailable')
})
for (const payload of [null, {}, { results: [] }, { results: [{}] }, { results: ['malformed'] }]) test('malformed provider response falls back', () => assert.equal(normalizeLocation(payload).status, 'unavailable'))
for (const code of [429, 500, 503]) test(`provider ${code} is neutral unavailable`, async () => {
  const { handler } = fixture({ fetchProvider: async () => new Response('private provider error', { status: code }) }); const r = await handler(request()); assert.deepEqual(await r.json(), { status: 'unavailable' })
})
test('timeout and missing key do not disclose provider errors', async () => {
  const { handler } = fixture({ timeoutMs: 5, fetchProvider: (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('sensitive upstream')))) })
  assert.deepEqual(await (await handler(request())).json(), { status: 'unavailable' })
  const missing = fixture({ apiKey: '' }); assert.deepEqual(await (await missing.handler(request())).json(), { status: 'unavailable' }); assert.equal(missing.calls.length, 0)
})
test('CORS restricts origins and quota guard prevents provider requests', async () => {
  const { handler, calls } = fixture({ allowLookup: () => false }); assert.equal((await handler(new Request('http://localhost', { method: 'OPTIONS', headers: { Origin: 'https://untrusted.invalid' } }))).status, 403)
  assert.deepEqual(await (await handler(request())).json(), { status: 'unavailable' }); assert.equal(calls.length, 0)
})
test('frontend proof-only request, bounded cache, account change/signout and stale suppression', async () => {
  let account = 'first', count = 0, resolve
  const client = { functions: { invoke: async (name, options) => { assert.equal(name, 'attendance-proof-location'); assert.deepEqual(Object.keys(options.body), ['proofId']); count++; return { data: { status: 'resolved', displayLocation: 'City A, Philippines' } } } } }
  const api = createProofLocationResolver(client, () => account)
  await api.resolve(id); await api.resolve(id); assert.equal(count, 1)
  account = ''; assert.deepEqual(await api.resolve(id), { status: 'unavailable' })
  account = 'first'; await api.resolve(id); assert.equal(count, 2)
  api.clear(); await api.resolve(id); assert.equal(count, 3)
  client.functions.invoke = () => new Promise(r => { resolve = r })
  api.clear(); const pending = api.resolve(id); account = 'second'; resolve({ data: { status: 'resolved', displayLocation: 'Old account' } }); await assert.rejects(pending, /ACCOUNT_CHANGED/)
})
test('cache bounded to 32 entries and unavailable responses are not cached', async () => {
  let count = 0; const client = { functions: { invoke: async () => { count++; return { data: { status: 'resolved', displayLocation: 'Place' } } } } }; const api = createProofLocationResolver(client, () => 'owner')
  for (let i = 0; i < 33; i++) await api.resolve(`${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`)
  await api.resolve('00000000-1111-4111-8111-111111111111'); assert.equal(count, 34)
  api.clear(); client.functions.invoke = async () => { count++; return { error: Error('private') } }; await api.resolve(id); await api.resolve(id); assert.equal(count, 36)
})

test('reactive account changes clear cache even across logout/login without a lookup', async () => {
  const { ref } = await import('vue'); const account = ref('owner'); let count = 0
  const client = { functions: { invoke: async () => { count++; return { data: { status: 'resolved', displayLocation: 'Place' } } } } }
  const api = createProofLocationResolver(client, () => account.value)
  await api.resolve(id); account.value = ''; account.value = 'owner'; await api.resolve(id); assert.equal(count, 2)
})

test('invalid JWT is rejected by verified-user adapter without provider access', async () => {
  const make = () => ({ auth: { getUser: async () => ({ data: { user: null }, error: Error('invalid') }) }, from() { assert.fail('unauthenticated database access') } })
  const { handler, calls } = fixture({ authorize: createProofAuthorizer(make, 'local', 'anon') }); assert.equal((await handler(request())).status, 403); assert.equal(calls.length, 0)
})
test('non-JSON provider result and malformed request are neutral without sensitive errors', async () => {
  const { handler } = fixture({ fetchProvider: async () => new Response('invalid provider content') }); assert.deepEqual(await (await handler(request())).json(), { status: 'unavailable' })
  assert.equal((await handler(new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer mocked-user' }, body: '{bad' }))).status, 400)
})
test('old same-account request cannot refill cache after logout/login', async () => {
  const { ref } = await import('vue'); const account = ref('owner'); let finish
  const client = { functions: { invoke: () => new Promise(r => { finish = r }) } }; const api = createProofLocationResolver(client, () => account.value)
  const pending = api.resolve(id); const oldFinish = finish; account.value = ''; account.value = 'owner'
  const next = api.resolve(id); oldFinish({ data: { status: 'resolved', displayLocation: 'stale' } }); await assert.rejects(pending, /ACCOUNT_CHANGED/)
  finish({ data: { status: 'resolved', displayLocation: 'current' } }); assert.equal((await next).displayLocation, 'current')
})
