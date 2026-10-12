// A small area line of values over time, filling its box; no axes.
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values), max = Math.max(...values)
  const span = max - min || 1
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 1000} ${220 - ((v - min) / span) * 200}`)
  const line = `M${points.join(' L')}`
  return (
    <svg className="sparkline" viewBox="0 0 1000 240" preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={`${line} L1000 240 L0 240 Z`} className="sparkline-area" />
      <path d={line} className="sparkline-line" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
