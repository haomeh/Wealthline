import type { HistoricalPoint } from './quantityHistory'

export interface SnapshotAccountDelta { id: string; name: string; delta: number }
export interface SnapshotAccountChange {
  status: 'complete' | 'partial' | 'unknown'
  delta: number | null
  rows: SnapshotAccountDelta[]
  residual: number | null
  unknownIds: string[]
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-7, Math.max(Math.abs(a), Math.abs(b)) * 1e-12)
const groups = (point: HistoricalPoint) => {
  const result = new Map<string, HistoricalPoint['accounts']>()
  for (const account of point.accounts) result.set(account.id, [...(result.get(account.id) ?? []), account])
  return result
}
const recordedValue = (point: HistoricalPoint, id: string) => {
  if (!point.valuation) return true // Legacy snapshots still record explicit TWD account values.
  const entries = point.valuation.entries.filter(entry => entry.accountId === id)
  if (!entries.length) return point.accounts.find(account => account.id === id)?.value === 0
  return entries.every(entry => finite(entry.quantity) && finite(entry.price) && entry.price > 0 && finite(entry.rate) && entry.rate > 0 && finite(entry.quantity * entry.price * entry.rate))
}
const reconciles = (point: HistoricalPoint) => finite(point.total) && point.accounts.every(account => finite(account.value)) && close(point.accounts.reduce((sum, account) => sum + (account.value ?? 0), 0), point.total)

// An observed account-value comparison, not FX/price/quantity attribution.
// The caller keeps the exact-day/coverage gate. Absence is never an inferred zero.
export function compareSnapshotAccounts(before: HistoricalPoint, after: HistoricalPoint): SnapshotAccountChange {
  const difference = finite(before.total) && finite(after.total) ? after.total - before.total : null
  const delta = finite(difference) ? difference : null
  const bg = groups(before), ag = groups(after)
  const rows: SnapshotAccountDelta[] = [], unknownIds: string[] = []
  for (const id of new Set([...bg.keys(), ...ag.keys()])) {
    const bs = bg.get(id) ?? [], as = ag.get(id) ?? [], b = bs[0], a = as[0]
    if (bs.length !== 1 || as.length !== 1 || !finite(b.value) || !finite(a.value) || !recordedValue(before, id) || !recordedValue(after, id) || !finite(a.value - b.value)) {
      unknownIds.push(id)
      continue
    }
    rows.push({ id, name: a.name || b.name || id, delta: a.value - b.value })
  }
  const explained = rows.reduce((sum, row) => sum + row.delta, 0)
  const residual = delta !== null && finite(explained) && finite(delta - explained) ? delta - explained : null
  const complete = unknownIds.length === 0 && reconciles(before) && reconciles(after) && delta !== null && residual !== null && close(explained, delta)
  return { status: complete ? 'complete' : rows.length ? 'partial' : 'unknown', delta, rows, residual, unknownIds }
}
