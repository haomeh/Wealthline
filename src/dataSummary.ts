// What the overview shows without reading the part files (dataParts.ts). The Drive main file
// stores it next to the data; it is derived, so a missing or unreadable summary only means the
// parts it stands for are read instead.
// - cashflow: totals per currency and month of all card expenses and bank transactions;
// - history: per archived year, the last snapshot of each month for the trend chart, and the
//   edits that carry holding quantities into the following years (holdingPeriods.ts).

import type { CashflowMonthTotals } from './cashflow'
import { parseHistory, type Change, type Snapshot } from './history'
import type { PartContent } from './dataParts'

export interface YearSummary {
  points: Snapshot[]
  carried: Change[]
}

export interface DataSummary {
  cashflow?: CashflowMonthTotals[]
  history: Record<string, YearSummary>
}

export const emptySummary = (): DataSummary => ({ history: {} })

const instrument = (c: Change) => `${c.accountId}|${c.type}|${c.currency}|${c.type === 'cash' ? '' : c.symbol.toUpperCase()}`
const changesQuantity = (c: Change) => !c.before || !c.after || c.before.quantity !== c.after.quantity

// `content`: one archived year's history part.
export function yearSummary(year: string, content: PartContent): YearSummary {
  const snapshots = (content.snapshots ?? []) as unknown as Snapshot[]
  const byMonth = new Map<string, Snapshot>()
  for (const s of snapshots) {
    const month = s.date.slice(0, 7)
    const seen = byMonth.get(month)
    if (!seen || s.date > seen.date) byMonth.set(month, s)
  }
  // The last quantity edit of each holding sets its quantity from then on. Edits of the year's
  // last UTC day can fall on the next year's first day in the user's time zone, where same-day
  // edits count too, so they are all kept.
  const changes = [...((content.changes ?? []) as unknown as Change[])].sort((a, b) => a.at.localeCompare(b.at))
  const last = new Map<string, Change>()
  for (const c of changes) if (changesQuantity(c)) last.set(instrument(c), c)
  const lastDay = `${year}-12-31`
  const carried = changes.filter((c) => last.get(instrument(c)) === c || c.at >= lastDay)
  return { points: [...byMonth.values()].sort((a, b) => a.date.localeCompare(b.date)), carried }
}

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const review = (v: unknown) => isObj(v) && ['count', 'debitCount', 'creditCount', 'debitAmount', 'creditAmount'].every((k) => isNum(v[k]))
const categories = (v: unknown) => Array.isArray(v) && v.every((c) => isObj(c) && typeof c.category === 'string' && isNum(c.count) && isNum(c.net))
function monthTotals(v: unknown): boolean {
  if (!isObj(v) || typeof v.currency !== 'string' || !/^[A-Z]{3}$/.test(v.currency) || typeof v.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.month)) return false
  const t = v.totals, c = v.coverage
  return isObj(t) && isNum(t.income) && isNum(t.consumption) && categories(t.incomeCategories) && categories(t.consumptionCategories) &&
    review(t.excluded) && review(t.pending) && Array.isArray(t.exclusions) && t.exclusions.every((e) => review(e) && typeof (e as Record<string, unknown>).reason === 'string') &&
    isObj(t.investmentRecovery) && isNum(t.investmentRecovery.count) && isNum(t.investmentRecovery.net) && typeof t.investmentRecovery.hasRecords === 'boolean' &&
    isObj(c) && isNum(c.cardCount) && isNum(c.bankCount) && isNum(c.recordCount)
}

// Keeps the parts of a stored summary that are well formed; the rest is left out.
export function parseSummary(raw: unknown): DataSummary {
  const summary = emptySummary()
  if (!isObj(raw)) return summary
  if (Array.isArray(raw.cashflow) && raw.cashflow.every(monthTotals)) {
    summary.cashflow = (raw.cashflow as CashflowMonthTotals[]).map((m) => ({ ...m, coverage: { ...m.coverage, complete: false } }))
  }
  if (isObj(raw.history)) {
    for (const [year, value] of Object.entries(raw.history)) {
      if (!/^\d{4}$/.test(year) || !isObj(value)) continue
      try {
        const parsed = parseHistory({ snapshots: value.points, changes: value.carried, liabilityChanges: [] }, (why) => { throw new Error(why) })
        summary.history[year] = { points: parsed.snapshots, carried: parsed.changes }
      } catch {
        // Unreadable: that year's part is read instead.
      }
    }
  }
  return summary
}
