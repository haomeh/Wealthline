import { fmt } from '../format'
import { localDate, type Snapshot } from '../history'
import type { WealthData } from '../model'
import type { HistoricalPoint } from '../quantityHistory'
import { Donut, type DonutSlice } from './Donut'
import { compareSnapshotAccounts } from '../snapshotAccountChange'
import { attributeAssetChange, type AssetAttribution } from '../assetChangeAttribution'

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), 0)}`
const effectLabel = (value: number | null) => value === null ? '尚無法拆解' : `NT$ ${signed(value)}`
const FACTORS = [
  { key: 'fx', label: '匯率影響' },
  { key: 'price', label: '價格影響' },
  { key: 'quantity', label: '餘額／持倉調整' },
] as const

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

// A record that leaves out an account holding value today, or counts it as 0 for lack of any record,
// would show that account's whole balance as a gain (a statement's balance for one account reads as +600%).
const covers = (point: HistoricalPoint, today: Snapshot) => point.total !== null && today.accounts.every((a) => {
  if (!a.value) return true
  const known = point.accounts.some((x) => x.id === a.id && x.value !== null)
  return known && !point.filled?.some((f) => f.id === a.id && f.from === null)
})
