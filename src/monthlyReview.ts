import type { CashflowSource } from './cashflowEntries'

export interface SourceReview {
  source: CashflowSource
  decision: 'reviewed' | 'no-activity'
  confirmedAt: string
  fingerprint: string
  exceptionNote?: string
}
export interface MonthlyReview {
  month: string
  expectedSources: CashflowSource[]
  confirmations: SourceReview[]
}

const fail = (): never => { throw new Error('每月核對資料無效') }
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
  return raw as Record<string, unknown>
}
function collection(raw: unknown, max: number): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) return fail()
  return Array.from(raw)
}
function source(raw: unknown): CashflowSource {
  const value = object(raw)
  if (value.kind === 'bank' && typeof value.accountId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.accountId)) {
    // Deleted accounts stay in the review history. State derivation marks them stale.
    return { kind: 'bank', accountId: value.accountId }
  }
  if (value.kind === 'card' && typeof value.card === 'string' && value.card.trim() && value.card.length <= 100) {
    // Exact saved labels are identities. Do not normalize or merge them here.
    return { kind: 'card', card: value.card }
  }
  return fail()
}
const sourceKey = (value: CashflowSource) => JSON.stringify(value.kind === 'bank' ? ['bank', value.accountId] : ['card', value.card])
function timestamp(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{3})?Z$/.test(raw) || raw.startsWith('0000')) return fail()
  const parsed = new Date(raw)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== (raw.length === 20 ? raw.slice(0, -1) + '.000Z' : raw)) return fail()
  return raw
}

// Allowlist only review metadata. The ledger is deliberately not consulted: stale history
// must survive changed scope, deleted accounts, and partially loaded Drive data.
export function parseMonthlyReviews(raw: unknown): MonthlyReview[] {
  const months = new Set<string>()
  return collection(raw, 1200).map(item => {
    const value = object(item)
    const month = value.month
    if (typeof month !== 'string' || !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000') || months.has(month)) return fail()
    months.add(month)
    const expected = new Set<string>()
    const expectedSources = collection(value.expectedSources, 200).map(item => {
      const ref = source(item), key = sourceKey(ref)
      if (expected.has(key)) return fail()
      expected.add(key)
      return ref
    })
    const confirmed = new Set<string>()
    const confirmations = collection(value.confirmations, 200).map((item): SourceReview => {
      const entry = object(item), ref = source(entry.source), key = sourceKey(ref)
      if (confirmed.has(key)) return fail()
      confirmed.add(key)
      if (entry.decision !== 'reviewed' && entry.decision !== 'no-activity') return fail()
      if (typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) return fail()
      if (entry.exceptionNote !== undefined && (typeof entry.exceptionNote !== 'string' || entry.exceptionNote.length > 500)) return fail()
      return { source: ref, decision: entry.decision, confirmedAt: timestamp(entry.confirmedAt), fingerprint: entry.fingerprint,
        ...(entry.exceptionNote !== undefined && { exceptionNote: entry.exceptionNote as string }) }
    })
    if (new Set([...expected, ...confirmed]).size > 200) return fail()
    return { month, expectedSources, confirmations }
  })
}
