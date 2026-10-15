import { useCalendarNow } from '../useCalendarNow'
import { useState } from 'react'
import { fmt, pct } from '../format'
import { totalPoints, snapshotOf, type Snapshot } from '../history'
import type { WealthData } from '../model'
import type { HistoricalPoint } from '../quantityHistory'
import { TrendChart } from './TrendChart'

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
    <p className={`hero-change ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>
      <strong className="num">
        {signed(diff)}
        {previous.total > 0 && <small> {diff >= 0 ? '+' : '−'}{pct(Math.abs(diff) / previous.total)}</small>}
      </strong>
      <span className="muted small"> 較{gap === 1 ? '昨天' : ` ${shortDate(previous.date)} 的紀錄`}</span>
    </p>
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
