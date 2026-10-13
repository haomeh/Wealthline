// Looks up a market price from Yahoo Finance's chart endpoint. Runs server-side only
// (Cloudflare Worker in production, Vite dev server locally) because Yahoo
// does not allow browser requests from other sites. No user data passes through here.

export interface Quote {
  symbol: string
  price: number
  currency: string
  name: string
}

export const SYMBOL = /^[A-Za-z0-9.\-=^]{1,24}$/

export async function yahooQuote(symbol: string): Promise<Quote | null> {
  if (!SYMBOL.test(symbol)) return null
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (wealthline quote lookup)' } })
  if (!res.ok) return null
  const body = (await res.json()) as {
    chart?: { result?: { meta?: { regularMarketPrice?: number; currency?: string; longName?: string; shortName?: string; symbol?: string } }[] }
  }
  const meta = body.chart?.result?.[0]?.meta
  if (!meta?.regularMarketPrice || !meta.currency) return null
  return {
    symbol: meta.symbol ?? symbol,
    price: meta.regularMarketPrice,
    currency: meta.currency.toUpperCase(),
    name: meta.longName ?? meta.shortName ?? symbol,
  }
}

export interface PriceHistory {
  symbol: string
  currency: string
  points: { date: string; close: number }[] // exchange-local YYYY-MM-DD, oldest first
  asTraded: true
  splits: { date: string; ratio: number }[]
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_YEARS = 10

// Yahoo closes are split-adjusted. Restore nominal historical per-share closes
// using all subsequent split events, so an actual historical share count is valid.
export async function yahooHistory(symbol: string, from: string): Promise<PriceHistory | null> {
  if (!SYMBOL.test(symbol) || !DATE.test(from)) return null
  const requested = Date.parse(`${from}T00:00:00Z`)
  if (!Number.isFinite(requested) || new Date(requested).toISOString().slice(0, 10) !== from || requested > Date.now() + 86400_000) return null
  // Older starts are cut to the last ten years: the answer simply has no older closes.
  const start = Math.max(requested, Date.now() - MAX_YEARS * 365 * 86400_000)
  const period1 = Math.floor(start / 1000) - 8 * 86400
  const period2 = Math.floor(Date.now() / 1000)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=splits`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (wealthline quote lookup)' } })
  if (!res.ok) { if(res.status===404) return null; throw new Error('history_provider_error') }
  const body = (await res.json()) as {
    chart?: {
      error?: {code?:string}
      result?: {
        meta?: { currency?: string; symbol?: string; gmtoffset?: number; exchangeTimezoneName?: string }
        timestamp?: number[]
        indicators?: { quote?: { close?: (number | null)[] }[] }
        events?: { splits?: Record<string, { date: number; numerator: number; denominator: number }> }
      }[]
    }
  }
  if(body.chart?.error) { if(body.chart.error.code==='Not Found') return null; throw new Error('history_provider_error') }
  const r = body.chart?.result?.[0]
  const closes = r?.indicators?.quote?.[0]?.close ?? []
  if(!r) { if(Array.isArray(body.chart?.result) && body.chart.result.length===0) return null; throw new Error('history_provider_error') }
  if (!r.meta?.currency || !Array.isArray(r.timestamp)) throw new Error('history_provider_error')
  const offset = r.meta.gmtoffset ?? 0
  const dateOf = (t: number) => r.meta?.exchangeTimezoneName
    ? new Intl.DateTimeFormat('en-CA', { timeZone: r.meta.exchangeTimezoneName, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t * 1000))
    : new Date((t + offset) * 1000).toISOString().slice(0, 10)
  const splits = Object.values(r.events?.splits ?? {}).map(s => ({ date: dateOf(s.date), ratio: s.numerator / s.denominator }))
  if (splits.some(s => !Number.isFinite(s.ratio) || s.ratio <= 0)) return null
  const byDate = new Map<string, number>()
  r.timestamp.forEach((t, i) => {
    const c = closes[i]
    const date = dateOf(t)
    if (date >= dateOf(Date.now() / 1000)) return // Today's daily candle is not a completed close.
    const factor = splits.filter(s => s.date > date).reduce((f,s) => f * s.ratio, 1)
    const close = typeof c === 'number' ? c * factor : NaN
    if (Number.isFinite(close) && close > 0) byDate.set(date, close)
  })
  return {
    asTraded: true,
    splits,
    symbol: r.meta.symbol ?? symbol,
    currency: r.meta.currency.toUpperCase(),
    points: [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// Shared by the Vite dev server and the Cloudflare Worker:
// GET /api/quote?symbol=AAPL → Quote JSON, GET /api/history?symbol=AAPL&from=2025-01-31 → PriceHistory JSON, or 404.
export const isApiPath = (path: string) => path === '/api/quote' || path === '/api/history'

export async function handleApiRequest(url: URL): Promise<Response> {
  const symbol = url.searchParams.get('symbol') ?? ''
  const history = url.pathname === '/api/history'
  let providerFailed=false
  const result = await (history ? yahooHistory(symbol, url.searchParams.get('from') ?? '') : yahooQuote(symbol)).catch(() => {providerFailed=history;return null})
  return new Response(JSON.stringify(result ?? { error: providerFailed ? 'provider_error' : 'not_found' }), {
    status: result ? 200 : providerFailed ? 502 : 404,
    // Past closes change only once a day.
    headers: { 'Content-Type': 'application/json', 'Cache-Control': providerFailed ? 'no-store' : `public, max-age=${history ? 3600 : 300}` },
  })
}
