import { useCalendarNow } from '../useCalendarNow'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { ActionIcon } from './ActionIcon'
import { Logo } from './Site'
import type { HistoricalPoint } from '../quantityHistory'
import { snapshotOf, totalPoints } from '../history'
import { seriesFor, MODES, type Mode } from './historySeries'
import { SnapshotDetails } from './SnapshotDetails'
import { TrendChart } from './TrendChart'
import { useHistoricalValuations } from '../useHistoricalValuations'
import { balanceSheet } from '../liabilities'
import { projectLiability } from '../loanSchedule'
import { fmt } from '../format'
import {
  CATEGORIES,
  COMMON_CURRENCIES,
  COUNTRIES,
  breakdown,
  countryLabel,
  accountLabel,
  missingRates,
  type WealthData,
} from '../model'
import { colorize } from '../chartColors'
import { ChangeSinceLast } from './AssetChange'
import { accountChange } from '../accountTrend'
import { missingStatementAssets } from '../bankStatementAssets'
import type { ColoredSlice } from '../chartColors'
import { CashflowSummary } from './CashflowSummary'
import type { CashflowMonthTotals } from '../cashflow'
import { useCashflowPeriod, useTwdCashflow } from '../cashflowPeriod'
import type { Change, Snapshot } from '../history'

// Earlier years of history that are not loaded: the last snapshot of each month, the edits
// that carry holding quantities past them, and the first day the loaded history covers.
export interface ArchiveSummary {
  points: Snapshot[]
  carried: Change[]
  from: string
}

interface Props {
  data: WealthData
  onGoHistory?: (date?: string) => void
  onGoRates: () => void
  onGoLiabilities?: () => void
  onNewAccount: () => void
  onImport: () => void
  onOpenAccount: (id: string) => void
  onGoExpenses?: () => void
  onGoBankTransactions?: () => void
  // When transactions are not loaded: their monthly totals (dataSummary.ts).
  cashflowMonths?: CashflowMonthTotals[]
  // When earlier years of history are not loaded.
  archive?: ArchiveSummary
  onLoadHistory?: () => void
  loadingHistory?: boolean
  // Phone only: the account list's 全部 link, the month tile's target and the save state in the header.
  onGoAccounts?: () => void
  onGoCashflow?: () => void
  status?: ReactNode
}

export function Overview({ data: loaded, onGoHistory, onGoRates, onGoLiabilities, onNewAccount, onImport, onOpenAccount, onGoExpenses, onGoBankTransactions, cashflowMonths, archive, onLoadHistory, loadingHistory, onGoAccounts, onGoCashflow, status }: Props) {
  const now = useCalendarNow()
  const data = archive ? { ...loaded, history: { ...loaded.history, snapshots: [...archive.points, ...loaded.history.snapshots], changes: [...archive.carried, ...loaded.history.changes] } } : loaded
  const estimated = data.liabilities?.some(d => d.schedule)
  // Without the earlier years, holding quantities are only known from where the loaded history starts.
  const historical = useHistoricalValuations(data, archive?.from)
  const [selected, setSelected] = useState('current')
  const [mode, setMode] = useState<Mode>('total')
  const [range, setRange] = useState<Range>('all')
  const live = snapshotOf(data, now)
  const points: HistoricalPoint[] = [...totalPoints(historical.data, now).filter(p => p.date !== live.date || p.manual), live]
  const allPoints = totalPoints(historical.data, now)
  const chartPoints = allPoints.filter(p => p.date >= rangeStart(range, now))
  const accountNames = new Map(allPoints.flatMap(p => p.accounts.map(a => [a.id, accountLabel({ name: a.name, country: historical.data.history.valuedQuantityDays?.find(d => d.date === p.date)?.entries.find(e => e.accountId === a.id)?.country ?? data.accounts.find(x => x.id === a.id)?.country })] as const)))
  const keys = points.map((p, i) => i === points.length - 1 ? 'current' : p.date)
  const index = Math.max(0, keys.includes(selected) ? keys.indexOf(selected) : points.length - 1)
  const point = points[index]
  const current = keys[index] === 'current'
  const cashflowInput = { expenses: data.expenses, expenseRules: data.expenseCategoryRules, bankTransactions: data.bankTransactions, bankRules: data.bankCategoryRules, months: cashflowMonths }
  const cashflowPeriod = useCashflowPeriod(cashflowInput, now)
  const monthFlow = useTwdCashflow(cashflowInput, cashflowPeriod.endMonth, cashflowPeriod.period, cashflowPeriod.today)
  const cashflow = (cashflowMonths ? cashflowMonths.length > 0 : !!(data.expenses?.length || data.bankTransactions?.length)) &&
    <CashflowSummary expenses={data.expenses} expenseRules={data.expenseCategoryRules} bankTransactions={data.bankTransactions} bankRules={data.bankCategoryRules} months={cashflowMonths} now={now} onGoExpenses={onGoExpenses} onGoBankTransactions={onGoBankTransactions}/>
  if (data.accounts.length === 0 && !data.liabilities?.length && points.length === 1) {
    return (
      <div className="overview"><section className="panel empty span-2">
        <div className="empty-mark" aria-hidden>
          ＄
        </div>
        <h2>開始記錄你的資產</h2>
        <p className="muted">先建立銀行或投資帳戶，再填入餘額與持倉。也可以直接貼上現有的試算表。</p>
        <div className="row center">
          <button className="primary" onClick={onNewAccount}>
            建立第一個帳戶
          </button>
          {onGoLiabilities && <button onClick={onGoLiabilities}>新增負債</button>}
          <button onClick={onImport}>從試算表或 CSV 匯入</button>
        </div>
      </section>{cashflow}</div>
    )
  }

  const totals = balanceSheet(data, now)
  const missing = missingRates(data)
  const unlinked = missingStatementAssets(data)
  const byCategory = breakdown(data, (a) => a.category)
  const accounts = breakdown(data, accountLabel).slices
  const hasCountry = data.accounts.some((a) => a.country)
  const netChange = monthChange(allPoints, now)
  // One scheduled loan: show how much of it is repaid, as the phone design does.
  const loan = data.liabilities?.length === 1 && data.liabilities[0].schedule ? data.liabilities[0] : undefined
  const repaid = loan && loan.balance > 0 ? projectLiability(loan, now).principalRepaid / loan.balance : null
  const month = monthFlow.groups[0]

  return (
    <div className="overview">
      <div className="page-head overview-head">
        <div className="overview-title">
          <Logo size={30} className="mobile-only" />
          <h2>總覽</h2>
          <p className="muted small desktop-only">
            {data.accounts.length} 個帳戶
            {data.fxUpdatedAt && ` · 匯率更新於 ${new Date(data.fxUpdatedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <div className="row">
          {status && <span className="mobile-only">{status}</span>}
          {!current && <button onClick={() => setSelected('current')}>回到目前</button>}
          {onGoHistory && <button className={current ? 'desktop-only' : ''} onClick={() => onGoHistory(current ? undefined : point.date)}>{current ? '查看歷史明細' : '查看這天的明細'}</button>}
        </div>
      </div>
      {current && unlinked.length > 0 && (
        <p className="notice">
          <span aria-hidden>⚠</span> 已匯入帳單的 {unlinked.map((u) => u.label).join('、')} 還沒有資產帳戶，目前總資產沒有算進去。
          {onGoAccounts && <button className="link" onClick={onGoAccounts}>到帳戶頁建立</button>}
        </p>
      )}
      {current && missing.length > 0 && (
        <p className="notice">
          <span aria-hidden>⚠</span> {missing.join('、')} 沒有匯率；資產總額可能不完整，相關負債與淨資產暫不換算。
          <button className="link" onClick={onGoRates}>
            查看匯率
          </button>
        </p>
      )}
      <div className="tiles overview-tiles">
        <section className={`panel ${current ? 'span-3' : 'span-4'} snapshot-timeline`} aria-label="資產時間線">
          <div className="trend-head">
            {current ? <div className="hero">
              <span className="eyebrow">總資產</span>
              <div className="hero-figure num-serif">
                <small>NT$</small>
                {fmt(byCategory.total, 0)}
              </div>
              <ChangeSinceLast data={historical.data} />
            </div> : <div><span className="eyebrow">資產時間線</span><h3>{point.date.replaceAll('-', '/')}</h3></div>}
            <div className="trend-controls">
              <div className="segmented trend-mode" role="group" aria-label="顯示方式">{(Object.keys(MODES) as Mode[]).map(m => <button key={m} aria-pressed={m === mode} className={m === mode ? 'on' : ''} onClick={() => setMode(m)}>{MODES[m]}</button>)}</div>
              <div className="segmented trend-range" role="group" aria-label="期間">{(Object.keys(RANGES) as Range[]).map(r => <button key={r} aria-pressed={r === range} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>{RANGES[r]}</button>)}</div>
            </div>
          </div>
          <TrendChart dates={chartPoints.map(p => p.date)} series={seriesFor(mode, chartPoints, accountNames)} area={mode === 'total'} />
          <details className="timeline-browse">
            <summary>瀏覽過去的快照<span className="muted small">{current ? '目前資產' : point.date.replaceAll('-', '/')}</span></summary>
            <div className="timeline-controls">
              <div className="timeline-navigation">
                <button className="timeline-arrow" aria-label="上一筆快照" title="上一筆快照" disabled={index === 0} onClick={() => setSelected(keys[index - 1])}><ActionIcon name="previous" /></button>
                <div className="timeline-range">
                  <div className="timeline-selection"><span>{current ? '目前' : point.periodDerived ? '期間推算' : point.manual ? '補登快照' : '原始快照'}</span><strong>{current ? '最新餘額' : point.date.replaceAll('-', '.')}</strong></div>
                  <input type="range" aria-label="資產快照時間線" aria-valuetext={current ? '目前資產' : point.date} min={0} max={points.length - 1} step={1} value={index} disabled={points.length < 2} style={{ '--timeline-progress': `${points.length > 1 ? index / (points.length - 1) * 100 : 100}%` } as CSSProperties} onChange={e => setSelected(keys[Number(e.target.value)])} />
                  <div className="timeline-endpoints" aria-hidden="true"><span>{points[0].date.replaceAll('-', '/')}</span><span>{points.length} 個節點</span><span>目前</span></div>
                </div>
                <button className="timeline-arrow" aria-label="下一筆快照" title="下一筆快照" disabled={index === points.length - 1} onClick={() => setSelected(keys[index + 1])}><ActionIcon name="next" /></button>
              </div>
              <label className="field"><span>選擇時間節點</span><select value={keys[index]} onChange={e => setSelected(e.target.value)}>{points.map((p, i) => <option key={keys[i]} value={keys[i]}>{keys[i] === 'current' ? '目前資產' : `${p.date}${p.periodDerived ? ' · 期間推算' : p.manual ? ' · 補登' : ''}`}</option>)}</select></label>
            </div>
            <p className="muted small">拖動滑桿或選擇紀錄，查看當時的餘額與配置。原始快照保留原值；期間推算補上缺少快照的日期，單日補登優先。</p>
          </details>
          {archive && onLoadHistory && <p className="muted small">{archive.from.slice(0, 4)} 年以前只顯示每月最後一筆原始快照，不含補登與期間推算。<button className="link" disabled={loadingHistory} onClick={onLoadHistory}>{loadingHistory ? '載入中…' : '載入完整歷史'}</button></p>}
          {!!(data.history.quantityDays?.length || data.history.holdingPeriods?.length) && <button className="link" disabled={historical.loading} onClick={historical.refresh}>{historical.loading ? '查詢歷史行情中…' : '重新查詢歷史行情'}</button>}
          {historical.omittedDays > 0 && <p className="muted small">略過 {historical.omittedDays} 個數量不足的推算日，不代表資產為零。</p>}
          {historical.status && <p className="muted small" aria-live="polite">{historical.status}</p>}
          {historical.error && <p role="alert" className="banner error">{historical.error}</p>}
        </section>
        {current && <>
          <section className="panel deep tile-stat overview-net" aria-label="淨資產">
            <span>{estimated ? '淨資產（預估）' : '淨資產'}</span>
            <strong>{totals.net === null ? '尚無法換算' : <><small>NT$ </small>{fmt(totals.net, 0)}</>}</strong>
            <small>{totals.net === null ? '總資產 − 總負債 · 請檢查匯率' : netChange === null ? '總資產 − 總負債' : `較上月 ${netChange >= 0 ? '+' : '−'}${Math.abs(netChange * 100).toFixed(1)}%`}</small>
          </section>
          <section className="panel tile-stat overview-debt" aria-label="總負債">
            <span>{loan ? `負債 · ${loan.name}` : estimated ? '總負債（含預估）' : '總負債'}</span>
            <strong>{totals.liabilities === null ? '尚無法換算' : <><small>NT$ </small>{fmt(totals.liabilities, 0)}</>}</strong>
            {repaid !== null ? <div className="meter" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, repaid * 100))}%` }} /></div>
              : !!totals.liabilities && byCategory.total > 0 && <div className="meter" aria-hidden><span style={{ width: `${Math.min(100, totals.liabilities / byCategory.total * 100)}%` }} /></div>}
            {repaid !== null ? <small>已還 {(repaid * 100).toFixed(1)}%（預估）<span className="desktop-only"> · 假設按期還款；不代表銀行餘額，不會扣除現金</span></small>
              : <small>{data.liabilities?.length ?? 0} 筆{estimated ? <span className="desktop-only"> · 假設按期還款；不代表銀行餘額，不會扣除現金</span> : '手動記錄'}{!!totals.liabilities && byCategory.total > 0 && ` · 占總資產 ${(totals.liabilities / byCategory.total * 100).toFixed(1)}%`}</small>}
            {onGoLiabilities && <button className="link" onClick={onGoLiabilities}>管理負債 →</button>}
          </section>
          {month && <MonthTile label={`${cashflowPeriod.selection.month} 月收支`} income={month.income} consumption={month.consumption} difference={month.difference} currency={month.currency} onClick={onGoCashflow} />}
          {data.accounts.length > 0 && <>
            <section className={`panel ${hasCountry ? '' : 'span-2 '}overview-share`} aria-label="資產配置">
              <span className="tile-label">類別</span>
              <div className="overview-donut-row"><Donut slices={colorize(byCategory.slices, CATEGORIES)} /><ShareLegend slices={colorize(byCategory.slices, CATEGORIES)} /></div>
            </section>
            <section className="panel overview-share" aria-label="幣別曝險">
              <span className="tile-label">幣別曝險</span>
              <ShareBar slices={colorize(breakdown(data, (_, p) => p.currency).slices, COMMON_CURRENCIES)} />
            </section>
            {hasCountry && <section className="panel overview-share" aria-label="國家">
              <span className="tile-label">國家</span>
              <ShareBar slices={colorize(breakdown(data, (a) => (a.country ? countryLabel(a.country) : '')).slices, Object.values(COUNTRIES))} />
            </section>}
            <section className="panel span-4 overview-accounts" aria-label="帳戶">
              <div className="overview-accounts-head mobile-only"><strong>帳戶</strong>{onGoAccounts && <button className="link" onClick={onGoAccounts}>全部 {data.accounts.length} 個 ›</button>}</div>
              <ul className="rank account-strip">
                {accounts.slice(0, 3).map((slice) => {
                  const account = data.accounts.find(a => accountLabel(a) === slice.label)
                  const change = account ? accountChange(data, account, now) : null
                  return <li key={slice.label}><button onClick={() => account && onOpenAccount(account.id)}>
                    <span className="label">{slice.label}</span>
                    <strong className="num-serif">{fmt(slice.value, 0)}</strong>
                    <span className={`small ${change === null || Math.abs(change) < 0.0005 ? 'muted' : change > 0 ? 'up' : 'down'}`} title="與 30 天前的每日紀錄比較">{change === null ? `${(slice.share * 100).toFixed(1)}%` : `${change > 0 ? '↑' : change < 0 ? '↓' : ''} ${Math.abs(change * 100).toFixed(1)}% · 30 天`}</span>
                  </button></li>
                })}
                {accounts.length > 3 && <li className="account-strip-rest">
                  <span className="label">其他 {accounts.length - 3} 個帳戶</span>
                  <strong className="num-serif">{fmt(accounts.slice(3).reduce((n, x) => n + x.value, 0), 0)}</strong>
                  <span className="muted small">{(accounts.slice(3).reduce((n, x) => n + x.share, 0) * 100).toFixed(1)}%</span>
                </li>}
              </ul>
            </section>
          </>}
          {!data.accounts.length && <section className="panel span-2"><p className="muted">尚未記錄資產，目前總資產為 0。</p><button onClick={onNewAccount}>新增資產帳戶</button></section>}
        </>}
      </div>
      {!current && <div className="overview-snapshot"><SnapshotDetails data={data} point={point} day={historical.data.history.valuedQuantityDays?.find(d => d.date === point.date)} onBackfill={onGoHistory} /></div>}
      {cashflow}
    </div>
  )
}

type Range = '1m' | '3m' | '1y' | 'all'
const RANGES: Record<Range, string> = { '1m': '1 個月', '3m': '3 個月', '1y': '1 年', all: '全部' }
const monthsBack = (now: string, months: number) => {
  const d = new Date(now)
  d.setMonth(d.getMonth() - months)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function rangeStart(range: Range, now: string) {
  return range === 'all' ? '' : monthsBack(now, range === '1m' ? 1 : range === '3m' ? 3 : 12)
}

// Net worth against the last record at least a month old; null without one.
function monthChange(points: HistoricalPoint[], now: string) {
  const edge = monthsBack(now, 1)
  const base = points.filter((p) => p.date <= edge && p.netWorth != null).at(-1)
  const today = points.at(-1)
  if (!base?.netWorth || today?.netWorth == null) return null
  return (today.netWorth - base.netWorth) / Math.abs(base.netWorth)
}

// The phone's month tile: the difference and two bars, income and spending.
function MonthTile({ label, income, consumption, difference, currency, onClick }: { label: string; income: number; consumption: number; difference: number; currency: string; onClick?: () => void }) {
  const max = Math.max(income, consumption, 1)
  const bar = (n: number) => `${Math.max(4, Math.max(0, n) / max * 100)}%`
  return <button className="panel tile-stat overview-month mobile-only" onClick={onClick} aria-label={`${label}：收入 ${fmt(income, 0)}，消費 ${fmt(consumption, 0)}，差額 ${fmt(difference, 0)} ${currency}`}>
    <span>{label}{currency !== 'TWD' && ` · ${currency}`}</span>
    <strong className={difference >= 0 ? 'up' : 'down'}>{difference >= 0 ? '+' : '−'}{fmt(Math.abs(difference), 0)}</strong>
    <span className="month-bars" aria-hidden><i style={{ height: bar(income), background: 'var(--s2)' }} /><i style={{ height: bar(consumption), background: 'var(--s1)' }} /></span>
    <span className="month-labels" aria-hidden><span>收入</span><span>消費</span></span>
  </button>
}

// The three largest parts and the rest as 其他.
function topSlices(slices: ColoredSlice[]) {
  const shown = slices.filter((s) => s.share > 0)
  const rest = shown.slice(3).reduce((n, x) => n + x.share, 0)
  return { head: shown.slice(0, 3), rest }
}

function Donut({ slices }: { slices: ColoredSlice[] }) {
  const shown = slices.filter((s) => s.share > 0)
  const ends = shown.map((_, i) => shown.slice(0, i + 1).reduce((n, s) => n + s.share * 100, 0))
  const stops = shown.map((s, i) => `${s.color} ${i ? ends[i - 1] : 0}% ${ends[i]}%`)
  return <div className="donut" role="img" aria-label={slices.map((s) => `${s.label} ${(s.share * 100).toFixed(1)}%`).join('，')} style={{ background: `conic-gradient(${stops.join(', ') || 'var(--hairline) 0 100%'})` }} />
}

function ShareLegend({ slices }: { slices: ColoredSlice[] }) {
  const { head, rest } = topSlices(slices)
  return <ul className="share-legend">
    {head.map((s) => <li key={s.label}><i style={{ background: s.color }} /><span>{s.label}</span><span className="muted">{(s.share * 100).toFixed(1)}%</span></li>)}
    {rest > 0 && <li><i style={{ background: 'var(--other)' }} /><span className="muted">其他</span><span className="muted">{(rest * 100).toFixed(1)}%</span></li>}
  </ul>
}

function ShareBar({ slices }: { slices: ColoredSlice[] }) {
  const { head, rest } = topSlices(slices)
  return <>
    <div className="tile-bar" role="img" aria-label={slices.map((s) => `${s.label} ${(s.share * 100).toFixed(1)}%`).join('，')}>
      {head.map((s) => <span key={s.label} style={{ flex: s.share, background: s.color }} />)}
      {rest > 0 && <span style={{ flex: rest, background: 'var(--other)' }} />}
    </div>
    <ShareLegend slices={slices} />
  </>
}
