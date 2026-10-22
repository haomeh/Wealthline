import { useState } from 'react'
import { fmt, pct } from '../format'
import type { ColoredSlice } from '../chartColors'

// Part-to-whole as one horizontal stacked bar plus a legend that carries the numbers.
export function Allocation({ slices }: { slices: ColoredSlice[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = slices.filter((s) => s.share > 0)
  return (
    <div className="alloc">
      <div className="alloc-bar" role="img" aria-label={shown.map((s) => `${s.label} ${pct(s.share)}`).join('，')}>
        {shown.map((s, i) => (
          <span
            key={s.label}
            style={{ flexGrow: s.share, background: s.color }}
            className={hover === null || hover === i ? '' : 'dim'}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {hover !== null && shown[hover] && (
          <div className="tip">
            <strong>{shown[hover].label}</strong>
            <span>
              NT$ {fmt(shown[hover].value, 0)} · {pct(shown[hover].share)}
            </span>
          </div>
        )}
      </div>
      <ul className="legend">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={hover === null || shown[hover]?.label === s.label ? '' : 'dim'}
            onMouseEnter={() => setHover(shown.indexOf(s) >= 0 ? shown.indexOf(s) : null)}
            onMouseLeave={() => setHover(null)}
            data-i={i}
          >
            <i style={{ background: s.color }} />
            <span className="label">{s.label}</span>
            <span className="value">{fmt(s.value, 0)}</span>
            <span className="share">{pct(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
