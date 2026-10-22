// Edge cache for the Yahoo proxy (Cloudflare Workers Cache API), so the number of upstream
// requests grows with the number of distinct tickers, not with the number of users.
// Only successful (200) answers are stored; errors and unknown tickers always go upstream.
import { DATE, SYMBOL, handleApiRequest } from './yahoo.ts'

// How long a stored answer is reused. Live quotes move; past closes change once a day.
export const EDGE_TTL_SECONDS = { quote: 180, history: 6 * 3600 }
// A reload (the client's "query again" button) skips a stored answer, but only once it is this old,
// so reload clicks cannot push more than a couple of requests a minute per ticker to Yahoo.
export const MIN_REFRESH_MS = 30_000
// What browsers are told on a cache hit (same as a fresh answer from handleApiRequest).
const BROWSER_MAX_AGE = { quote: 300, history: 3600 }

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

type Kind = 'quote' | 'history'
type Produce = (url: URL) => Promise<Response>
interface Stored { status: number; body: string; cacheControl: string }

// A lookup already running in this isolate, so a burst of identical requests asks Yahoo once.
const inflight = new Map<string, Promise<Stored>>()

const quarterStart = (date: string) => `${date.slice(0, 4)}-${String(Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`

// Normalizes the request into a cache key; null means "not cacheable" (the handler answers it itself).
function normalize(url: URL): { kind: Kind; url: URL } | null {
  const kind: Kind | null = url.pathname === '/api/quote' ? 'quote' : url.pathname === '/api/history' ? 'history' : null
  if (!kind) return null
  const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase()
  if (!SYMBOL.test(symbol)) return null
  const key = new URL(url.pathname, url.origin)
  key.searchParams.set('symbol', symbol)
  if (kind === 'history') {
    const from = url.searchParams.get('from') ?? ''
    if (!DATE.test(from)) return null
    // Asked from the first day of its quarter: the answer only gains a few older closes (the client
    // never shows days before its own start), and a ticker has a handful of cache keys instead of one
    // per day, so varying the date cannot turn every request into an upstream one.
    key.searchParams.set('from', quarterStart(from))
  }
  return { kind, url: key }
}

const json = (stored: Stored, cache: 'HIT' | 'MISS') =>
  new Response(stored.body, {
    status: stored.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': stored.cacheControl, 'X-Edge-Cache': cache },
  })

// True when the client asked for a fresh copy (fetch's `cache: 'no-cache'` sends max-age=0).
export function wantsFresh(headers: Headers | undefined): boolean {
  if (!headers) return false
  return /(^|,)\s*(no-cache|no-store|max-age=0)\s*(,|$)/i.test(headers.get('Cache-Control') ?? '') || /no-cache/i.test(headers.get('Pragma') ?? '')
}

export interface CachedApiOptions {
  waitUntil?: (p: Promise<unknown>) => void
  produce?: Produce
  headers?: Headers // the incoming request's, to honor explicit reloads
  now?: () => number
}

export async function cachedApiResponse(url: URL, cache: EdgeCache | undefined, options: CachedApiOptions = {}): Promise<Response> {
  const { waitUntil = () => {}, produce = handleApiRequest, headers, now = Date.now } = options
  const target = cache ? normalize(url) : null
  if (!cache || !target) return produce(url)
  const key = new Request(target.url)
  const hit = await cache.match(key).catch(() => undefined)
  if (hit?.ok) {
    const age = now() - (Number(hit.headers.get('X-Cached-At')) || 0)
    if (!wantsFresh(headers) || age < MIN_REFRESH_MS) {
      return json({ status: 200, body: await hit.text(), cacheControl: `public, max-age=${BROWSER_MAX_AGE[target.kind]}` }, 'HIT')
    }
  }
  const id = target.url.pathname + target.url.search
  let pending = inflight.get(id)
  if (!pending) {
    pending = (async () => {
      const res = await produce(target.url)
      const stored = { status: res.status, body: await res.text(), cacheControl: res.headers.get('Cache-Control') ?? 'no-store' }
      if (res.status === 200) {
        const copy = new Response(stored.body, {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${EDGE_TTL_SECONDS[target.kind]}`, 'X-Cached-At': String(now()) },
        })
        waitUntil(cache.put(key, copy).catch(() => {}))
      }
      return stored
    })().finally(() => inflight.delete(id))
    inflight.set(id, pending)
  }
  return json(await pending, 'MISS')
}
