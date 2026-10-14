import type { WealthData } from './model'

export function summarizeBackup(data: WealthData, file: { name: string; size: number }, sourceUpdatedAt: string | null = data.updatedAt) {
  const dates = [
    ...data.history.snapshots.map((item) => item.date),
    ...(data.history.quantityDays ?? []).map((item) => item.date),
    ...(data.history.holdingPeriods ?? []).flatMap((item) => item.end ? [item.start, item.end] : [item.start]),
  ].filter((date): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()
  return {
    name: file.name,
    bytes: file.size,
    updatedAt: sourceUpdatedAt,
    counts: {
      accounts: data.accounts.length,
      positions: data.accounts.reduce((count, account) => count + account.positions.length, 0),
      liabilities: data.liabilities?.length ?? 0,
      expenses: data.expenses?.length ?? 0,
      monthlyReviews: data.monthlyReviews?.length ?? 0,
      bankTransactions: data.bankTransactions?.length ?? 0,
    },
    historyRange: dates.length ? { from: dates[0], to: dates.at(-1)! } : null,
  }
}
