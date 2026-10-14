import type { CashflowEntry, CashflowSource } from './cashflowEntries'
import type { MonthlyReview } from './monthlyReview'
import { cashflowFingerprint } from './cashflowFingerprint'

export interface MonthlyReviewState {
  status: 'unreviewed' | 'in-progress' | 'reviewed' | 'stale'
  currentMonth: boolean
  sources: { source: CashflowSource; count: number; unclassifiedCount: number; fingerprint: string; current: boolean }[]
}
export const reviewSourceKey = (source: CashflowSource): string => JSON.stringify(source.kind === 'bank' ? ['bank', source.accountId] : ['card', source.card])
export const isUnclassified = (entry: CashflowEntry): boolean => entry.classification === 'pending' || entry.category === '未分類'
export function reviewSources(entries: readonly CashflowEntry[], review: MonthlyReview): CashflowSource[] {
  const all = new Map<string, CashflowSource>()
  for (const source of [...review.expectedSources, ...entries.filter(e => e.date.startsWith(review.month + '-')).map(e => e.source)]) all.set(reviewSourceKey(source), source)
  return [...all].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, source]) => source)
}
export async function reviewFingerprint(entries: readonly CashflowEntry[], review: MonthlyReview, source: CashflowSource, bankLabels: Readonly<Record<string, string>>): Promise<string> {
  const key = reviewSourceKey(source)
  const rows = entries.filter(e => e.date.startsWith(review.month + '-') && reviewSourceKey(e.source) === key)
    .slice().sort((a, b) => a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0)
  return cashflowFingerprint({ policyVersion: 1, month: review.month, source,
    label: source.kind === 'card' ? source.card : bankLabels[source.accountId] ?? null,
    expectations: review.expectedSources.map(reviewSourceKey).sort(), rows })
}
export async function monthlyReviewState(entries: readonly CashflowEntry[], review: MonthlyReview, today: string, bankLabels: Readonly<Record<string, string>>): Promise<MonthlyReviewState> {
  const expected = new Set(review.expectedSources.map(reviewSourceKey))
  const sources = await Promise.all(reviewSources(entries, review).map(async source => {
    const key = reviewSourceKey(source)
    const rows = entries.filter(e => e.date.startsWith(review.month + '-') && reviewSourceKey(e.source) === key)
    const unclassifiedCount = rows.filter(isUnclassified).length
    const fingerprint = await reviewFingerprint(entries, review, source, bankLabels)
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
