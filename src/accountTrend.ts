import { localDate, type Snapshot } from './history'
import { accountBaseValue, type Account, type WealthData } from './model'

// An account's value over the saved daily snapshots, and how it moved over the last days.

export interface AccountPoint {
  date: string
  value: number
}

// The account's value on each snapshot day that recorded it, then today's live value.
export function accountSeries(data: WealthData, account: Account, now: string): AccountPoint[] {
  const today = localDate(now)
  const past = data.history.snapshots
    .filter((s) => s.date < today)
    .flatMap((s) => valueIn(s, account.id) === undefined ? [] : [{ date: s.date, value: valueIn(s, account.id)! }])
  return [...past, { date: today, value: accountBaseValue(data, account) }]
}

// The change against the last snapshot at least `days` before today, as a ratio; null when
// no snapshot is that old or its value was zero.
export function accountChange(data: WealthData, account: Account, now: string, days = 30): number | null {
  const then = new Date(now)
  then.setDate(then.getDate() - days)
  const cutoff = localDate(then.toISOString())
  let before: number | undefined
  for (const s of data.history.snapshots) {
    if (s.date > cutoff) break
    before = valueIn(s, account.id) ?? before
  }
  if (!before || before <= 0) return null
  const current = accountBaseValue(data, account)
  return Number.isFinite(current) ? (current - before) / before : null
}

const valueIn = (s: Snapshot, id: string) => s.accounts.find((a) => a.id === id)?.value
