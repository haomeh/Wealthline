import type { CashflowEntry, CashflowSource } from './cashflowEntries'
import { reviewSourceKey, type MonthlyReview } from './monthlyReview'
import { cashflowFingerprint } from './cashflowFingerprint'

export interface MonthlyReviewState {
  status: 'unreviewed' | 'in-progress' | 'reviewed' | 'stale'
  currentMonth: boolean
  sources: { source: CashflowSource; count: number; unclassifiedCount: number; fingerprint: string; current: boolean }[]
}
export { reviewSourceKey }
// The status a report shows; an unfinished review reads as 未核對.
export const reviewStatusLabel = (state: MonthlyReviewState | null | undefined): string => state?.status === 'reviewed' ? (state.currentMonth ? '截至目前已核對' : '已人工核對') : state?.status === 'stale' ? '需重新核對' : '未核對'
export const isUnclassified = (entry: CashflowEntry): boolean => entry.classification === 'pending' || entry.category === '未分類'
export function reviewSources(entries: readonly CashflowEntry[], review: MonthlyReview): CashflowSource[] {
  const all = new Map<string, CashflowSource>()
  for (const source of [...review.expectedSources, ...entries.filter(e => e.date.startsWith(review.month + '-')).map(e => e.source)]) all.set(reviewSourceKey(source), source)
  return [...all].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, source]) => source)
}
// Binds the stable source fields and the final classification only: labels, rule evidence and
// derived amounts may change without the reviewed records changing.
export async function reviewFingerprint(entries: readonly CashflowEntry[], review: MonthlyReview, source: CashflowSource): Promise<string> {
  const key = reviewSourceKey(source)
  const rows = entries.filter(e => e.date.startsWith(review.month + '-') && reviewSourceKey(e.source) === key)
    .slice().sort((a, b) => a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0)
    .map(e => ({ recordId: e.recordId, date: e.date, description: e.description, amount: e.amount, currency: e.currency, direction: e.direction ?? null,
      classification: e.classification, category: e.category ?? null, exclusionReason: e.exclusionReason ?? null }))
  return cashflowFingerprint({ policyVersion: 1, month: review.month, source,
    expectations: review.expectedSources.map(reviewSourceKey).sort(), rows })
}
export async function monthlyReviewState(entries: readonly CashflowEntry[], review: MonthlyReview, today: string, bankLabels: Readonly<Record<string, string>>): Promise<MonthlyReviewState> {
  const expected = new Set(review.expectedSources.map(reviewSourceKey))
  const sources = await Promise.all(reviewSources(entries, review).map(async source => {
    const key = reviewSourceKey(source)
    const rows = entries.filter(e => e.date.startsWith(review.month + '-') && reviewSourceKey(e.source) === key)
    const unclassifiedCount = rows.filter(isUnclassified).length
    const fingerprint = await reviewFingerprint(entries, review, source)
    const confirmation = review.confirmations.find(c => reviewSourceKey(c.source) === key)
    const current = !!confirmation && expected.has(key) && confirmation.fingerprint === fingerprint
      && confirmation.decision === (rows.length ? 'reviewed' : 'no-activity')
      && (!unclassifiedCount || !!confirmation.exceptionNote?.trim())
      && (source.kind !== 'bank' || Object.hasOwn(bankLabels, source.accountId))
      && review.month <= today.slice(0, 7)
    return { source, count: rows.length, unclassifiedCount, fingerprint, current }
  }))
  const stale = review.confirmations.some(c => !sources.find(s => reviewSourceKey(s.source) === reviewSourceKey(c.source))?.current)
  const complete = expected.size > 0 && sources.every(s => s.current)
  return { status: complete ? 'reviewed' : stale ? 'stale' : review.confirmations.length ? 'in-progress' : 'unreviewed', currentMonth: review.month === today.slice(0, 7), sources }
}
