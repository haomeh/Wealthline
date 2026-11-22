import { expandPeriodDays, resolveCompletion } from './holdingPeriods'
import { localDate, type Snapshot } from './history'
import { accountBaseValue, accountLabel, type Account, type AccountKind, type Position, type WealthData } from './model'
import { instrumentKey, isUnrecordedPartialDay, type QuantityDay, type QuantityEntry } from './quantityHistory'
import { displaySymbol } from './quotes'
import type { ValuationEntry } from './valuationEvidence'

export type AccountNodeStatus =
  | 'recorded'
  | 'confirmed-absent'
  | 'partial'
  | 'carried'
  | 'missing-zero'
  | 'no-quote'

export type TimeNodeSource =
  | 'snapshot'
  | 'statement'
  | 'inventory'
  | 'completion'
  | 'manual'
  | 'period'
  | 'period-omitted'

export interface CoverageAccount {
  id: string
  name: string
  country: string
  label: string
  kind?: AccountKind
  category: string
  isCurrent: boolean
  referenceValue: number | null
  lastSeenDate: string | null
}

export interface AccountCoverageCell {
  account: CoverageAccount
  status: AccountNodeStatus
  carriedFrom?: string | null
  missingItems?: string[]
  recordedValue?: number | null
}

export interface TimeNodeCoverage {
  date: string
  month: string
  source: TimeNodeSource
  recordedTotal: number | null
  expectedCount: number
  recordedCount: number
  cells: AccountCoverageCell[]
  missingZero: AccountCoverageCell[]
  partial: AccountCoverageCell[]
  carried: AccountCoverageCell[]
  noQuote: AccountCoverageCell[]
  hasGaps: boolean
  hasZeroImpact: boolean
  estimatedMissingTotal: number
}

export interface MonthCoverage {
  month: string
  nodes: TimeNodeCoverage[]
  latest: TimeNodeCoverage
  expectedCount: number
  recordedCount: number
  missingZero: AccountCoverageCell[]
  partial: AccountCoverageCell[]
  carried: AccountCoverageCell[]
  noQuote: AccountCoverageCell[]
  hasMonthGaps: boolean
  nodeGapCount: number
  estimatedMissingTotal: number
}

export interface AccountCoverageReport {
  accounts: CoverageAccount[]
  nodes: TimeNodeCoverage[]
  months: MonthCoverage[]
  gapNodeCount: number
  gapMonthCount: number
  periodError?: string
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const dedupe = (items: string[]) => [...new Set(items)]

const itemLabel = (item: Pick<QuantityEntry | ValuationEntry, 'type' | 'symbol' | 'currency'>) =>
  item.type === 'cash' ? `${item.currency} 現金` : `${displaySymbol(item.symbol)} (${item.currency})`

const positionLabel = (position: Position) =>
  position.type === 'cash' ? `${position.currency} 現金` : `${displaySymbol(position.symbol)} (${position.currency})`

const positionInstrumentKey = (account: Account, position: Position) =>
  instrumentKey({ accountId: account.id, type: position.type, symbol: position.type === 'cash' ? '' : position.symbol.toUpperCase(), currency: position.currency })

const byImpactDesc = (a: AccountCoverageCell, b: AccountCoverageCell) =>
  (b.account.referenceValue ?? -1) - (a.account.referenceValue ?? -1) || a.account.label.localeCompare(b.account.label)

const sumReference = (cells: readonly AccountCoverageCell[]) =>
  cells.reduce((sum, cell) => sum + (cell.account.referenceValue && cell.account.referenceValue > 0 ? cell.account.referenceValue : 0), 0)

function collectAccounts(data: WealthData): { accounts: CoverageAccount[]; currentById: Map<string, Account> } {
  const currentById = new Map(data.accounts.map((a) => [a.id, a]))
  const historicalIds = new Set<string>()
  const meta = new Map<string, { name: string; country: string; category: string; lastSeenDate: string | null; snapshotValue: number | null; snapshotDate: string }>()

  const touch = (id: string, name: string, country: string, category: string, date?: string, snapshotValue?: number) => {
    historicalIds.add(id)
    const prev = meta.get(id)
    const nextDate = date && (!prev?.lastSeenDate || date > prev.lastSeenDate) ? date : prev?.lastSeenDate ?? null
    const takeSnap = snapshotValue !== undefined && finite(snapshotValue) && date && (!prev?.snapshotDate || date >= prev.snapshotDate)
    meta.set(id, {
      name: name || prev?.name || id,
      country: country || prev?.country || '',
      category: category || prev?.category || '未分類',
      lastSeenDate: nextDate,
      snapshotValue: takeSnap ? snapshotValue : prev?.snapshotValue ?? null,
      snapshotDate: takeSnap ? date : prev?.snapshotDate ?? '',
    })
  }

  for (const s of data.history.snapshots) {
    for (const a of s.accounts) touch(a.id, a.name, '', '', s.date, a.value)
  }
  for (const d of data.history.quantityDays ?? []) {
    for (const a of [...(d.inventory?.accounts ?? []), ...(d.completion?.accounts ?? [])]) touch(a.id, a.name, '', '', d.date)
    for (const e of [...d.entries, ...(d.completion?.entries ?? [])]) touch(e.accountId, e.account, e.country, e.category, d.date)
  }
  for (const p of data.history.holdingPeriods ?? []) {
    touch(p.accountId, p.account, p.country, p.category, p.end ?? p.start)
  }

  const list: CoverageAccount[] = []
  for (const a of data.accounts) {
    // Skip brand-new empty shell accounts with no positions and no historical presence.
    if (!a.positions.length && !historicalIds.has(a.id)) continue
    const value = accountBaseValue(data, a)
    list.push({
      id: a.id,
      name: a.name,
      country: a.country,
      label: accountLabel(a),
      kind: a.kind,
      category: a.category,
      isCurrent: true,
      referenceValue: finite(value) ? value : null,
      lastSeenDate: null,
    })
  }
  for (const [id, info] of meta) {
    if (currentById.has(id)) continue
    list.push({
      id,
      name: info.name,
      country: info.country,
      label: accountLabel({ name: info.name, country: info.country }),
      category: info.category,
      isCurrent: false,
      referenceValue: info.snapshotValue,
      lastSeenDate: info.lastSeenDate,
    })
  }

  list.sort((a, b) => (b.referenceValue ?? -1) - (a.referenceValue ?? -1) || a.label.localeCompare(b.label))
  return { accounts: list, currentById }
}

function unvaluedSnapshotItems(snapshot: Snapshot, accountId: string): string[] {
  if (!snapshot.valuation) return []
  const bad = snapshot.valuation.entries.filter(
    (e) => e.accountId === accountId && e.quantity !== 0 && (e.quantity === null || e.price === null || e.rate === null),
  )
  return dedupe(bad.map(itemLabel))
}

function expandForCoverage(data: WealthData, now: string): { days: QuantityDay[]; error?: string } {
  try {
    return { days: expandPeriodDays(data, now) }
  } catch (e) {
    // Fallback to raw quantityDays (with completions resolved) when period expansion exceeds the row cap.
    const days = (data.history.quantityDays ?? []).map((d) => resolveCompletion(data, d))
    return { days, error: e instanceof Error ? e.message : '無法展開持有期間' }
  }
}

/**
 * Inspect every historical time node (snapshots, bank statement dates, manual backfills, and
 * holding periods) to report exactly which accounts are missing, partial, carried forward, or
 * lacking quotes at each date and each calendar month.
 */
export function accountCoverage(data: WealthData, now: string): AccountCoverageReport {
  const today = localDate(now)
  const { accounts, currentById } = collectAccounts(data)
  if (!accounts.length) return { accounts: [], nodes: [], months: [], gapNodeCount: 0, gapMonthCount: 0 }

  const allSnapshotsByDate = new Map<string, Snapshot>(data.history.snapshots.map((s) => [s.date, s]))
  const rawDaysByDate = new Map<string, QuantityDay>((data.history.quantityDays ?? []).map((d) => [d.date, d]))
  const statementDates = new Set((data.bankStatementBalances ?? []).map((b) => b.date))
  const { days: expandedDays, error: periodError } = expandForCoverage(data, now)
  const expandedByDate = new Map<string, QuantityDay>(expandedDays.map((d) => [d.date, d]))

  const dateSet = new Set<string>()
  for (const s of data.history.snapshots) if (s.date < today) dateSet.add(s.date)
  for (const d of expandedDays) if (d.date < today || rawDaysByDate.has(d.date)) dateSet.add(d.date)
  const dates = [...dateSet].sort((a, b) => a.localeCompare(b))
  if (!dates.length) return { accounts, nodes: [], months: [], gapNodeCount: 0, gapMonthCount: 0, ...(periodError && { periodError }) }

  const lastRecordedDate = new Map<string, string>()
  const chronologicalNodes: TimeNodeCoverage[] = []

  for (const date of dates) {
    const rawDay = rawDaysByDate.get(date)
    const day = expandedByDate.get(date)
    const snap = allSnapshotsByDate.get(date)
    const source: TimeNodeSource = rawDay
      ? rawDay.inventory
        ? 'inventory'
        : rawDay.completion
          ? 'completion'
          : statementDates.has(date)
            ? 'statement'
            : 'manual'
      : snap
        ? 'snapshot'
        : day && isUnrecordedPartialDay(day)
          ? 'period-omitted'
          : 'period'

    const expected = accounts.filter((acc) => acc.isCurrent || (acc.lastSeenDate !== null && date <= acc.lastSeenDate))
    const cells: AccountCoverageCell[] = []

    for (const acc of expected) {
      const currentAccount = currentById.get(acc.id)
      const currentPositions = currentAccount?.positions ?? []

      if (day && (rawDay || !snap)) {
        if (day.inventory) {
          if (!day.inventory.accounts.some((a) => a.id === acc.id)) {
            cells.push({ account: acc, status: 'confirmed-absent' })
            continue
          }
          const entries = day.entries.filter((e) => e.accountId === acc.id)
          const unknown = entries.filter((e) => e.quantity === null)
          const errored = entries.filter((e) => e.quantity !== null && e.quantity !== 0 && !!e.error)
          if (unknown.length && unknown.length === entries.length) cells.push({ account: acc, status: 'missing-zero', carriedFrom: null })
          else if (unknown.length) cells.push({ account: acc, status: 'partial', missingItems: dedupe(unknown.map(itemLabel)) })
          else if (errored.length) cells.push({ account: acc, status: 'no-quote', missingItems: dedupe(errored.map(itemLabel)) })
          else cells.push({ account: acc, status: 'recorded' })
          continue
        }

        const entries = day.entries.filter((e) => e.accountId === acc.id)
        const seenKeys = new Set(entries.map(instrumentKey))
        const coveredByCompletion = !!day.completion && day.completion.accounts.some((a) => a.id === acc.id)
        const extraMissing = coveredByCompletion
          ? []
          : currentPositions.filter((p) => !seenKeys.has(positionInstrumentKey(currentAccount!, p))).map(positionLabel)

        const known = entries.filter((e) => e.quantity !== null)
        const unknown = entries.filter((e) => e.quantity === null)
        const missingItems = dedupe([...unknown.map(itemLabel), ...extraMissing])
        const snapAccount = snap?.accounts.find((a) => a.id === acc.id)

        if (known.length === 0) {
          if (snapAccount !== undefined) {
            const bad = unvaluedSnapshotItems(snap!, acc.id)
            cells.push(
              bad.length
                ? { account: acc, status: 'no-quote', missingItems: bad, recordedValue: snapAccount.value }
                : { account: acc, status: 'recorded', recordedValue: snapAccount.value },
            )
          } else if (source === 'period-omitted') {
            cells.push({ account: acc, status: 'missing-zero', carriedFrom: null })
          } else {
            const prior = lastRecordedDate.get(acc.id) ?? null
            cells.push(prior ? { account: acc, status: 'carried', carriedFrom: prior } : { account: acc, status: 'missing-zero', carriedFrom: null })
          }
        } else if (missingItems.length > 0) {
          cells.push({ account: acc, status: 'partial', missingItems, carriedFrom: lastRecordedDate.get(acc.id) ?? null })
        } else {
          const errored = known.filter((e) => e.quantity !== 0 && !!e.error)
          cells.push(errored.length ? { account: acc, status: 'no-quote', missingItems: dedupe(errored.map(itemLabel)) } : { account: acc, status: 'recorded' })
        }
      } else if (snap) {
        const snapAccount = snap.accounts.find((a) => a.id === acc.id)
        if (!snapAccount) {
          cells.push({ account: acc, status: 'missing-zero', carriedFrom: null })
        } else {
          const bad = unvaluedSnapshotItems(snap, acc.id)
          cells.push(
            bad.length
              ? { account: acc, status: 'no-quote', missingItems: bad, recordedValue: snapAccount.value }
              : { account: acc, status: 'recorded', recordedValue: snapAccount.value },
          )
        }
      }
    }

    if (source !== 'period-omitted') {
      for (const cell of cells) {
        if (cell.status === 'recorded' || cell.status === 'partial' || cell.status === 'no-quote') {
          lastRecordedDate.set(cell.account.id, date)
        }
      }
    }

    const missingZero = cells.filter((c) => c.status === 'missing-zero').sort(byImpactDesc)
    const partial = cells.filter((c) => c.status === 'partial').sort(byImpactDesc)
    const carried = cells.filter((c) => c.status === 'carried').sort(byImpactDesc)
    const noQuote = cells.filter((c) => c.status === 'no-quote').sort(byImpactDesc)
    const recordedCount = cells.filter((c) => c.status === 'recorded' || c.status === 'confirmed-absent').length

    chronologicalNodes.push({
      date,
      month: date.slice(0, 7),
      source,
      recordedTotal: !rawDay && snap ? snap.total : null,
      expectedCount: cells.length,
      recordedCount,
      cells,
      missingZero,
      partial,
      carried,
      noQuote,
      hasGaps: missingZero.length + partial.length + carried.length + noQuote.length > 0,
      hasZeroImpact: missingZero.length > 0 || partial.length > 0,
      estimatedMissingTotal: sumReference(missingZero),
    })
  }

  const byMonth = new Map<string, TimeNodeCoverage[]>()
  for (const node of chronologicalNodes) {
    byMonth.set(node.month, [...(byMonth.get(node.month) ?? []), node])
  }

  const months: MonthCoverage[] = [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, monthNodes]) => {
      const latest = monthNodes[monthNodes.length - 1]
      const accountMap = new Map<string, CoverageAccount>()
      for (const node of monthNodes) for (const cell of node.cells) accountMap.set(cell.account.id, cell.account)
      const monthCells: AccountCoverageCell[] = []

      for (const acc of accountMap.values()) {
        const accCells = monthNodes.flatMap((n) => n.cells.filter((c) => c.account.id === acc.id))
        const latestCell = latest.cells.find((c) => c.account.id === acc.id)
        if (!latestCell) continue

        if (latestCell.status === 'confirmed-absent' && !accCells.some((c) => c.status === 'recorded')) {
          monthCells.push(latestCell)
        } else if (latestCell.status === 'missing-zero') {
          monthCells.push(latestCell)
        } else if (accCells.some((c) => c.status === 'recorded')) {
          monthCells.push({ account: acc, status: 'recorded', recordedValue: latestCell.recordedValue })
        } else if (accCells.some((c) => c.status === 'partial')) {
          const latestPartial = [...accCells].reverse().find((c) => c.status === 'partial')!
          monthCells.push(latestPartial)
        } else if (accCells.some((c) => c.status === 'no-quote')) {
          const latestNoQuote = [...accCells].reverse().find((c) => c.status === 'no-quote')!
          monthCells.push(latestNoQuote)
        } else {
          monthCells.push(latestCell)
        }
      }

      const missingZero = monthCells.filter((c) => c.status === 'missing-zero').sort(byImpactDesc)
      const partial = monthCells.filter((c) => c.status === 'partial').sort(byImpactDesc)
      const carried = monthCells.filter((c) => c.status === 'carried').sort(byImpactDesc)
      const noQuote = monthCells.filter((c) => c.status === 'no-quote').sort(byImpactDesc)
      const recordedCount = monthCells.filter((c) => c.status === 'recorded' || c.status === 'confirmed-absent').length
      const nodeGapCount = monthNodes.filter((n) => n.hasGaps).length

      return {
        month,
        nodes: [...monthNodes].reverse(),
        latest,
        expectedCount: monthCells.length,
        recordedCount,
        missingZero,
        partial,
        carried,
        noQuote,
        hasMonthGaps: missingZero.length + partial.length + carried.length + noQuote.length > 0,
        nodeGapCount,
        estimatedMissingTotal: sumReference(missingZero),
      }
    })

  const nodes = [...chronologicalNodes].reverse()
  return {
    accounts,
    nodes,
    months,
    gapNodeCount: nodes.filter((n) => n.hasGaps).length,
    gapMonthCount: months.filter((m) => m.hasMonthGaps).length,
    ...(periodError && { periodError }),
  }
}
