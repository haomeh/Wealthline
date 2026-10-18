import { useEffect, useId, useRef, useState } from 'react'
import type { ColoredSlice } from '../chartColors'

// The Overview ring stays static by default. A detail formatter opts into signed,
// keyboard/touch-accessible inspection without treating net change as a whole.
export function Donut({ slices, detail, note, label = '資產配置' }: { slices: ColoredSlice[]; detail?: (slice: ColoredSlice) => string; note?: string; label?: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const tooltipId = useId()
  const chart = useRef<HTMLDivElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 16, top: 16 })
  const shown = slices.filter((s) => s.share > 0)
  const ends = shown.map((_, i) => shown.slice(0, i + 1).reduce((n, s) => n + s.share * 100, 0))
  const stops = shown.map((s, i) => `${s.color} ${i ? ends[i - 1] : 0}% ${ends[i]}%`)
  const background = `conic-gradient(${stops.join(', ') || 'var(--hairline) 0 100%'})`
  const active = shown.find(s => s.label === (hover ?? focused ?? selected))
  useEffect(() => {
    if (!active) return
    const place = () => {
      const bounds = chart.current?.getBoundingClientRect(), tip = tooltip.current?.getBoundingClientRect()
      if (!bounds || !tip) return
      const left = Math.max(16, Math.min(bounds.left, window.innerWidth - tip.width - 16))
      const above = bounds.top - tip.height - 8
      const top = Math.max(16, Math.min(above >= 16 ? above : bounds.bottom + 8, window.innerHeight - tip.height - 16))
      setPosition({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [active])
  if (!detail) return <div className="donut" role="img" aria-label={slices.map((s) => `${s.label} ${(s.share * 100).toFixed(1)}%`).join('，')} style={{ background }} />
  const clear = () => { setHover(null); setFocused(null); setSelected(null) }
  const toggle = (name: string) => { if (selected === name) clear(); else setSelected(name) }
  const circumference = 2 * Math.PI * 41
  return <div ref={chart} className="donut-chart" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); clear() } }}>
    <div className="donut" role={shown.length ? 'group' : 'img'} aria-label={label} style={{ background: shown.length ? undefined : 'var(--hairline)' }}>
      {!!shown.length && <svg viewBox="0 0 100 100" aria-label={label}>
        {shown.map((s, i) => <circle key={s.label} className={`donut-segment${active && active.label !== s.label ? ' dim' : ''}`} cx="50" cy="50" r="41" fill="none" stroke={s.color} strokeWidth="18" strokeDasharray={`${s.share * circumference} ${circumference}`} strokeDashoffset={-(i ? ends[i - 1] / 100 : 0) * circumference} transform="rotate(-90 50 50)"
          role="button" tabIndex={0} aria-label={`${s.label} ${detail(s)}`} aria-describedby={active?.label === s.label ? tooltipId : undefined} data-cause={s.label} data-share={s.share}
          onPointerEnter={() => setHover(s.label)} onPointerLeave={() => setHover(null)}
          onFocus={() => { setHover(null); setFocused(s.label) }} onBlur={() => { setFocused(null); setSelected(null) }}
          onClick={() => toggle(s.label)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.label) } }} />)}
      </svg>}
    </div>
    {active && <div ref={tooltip} className="tip donut-tip" role="tooltip" id={tooltipId} style={position}><strong>{active.label}</strong><span>{detail(active)}</span>{note && <small>{note}</small>}</div>}
  </div>
}
