import type { CashflowCurrencySummary } from '../cashflow'
import { fmt } from '../format'

// Without an exchange rate a period still has its totals in each recorded currency; only the TWD sum is missing.
export function CurrencyTotals({ groups, label }: { groups: readonly CashflowCurrencySummary[]; label: string }) {
  return <div className="cashflow-currency-totals" aria-label="各幣別原幣合計">
    <p className="muted small">{label}各幣別的原幣合計：</p>
    <ul>{groups.map(g => <li key={g.currency}><strong>{g.currency}</strong> 收入 {fmt(g.income)} · 實際消費 {fmt(g.consumption)} · 差額 {fmt(g.difference)}</li>)}</ul>
  </div>
}
