import { useMemo, useState } from 'react'
import { cashflowSummary, type CashflowCurrencySummary, type CashflowMonthTotals, type CashflowPeriod } from '../cashflow'
import { fmt } from '../format'
import type { WealthData } from '../model'
import type { BankTransaction, BankTransactionAccount } from '../bankTransactions'
import { useCalendarNow } from '../useCalendarNow'
import { cashflowColor } from '../cashflowColor'
import { monthKey, useCashflowPeriod, useTwdCashflow, type CashflowPeriodState } from '../cashflowPeriod'
import { CashflowPeriodControls } from './CashflowPeriodControls'
import { ExpenseRecords } from './ExpenseRecords'
import { BankRecord } from './BankTransactions'

interface Props {
  data: WealthData
  // When transactions are not loaded: their monthly totals (dataSummary.ts).
  months?: CashflowMonthTotals[]
  onGoExpenses: () => void
  onGoBankTransactions: () => void
  // Opens the statement import, the one entry for card and bank statements.
  onImport: () => void
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${fmt(n, 0)}`
const count = (categories: { count: number }[]) => categories.reduce((n, c) => n + c.count, 0)

// Card spending and bank rows as one set of income and spending, one period at a time.
export function Cashflow({ data, months, onGoExpenses, onGoBankTransactions, onImport }: Props) {
  const now = useCalendarNow()
  const input = { expenses: data.expenses, expenseRules: data.expenseCategoryRules, bankTransactions: data.bankTransactions, bankRules: data.bankCategoryRules, months }
  const period = useCashflowPeriod(input, now)
  const { rawGroups, groups, needsFx, loading, error, retry } = useTwdCashflow(input, period.endMonth, period.period, period.today)
  const trend = trendWindow(period)
  const bars = useTwdCashflow(input, trend.end, trend.period, period.today)
  // The chosen month is one of the twelve already converted for the bars, so picking a bar swaps the numbers
  // in place instead of waiting for another exchange-rate round trip.
  const barsNow = bars.groups[0]
  const monthGroup = useMemo(() => period.selection.range === 'month' ? monthOf(barsNow, period.endMonth) : undefined, [barsNow, period.selection.range, period.endMonth])
  const group = monthGroup ?? groups[0]
  // While a new period converts, the last numbers stay up (dimmed) instead of the page emptying and refilling.
  // Not kept when the period simply has no records: that must show as empty.
  const [kept, setKept] = useState<{ group?: CashflowCurrencySummary; bars?: CashflowCurrencySummary }>({})
  if ((group && group !== kept.group) || (barsNow && barsNow !== kept.bars)) setKept({ group: group ?? kept.group, bars: barsNow ?? kept.bars })
  const shown = group ?? (loading || bars.loading ? kept.group : undefined)
  const shownBars = barsNow ?? (bars.loading ? kept.bars : undefined)
  const stale = (!!shown && shown !== group) || (!!shownBars && shownBars !== barsNow)
  const converting = (!shown && loading) || (!shownBars && bars.loading)
  const failed = (!shown && needsFx && error) || (!shownBars && bars.needsFx && bars.error)
  const empty = !period.monthList.length

  return <>
    <div className="page-head cashflow-page-head">
      <h2>收支總覽</h2>
      {!empty && <div className="cashflow-page-controls"><button onClick={onImport}>匯入帳單</button><CashflowPeriodControls state={period} /></div>}
    </div>
    {empty ? <section className="panel empty">
      <p className="muted">還沒有收支紀錄。匯入信用卡帳單或銀行帳單後，這裡會合併成同一套收支。</p>
      <div className="row center"><button className="primary" onClick={onImport}>匯入帳單</button></div>
    </section> : <>
      {converting && <p role="status" className="notice">正在換算每月匯率…</p>}
      {failed && <div role="alert" className="notice"><p>無法完成 TWD 換算：{(!shown && needsFx && error) || bars.error}。未顯示部分合計。</p><button onClick={() => { retry(); bars.retry() }}>重試匯率</button></div>}
      {!rawGroups.length && <section className="panel cashflow-no-record"><p className="muted">{period.label}無紀錄，不代表收支為零。{shownBars ? '其他月份仍照常顯示。' : ''}</p>
        {period.latestMonth && <button onClick={() => period.showMonth(period.latestMonth!)}>查看 {Number(period.latestMonth.slice(0, 4))} 年 {Number(period.latestMonth.slice(5, 7))} 月</button>}
      </section>}
      {(shown || shownBars) && <div className="tiles cashflow-tiles" aria-busy={stale} data-stale={stale || undefined}>
        {shown && <>
          <section className="panel span-2 cashflow-phone-summary mobile-only" aria-label="收支摘要">
            <span className="muted">收支差額 · TWD</span>
            <strong className={`num-serif ${shown.difference >= 0 ? 'up' : 'down'}`}>{signed(shown.difference)}</strong>
            {([['收入', shown.income, 'var(--s2)'], ['消費', shown.consumption, 'var(--s1)']] as const).map(([label, value, color]) => <div className="cashflow-hbar" key={label}>
              <span>{label}</span>
              <span className="cashflow-hbar-track"><i style={{ width: `${Math.max(2, Math.max(0, value) / Math.max(shown.income, shown.consumption, 1) * 100)}%`, background: color }} /></span>
              <span className="num-serif">{fmt(value, 0)}</span>
            </div>)}
            {shown.income > 0 && <small className="muted">儲蓄率 {Math.round(shown.difference / shown.income * 100)}%</small>}
          </section>
          <section className="panel deep tile-stat desktop-only" aria-label="收支差額">
            <span>收支差額 · TWD</span>
            <strong>{signed(shown.difference)}</strong>
            <small>收入 − 實際消費；不是帳戶餘額或淨資產</small>
          </section>
          <section className="panel tile-stat desktop-only" aria-label="收入">
            <span>收入</span>
            <strong>{fmt(shown.income, 0)}</strong>
            <small>銀行流水 {count(shown.incomeCategories)} 筆</small>
          </section>
          <section className="panel tile-stat desktop-only" aria-label="實際消費">
            <span>實際消費</span>
            <strong>{fmt(shown.consumption, 0)}</strong>
            <small>信用卡 {shown.coverage.cardCount} 筆 · 銀行 {Math.max(0, count(shown.consumptionCategories) - shown.coverage.cardCount)} 筆</small>
          </section>
          {shown.pending.count > 0 ? <section className="panel warn tile-stat cashflow-pending-tile" aria-label="未分類">
            <span><strong>{shown.pending.count} 筆銀行流水未分類</strong></span>
            <small>已暫依入帳／支出計入；轉帳或繳卡費請設為不計收支。</small>
            <button className="link" onClick={onGoBankTransactions}>前往分類 →</button>
          </section> : <section className="panel tile-stat desktop-only" aria-label="儲蓄率">
            <span>儲蓄率</span>
            <strong>{shown.income > 0 ? `${Math.round(shown.difference / shown.income * 100)}%` : '—'}</strong>
            <small>收支差額 ÷ 收入</small>
          </section>}
        </>}

        {/* Stays up when the chosen month has no records, so the other months remain visible. */}
        <section className={`panel ${shown ? 'span-3' : 'span-4'} cashflow-bars-tile`} aria-label={trend.title}>
          <div className="panel-head"><h3>{trend.title}</h3><div className="cashflow-bars-legend"><span><i style={{ background: 'var(--s2)' }} />收入</span><span><i style={{ background: 'var(--s1)' }} />消費</span></div></div>
          {shownBars ? <MonthBars group={shownBars} selected={period.selection.range === 'month' ? period.endMonth : ''} onSelect={period.showMonth} /> : <p className="muted small">{bars.loading ? '正在換算每月匯率…' : '無法顯示月份對照。'}</p>}
        </section>
        {shown && <>
          <section className="panel cashflow-categories-tile" aria-label="消費分類">
            <h3>{period.label}消費分類</h3>
            <CategoryList categories={shown.consumptionCategories} />
            {shown.incomeCategories.length > 0 && <details className="cashflow-income-details"><summary>收入分類</summary><CategoryList categories={shown.incomeCategories} income /></details>}
          </section>

          {/* Keyed by the selection so the open year and month reset when it changes. */}
          <RecordsTile key={period.label} period={period} data={data} loading={!!months} onGoExpenses={onGoExpenses} onGoBankTransactions={onGoBankTransactions} />
        </>}
      </div>}
      {shown?.investmentRecovery.hasRecords && <p className="notice small" role="note">投資回收款：可能包含投入本金，不代表投資收益</p>}
      <p className="cashflow-footnote muted small">依已匯入紀錄，不代表完整月份。{period.isCurrentMonth ? '本月尚未結束。' : ''}金額統一換算 TWD，依各月月底已完成匯率；本月採最新已完成匯率（最多回溯 7 日）。</p>
    </>}
  </>
}

// The bar chart always shows one year's twelve months: the chosen year, or the year of the chosen or latest month.
// Picking a month inside that year keeps the chart in place.
function trendWindow(period: CashflowPeriodState): { end: string; period: CashflowPeriod; title: string } {
  const year = period.selection.range === 'all' ? Number((period.latestMonth ?? period.endMonth).slice(0, 4)) : period.selection.year
  return { end: monthKey(year, 12), period: 12, title: `${year} 年每月` }
}

// One month of an already converted year as a group of its own; undefined when the month has no records.
function monthOf(year: CashflowCurrencySummary | undefined, month: string): CashflowCurrencySummary | undefined {
  const point = year?.months.find((m) => m.month === month)
  if (!year || !point || point.income === null || point.consumption === null || point.difference === null) return undefined
  const { income, consumption, difference, incomeCategories, consumptionCategories, excluded, exclusions, pending, investmentRecovery, coverage } = point
  return cashflowSummary({ months: [{ currency: year.currency, month, coverage, totals: { income, consumption, difference, incomeCategories, consumptionCategories, excluded, exclusions, pending, investmentRecovery } }] }, month, 1)[0]
}

function bankRecordGroups(rows: readonly BankTransaction[], accounts: readonly BankTransactionAccount[]) {
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? '未知帳戶'
  const groups = new Map<string, { key: string; date: string; account: string; rows: BankTransaction[] }>()
  for (const row of [...rows].sort((a, b) => b.date.localeCompare(a.date))) {
    const key = JSON.stringify([row.date, row.accountId])
    const group = groups.get(key) ?? { key, date: row.date, account: label(row.accountId), rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()]
}

// The records behind the totals, listed under the tiles: the chosen month, or each month of the year,
// one open at a time; 全部期間 groups the months by year, the latest year open at first.
function RecordsTile({ period, data, loading, onGoExpenses, onGoBankTransactions }: { period: CashflowPeriodState; data: WealthData; loading: boolean; onGoExpenses: () => void; onGoBankTransactions: () => void }) {
  const { range, year } = period.selection
  const yearPrefix = `${String(year).padStart(4, '0')}-`
  const recordMonths = range === 'month' ? [period.endMonth] : period.monthList.filter((m) => range === 'all' || m.startsWith(yearPrefix))
  const recordYears = [...new Set(recordMonths.map((m) => m.slice(0, 4)))]
  const [openMonth, setOpenMonth] = useState('')
  const [openYear, setOpenYear] = useState<string | null>(null)
  const count = (prefix: string) => loading ? null : <span className="muted small">信用卡 {(data.expenses ?? []).filter((e) => e.date.startsWith(prefix)).length} 筆 · 銀行 {(data.bankTransactions ?? []).filter((t) => t.date.startsWith(prefix)).length} 筆</span>
  const records = (month: string) => <MonthRecords month={month} data={data} loading={loading} onGoExpenses={onGoExpenses} onGoBankTransactions={onGoBankTransactions} />
  return <section className="panel span-4 cashflow-records-tile" aria-label={`${period.label}明細`}>
    {range === 'month' ? records(period.endMonth) : recordYears.map((y) => {
      const yearOpen = range === 'year' || (openYear ?? recordYears[0]) === y
      return <div key={y} className="cashflow-year-records">
        {range === 'all' && <button className="cashflow-month-toggle cashflow-year-toggle" aria-expanded={yearOpen} onClick={() => setOpenYear(yearOpen ? '' : y)}>
          <strong>{Number(y)} 年</strong><span className="muted small">{recordMonths.filter((m) => m.startsWith(y)).length} 個月有紀錄</span>
        </button>}
        {yearOpen && recordMonths.filter((m) => m.startsWith(y)).map((m) => {
          const open = openMonth === m
          return <div key={m} className="cashflow-month-records">
            <button className="cashflow-month-toggle" aria-expanded={open} onClick={() => setOpenMonth(open ? '' : m)}><strong>{Number(m.slice(5, 7))} 月</strong>{count(m)}</button>
            {open && records(m)}
          </div>
        })}
      </div>
    })}
  </section>
}

// One month's card and bank records, each behind a disclosure.
function MonthRecords({ month, data, loading, onGoExpenses, onGoBankTransactions }: { month: string; data: WealthData; loading: boolean; onGoExpenses: () => void; onGoBankTransactions: () => void }) {
  const cardRows = (data.expenses ?? []).filter((e) => e.date.startsWith(month))
  const bankGroups = bankRecordGroups((data.bankTransactions ?? []).filter((t) => t.date.startsWith(month)), data.bankTransactionAccounts ?? [])
  const bankCount = bankGroups.reduce((n, g) => n + g.rows.length, 0)
  const count = (n: number) => loading ? '' : ` · ${n} 筆`
  return <>
    <details className="cashflow-records">
      <summary><strong>信用卡消費{count(cardRows.length)}</strong><span className="muted small">依原交易日期；退款扣除消費</span></summary>
      {loading ? <p className="muted small">正在載入明細…</p> : cardRows.length
        ? <ExpenseRecords expenses={cardRows} rules={data.expenseCategoryRules ?? []} />
        : <p className="muted small">這個月沒有信用卡消費</p>}
      <button className="link" onClick={onGoExpenses}>前往信用卡消費頁編輯 →</button>
    </details>
    <details className="cashflow-records">
      <summary><strong>銀行流水{count(bankCount)}</strong><span className="muted small">依銀行記帳日；不計收支的只列示</span></summary>
      {loading ? <p className="muted small">正在載入明細…</p> : bankGroups.length
        ? <div className="bank-records record-groups">{bankGroups.map((g) => <section key={g.key} className="bank-record-group">
          <header className="record-group-head"><time dateTime={g.date}>{g.date}</time><span title={g.account}>{g.account}</span></header>
          {g.rows.map((row) => <BankRecord key={row.id} row={row} account={g.account} rules={data.bankCategoryRules ?? []} />)}
        </section>)}</div>
        : <p className="muted small">這個月沒有銀行流水</p>}
      <button className="link" onClick={onGoBankTransactions}>前往銀行流水頁編輯 →</button>
    </details>
  </>
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
        {!none && <span className="cashflow-bar-tip" aria-hidden>收入 {fmt(m.income ?? 0, 0)}<br />消費 {fmt(m.consumption ?? 0, 0)}</span>}
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
