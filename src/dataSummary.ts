// What the overview shows without reading the part files (dataParts.ts). The Drive main file
// stores one entry per part file; it is derived, so a missing, unreadable or outdated entry only
// means that part is read and its entry made again (driveStore.ts).
// - a transaction part: totals per currency and month of its card expenses and bank transactions;
// - an archived history year: the last snapshot of each month for the trend chart, and the edits
//   that carry holding quantities into the following years (holdingPeriods.ts).
// Each entry records which content it was made from:
// - hash: SHA-256 of the part's records in a fixed form (recordsHash), without the file header;
// - md5: Drive's MD5 checksum of the part file as this app last wrote it. Drive lists it without
//   downloading the file, so opening finds parts written since the entry was made (a save that
//   stopped before the main file, or another device) and reads only those;
// - fileId: the Drive file the entry was made from. Drive allows two files with the same part
//   name (two creates of one part); this says which one the main file was saved with.
// Transaction entries also depend on the category rules: `rules` is the hash of the rules they
// were counted with.

import { cashflowMonths, type CashflowMonthTotals } from './cashflow'
import { parseHistory, type Change, type Snapshot } from './history'
import type { PartContent } from './dataParts'
import type { BankCategoryRule, BankTransaction } from './bankTransactions'
import type { Expense, ExpenseCategoryRule } from './expenses'

export interface PartSummary {
  hash: string
  md5: string | null
  fileId?: string
  sequence: number
  cashflow?: CashflowMonthTotals[]
  points?: Snapshot[]
  carried?: Change[]
}

export interface DataSummary {
  rules?: string
  parts: Record<string, PartSummary>
}

export const emptySummary = (): DataSummary => ({ parts: {} })

export interface Rules {
  expenseCategoryRules?: ExpenseCategoryRule[]
  bankCategoryRules?: BankCategoryRule[]
}
export const rulesOf = (r: Rules) => [r.expenseCategoryRules ?? null, r.bankCategoryRules ?? null]

// The overview content of one part's records.
export function partSummary(name: string, content: PartContent, rules: Rules): Pick<PartSummary, 'cashflow' | 'points' | 'carried'> {
  if (name.startsWith('ledger-')) {
    return { cashflow: cashflowMonths({ expenses: content.expenses as unknown as Expense[], expenseRules: rules.expenseCategoryRules, bankTransactions: content.bankTransactions as unknown as BankTransaction[], bankRules: rules.bankCategoryRules }) }
  }
  return yearSummary(name.slice('history-'.length), content)
}

const instrument = (c: Change) => `${c.accountId}|${c.type}|${c.currency}|${c.type === 'cash' ? '' : c.symbol.toUpperCase()}`
const changesQuantity = (c: Change) => !c.before || !c.after || c.before.quantity !== c.after.quantity

// `content`: one archived year's history part.
function yearSummary(year: string, content: PartContent): Pick<PartSummary, 'points' | 'carried'> {
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

const isPartName = (name: string) => /^(?:ledger-\d{4}-Q[1-4]|history-\d{4})$/.test(name)

// Keeps the entries of a stored summary that are well formed; the rest is left out.
export function parseSummary(raw: unknown): DataSummary {
  const summary = emptySummary()
  if (!isObj(raw)) return summary
  if (typeof raw.rules === 'string') summary.rules = raw.rules
  if (!isObj(raw.parts)) return summary
  for (const [name, value] of Object.entries(raw.parts)) {
    if (!isPartName(name) || !isObj(value) || typeof value.hash !== 'string' || !(value.md5 === null || typeof value.md5 === 'string') || !Number.isInteger(value.sequence)) continue
    const base = { hash: value.hash, md5: value.md5 as string | null, ...(typeof value.fileId === 'string' && value.fileId && { fileId: value.fileId }), sequence: value.sequence as number }
    if (name.startsWith('ledger-')) {
      if (!Array.isArray(value.cashflow) || !value.cashflow.every(monthTotals)) continue
      summary.parts[name] = { ...base, cashflow: (value.cashflow as CashflowMonthTotals[]).map((m) => ({ ...m, coverage: { ...m.coverage, complete: false } })) }
      continue
    }
    try {
      const parsed = parseHistory({ snapshots: value.points, changes: value.carried, liabilityChanges: [] }, (why) => { throw new Error(why) })
      summary.parts[name] = { ...base, points: parsed.snapshots, carried: parsed.changes }
    } catch {
      // Unreadable: that part is read instead.
    }
  }
  return summary
}
