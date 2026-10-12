import type { CashflowCurrencySummary, CashflowMonthTotals, CashflowPeriod } from '../cashflow'
import { fmt } from '../format'
import type { WealthData } from '../model'
import { useCalendarNow } from '../useCalendarNow'
import { cashflowColor } from '../cashflowColor'
import { monthKey, useCashflowPeriod, useTwdCashflow, type CashflowPeriodState } from '../cashflowPeriod'
import { CashflowPeriodControls } from './CashflowPeriodControls'

interface Props {
  data: WealthData
  // When transactions are not loaded: their monthly totals (dataSummary.ts).
  months?: CashflowMonthTotals[]
  onGoExpenses: () => void
  onGoBankTransactions: () => void
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${fmt(n, 0)}`
const count = (categories: { count: number }[]) => categories.reduce((n, c) => n + c.count, 0)

// Card spending and bank rows as one set of income and spending, one period at a time.
export function Cashflow({ data, months, onGoExpenses, onGoBankTransactions }: Props) {
  const now = useCalendarNow()
  const input = { expenses: data.expenses, expenseRules: data.expenseCategoryRules, bankTransactions: data.bankTransactions, bankRules: data.bankCategoryRules, months }
  const period = useCashflowPeriod(input, now)
  const { rawGroups, groups, needsFx, loading, error, retry } = useTwdCashflow(input, period.endMonth, period.period, period.today)
  const trend = trendWindow(period)
  const bars = useTwdCashflow(input, trend.end, trend.period, period.today)
  const group = groups[0]
  const empty = !period.monthList.length

  return <>
    <div className="page-head cashflow-page-head">
      <h2>收支總覽</h2>
      {!empty && <div className="cashflow-page-controls"><CashflowPeriodControls state={period} /></div>}
    </div>
    {empty ? <section className="panel empty">
      <p className="muted">還沒有收支紀錄。匯入信用卡帳單或銀行流水後，這裡會合併成同一套收支。</p>
      <div className="row center"><button className="primary" onClick={onGoExpenses}>匯入信用卡帳單</button><button onClick={onGoBankTransactions}>匯入銀行流水</button></div>
    </section> : <>
      {loading && <p role="status" className="notice">正在換算每月匯率…</p>}
      {needsFx && error && <div role="alert" className="notice"><p>無法完成 TWD 換算：{error}。未顯示部分合計。</p><button onClick={retry}>重試匯率</button></div>}
      {!rawGroups.length && <section className="panel cashflow-no-record"><p className="muted">{period.label}無紀錄，不代表收支為零。</p>
        {period.latestMonth && <button onClick={() => period.showMonth(period.latestMonth!)}>查看 {Number(period.latestMonth.slice(0, 4))} 年 {Number(period.latestMonth.slice(5, 7))} 月</button>}
      </section>}
      {group && <div className="tiles">
        <section className="panel deep tile-stat" aria-label="收支差額">
          <span>收支差額 · TWD</span>
          <strong>{signed(group.difference)}</strong>
          <small>收入 − 實際消費；不是帳戶餘額或淨資產</small>
        </section>
        <section className="panel tile-stat" aria-label="收入">
          <span>收入</span>
          <strong>{fmt(group.income, 0)}</strong>
          <small>銀行流水 {count(group.incomeCategories)} 筆</small>
        </section>
        <section className="panel tile-stat" aria-label="實際消費">
          <span>實際消費</span>
          <strong>{fmt(group.consumption, 0)}</strong>
          <small>信用卡 {group.coverage.cardCount} 筆 · 銀行 {Math.max(0, count(group.consumptionCategories) - group.coverage.cardCount)} 筆</small>
        </section>
        {group.pending.count > 0 ? <section className="panel warn tile-stat cashflow-pending-tile" aria-label="未分類">
          <span><strong>{group.pending.count} 筆銀行流水未分類</strong></span>
          <small>已暫依入帳／支出計入；轉帳或繳卡費請設為不計收支。</small>
          <button className="link" onClick={onGoBankTransactions}>前往分類 →</button>
        </section> : <section className="panel tile-stat" aria-label="儲蓄率">
          <span>儲蓄率</span>
          <strong>{group.income > 0 ? `${Math.round(group.difference / group.income * 100)}%` : '—'}</strong>
          <small>收支差額 ÷ 收入</small>
        </section>}

        <section className="panel span-3 cashflow-bars-tile" aria-label={trend.title}>
          <div className="panel-head"><h3>{trend.title}</h3><div className="cashflow-bars-legend"><span><i style={{ background: 'var(--s2)' }} />收入</span><span><i style={{ background: 'var(--s1)' }} />消費</span></div></div>
          {bars.groups[0] ? <MonthBars group={bars.groups[0]} selected={period.selection.range === 'month' ? period.endMonth : ''} onSelect={period.showMonth} /> : <p className="muted small">{bars.loading ? '正在換算每月匯率…' : '無法顯示月份對照。'}</p>}
        </section>
        <section className="panel cashflow-categories-tile" aria-label="消費分類">
          <h3>{period.label}消費分類</h3>
          <CategoryList categories={group.consumptionCategories} />
          {group.incomeCategories.length > 0 && <details className="cashflow-income-details"><summary>收入分類</summary><CategoryList categories={group.incomeCategories} income /></details>}
        </section>

        <section className="panel span-2 cashflow-source-tile">
          <div><strong>信用卡消費 · {group.coverage.cardCount} 筆</strong><span className="muted small">依原交易日期；退款扣除消費</span></div>
          <button className="link" onClick={onGoExpenses}>查看明細 →</button>
        </section>
        <section className="panel span-2 cashflow-source-tile">
          <div><strong>銀行流水 · {group.coverage.bankCount} 筆</strong><span className="muted small">{group.excluded.count ? `不計收支 ${group.excluded.count} 筆僅列示（轉帳、繳卡費）` : '依銀行記帳日；收入沖回從收入扣除'}</span></div>
          <button className="link" onClick={onGoBankTransactions}>查看明細 →</button>
        </section>
      </div>}
      {group?.investmentRecovery.hasRecords && <p className="notice small" role="note">投資回收款：可能包含投入本金，不代表投資收益</p>}
      <p className="cashflow-footnote muted small">依已匯入紀錄，不代表完整月份。{period.isCurrentMonth ? '本月尚未結束。' : ''}金額統一換算 TWD，依各月月底已完成匯率；本月採最新已完成匯率（最多回溯 7 日）。</p>
    </>}
  </>
}

// The months the bar chart compares: six up to the chosen month, or the chosen year's twelve.
function trendWindow(period: CashflowPeriodState): { end: string; period: CashflowPeriod; title: string } {
  if (period.selection.range === 'year') return { end: monthKey(period.selection.year, 12), period: 12, title: `${period.selection.year} 年每月` }
  if (period.selection.range === 'all') return { end: period.latestMonth ?? period.endMonth, period: 6, title: '近 6 個月' }
  return { end: period.endMonth, period: 6, title: '近 6 個月' }
}

function MonthBars({ group, selected, onSelect }: { group: CashflowCurrencySummary; selected: string; onSelect: (month: string) => void }) {
  const max = Math.max(1, ...group.months.flatMap((m) => [m.income ?? 0, m.consumption ?? 0]))
  const height = (v: number | null) => `${Math.max(0, (v ?? 0) / max) * 100}%`
  return <div className="cashflow-bars" style={{ gridTemplateColumns: `repeat(${group.months.length}, minmax(0, 1fr))` }}>
    {group.months.map((m) => {
      const label = `${Number(m.month.slice(5, 7))} 月`
      const none = m.income === null && m.consumption === null
      return <button key={m.month} className={`cashflow-bar${m.month === selected ? ' on' : ''}`} onClick={() => onSelect(m.month)}
        aria-pressed={m.month === selected}
        aria-label={`${Number(m.month.slice(0, 4))} 年 ${label}：${none ? '無紀錄' : `收入 ${fmt(m.income ?? 0, 0)}，消費 ${fmt(m.consumption ?? 0, 0)}`}`}>
        <span className="cashflow-bar-pair" aria-hidden>
          <span style={{ height: height(m.income), background: 'var(--s2)' }} title={`收入 ${fmt(m.income ?? 0, 0)}`} />
          <span style={{ height: height(m.consumption), background: 'var(--s1)' }} title={`消費 ${fmt(m.consumption ?? 0, 0)}`} />
        </span>
        <span className="cashflow-bar-label">{label}</span>
      </button>
    })}
  </div>
}

function CategoryList({ categories, income = false }: { categories: CashflowCurrencySummary['consumptionCategories'] | CashflowCurrencySummary['incomeCategories']; income?: boolean }) {
  if (!categories.length) return <p className="muted small">沒有這類紀錄</p>
  return <ul className="cashflow-category-rows">
    {[...categories].sort((a, b) => b.net - a.net).map((c) => <li key={c.category}>
      <i aria-hidden style={{ background: cashflowColor(c.category, income) }} />
      <span>{c.category}<small className="muted"> · {c.count} 筆</small></span>
      <span className="num-serif">{fmt(c.net, 0)}</span>
    </li>)}
  </ul>
}
