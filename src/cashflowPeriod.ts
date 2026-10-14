import { useEffect, useMemo, useState } from 'react'
import { cashflowMonthList, cashflowSummary, type CashflowCurrencySummary, type CashflowInput, type CashflowPeriod } from './cashflow'
import { cashflowWithFxEvidence, twdCashflowEvidence, type CashflowFxEvidence } from './cashflowFx'
import { fetchHistory } from './priceHistory'

// The period the cashflow views show, the picker that changes it, and the totals converted to TWD.
// Shared by the overview's cashflow card and the cashflow page; the picker is views/CashflowPeriodControls.tsx.

export type Selection = { range: 'month' | 'year' | 'all'; year: number; month: number }
export const monthKey = (year: number, month: number) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
const monthSelection = (key: string): Selection => ({ range: 'month', year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) })
const dayOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function useCashflowPeriod(input: CashflowInput, now: string) {
  const date = new Date(now)
  const currentMonth = monthKey(date.getFullYear(), date.getMonth() + 1)
  const { expenses, bankTransactions, months } = input
  const monthList = useMemo(() => cashflowMonthList({ expenses, bankTransactions, months }), [expenses, bankTransactions, months])
  const recordedMonths = new Set(monthList)
  // An imported statement is usually for an earlier month: without records this month, open on the latest one.
  const latestMonth = monthList.find((month) => month <= currentMonth) ?? monthList[0]
  const [selection, setSelection] = useState<Selection>(() => monthSelection(recordedMonths.has(currentMonth) || !latestMonth || latestMonth > currentMonth ? currentMonth : latestMonth))
  const endMonth = monthKey(selection.year, selection.range === 'year' ? 12 : selection.month)
  const period: CashflowPeriod = selection.range === 'all' ? 'all' : selection.range === 'year' ? 12 : 1
  const label = selection.range === 'all' ? '全部期間' : `${selection.year} 年${selection.range === 'month' ? ` ${selection.month} 月` : ''}`
  const isCurrentMonth = selection.range === 'month' && selection.year === date.getFullYear() && selection.month === date.getMonth() + 1
  return {
    date, today: dayOf(date), monthList, recordedMonths, latestMonth, selection, setSelection, endMonth, period, label, isCurrentMonth,
    showMonth: (key: string) => setSelection(monthSelection(key)),
  }
}
export type CashflowPeriodState = ReturnType<typeof useCashflowPeriod>

// Totals for a period, per currency as recorded, and as one TWD group when another currency is present.
export function useTwdCashflow(input: CashflowInput, endMonth: string, period: CashflowPeriod, today: string) {
  const { expenses, expenseRules, bankTransactions, bankRules, months } = input
  const rawGroups = useMemo(() => cashflowSummary({ expenses, expenseRules, bankTransactions, bankRules, months }, endMonth, period), [expenses, expenseRules, bankTransactions, bankRules, months, endMonth, period])
  const needsFx = rawGroups.some((group) => group.currency !== 'TWD')
  const [attempt, setAttempt] = useState(0)
  const [conversion, setConversion] = useState<{ source: typeof rawGroups; today: string; attempt: number; group?: CashflowCurrencySummary; fx: CashflowFxEvidence[]; error?: string }>()
  useEffect(() => {
    if (!needsFx) return
    let active = true
    cashflowWithFxEvidence(rawGroups, today, (symbol, from) => fetchHistory(symbol, from, attempt > 0)).then(({group, fx}) => {
      if (active) setConversion({ source: rawGroups, today, attempt, group, fx })
    }, (error) => {
      if (active) setConversion({ source: rawGroups, today, attempt, fx: [], error: error instanceof Error ? error.message : '匯率查詢失敗' })
    })
    return () => { active = false }
  }, [rawGroups, today, attempt, needsFx])
  const current = conversion?.source === rawGroups && conversion.today === today && conversion.attempt === attempt ? conversion : undefined
  const groups = needsFx ? (current?.group ? [current.group] : []) : rawGroups
  const localFx = useMemo(() => needsFx ? [] : twdCashflowEvidence(rawGroups, today), [rawGroups, today, needsFx])
  const fx = needsFx ? current?.fx ?? [] : localFx
  return { rawGroups, groups, fx, needsFx, loading: needsFx && !current, error: needsFx ? current?.error : undefined, retry: () => setAttempt(attempt + 1) }
}

