import { useEffect, useMemo, useState } from 'react'
import { monthsInPeriod, type CashflowCurrencySummary } from '../cashflow'
import { cashflowEntries } from '../cashflowEntries'
import type { CashflowPeriodState } from '../cashflowPeriod'
import type { LedgerReadiness } from '../cashflowQuery'
import type { WealthData } from '../model'
import { monthlyReviewState, reviewStatusLabel, type MonthlyReviewState } from '../monthlyReviewState'

// The identity is replaced during render before asynchronous fingerprints can resolve.
// Cached summaries cannot stand in for the rows used by the review policy.
function useCashflowStatus(data: WealthData | undefined, readiness: LedgerReadiness, period: CashflowPeriodState) {
  const { endMonth, period: range, today } = period
  const evidence = useMemo(() => {
    if (!data || readiness !== 'ready') return null
    try {
      const entries = cashflowEntries({ expenses: data.expenses, expenseRules: data.expenseCategoryRules, bankTransactions: data.bankTransactions, bankRules: data.bankCategoryRules })
      const scope = range === 'all' ? null : new Set(monthsInPeriod(endMonth, range))
      const rows = entries.filter(entry => !scope || scope.has(entry.date.slice(0, 7)))
      const recorded = [...new Set(rows.map(entry => entry.date.slice(0, 7)))].sort()
      const months = range === 1 ? [endMonth] : recorded
      const labels = Object.fromEntries((data.bankTransactionAccounts ?? []).map(account => [account.id, account.label]))
      return { entries, rows, recorded, months, labels }
    } catch { return { error: true as const } }
  }, [data, readiness, endMonth, range])
  const request = useMemo(() => ({ data, evidence, today }), [data, evidence, today])
  const [result, setResult] = useState<{ request: typeof request; states?: MonthlyReviewState[]; error?: boolean }>()
  useEffect(() => {
    if (!data || !evidence || 'error' in evidence) return
    let active = true
    void Promise.all(evidence.months.map(month => monthlyReviewState(evidence.entries,
      data.monthlyReviews?.find(review => review.month === month) ?? { month, expectedSources: [], confirmations: [] }, today, evidence.labels)))
      .then(states => { if (active) setResult({ request, states }) }, () => { if (active) setResult({ request, error: true }) })
    return () => { active = false }
  }, [data, evidence, today, request])
  const current = result?.request === request ? result : undefined
  return { evidence: evidence && !('error' in evidence) ? evidence : undefined,
    states: current?.states, error: !!(evidence && 'error' in evidence) || !!current?.error }
}

export function CashflowDataStatus({ data, readiness, period, group, reliableTotals, onReview }: {
  data?: WealthData; readiness: LedgerReadiness; period: CashflowPeriodState
  group?: CashflowCurrencySummary; reliableTotals: boolean; onReview: () => void
}) {
  const { evidence, states, error } = useCashflowStatus(data, readiness, period)
  const month = period.period === 1
  const state = month ? states?.[0] : undefined
  const currentMonth = period.today.slice(0, 7)
  const unavailable = !data || readiness !== 'ready'
  const status = unavailable ? readiness === 'error' ? '明細載入失敗／核對狀態待確認' : '明細尚未載入／核對狀態待確認'
    : error ? '核對狀態無法確認' : !states ? '正在檢查核對狀態…'
      : month ? reviewStatusLabel(state) : `有紀錄 ${evidence?.recorded.length ?? 0} 個月 · 已核對 ${states.filter(item => item.status === 'reviewed').length} 個月`
  const counts = evidence ? `銀行 ${evidence.rows.filter(entry => entry.source.kind === 'bank').length} 筆 · 信用卡 ${evidence.rows.filter(entry => entry.source.kind === 'card').length} 筆`
    : unavailable && group ? `摘要記錄：銀行 ${group.coverage.bankCount} 筆 · 信用卡 ${group.coverage.cardCount} 筆` : '來源筆數待確認'
  const reason = !month ? '切換至已核對的完整月份查看儲蓄率'
    : unavailable ? '明細載入後才能確認儲蓄率'
      : period.endMonth > currentMonth ? '未來月份尚不能計算儲蓄率'
        : period.endMonth === currentMonth ? '本月尚未結束，儲蓄率待月底核對'
          : error ? '核對狀態無法確認，暫不顯示儲蓄率'
            : !states ? '核對狀態確認後再顯示儲蓄率'
              : state?.status !== 'reviewed' ? state?.status === 'stale' ? '資料已變動，請重新核對本月' : '尚未完成每月核對'
                : !reliableTotals ? '金額與匯率確認後再顯示儲蓄率'
                  : !group || group.income <= 0 ? '本月收入須大於零才能計算儲蓄率' : null
  const exceptions = state?.sources.filter(source => source.current).reduce((sum, source) => sum + source.unclassifiedCount, 0) ?? 0
  return <section className="panel cashflow-data-status" aria-label="收支資料狀態">
    <div className="cashflow-status-evidence"><h3>資料狀態</h3><strong>{counts}</strong><span role="status">{status}{exceptions > 0 ? ` · 保留 ${exceptions} 筆未分類` : ''}</span><small className="muted">觀測筆數與人工核對不代表完整月份。</small></div>
    <div className="cashflow-savings-context" aria-label="儲蓄率說明">
      {reason ? <><strong>儲蓄率待確認</strong><span className="muted small">{reason}</span></> : <><strong>儲蓄率 {Math.round(group!.difference / group!.income * 100)}%</strong><small className="muted">已結束且已核對月份 · 收支差額 ÷ 收入</small></>}
      <button onClick={onReview}>前往每月核對</button>
    </div>
  </section>
}
