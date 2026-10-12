import type { ReactNode } from 'react'

// Browse a short summary; reveal the full source without opening an editor.
export function DetailRecord({ title, value, label, actions, children, className = '' }: {
  title: string; value: ReactNode; label: string; actions?: ReactNode; children: ReactNode; className?: string
}) {
  return <article className={`detail-record ${className}${actions ? ' has-actions' : ''}`}>
    <details className="detail-record-details">
      <summary title={title}>
        <span className="record-sr-only">{label} · </span>
        <strong className="detail-record-title">{title}</strong>
        <span className="detail-record-value">{value}</span>
      </summary>
      <div className="detail-record-content">{children}</div>
    </details>
    {actions && <div className="detail-record-actions">{actions}</div>}
  </article>
}
