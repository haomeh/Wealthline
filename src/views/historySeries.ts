import { CATEGORIES } from '../model'
import { entryValue, instrumentKey, type HistoricalPoint, type QuantityEntry } from '../quantityHistory'
import type { Series } from './TrendChart'

export const MODES = { total: '總資產', account: '依帳戶', category: '依類別' }
export type Mode = keyof typeof MODES
const SLOTS = 8


// One line per entity in a fixed color slot; past the eighth, the rest fold into 其餘.
export function seriesFor(mode: Mode, points: HistoricalPoint[], accountNames: Map<string, string>): Series[] {
  if (mode === 'total') return [{ key: 'total', label: '總資產', color: 'var(--s1)', values: points.map((p) => p.total) }]

  const valueOf = (p: HistoricalPoint, key: string) =>
    p.total === null ? null : mode === 'account' ? (p.accounts.find((a) => a.id === key)?.value ?? 0) : (p.categories[key] ?? 0)
  const keys = new Set<string>()
  for (const p of points) for (const k of mode === 'account' ? p.accounts.map((a) => a.id) : Object.keys(p.categories)) keys.add(k)

  const latest = points[points.length - 1]
  // Categories keep the same colors as on the overview; the largest accounts today get their own.
  const order =
    mode === 'category'
      ? [...CATEGORIES, ...[...keys].filter((k) => !CATEGORIES.includes(k)).sort()]
      : [...keys].sort((a, b) => (valueOf(latest, b) ?? 0) - (valueOf(latest, a) ?? 0))
  const own = order.slice(0, SLOTS).filter((k) => keys.has(k))
  const rest = [...keys].filter((k) => !own.includes(k))
  const series: Series[] = own.map((k) => ({
    key: k,
    label: mode === 'account' ? (accountNames.get(k) ?? k) : k,
    color: `var(--s${order.indexOf(k) + 1})`,
    values: points.map((p) => valueOf(p, k)),
  }))
  if (rest.length) {
    series.push({
      key: '__rest',
      label: `其餘 ${rest.length} 個`,
      color: 'var(--other)',
      values: points.map((p) => p.total === null ? null : rest.reduce((s, k) => s + (valueOf(p, k) ?? 0), 0)),
    })
  }
  return series
}

// Where an account's value on this point comes from when the day did not record all of it (history.ts).
export function filledNote(point: HistoricalPoint, id: string): string {
  const f = point.filled?.find(x => x.id === id)
  if (!f) return ''
  const from = f.from === point.date ? '當天快照' : f.from?.replaceAll('-', '/')
  if (f.reason === 'partial') return from ? `部分項目沿用 ${from}` : '部分項目無紀錄，以 0 計'
  if (f.reason === 'no-quote') return `缺行情，沿用 ${from}`
  return from ? `沿用 ${from}` : '無紀錄，以 0 計'
}

// The earlier value the point's total uses for an entry the day leaves unknown (history.ts),
// so the entry row shows the same amount as its account instead of 估值未知.
export function carriedEntry(point: HistoricalPoint | undefined, entry: QuantityEntry): { value: number; note: string } | undefined {
  if (!point || entryValue(entry) !== null) return undefined
  const part = point.filled?.find(f => f.id === entry.accountId)?.parts?.find(p => p.key === instrumentKey(entry))
  if (!part) return undefined
  return { value: part.value, note: part.date === point.date ? '沿用當天快照' : `沿用 ${part.date.replaceAll('-', '/')}` }
}
