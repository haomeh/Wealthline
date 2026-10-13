import type { HTMLAttributes, ReactNode } from 'react'

export type RecordProps = HTMLAttributes<HTMLElement> & { [data: `data-${string}`]: string | undefined }

// Use one row style for history sources, spending, and bank records.
// `subtitle`: a second, smaller line under the title (date, source, category).
// `articleProps`: extra attributes and handlers for the row, such as a swipe gesture.
export function DetailRecord({ title, value, label, meta, status, subtitle, actions, children, className = '', articleProps }: {
  title: string; value: ReactNode; label: string; meta?: ReactNode; status?: ReactNode; subtitle?: ReactNode;
  actions?: ReactNode; children: ReactNode; className?: string; articleProps?: RecordProps
}) {
  const heading = <span className="detail-record-heading"><strong className="detail-record-title">{title}</strong>{status}</span>
  return <article {...articleProps} className={`detail-record ${className}`}>
    <details className="detail-record-details">
      <summary title={title}>
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
