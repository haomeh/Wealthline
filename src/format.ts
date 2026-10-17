export const fmt = (n: number, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString('zh-TW', { maximumFractionDigits: digits }) : '—'

export const pct = (share: number) => `${(share * 100).toFixed(2)}%`

// List amounts: each currency keeps one number of decimals, so a column of amounts lines up at
// the right edge and, within a currency, at the decimal point. TWD (also written NT$) and other
// currencies without cents in daily use show none, unless an amount does have cents.
const ZERO_DECIMAL = new Set(['TWD', 'NT$', 'JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF'])
export function currencyDecimals(currency: string): 0 | 2 {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2
}
const wholeAmount = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 })
const centsAmount = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
// `currency` left out: two decimals when there are cents, none otherwise.
export function amountParts(n: number, currency?: string): { whole: string; fraction: string } {
  if (!Number.isFinite(n)) return { whole: '—', fraction: '' }
  const value = Math.abs(n)
  const cents = Math.round(value * 100) % 100 !== 0
  const text = cents || (currency !== undefined && currencyDecimals(currency) === 2) ? centsAmount.format(value) : wholeAmount.format(value)
  const dot = text.indexOf('.')
  return dot < 0 ? { whole: text, fraction: '' } : { whole: text.slice(0, dot), fraction: text.slice(dot) }
}
// One list amount as text, such as 1,838.90 for SGD or 20,199 for TWD.
export const listAmount = (n: number, currency: string) => { const { whole, fraction } = amountParts(n, currency); return whole + fraction }
