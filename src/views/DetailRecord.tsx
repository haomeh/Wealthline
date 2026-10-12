import type { ReactNode } from 'react'

// Use one row style for history sources, spending, and bank records.
export function DetailRecord({ title, value, label, meta, status, actions, children, className = '' }: {
  title: string; value: ReactNode; label: string; meta?: ReactNode; status?: ReactNode;
  actions?: ReactNode; children: ReactNode; className?: string
}) {
  return <article className={`detail-record ${className}`}>
    <details className="detail-record-details">
      <summary title={title}>
        <span className="record-sr-only">{label} · </span>
        <span className="detail-record-heading"><strong className="detail-record-title">{title}</strong>{status}</span>
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
