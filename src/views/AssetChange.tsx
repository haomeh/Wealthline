import { useCalendarNow } from '../useCalendarNow'
import { useState } from 'react'
import { fmt, pct } from '../format'
import { totalPoints, snapshotOf, localDate, type Snapshot } from '../history'
import type { WealthData } from '../model'
import type { HistoricalPoint } from '../quantityHistory'
import { TrendChart } from './TrendChart'
import { Donut, type DonutSlice } from './Donut'
import { compareSnapshotAccounts } from '../snapshotAccountChange'
import { attributeAssetChange, type AssetAttribution, type AssetAttributionRow, type AssetEffects } from '../assetChangeAttribution'
import type { ValuationEntry } from '../valuationEvidence'

const RANGES = [
  { key: '7', label: '7 天', days: 7 },
  { key: '30', label: '30 天', days: 30 },
  { key: '90', label: '90 天', days: 90 },
  { key: 'all', label: '全部', days: Infinity },
] as const

const DAY = 86400_000
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY
const shortDate = (date: string) => date.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/')
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), 0)}`
const effectLabel = (value: number | null) => value === null ? '尚無法拆解' : `NT$ ${signed(value)}`
const FACTORS = [
  { key: 'fx', label: '匯率影響', note: '持有數量與原價格不變時，換算成新台幣的差異。' },
  { key: 'price', label: '價格影響', note: '原持有數量按目前匯率計算的價格差異，包含手動價格更新。' },
  { key: 'quantity', label: '餘額／持倉調整', note: '餘額、持倉數量或新增／移除項目的估值差異。' },
] as const

function attributionReason(result: AssetAttribution) {
  if (result.status === 'unknown') return '尚無法拆解：缺少相符的估值依據'
  if (result.status === 'partial') return '部分可拆解；仍有資料不足'
  const largest = [...FACTORS].sort((a, b) => Math.abs(result.effects[b.key] ?? 0) - Math.abs(result.effects[a.key] ?? 0))[0]
  return result.effects[largest.key] ? `主要為${largest.label}` : '估值因素沒有變動'
}

const evidenceNumber = (value: number | null | undefined) => value == null ? '未知' : fmt(value, 6)
function sourceLabel(entry: ValuationEntry | undefined, field: 'price' | 'rate') {
  if (!entry) return '無當期依據'
  if (field === 'price' && entry.type === 'cash') return '現金單價 1'
  if (field === 'rate' && entry.currency === 'TWD') return '新台幣換算 1'
  const manual = field === 'price' ? entry.priceManual : entry.rateManual
  const updated = field === 'price' ? entry.priceUpdatedAt : entry.rateUpdatedAt
  return `${manual ? '手動設定' : '自動報價'}${updated ? ` · ${updated.replace('T', ' ').replace(/\.\d+Z$/, 'Z')}` : ' · 更新時間未記錄'}`
}

function FactorEvidence({ row, factor }: { row: AssetAttributionRow; factor: keyof AssetEffects }) {
  const { before: b, after: a } = row
  return <li className="asset-attribution-evidence">
    <div className="asset-attribution-evidence-head"><strong>{row.account || row.accountId} · {row.currency}{row.symbol ? ` · ${row.symbol}` : ''}</strong><span className="num">{effectLabel(row.effects[factor])}</span></div>
    {row.reason ? <p className="muted small">{row.reason}</p> : <>
      {row.change !== 'matched' && <p className="muted small">{row.change === 'added' ? '新增項目，按目前估值列入調整' : '移除項目，按比較日估值列入調整'}</p>}
      <dl>
        <div><dt>數量</dt><dd className="num">{evidenceNumber(b?.quantity)} → {evidenceNumber(a?.quantity)}</dd></div>
        <div><dt>價格（{row.currency}）</dt><dd className="num">{evidenceNumber(b?.price)} → {evidenceNumber(a?.price)}</dd></div>
        <div><dt>匯率（TWD/{row.currency}）</dt><dd className="num">{evidenceNumber(b?.rate)} → {evidenceNumber(a?.rate)}</dd></div>
      </dl>
      <p className="muted small">價格依據：{sourceLabel(b, 'price')} → {sourceLabel(a, 'price')}</p>
      <p className="muted small">匯率依據：{sourceLabel(b, 'rate')} → {sourceLabel(a, 'rate')}</p>
    </>}
  </li>
}

function AttributionBody({ result, previous, today }: { result: AssetAttribution; previous?: HistoricalPoint; today: Snapshot }) {
  return <div className="asset-attribution-body">
      {previous && <p className="muted small">比較 {previous.date.replace(/-/g, '/')} → {today.date.replace(/-/g, '/')}；金額皆為新台幣。</p>}
      <div className="asset-attribution-factors">
        {FACTORS.map(f => <details className="asset-attribution-factor" key={f.key}>
          <summary><span>{f.label}</span><strong className="num">{effectLabel(result.effects[f.key])}</strong></summary>
          <div className="asset-attribution-factor-body">
            <p className="muted small">{f.note}</p>
            {result.status !== 'complete' && <p className="muted small">僅列出可核對的部分；未知項目不當作 0。</p>}
            {result.rows.length ? <ul>{result.rows.map(row => <FactorEvidence key={row.key} row={row} factor={f.key} />)}</ul> : <p className="muted small">缺少比較日期的逐項估值依據。</p>}
          </div>
        </details>)}
      </div>
      {result.status !== 'complete' && <div className="asset-attribution-residual">
        <span>未解釋差額</span><strong className="num">{result.residual === null ? '尚無法計算' : `NT$ ${signed(result.residual)}`}</strong>
        <p className="muted small">尚有缺少或不相符的估值依據。差額為 0 仍不代表完整拆解；缺少匯率的資產仍待確認。</p>
      </div>}
      <details className="asset-attribution-method">
        <summary>如何計算</summary>
        <p className="muted small">先匯率，再價格，最後數量。匯率影響＝原數量 × 原價格 × 匯率差；價格影響＝原數量 × 價格差 × 目前匯率；餘額／持倉調整＝數量差 × 目前價格 × 目前匯率。新增或移除項目按已知端點估值列入調整。</p>
        <p className="muted small">使用比較當時保存的估值依據；舊紀錄、補登或沿用值可能無法拆解。這些是估值差異，無法據此判定交易損益或現金流。</p>
      </details>
    </div>
}

function AttributionDetails({ previous, today }: { previous: HistoricalPoint; today: Snapshot }) {
  const result = attributeAssetChange(previous, today)
  return <details className="asset-attribution">
    <summary><span>{attributionReason(result)}</span><span className="asset-attribution-action">查看原因</span></summary>
    <AttributionBody result={result} previous={previous} today={today} />
  </details>
}

// Compare only an original snapshot from the actual local calendar yesterday.
// Historical valuation, interpolation and carried account values are not daily evidence.
export function DailyAssetChange({ data, today }: { data: WealthData; today: Snapshot }) {
  const calendar = new Date(today.at)
  calendar.setDate(calendar.getDate() - 1)
  const yesterday = localDate(calendar.toISOString())
  const candidates = data.history.snapshots.filter(p => p.date === yesterday && localDate(p.at) === yesterday && Number.isFinite(Date.parse(p.at)) && Date.parse(p.at) <= Date.parse(today.at))
  const candidate: HistoricalPoint | undefined = candidates.sort((a, b) => b.at.localeCompare(a.at))[0]
  const attribution = candidate ? attributeAssetChange(candidate, today) : undefined
  const aggregateComplete = candidate && candidate.total !== null && Number.isFinite(candidate.total) && candidate.accounts.every(a => a.value !== null && Number.isFinite(a.value)) && Math.abs(candidate.accounts.reduce((sum, a) => sum + (a.value ?? 0), 0) - candidate.total) < .01
  const previous = candidate && !candidate.manual && !candidate.periodDerived && !candidate.filled?.length && aggregateComplete && (attribution?.status === 'complete' || covers(candidate, today)) ? candidate : undefined
  const result: AssetAttribution = previous && attribution ? attribution : { status: 'unknown', delta: null, effects: { fx: null, price: null, quantity: null }, residual: null, unknownCount: 0, rows: [] }
  const missingFx = today.valuation?.entries.some(e => e.rate === null)
  const diff = result.delta
  const accountComparison = previous && result.status === 'unknown' ? compareSnapshotAccounts(previous, today) : null
  const causes: { id: string; label: string; value: number | null; color: string }[] = accountComparison
    ? accountComparison.rows.map((row, i) => ({ id: `account:${row.id}`, label: row.name, value: row.delta, color: `var(--s${i % 8 + 1})` }))
    : FACTORS.map((factor, i) => ({ id: `factor:${factor.key}`, label: factor.label, value: result.effects[factor.key], color: `var(--s${i + 1})` }))
  const residual = accountComparison ? accountComparison.residual : result.residual
  if ((accountComparison ? accountComparison.status !== 'complete' : result.status !== 'complete') && residual !== null && residual !== 0) causes.push({ id: 'residual', label: '未解釋差額', value: residual, color: 'var(--other)' })
  const nonzero = causes.filter((cause): cause is typeof cause & { value: number } => cause.value !== null && Number.isFinite(cause.value) && cause.value !== 0)
  const max = Math.max(...nonzero.map(c => Math.abs(c.value)), 0)
  const magnitude = nonzero.reduce((sum, cause) => sum + Math.abs(cause.value) / max, 0)
  const slices: DonutSlice[] = nonzero.map(cause => ({ ...cause, share: Math.abs(cause.value) / max / magnitude }))
  const note = accountComparison ? accountComparison.status === 'complete' ? '帳戶差額' : '帳戶差額・部分資料不足' : !previous ? '沒有昨天的完整快照，尚無法比較。' : result.status === 'partial' ? '部分可拆解，仍有資料不足。' : result.status === 'unknown' ? '尚無法拆解，缺少相符估值依據。' : slices.length ? '' : '已知估值因素的淨影響皆為 0。'
  const accountBasis = accountComparison ? `帳戶差額：比較快照記錄的新台幣帳戶值，尚未拆分匯率、價格或持倉原因。${accountComparison.status !== 'complete' ? '仍有未知項目；未解釋差額為 0 也不代表資料完整。' : ''}` : ''
  const chartBasis = accountComparison ? '圓環依各帳戶差額的絕對金額繪製，非淨變動占比。' : result.status !== 'complete' ? '資料不完整；未解釋差額為 0 也不代表完整拆解。' : '圓環依各因素絕對金額繪製，非淨變動占比。'
  const basis = previous ? `${accountBasis}以昨天 ${previous.date.replaceAll('-', '/')} ${new Date(previous.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })} 的紀錄比較目前估值。${chartBasis}${missingFx ? '有資產缺少匯率，僅含可換算部分。' : ''}` : '沒有昨天的完整快照。'
  const chartLabel = accountComparison
    ? slices.length ? '帳戶差額，依絕對金額繪製，原因尚未拆解' : accountComparison.status === 'complete' ? '帳戶差額皆為零，原因尚未拆解' : '帳戶資料不足，尚有未知差額'
    : slices.length ? '資產變動原因，依絕對金額繪製' : !previous ? '尚無法比較資產變動原因' : result.status !== 'complete' ? '資料不足，尚無法拆解原因' : '已知估值因素淨影響為零'
  return <section className="panel daily-asset-change" aria-label="今日資產變動">
    <div className="tile-stat daily-change-head">
      <h3 className="tile-label">今日資產變動</h3>
      <strong className={`daily-change-delta num ${diff !== null && diff > 0 ? 'up' : diff !== null && diff < 0 ? 'down' : ''}`}>{diff === null ? '尚無法比較' : <><small>NT$ </small>{signed(diff)}</>}</strong>
    </div>
    <div className="daily-change-chart"><Donut slices={slices} detail={slice => effectLabel(slice.value)} note={basis} label={chartLabel} /></div>
    {(note || missingFx) && <p className="daily-change-note muted small" role={result.status !== 'complete' ? 'status' : undefined}>{note}{missingFx && ' 缺少匯率。'}</p>}
  </section>
}

// How the total moved: against the previous record on the hero, and over a chosen range below.
function useAssetChange(data: WealthData) {
  const now = useCalendarNow()
  const points = totalPoints(data, now)
  return { points, today: points[points.length - 1] }
}

// A record that leaves out an account holding value today, or counts it as 0 for lack of any record,
// would show that account's whole balance as a gain (a statement's balance for one account reads as +600%).
const covers = (point: HistoricalPoint, today: Snapshot) => point.total !== null && today.accounts.every((a) => {
  if (!a.value) return true
  const known = point.accounts.some((x) => x.id === a.id && x.value !== null)
  return known && !point.filled?.some((f) => f.id === a.id && f.from === null)
})

export function ChangeSinceLast({ data }: { data: WealthData }) {
  const { points } = useAssetChange(data)
  const now = useCalendarNow()
  const today = snapshotOf(data, now)
  // Compare with the latest earlier record that covers every account; none shows nothing.
  const previous = points.slice(0, -1).reverse().find((p) => p.date < today.date && covers(p, today))
  if (!previous || previous.total === null) return null
  const diff = today.total - previous.total
  const gap = dayNumber(today.date) - dayNumber(previous.date)
  return (
    <div className="asset-change-since-last">
    <p className={`hero-change ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>
      <strong className="num">
        {signed(diff)}
        {previous.total > 0 && <small> {diff >= 0 ? '+' : '−'}{pct(Math.abs(diff) / previous.total)}</small>}
      </strong>
      <span className="muted small"> 較{gap === 1 ? '昨天' : ` ${shortDate(previous.date)} 的紀錄`}</span>
    </p>
    <AttributionDetails previous={previous} today={today} />
    </div>
  )
}

export function AssetChange({ data }: { data: WealthData }) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30')
  const { points, today } = useAssetChange(data)
  const days = RANGES.find((r) => r.key === range)!.days

  // Start from the last record at or before the range's edge; when records begin later, from the first one.
  const edge = dayNumber(today.date) - days
  let startIndex = 0
  points.forEach((p, i) => {
    if (dayNumber(p.date) <= edge) startIndex = i
  })
  const shown = points.slice(startIndex)
  const base = shown[0]
  const diff = today.total === null || base.total === null ? null : today.total - base.total

  return (
    <section className="panel span-2 asset-change">
      <div className="panel-head">
        <h3>資產變化</h3>
        <div className="segmented" role="group" aria-label="期間">
          {RANGES.map((r) => (
            <button key={r.key} className={r.key === range ? 'on' : ''} aria-pressed={r.key === range} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      {(data.history.quantityDays?.length || data.history.holdingPeriods?.length) ? <p className="muted small">含單日補登及持有期間的歷史估值；目前總資產仍以現有持倉計算。資料不完整的日期保留缺口。</p> : null}
      {shown.length < 2 ? (
        <p className="muted">
          目前只有一天的紀錄。每天第一次登入時會自動記一筆，累積幾天之後，這裡就會顯示總資產的變化。
        </p>
      ) : (
        <>
          <p className="change-figure">
            <strong className="num">
              {diff === null ? '資料不完整' : signed(diff)} <small>NT$</small>
            </strong>
            {diff !== null && base.total !== null && base.total > 0 && <span className="num"> {diff >= 0 ? '+' : '−'}{pct(Math.abs(diff) / base.total)}</span>}
            <span className="muted small">
              {' '}自 {base.date.replace(/-/g, '/')}（{base.total === null ? '資料不完整' : `NT$ ${fmt(base.total, 0)}`}）
            </span>
          </p>
          <TrendChart dates={shown.map((p) => p.date)} series={[{ key: 'total', label: '總資產', color: 'var(--s1)', values: shown.map((p) => p.total) }]} area />
          {days !== Infinity && dayNumber(points[0].date) > edge && (
            <p className="muted small chart-note">最早的紀錄是 {points[0].date.replace(/-/g, '/')}，所以這段期間比實際選的短。</p>
          )}
        </>
      )}
    </section>
  )
}
