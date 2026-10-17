import type { HTMLAttributes, ReactNode, SyntheticEvent } from 'react'

export type RecordProps = HTMLAttributes<HTMLElement> & { [data: `data-${string}`]: string | undefined }

// Use one row style for history sources, spending, and bank records.
// `subtitle`: a second, smaller line under the title (date, source, category).
// `articleProps`: extra attributes and handlers for the row, such as a swipe gesture.
// A title too long for the row ends in …; pointing at the row (or focusing it) shows it in full
// in a bubble, and opening the row shows the whole description.
export function DetailRecord({ title, value, label, meta, status, subtitle, actions, children, className = '', articleProps }: {
  title: string; value: ReactNode; label: string; meta?: ReactNode; status?: ReactNode; subtitle?: ReactNode;
  actions?: ReactNode; children: ReactNode; className?: string; articleProps?: RecordProps
}) {
  const heading = <span className="detail-record-heading" data-full={title}><strong className="detail-record-title">{title}</strong>{status}</span>
  return <article {...articleProps} className={`detail-record ${className}`}>
    <details className="detail-record-details">
      <summary onPointerEnter={markClipped} onFocus={markClipped}>
        <span className="record-sr-only">{label} · </span>
        {subtitle ? <span className="detail-record-main">{heading}<span className="detail-record-subtitle">{subtitle}</span></span> : heading}
        <span className="detail-record-secondary">
          {meta && <span className="detail-record-meta">{meta}</span>}
          <span className="detail-record-value">{value}</span>
        </span>
      </summary>
      <div className="detail-record-content">{children}</div>
    </details>
    {actions && <div className="detail-record-actions">{actions}</div>}
  </article>
}

// Marks the heading whose title is cut off, so only those show the full-title bubble.
function markClipped(e: SyntheticEvent<HTMLElement>) {
  const title = e.currentTarget.querySelector<HTMLElement>('.detail-record-title')
  title?.parentElement?.toggleAttribute('data-clipped', title.scrollWidth > title.clientWidth + 1)
}
