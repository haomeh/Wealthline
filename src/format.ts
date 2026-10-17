export const fmt = (n: number, digits = 2) =>
  Number.isFinite(n) ? n.toLocaleString('zh-TW', { maximumFractionDigits: digits }) : '—'

export const pct = (share: number) => `${(share * 100).toFixed(2)}%`

// List amounts: two decimals when there are cents, none otherwise. The parts let a row keep
// the decimal point in one column (whole numbers leave the fraction slot empty).
const wholeAmount = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 })
const centsAmount = new Intl.NumberFormat('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export function amountParts(n: number): { whole: string; fraction: string } {
  if (!Number.isFinite(n)) return { whole: '—', fraction: '' }
  const value = Math.abs(n)
  const text = Math.round(value * 100) % 100 ? centsAmount.format(value) : wholeAmount.format(value)
  const dot = text.indexOf('.')
  return dot < 0 ? { whole: text, fraction: '' } : { whole: text.slice(0, dot), fraction: text.slice(dot) }
}
