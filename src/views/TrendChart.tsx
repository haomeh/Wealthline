import { useEffect, useRef, useState } from 'react'
import { fmt } from '../format'

export interface Series {
  key: string
  label: string
  color: string
  values: (number | null)[] // one per date
}

const HEIGHT = 260
const PAD = { top: 12, right: 16, bottom: 28, left: 60 }
const compact = (digits: number) => new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: digits })
// Enough digits that no two axis labels read the same.
function axisFormat(ticks: number[]): Intl.NumberFormat {
  for (let digits = 1; digits < 4; digits++) {
    const f = compact(digits)
    if (new Set(ticks.map((t) => f.format(t))).size === ticks.length) return f
  }
  return compact(4)
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1
    min -= pad
    max += pad
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const ticks: number[] = []
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

const shortDate = (d: string, withYear: boolean) => {
  const [y, m, day] = d.split('-')
  return withYear ? `${y}/${Number(m)}/${Number(day)}` : `${Number(m)}/${Number(day)}`
}

// Values over time on one shared axis, with a crosshair that lists every series on hover.
export function TrendChart({ dates, series, area = false, label = '資產走勢圖', currency = 'NT$', monthly = false, onSelect }: { dates: string[]; series: Series[]; area?: boolean; label?:string; currency?:string; monthly?:boolean; onSelect?:(date:string)=>void }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hoverIndex, setHover] = useState<number | null>(null)
  const hover = hoverIndex !== null && hoverIndex < dates.length ? hoverIndex : null

  const times = dates.map((d) => Date.parse(`${d}T00:00:00Z`))
  const t0 = times[0]
  const t1 = times[times.length - 1]
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v))
  const ticks = niceTicks(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 1)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const axis = axisFormat(ticks)
  const innerW = Math.max(width - PAD.left - PAD.right, 1)
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (t1 === t0 ? innerW / 2 : ((times[i] - t0) / (t1 - t0)) * innerW)
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH

  const multiYear = dates[0]?.slice(0, 4) !== dates[dates.length - 1]?.slice(0, 4)
  // Date labels at evenly spaced points, always keeping the first and last and
  // skipping any that would crowd a neighbor.
  const xLabels: number[] = []
  const want = Math.min(Math.max(2, Math.floor(innerW / 90)), dates.length)
  for (let k = 0; k < want; k++) {
    const i = want === 1 ? 0 : Math.round((k * (dates.length - 1)) / (want - 1))
    const last = i === dates.length - 1
    if (xLabels.includes(i)) continue
    while (last && xLabels.length > 1 && x(i) - x(xLabels[xLabels.length - 1]) <= 70) xLabels.pop()
    if (xLabels.length === 0 || x(i) - x(xLabels[xLabels.length - 1]) > 70) xLabels.push(i)
  }

  function nearest(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left + (PAD.left - 10)
    let best = 0
    for (let i = 1; i < dates.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    return best
  }

  const showDots = dates.length <= 40
  const tipLeft = hover !== null && x(hover) > width / 2

  return (
    <div className="trend" ref={ref}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {axis.format(t)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              className="axis"
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor={dates.length === 1 ? 'middle' : i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
            >
              {monthly ? multiYear ? dates[i].slice(0,7).replace('-', '/') : `${Number(dates[i].slice(5,7))}月` : shortDate(dates[i], multiYear)}
            </text>
          ))}
          {area && series.length === 1 && dates.length > 1 && series[0].values.every(v => v !== null) && (
            <path
              className="area"
              style={{ fill: series[0].color }}
              d={`M${x(0)},${y(lo)} ${series[0].values.map((v, i) => `L${x(i)},${y(v!)}`).join(' ')} L${x(dates.length - 1)},${y(lo)} Z`}
            />
          )}
          {series.map((s) => (
            <g key={s.key} style={{ color: s.color }}>
              {dates.length > 1 && <path className="line" d={s.values.map((v, i) => v === null ? '' : `${i && s.values[i-1] !== null ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} />}
              {(showDots || dates.length === 1) && s.values.map((v, i) => v !== null && <circle key={i} className="dot" cx={x(i)} cy={y(v)} r={3.5} />)}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
              {series.map((s) => s.values[hover] !== null && (
                <circle key={s.key} className="dot hot" style={{ color: s.color }} cx={x(hover)} cy={y(s.values[hover])} r={5} />
              ))}
            </g>
          )}
          <rect
            x={PAD.left - 10}
            y={0}
            width={innerW + 20}
            height={HEIGHT}
            fill="transparent"
            onPointerMove={e=>setHover(nearest(e))}
            onClick={e=>onSelect?.(dates[nearest(e)])}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && (
        <div
          className="tip trend-tip"
          style={tipLeft ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}
        >
          <strong>{monthly ? dates[hover].slice(0,7).replace('-', ' / ') : shortDate(dates[hover], true)}</strong>
          {[...series]
            .sort((a, b) => (b.values[hover] ?? -Infinity) - (a.values[hover] ?? -Infinity))
            .map((s) => (
              <span key={s.key} className="tip-row">
                {series.length > 1 && <i style={{ background: s.color }} />}
                {series.length > 1 && <span className="label">{s.label}</span>}
                <span className="value">{s.values[hover] === null ? monthly ? '無紀錄' : '資料不完整' : `${currency} ${fmt(s.values[hover], monthly ? 2 : 0)}`}</span>
              </span>
            ))}
        </div>
      )}
      {series.length > 1 && (
        <ul className="legend inline">
          {series.map((s) => (
            <li key={s.key}>
              <i style={{ background: s.color }} />
              <span className="label">{s.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
