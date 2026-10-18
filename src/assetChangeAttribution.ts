import type { HistoricalPoint } from './quantityHistory'
import { valuationKey, type ValuationEntry } from './valuationEvidence'

export interface AssetEffects { fx: number | null; price: number | null; quantity: number | null }
export interface AssetAttributionRow {
  key: string
  accountId: string
  account: string
  symbol: string
  currency: string
  before?: ValuationEntry
  after?: ValuationEntry
  change: 'matched' | 'added' | 'removed' | 'unknown'
  effects: AssetEffects
  reason?: string
}
export interface AssetAttribution {
  status: 'complete' | 'partial' | 'unknown'
  delta: number | null
  effects: AssetEffects
  residual: number | null
  unknownCount: number
  rows: AssetAttributionRow[]
}

const unknown = (): AssetEffects => ({ fx: null, price: null, quantity: null })
const zero = (): AssetEffects => ({ fx: 0, price: 0, quantity: 0 })
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-7, Math.max(Math.abs(a), Math.abs(b)) * 1e-12)
const known = (e: ValuationEntry): e is ValuationEntry & { quantity: number; price: number; rate: number } => e.quantity !== null && Number.isFinite(e.quantity) && e.price !== null && Number.isFinite(e.price) && e.price > 0 && e.rate !== null && Number.isFinite(e.rate) && e.rate > 0 && Number.isFinite(e.quantity * e.price * e.rate)
const ownEvidence = (p: HistoricalPoint) => !!p.valuation && p.valuation.version === 1 && p.valuation.baseCurrency === 'TWD' && p.valuation.at === p.at && !p.manual && !p.periodDerived && !p.filled?.length
const group = (entries: ValuationEntry[]) => {
  const groups = new Map<string, ValuationEntry[]>()
  for (const e of entries) groups.set(valuationKey(e), [...(groups.get(valuationKey(e)) ?? []), e])
  return groups
}

function reconciles(point: HistoricalPoint): boolean {
  if (!ownEvidence(point) || point.total === null) return false
  const entries = point.valuation!.entries
  if (entries.some(e => !known(e)) || new Set(entries.map(valuationKey)).size !== entries.length) return false
  if (new Set(point.accounts.map(a => a.id)).size !== point.accounts.length || entries.some(e => !point.accounts.some(a => a.id === e.accountId))) return false
  return point.accounts.every(a => a.value !== null && close(entries.filter(e => e.accountId === a.id).reduce((sum, e) => sum + e.quantity! * e.price! * e.rate!, 0), a.value)) && close(point.accounts.reduce((sum, a) => sum + (a.value ?? 0), 0), point.total)
}

// Decompose the exact displayed endpoints. No price/FX requests and no trade inference.
export function attributeAssetChange(before: HistoricalPoint, after: HistoricalPoint): AssetAttribution {
  const delta = before.total === null || after.total === null ? null : after.total - before.total
  const validBefore = ownEvidence(before), validAfter = ownEvidence(after)
  const bg = group(validBefore ? before.valuation!.entries : []), ag = group(validAfter ? after.valuation!.entries : [])
  const rows: AssetAttributionRow[] = []
  for (const key of new Set([...bg.keys(), ...ag.keys()])) {
    const bs = bg.get(key) ?? [], as = ag.get(key) ?? [], b = bs[0], a = as[0], e = a ?? b
    const row: AssetAttributionRow = { key, accountId: e.accountId, account: e.account, symbol: e.symbol, currency: e.currency, before: b, after: a, change: 'unknown', effects: unknown() }
    if (!validBefore || !validAfter) row.reason = '比較日期缺少相符的估值依據'
    else if (bs.length > 1 || as.length > 1) row.reason = '同一帳戶／標的／幣別的依據重複，尚無法拆解'
    else if ([b, a].some(x => x && !known(x))) row.reason = [b, a].some(x => x && (x.rate === null || !Number.isFinite(x.rate) || x.rate <= 0)) ? '缺少有效匯率，尚無法拆解' : '缺少有效數量或價格，尚無法拆解'
    else if (b && a && known(b) && known(a)) {
      row.change = 'matched'
      row.effects = { fx: b.quantity * b.price * (a.rate - b.rate), price: b.quantity * (a.price - b.price) * a.rate, quantity: (a.quantity - b.quantity) * a.price * a.rate }
    } else {
      row.change = a ? 'added' : 'removed'
      const endpoint = (a ?? b)!
      row.effects = { fx: 0, price: 0, quantity: (a ? 1 : -1) * endpoint.quantity! * endpoint.price! * endpoint.rate! }
    }
    if (Object.values(row.effects).some(v => v !== null && !Number.isFinite(v))) { row.change = 'unknown'; row.effects = unknown(); row.reason = '估值超出可計算範圍' }
    rows.push(row)
  }
  const knownRows = rows.filter(r => r.change !== 'unknown')
  const effects = knownRows.length ? knownRows.reduce<AssetEffects>((sum, r) => ({ fx: sum.fx! + r.effects.fx!, price: sum.price! + r.effects.price!, quantity: sum.quantity! + r.effects.quantity! }), zero()) : unknown()
  const explained = (effects.fx ?? 0) + (effects.price ?? 0) + (effects.quantity ?? 0)
  const residual = delta === null ? null : delta - explained
  const complete = validBefore && validAfter && rows.every(r => r.change !== 'unknown') && reconciles(before) && reconciles(after) && residual !== null && close(residual, 0)
  return { status: complete ? 'complete' : knownRows.length ? 'partial' : 'unknown', delta, effects: complete && !rows.length ? zero() : effects, residual, unknownCount: rows.filter(r => r.change === 'unknown').length, rows }
}
