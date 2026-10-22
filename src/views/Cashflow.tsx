import { useEffect, useMemo, useState } from 'react'
import { parseCashflowQuery, cashflowQueryString, categoryToken, type CashflowQuery, type LedgerReadiness } from '../cashflowQuery'
import { navigate, useRouteLocation } from '../site'
import { MonthlyReport } from './MonthlyReport'
import type { CaptureReport } from '../monthlyReportExport'
import { MonthlyReviewPanel } from './MonthlyReviewPanel'
import { CashflowRecords } from './CashflowRecords'
import { cashflowSummary, monthsInPeriod, type CashflowCurrencySummary, type CashflowMonthTotals, type CashflowPeriod } from '../cashflow'
import { fmt } from '../format'
import type { WealthData } from '../model'
import { useCalendarNow } from '../useCalendarNow'
import { cashflowColor } from '../cashflowColor'
import { monthKey, useCashflowPeriod, useTwdCashflow, type CashflowPeriodState } from '../cashflowPeriod'
import { localDate } from '../history'
import { CashflowPeriodControls } from './CashflowPeriodControls'
import { useRecordEditing } from './useRecordEditing'
import { QuickClassify } from './QuickClassify'
import { quickQueue } from '../quickClassify'
import { CashflowDataStatus } from './CashflowDataStatus'
import { CurrencyTotals } from './CurrencyTotals'

interface Props {
  data: WealthData
  onChange?: (next: WealthData) => void
  busy?: boolean
  dirty?: boolean
  sessionIdentity?: number
  captureReport?: CaptureReport
  captureReviewGuard?: () => () => boolean
  readiness?: LedgerReadiness
  ledgerError?: string
  onRetryLedger?: () => void
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
export function Cashflow(props:Props) {
 const location=useRouteLocation(),now=useCalendarNow()
 const today=localDate(now)
 const parsed=parseCashflowQuery(location.includes('?')?location.slice(location.indexOf('?')):'').query
 if(parsed.panel==='report'&&parsed.month)return <MonthlyReport key={`${parsed.month}:${props.sessionIdentity}`} data={props.data} month={parsed.month} today={today} readiness={props.readiness??(props.months?'loading':'ready')} dirty={props.dirty} busy={props.busy} sessionIdentity={props.sessionIdentity} captureReport={props.captureReport} onClose={()=>navigate('/cashflow'+cashflowQueryString({...parsed,panel:'records'}),{scroll:'preserve'})}/>
 return <LiveCashflow {...props}/>
}

function LiveCashflow({ data, onChange, busy = false, dirty, sessionIdentity, captureReviewGuard, months, readiness = months ? 'loading' : 'ready', ledgerError, onRetryLedger, onGoExpenses, onGoBankTransactions, onImport }: Props) {
  const now = useCalendarNow()
  const editing = useRecordEditing({ data, onChange, busy, loading: readiness !== 'ready' })
  const input = { expenses: data.expenses, expenseRules: data.expenseCategoryRules, bankTransactions: data.bankTransactions, bankRules: data.bankCategoryRules, months }
  const localPeriod = useCashflowPeriod(input, now)
  const location = useRouteLocation()
  const parsed = parseCashflowQuery(location.includes('?') ? location.slice(location.indexOf('?')) : '')
  const currentMonth=monthKey(localPeriod.date.getFullYear(),localPeriod.date.getMonth()+1)
  const defaultMonth=localPeriod.recordedMonths.has(currentMonth)?currentMonth:localPeriod.latestMonth??currentMonth
  const query = {...parsed.query, ...(parsed.query.range==='month'&&!parsed.query.month ? {month:defaultMonth}: {})}
  const [corrected, setCorrected] = useState(parsed.corrected)
  const [focusSelection, setFocusSelection] = useState(0)
  const onQuery = (next:CashflowQuery, replace=false) => navigate('/cashflow'+cashflowQueryString(next),{replace,scroll:'preserve'})
  useEffect(()=>{
    const notice=()=>{if(window.location.pathname==='/cashflow' && parseCashflowQuery(window.location.search).corrected)setCorrected(true)}
    window.addEventListener('popstate',notice)
    return ()=>window.removeEventListener('popstate',notice)
  },[])
  useEffect(()=>{
    if(window.location.pathname!=='/cashflow')return
    if(parsed.corrected || (!parsed.query.month && parsed.query.range==='month' && (readiness==='ready'||!!months))) navigate('/cashflow'+cashflowQueryString(query),{replace:true,scroll:'preserve'})
  },[location, readiness, months, defaultMonth]) // eslint-disable-line react-hooks/exhaustive-deps
  // A year or 全部期間 URL names no month: the last month chosen stays in the local selection.
  const selection = {range:query.range,year:query.year??(query.month?Number(query.month.slice(0,4)):localPeriod.selection.year),month:query.month?Number(query.month.slice(5,7)):localPeriod.selection.month}
  const choose = (next:CashflowQuery)=>{setFocusSelection(n=>n+1);onQuery(next)}
  // A picked bar opens that month's records below, as a picked tile does, but keeps focus on the chart.
  const [barPicked, setBarPicked] = useState(false)
  const period:CashflowPeriodState = {...localPeriod,selection,isCurrentMonth:query.range==='month'&&query.month===currentMonth,endMonth:monthKey(selection.year,selection.range==='year'?12:selection.month),period:selection.range==='all'?'all':selection.range==='year'?12:1,label:selection.range==='all'?'全部期間':`${selection.year} 年${selection.range==='month'?` ${selection.month} 月`:''}`,setSelection: action=>{
    const next=typeof action==='function'?action(selection):action
    localPeriod.setSelection(next)
    onQuery({...query,range:next.range,month:next.range==='month'?monthKey(next.year,next.month):undefined,year:next.range==='year'?next.year:undefined,panel:'records',page:1})
  },showMonth: month=>onQuery({...query,range:'month',month,year:undefined,panel:'records',page:1})}
  // 核對 and 報表 are per month: in a year, its last recorded month up to this one.
  const yearMonths=localPeriod.monthList.filter(m=>m.startsWith(period.endMonth.slice(0,5))&&m<=currentMonth).sort()
  const panelMonth=query.range==='month'?query.month:query.range==='year'?yearMonths.at(-1)??(period.endMonth<currentMonth?period.endMonth:currentMonth):period.endMonth
  const selectMetric=(metric:CashflowQuery['metric'], category?:string)=>choose({...query,metric,category,panel:'records',page:1})
  const { rawGroups, groups, fx, needsFx, loading, error, retry } = useTwdCashflow(input, period.endMonth, period.period, period.today)
  const trend = trendWindow(period)
  const bars = useTwdCashflow(input, trend.end, trend.period, period.today)
  // The chosen month is one of the twelve already converted for the bars, so picking a bar swaps the numbers
  // in place instead of waiting for another exchange-rate round trip.
  const barsNow = bars.groups[0]
  const monthGroup = useMemo(() => period.selection.range === 'month' ? monthOf(barsNow, period.endMonth) : undefined, [barsNow, period.selection.range, period.endMonth])
  const group = monthGroup ?? groups[0]
  // The records use the same rates, so their totals show with the tiles instead of after the month's own conversion.
  const recordFx = monthGroup ? bars.fx : fx
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
  // 快速分類 from the 未分類 tile: the shown period's bank rows left pending and card rows left 未分類.
  const [quick, setQuick] = useState<string | null>(null)
  const periodKey = `${period.period}:${period.endMonth}`
  const periodMonths = period.period !== 'all' ? new Set(monthsInPeriod(period.endMonth, period.period)) : null
  const inPeriod = (date: string) => !periodMonths || periodMonths.has(date.slice(0, 7))
  const queueReady = readiness === 'ready' && !months && !stale && !loading && !bars.loading && !error && !bars.error
  const queue = queueReady ? quickQueue(data, ['bank', 'card'], inPeriod) : undefined
  const pendingBank = queue?.filter(item => item.source === 'bank').length ?? 0
  const pendingCard = queue?.filter(item => item.source === 'card').length ?? 0

  // The editor replaces the page while open; the page stays mounted underneath, so the open month and chosen period survive.
  return <>
    {editing.editor}{editing.dialogs}
    {quick === periodKey && queueReady && onChange && <QuickClassify key={periodKey} data={data} onChange={onChange} busy={busy} sources={['bank', 'card']} inRange={inPeriod} onClose={() => setQuick(null)} />}
    <div className="cashflow-body" hidden={editing.editing}>
    {corrected && <p role="status" className="notice">網址篩選無效，已還原為安全的未篩選範圍。</p>}
    {editing.error && <p role="alert">{editing.error}</p>}
    <div className="page-head cashflow-page-head">
      <h2>收支總覽</h2>
      {/* With no records yet the period and view controls have nothing to show; the empty card offers the import. */}
      {!empty && <div className="cashflow-page-controls"><button className="desktop-only" onClick={onImport}>匯入帳單</button><CashflowPeriodControls state={period} /></div>}
    </div>
    {!empty && <div className="segmented cashflow-panels" role="group" aria-label="檢視"><button aria-pressed={query.panel === 'records'} className={query.panel === 'records' ? 'on' : ''} onClick={() => onQuery({...query,panel:'records'})}>收支明細</button><button aria-pressed={query.panel === 'review'} className={query.panel === 'review' ? 'on' : ''} onClick={() => onQuery({...query,range:'month',month:panelMonth,year:undefined,panel:'review',page:1})}>{query.range === 'month' ? '每月核對' : `核對 ${panelMonth}`}</button><button onClick={()=>onQuery({...query,range:'month',month:panelMonth,year:undefined,panel:'report',page:1})}>每月報表</button></div>}
    {query.panel === 'review' && query.month && <MonthlyReviewPanel key={`${query.month}:${sessionIdentity}`} data={data} month={query.month} today={period.today} readiness={readiness} onChange={onChange} busy={busy} dirty={dirty} sessionIdentity={sessionIdentity} captureReviewGuard={captureReviewGuard} onUnclassified={source => choose({...query,panel:'records',source,metric:'all',category:'unclassified',page:1})} />}
    <CashflowDataStatus data={data} readiness={months && readiness !== 'error' ? 'loading' : readiness} period={period} group={group} reliableTotals={queueReady&&!busy} onReview={()=>onQuery({...query,range:'month',month:panelMonth,year:undefined,panel:'review',page:1})}/>
    {empty && readiness!=='ready' && <div role={readiness==='error'?'alert':'status'}>{readiness==='error' ? <>{ledgerError || '無法載入明細'}<button onClick={onRetryLedger}>重試明細</button></> : '正在載入明細…'}</div>}
    {empty ? <section className="panel empty">
      <p className="muted">還沒有收支紀錄。匯入信用卡帳單或銀行帳單後，這裡會合併算出每月的收入與花費。</p>
      <p className="muted small">兩種帳單可以一起選，會自動分辨。</p>
      <div className="row center"><button className="primary" onClick={onImport}>匯入帳單</button></div>
    </section> : <>
      {converting && <p role="status" className="notice">正在換算每月匯率…</p>}
      {failed && <div role="alert" className="notice"><p>無法完成 TWD 換算：{(!shown && needsFx && error) || bars.error}。未顯示部分合計。</p>{!shown && rawGroups.length > 0 && <CurrencyTotals groups={rawGroups} label={period.label} />}<button onClick={() => { retry(); bars.retry() }}>重試匯率</button></div>}
      {!rawGroups.length && <section className="panel cashflow-no-record"><p className="muted">{period.label}無紀錄，不代表收支為零。{shownBars ? '其他月份仍照常顯示。' : ''}</p>
        {period.latestMonth && <button onClick={() => period.showMonth(period.latestMonth!)}>查看 {Number(period.latestMonth.slice(0, 4))} 年 {Number(period.latestMonth.slice(5, 7))} 月</button>}
      </section>}
      {(shown || shownBars) && <div className="tiles cashflow-tiles" aria-busy={stale} data-stale={stale || undefined}>
        {shown && <>
          <section className="panel span-2 cashflow-phone-summary mobile-only" aria-label="收支摘要">
            <span className="muted">收支差額 · TWD</span>
            <strong className={`num-serif ${shown.difference >= 0 ? 'up' : 'down'}`}><button disabled={stale} onClick={()=>selectMetric('difference')}>{signed(shown.difference)}</button></strong>
            {([['收入', shown.income, 'var(--s2)'], ['消費', shown.consumption, 'var(--s1)']] as const).map(([label, value, color]) => <div className="cashflow-hbar" key={label}>
              <button disabled={stale} onClick={()=>selectMetric(label==='收入'?'income':'consumption')}>{label}</button>
              <span className="cashflow-hbar-track"><i style={{ width: `${Math.max(2, Math.max(0, value) / Math.max(shown.income, shown.consumption, 1) * 100)}%`, background: color }} /></span>
              <span className="num-serif">{fmt(value, 0)}</span>
            </div>)}
          </section>
          <section className="panel deep tile-stat desktop-only" aria-label="收支差額">
            <span>收支差額 · TWD</span>
            <button disabled={stale} onClick={()=>selectMetric('difference')}><strong>{signed(shown.difference)}</strong></button>
            <small>收入 − 實際消費；不是帳戶餘額或淨資產</small>
          </section>
          <section className="panel tile-stat desktop-only" aria-label="收入">
            <span>收入</span>
            <button disabled={stale} onClick={()=>selectMetric('income')}><strong>{fmt(shown.income, 0)}</strong></button>
            <small>銀行流水 {count(shown.incomeCategories)} 筆{passiveIncome(shown) > 0 && ` · 股利與利息 ${fmt(passiveIncome(shown), 0)}`}</small>
          </section>
          <section className="panel tile-stat desktop-only" aria-label="實際消費">
            <span>實際消費</span>
            <button disabled={stale} onClick={()=>selectMetric('consumption')}><strong>{fmt(shown.consumption, 0)}</strong></button>
            <small>信用卡 {shown.coverage.cardCount} 筆 · 銀行 {Math.max(0, count(shown.consumptionCategories) - shown.coverage.cardCount)} 筆</small>
          </section>
          {(!queue || queue.length > 0) && <section className="panel warn tile-stat cashflow-pending-tile" aria-label="未分類">
            <span><strong>{queue ? `未分類 ${queue.length} 筆` : '未分類筆數待確認'}</strong></span>
            <small>{queue ? `銀行 ${pendingBank} 筆 · 信用卡 ${pendingCard} 筆` : readiness !== 'ready' || months ? '明細載入後確認未分類筆數' : '金額與目前期間確認後顯示筆數'}</small>
            {pendingBank > 0 && <small>銀行未分類已暫依入帳／支出計入；轉帳或繳卡費請設為不計收支。</small>}
            <div className="cashflow-pending-actions">
              {onChange && <button disabled={busy || !queueReady || !queue?.length} onClick={() => setQuick(periodKey)}>快速分類</button>}
              <button className="link" onClick={onGoBankTransactions}>前往銀行流水 →</button>
            </div>
          </section>}
        </>}

        {/* Stays up when the chosen month has no records, so the other months remain visible. */}
        <section className={`panel ${shown ? 'span-3' : 'span-4'} cashflow-bars-tile`} aria-label={trend.title}>
          <div className="panel-head"><h3>{trend.title}</h3></div>
          {shownBars ? <MonthBars group={shownBars} disabled={stale} selected={period.selection.range === 'month' ? period.endMonth : ''} onSelect={month => { setBarPicked(true); period.showMonth(month) }} /> : <p className="muted small">{bars.loading ? '正在換算每月匯率…' : '無法顯示月份對照。'}</p>}
        </section>
        {shown && <>
          <section className="panel cashflow-categories-tile" aria-label="消費分類">
            <h3>{period.label}消費分類</h3>
            <CategoryList categories={shown.consumptionCategories} onSelect={c=>{if(!stale)selectMetric('consumption',categoryToken(c))}} />
            {shown.incomeCategories.length > 0 && <details className="cashflow-income-details"><summary>收入分類{passiveIncome(shown) > 0 && <span className="muted"> · 股利與利息 {fmt(passiveIncome(shown), 0)}</span>}</summary><CategoryList categories={shown.incomeCategories} income onSelect={c=>{if(!stale)selectMetric('income',categoryToken(c))}} /></details>}
          </section>

        </>}
      </div>}
      <CashflowRecords editing={editing} query={query} fx={recordFx} readiness={readiness} ledgerError={ledgerError} onRetry={onRetryLedger} onQuery={onQuery} focusSelection={focusSelection} expand={barPicked} period={period} data={data} loading={readiness!=='ready'} onGoExpenses={onGoExpenses} onGoBankTransactions={onGoBankTransactions} />
      {shown?.investmentRecovery.hasRecords && <p className="notice small" role="note">投資回收款：可能包含投入本金，不代表投資收益</p>}
      <details className="cashflow-footnote muted small"><summary>金額怎麼算</summary><p>依已匯入紀錄，不代表完整月份。{period.isCurrentMonth ? '本月尚未結束。' : ''}金額統一換算 TWD，依各月月底已完成匯率；本月採最新已完成匯率（最多回溯 7 日）。</p></details>
    </>}
    </div>
  </>
}

// The bar chart always shows one year's twelve months: the chosen year, or the year of the chosen or latest month.
// Picking a month inside that year keeps the chart in place.
function trendWindow(period: CashflowPeriodState): { end: string; period: CashflowPeriod; title: string } {
  const year = period.selection.range === 'all' ? Number((period.latestMonth ?? period.endMonth).slice(0, 4)) : period.selection.year
  return { end: monthKey(year, 12), period: 12, title: `${year} 年每月` }
}

// Dividends and interest in the period: income that came from holdings rather than work.
const passiveIncome = (group: CashflowCurrencySummary) => group.incomeCategories.filter(c => c.category === '股利' || c.category === '利息').reduce((n, c) => n + c.net, 0)

// One month of an already converted year as a group of its own; undefined when the month has no records.
function monthOf(year: CashflowCurrencySummary | undefined, month: string): CashflowCurrencySummary | undefined {
  const point = year?.months.find((m) => m.month === month)
  if (!year || !point || point.income === null || point.consumption === null || point.difference === null) return undefined
  const { income, consumption, difference, incomeCategories, consumptionCategories, excluded, exclusions, pending, investmentRecovery, coverage } = point
  return cashflowSummary({ months: [{ currency: year.currency, month, coverage, totals: { income, consumption, difference, incomeCategories, consumptionCategories, excluded, exclusions, pending, investmentRecovery } }] }, month, 1)[0]
}

function MonthBars({ group, selected, disabled, onSelect }: { group: CashflowCurrencySummary; selected: string; disabled?: boolean; onSelect: (month: string) => void }) {
  const [view, setView] = useState<'both' | 'consumption'>('both')
  const values = group.months.flatMap(m => view === 'both' ? [m.income ?? 0, m.consumption ?? 0] : [m.consumption ?? 0])
  const max = Math.max(1, ...values.map(Math.abs))
  const negative = values.some(value => value < 0)
  const height = (v: number | null) => `${Math.abs(v ?? 0) / max * 100}%`
  return <>
    <div className="cashflow-bars-controls"><div className="segmented" role="group" aria-label="圖表顯示">
      <button className={view === 'both' ? 'on' : ''} aria-pressed={view === 'both'} onClick={() => setView('both')}>收入與消費</button>
      <button className={view === 'consumption' ? 'on' : ''} aria-pressed={view === 'consumption'} onClick={() => setView('consumption')}>只看消費</button>
    </div><div className="cashflow-bars-legend">{view === 'both' && <span><i style={{ background: 'var(--s2)' }} />收入</span>}<span><i style={{ background: 'var(--s1)' }} />消費</span></div></div>
    {negative && <p className="muted small cashflow-negative-note">退款及沖回的負值顯示於零線下方。</p>}
    <div className="cashflow-bars" data-signed={negative || undefined} style={{ gridTemplateColumns: `repeat(${group.months.length}, minmax(0, 1fr))` }}>
    {group.months.map((m) => {
      const label = `${Number(m.month.slice(5, 7))} 月`
      const none = m.income === null && m.consumption === null
      return <button key={m.month} className={`cashflow-bar${m.month === selected ? ' on' : ''}`} onClick={() => onSelect(m.month)}
        disabled={disabled}
        aria-pressed={m.month === selected}
        aria-label={`${Number(m.month.slice(0, 4))} 年 ${label}：${none ? '無紀錄' : `收入 ${fmt(m.income ?? 0, 0)}，消費 ${fmt(m.consumption ?? 0, 0)}`}`}>
        <span className="cashflow-bar-pair" aria-hidden>
          {view === 'both' && <span data-series="income" data-sign={Math.sign(m.income ?? 0)} style={{ height: height(m.income), background: 'var(--s2)' }} title={`收入 ${fmt(m.income ?? 0, 0)}`} />}
          <span data-series="consumption" data-sign={Math.sign(m.consumption ?? 0)} style={{ height: height(m.consumption), background: 'var(--s1)' }} title={`消費 ${fmt(m.consumption ?? 0, 0)}`} />
        </span>
        <span className="cashflow-bar-label">{label}</span>
        {!none && <span className="cashflow-bar-tip" aria-hidden>收入 {fmt(m.income ?? 0, 0)}<br />消費 {fmt(m.consumption ?? 0, 0)}</span>}
      </button>
    })}
  </div></>
}

function CategoryList({ categories, income = false, onSelect }: { onSelect: (category:string)=>void; categories: CashflowCurrencySummary['consumptionCategories'] | CashflowCurrencySummary['incomeCategories']; income?: boolean }) {
  if (!categories.length) return <p className="muted small">沒有這類紀錄</p>
  return <ul className="cashflow-category-rows">
    {[...categories].sort((a, b) => b.net - a.net).map((c) => <li key={c.category}>
      <i aria-hidden style={{ background: cashflowColor(c.category, income) }} />
      <button onClick={()=>onSelect(c.category)}>{c.category}<small className="muted"> · {c.count} 筆</small></button>
      <span className="num-serif">{fmt(c.net, 0)}</span>
    </li>)}
  </ul>
}
