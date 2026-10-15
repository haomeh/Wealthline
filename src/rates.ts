// Fetches current exchange rates to TWD from free public sources that allow browser requests.
// Fiat: open.er-api.com (ExchangeRate-API open access, updated daily).
// Stablecoins and crypto used as a currency: CoinGecko simple price.

import { BASE_CURRENCY } from './model'
import { CRYPTO_IDS } from './currencies'

const FIAT_URL = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`
// A failed request (offline, blocked) says so in words instead of the browser's "Failed to fetch".
const OFFLINE = '無法連線到匯率來源，請確認網路後再按「立即更新」。'
const get = (url: string) => fetch(url).catch(() => { throw new Error(OFFLINE) })

export interface FetchedRates {
  rates: Record<string, number> // TWD per 1 unit
  updatedAt: string
  unsupported: string[]
}

export async function fetchRates(currencies: string[]): Promise<FetchedRates> {
  const wanted = currencies.filter((c) => c !== BASE_CURRENCY)
  const rates: Record<string, number> = {}

  const fiat = wanted.filter((c) => !(c in CRYPTO_IDS))
  if (fiat.length) {
    const res = await get(FIAT_URL)
    if (!res.ok) throw new Error(`匯率來源暫時無法使用 (${res.status})`)
    // rates[X] is how many X one TWD buys, so TWD per X is its inverse.
    const body = (await res.json()) as { result: string; rates: Record<string, number> }
    if (body.result !== 'success') throw new Error('匯率來源回傳錯誤')
    for (const c of fiat) if (body.rates[c] > 0) rates[c] = 1 / body.rates[c]
  }

  const crypto = wanted.filter((c) => c in CRYPTO_IDS)
  if (crypto.length) {
    const ids = crypto.map((c) => CRYPTO_IDS[c]).join(',')
    const res = await get(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=twd`)
    if (res.ok) {
      const body = (await res.json()) as Record<string, { twd?: number }>
      for (const c of crypto) {
        const v = body[CRYPTO_IDS[c]]?.twd
        if (v && v > 0) rates[c] = v
      }
    }
  }

  return { rates, updatedAt: new Date().toISOString(), unsupported: wanted.filter((c) => !(c in rates)) }
}
