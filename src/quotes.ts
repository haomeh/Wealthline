import type { WealthData } from './model'

// Turns what the user types ("2330", "AAPL", "BTC") into a market price and its currency,
// using the account's country to pick the exchange. Prices come from /api/quote.

export interface Quote {
  symbol: string // Yahoo symbol actually used, e.g. 2330.TW
  price: number
  currency: string
  name: string
}

const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'USDT', 'USDC', 'TRX', 'DOT', 'AVAX', 'LINK', 'TON', 'MATIC'])

// Candidate exchange symbols to try in order.
export function candidates(input: string, country: string, isCryptoAccount: boolean): string[] {
  const s = input.trim().toUpperCase()
  if (!s) return []
  if (s.includes('.') || s.includes('-') || s.includes('=')) return [s]
  if (CRYPTO.has(s) || isCryptoAccount) return [`${s}-USD`]
  if (/^\d{1,6}[A-Z]?$/.test(s)) {
    // Numeric codes are Asian listings: Taiwan (listed, then OTC), Hong Kong, Japan.
    // Yahoo lists Hong Kong codes below 10000 with exactly four digits (00700 -> 0700.HK).
    if (country === 'HK') return [/^\d{1,5}$/.test(s) ? `${String(Number(s)).padStart(4, '0')}.HK` : `${s}.HK`]
    if (country === 'JP') return [`${s}.T`]
    return [`${s}.TW`, `${s}.TWO`]
  }
  if (country === 'SG') return [`${s}.SI`, s]
  if (country === 'HK') return [`${s}.HK`, s]
  return [s]
}

export async function lookupQuote(input: string, country: string, isCryptoAccount: boolean): Promise<Quote | null> {
  for (const symbol of candidates(input, country, isCryptoAccount)) {
    const res = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`).catch(() => null)
    if (res?.ok) return (await res.json()) as Quote
  }
  return null
}

// Shown without the exchange suffix, the way the user typed it.
export const displaySymbol = (s: string) => s.replace(/\.(TW|TWO|SI|HK|T)$/, '').replace(/-USD$/, '')

// Fetches current prices for every holding that is not priced by hand.
export async function fetchHoldingQuotes(data: WealthData): Promise<{ quotes: Map<string, Quote>; failed: string[] }> {
  const quotes = new Map<string, Quote>()
  const failed: string[] = []
  const jobs = data.accounts.flatMap((a) =>
    a.positions
      .filter((p) => p.type === 'holding' && !p.priceManual && p.symbol)
      .map(async (p) => {
        const q = await lookupQuote(p.symbol, a.country, a.category.includes('加密'))
        if (q) quotes.set(p.id, q)
        else failed.push(displaySymbol(p.symbol))
      }),
  )
  await Promise.all(jobs)
  return { quotes, failed }
}

export function applyQuotes(data: WealthData, quotes: Map<string, Quote>, at: string): WealthData {
  return {
    ...data,
    accounts: data.accounts.map((a) => ({
      ...a,
      positions: a.positions.map((p) => {
        const q = quotes.get(p.id)
        // Skip positions the user switched to manual pricing while the lookup ran.
        return q && !p.priceManual ? { ...p, price: q.price, currency: q.currency, name: q.name, priceUpdatedAt: at } : p
      }),
    })),
  }
}
