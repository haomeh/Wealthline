import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'

let server, edge, worker
const originalFetch = globalThis.fetch
const originalCaches = globalThis.caches

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  edge = await server.ssrLoadModule('/server/edgeCache.ts')
  worker = (await server.ssrLoadModule('/worker/index.ts')).default
})
after(async () => {
  globalThis.fetch = originalFetch
  globalThis.caches = originalCaches
  await server.close()
})
beforeEach(() => { globalThis.fetch = originalFetch })

// A Cache API stand-in keyed by URL, remembering the Cache-Control it was given.
const fakeCache = () => {
  const store = new Map()
  return {
    store,
    async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined },
    async put(req, res) { store.set(req.url, res) },
  }
}
const quoteBody = { symbol: 'AAPL', price: 190, currency: 'USD', name: 'Apple' }
const producer = (status = 200, body = quoteBody) => {
  const calls = []
  const produce = async (url) => {
    calls.push(url.pathname + url.search)
    return new Response(JSON.stringify(status === 200 ? body : { error: 'x' }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': status === 502 ? 'no-store' : 'public, max-age=300' },
    })
  }
  return { calls, produce }
}
const get = (path) => new URL(`https://wealthline.example${path}`)

test('a second request for the same ticker is served from the edge cache', async () => {
  const cache = fakeCache()
  const { calls, produce } = producer()
  const first = await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce })
  assert.equal(first.headers.get('X-Edge-Cache'), 'MISS')
  const second = await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce })
  assert.equal(second.headers.get('X-Edge-Cache'), 'HIT')
  assert.deepEqual(await second.json(), quoteBody)
  assert.equal(second.headers.get('Cache-Control'), 'public, max-age=300')
  assert.equal(calls.length, 1)
})

test('stored answers carry the edge TTL: minutes for quotes, hours for past closes', async () => {
  const cache = fakeCache()
  const { produce } = producer(200, { symbol: 'AAPL', currency: 'USD', points: [], splits: [], asTraded: true })
  await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce })
  await edge.cachedApiResponse(get('/api/history?symbol=AAPL&from=2026-01-05'), cache, { produce })
  assert.equal(cache.store.get('https://wealthline.example/api/quote?symbol=AAPL').headers.get('Cache-Control'), `public, max-age=${edge.EDGE_TTL_SECONDS.quote}`)
  assert.equal(cache.store.get('https://wealthline.example/api/history?symbol=AAPL&from=2026-01-01').headers.get('Cache-Control'), `public, max-age=${edge.EDGE_TTL_SECONDS.history}`)
  assert.ok(edge.EDGE_TTL_SECONDS.quote <= 600 && edge.EDGE_TTL_SECONDS.history > edge.EDGE_TTL_SECONDS.quote)
})

test('ticker case does not create separate entries', async () => {
  const cache = fakeCache()
  const { calls, produce } = producer()
  await edge.cachedApiResponse(get('/api/quote?symbol=aapl'), cache, { produce })
  await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce })
  assert.deepEqual(calls, ['/api/quote?symbol=AAPL'])
})

test('history entries are keyed by ticker and the quarter of the start date, so varying the date cannot bypass the cache', async () => {
  const cache = fakeCache()
  const { calls, produce } = producer(200, { symbol: 'AAPL', currency: 'USD', points: [] })
  for (const from of ['2026-01-05', '2026-01-05', '2026-02-01', '2026-03-31', '2026-04-01', '2026-12-31']) await edge.cachedApiResponse(get(`/api/history?symbol=AAPL&from=${from}`), cache, { produce })
  assert.deepEqual(calls, ['/api/history?symbol=AAPL&from=2026-01-01', '/api/history?symbol=AAPL&from=2026-04-01', '/api/history?symbol=AAPL&from=2026-10-01'])
})

test('provider errors and unknown tickers are never stored', async () => {
  for (const status of [404, 502]) {
    const cache = fakeCache()
    const { calls, produce } = producer(status)
    const first = await edge.cachedApiResponse(get('/api/history?symbol=NOPE&from=2026-01-05'), cache, { produce })
    assert.equal(first.status, status)
    if (status === 502) assert.equal(first.headers.get('Cache-Control'), 'no-store')
    await edge.cachedApiResponse(get('/api/history?symbol=NOPE&from=2026-01-05'), cache, { produce })
    assert.equal(cache.store.size, 0)
    assert.equal(calls.length, 2)
  }
})

test('a recovered provider replaces an earlier failure on the next request', async () => {
  const cache = fakeCache()
  let fail = true
  const produce = async () => fail
    ? new Response('{"error":"provider_error"}', { status: 502, headers: { 'Cache-Control': 'no-store' } })
    : new Response(JSON.stringify(quoteBody), { headers: { 'Cache-Control': 'public, max-age=300' } })
  assert.equal((await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce })).status, 502)
  fail = false
  assert.equal((await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce })).status, 200)
  assert.equal((await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce })).headers.get('X-Edge-Cache'), 'HIT')
})

test('invalid symbols and dates bypass the cache and never create entries', async () => {
  const cache = fakeCache()
  const { calls, produce } = producer(404)
  for (const path of ['/api/quote?symbol=https://evil.example', '/api/quote', '/api/history?symbol=AAPL&from=yesterday']) {
    const res = await edge.cachedApiResponse(get(path), cache, { produce })
    assert.equal(res.headers.get('X-Edge-Cache'), null)
  }
  assert.equal(cache.store.size, 0)
  assert.equal(calls.length, 3)
})

test('a cache that throws never breaks the lookup', async () => {
  const cache = { match: async () => { throw new Error('cache down') }, put: async () => { throw new Error('cache down') } }
  const { produce } = producer()
  const res = await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { waitUntil: (p) => p, produce })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), quoteBody)
})

test('simultaneous requests for one ticker ask the provider once', async () => {
  const cache = fakeCache()
  const { calls, produce } = producer()
  const slow = async (url) => { await new Promise((r) => setTimeout(r, 10)); return produce(url) }
  const all = await Promise.all(Array.from({ length: 5 }, () => edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce: slow })))
  assert.equal(calls.length, 1)
  for (const r of all) assert.deepEqual(await r.json(), quoteBody)
})

test('without a Cache API the proxy answers directly, as in dev', async () => {
  const { calls, produce } = producer()
  for (let i = 0; i < 2; i++) await edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), undefined, { produce })
  assert.equal(calls.length, 2)
})

test('the Worker caches Yahoo answers at the edge and keeps its security headers', async () => {
  const cache = fakeCache()
  globalThis.caches = { default: cache }
  let upstream = 0
  globalThis.fetch = async () => {
    upstream++
    return Response.json({ chart: { result: [{ meta: { regularMarketPrice: 190, currency: 'usd', symbol: 'AAPL', longName: 'Apple' } }] } })
  }
  const pending = []
  const ctx = { waitUntil: (p) => pending.push(p) }
  const first = await worker.fetch(new Request('https://wealthline.example/api/quote?symbol=AAPL'), {}, ctx)
  await Promise.all(pending)
  const second = await worker.fetch(new Request('https://wealthline.example/api/quote?symbol=aapl'), {}, ctx)
  assert.equal(upstream, 1)
  assert.deepEqual(await first.json(), await second.json())
  assert.equal(second.headers.get('X-Edge-Cache'), 'HIT')
  assert.equal(second.headers.get('X-Robots-Tag'), 'noindex')
  assert.ok(second.headers.get('Content-Security-Policy'))
})

test('an explicit reload skips an old stored answer, refreshes it, and is rate-limited', async () => {
  const cache = fakeCache()
  let price = 190
  let calls = 0
  const produce = async () => { calls++; return new Response(JSON.stringify({ ...quoteBody, price }), { headers: { 'Cache-Control': 'public, max-age=300' } }) }
  let clock = 1_000_000
  const now = () => clock
  const reload = new Headers({ 'Cache-Control': 'max-age=0' })
  const ask = (headers) => edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce, headers, now })
  await ask()
  price = 191
  // Too soon after storing: the reload is answered from the edge copy.
  clock += edge.MIN_REFRESH_MS - 1
  assert.equal((await (await ask(reload)).json()).price, 190)
  assert.equal(calls, 1)
  // Old enough: it goes to Yahoo and the stored copy is replaced for everyone.
  clock += 2
  const fresh = await ask(reload)
  assert.equal(fresh.headers.get('X-Edge-Cache'), 'MISS')
  assert.equal((await fresh.json()).price, 191)
  assert.equal(calls, 2)
  assert.equal((await (await ask()).json()).price, 191)
  assert.equal(calls, 2)
})

test('reload directives are recognised, ordinary requests are not', () => {
  const h = (init) => new Headers(init)
  for (const init of [{ 'Cache-Control': 'no-cache' }, { 'Cache-Control': 'max-age=0' }, { 'Cache-Control': 'no-store' }, { 'Pragma': 'no-cache' }, { 'Cache-Control': 'public, MAX-AGE=0' }]) assert.equal(edge.wantsFresh(h(init)), true, JSON.stringify(init))
  for (const init of [{}, { 'Cache-Control': 'max-age=300' }, { 'Cache-Control': 'max-age=0123' }]) assert.equal(edge.wantsFresh(h(init)), false, JSON.stringify(init))
  assert.equal(edge.wantsFresh(undefined), false)
})

test('a failed reload does not replace a good stored answer', async () => {
  const cache = fakeCache()
  let ok = true
  const produce = async () => ok ? new Response(JSON.stringify(quoteBody), { headers: { 'Cache-Control': 'public, max-age=300' } }) : new Response('{"error":"provider_error"}', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  let clock = 0
  const ask = (headers) => edge.cachedApiResponse(get('/api/quote?symbol=AAPL'), cache, { produce, headers, now: () => clock })
  await ask()
  ok = false
  clock += edge.MIN_REFRESH_MS + 1
  assert.equal((await ask(new Headers({ 'Cache-Control': 'no-cache' }))).status, 502)
  assert.deepEqual(await (await ask()).json(), quoteBody)
})

test('the privacy policy discloses the edge cache in both languages', () => {
  const legal = readFileSync('src/views/Legal.tsx', 'utf8')
  assert.match(legal, /邊緣快取/)
  assert.match(legal, /edge cache/)
  assert.doesNotMatch(legal, /does not persist request contents|持久化紀錄/)
})
