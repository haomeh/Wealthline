import { useState, type ReactNode } from 'react'
import type { StatementKind } from '../statementKind'
import type { ImportPlan } from './StatementImportEntry'

/** Per kind: the import's closing message, once confirmed or cancelled. */
export type BatchResults = Partial<Record<StatementKind, string>>
const TAB_NAMES: Record<StatementKind, string> = { card: '信用卡帳單', bank: '銀行對帳單', securities: '證券帳戶' }

// A detected batch: the card, bank and securities statement imports side by side, one tab each. Both stay mounted,
// so a parsed preview survives switching tabs; each tab confirms or cancels its own kind.
// `dirty`: there are unsaved edits, so the closing summary asks for a save only then.
export function StatementImportBatch({ plan, card, bank, securities, onClose, dirty = true }: { plan: ImportPlan & { results: BatchResults }; card: ReactNode; bank: ReactNode; securities: ReactNode; onClose: () => void; dirty?: boolean }) {
  const done = plan.results
  const kinds = (['card', 'bank', 'securities'] as const).filter((k) => plan[k].length)
  const [chosen, setChosen] = useState<StatementKind>(kinds[0] ?? 'card')
  // A finished tab gives way to one still open.
  const active = done[chosen] ? kinds.find((k) => !done[k]) ?? chosen : chosen
  const finished = kinds.every((k) => done[k])
  return <div className="statement-batch">
    <section className="panel statement-batch-head">
      <div className="panel-head"><h2>匯入帳單</h2>{finished && <button className="primary" onClick={onClose}>返回收支總覽</button>}</div>
      <details className="bank-import-report statement-kind-report" open={!finished || undefined}><summary><span>自動判斷結果</span><span className="muted">{plan.notes.length} 項</span></summary>
        <ul aria-label="帳單類型判斷結果">{plan.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      </details>
      {finished && <ul className="notice" aria-label="匯入結果">{kinds.map((k) => <li key={k}><strong>{TAB_NAMES[k]}</strong>：{done[k]?.replace('請按「儲存變更」。', '')}</li>)}{dirty && <li className="muted small">匯入的資料要按「儲存變更」才會保存。</li>}</ul>}
      {!finished && kinds.length > 1 && <div className="segmented statement-batch-tabs" role="tablist" aria-label="匯入類型">{kinds.map((k) =>
        <button key={k} type="button" role="tab" id={`batch-tab-${k}`} aria-controls={`batch-panel-${k}`} aria-selected={k === active} className={k === active ? 'on' : ''} onClick={() => setChosen(k)}>
          {TAB_NAMES[k]} · {plan[k].length} 份{done[k] ? ' ✓' : ''}
        </button>)}</div>}
    </section>
    {!finished && kinds.map((k) => <div key={k} role={kinds.length > 1 ? 'tabpanel' : undefined} id={`batch-panel-${k}`} aria-labelledby={kinds.length > 1 ? `batch-tab-${k}` : undefined} hidden={k !== active}>
      {done[k] ? <p role="status" className="notice">{TAB_NAMES[k]}：{done[k]}</p> : k === 'card' ? card : k === 'bank' ? bank : securities}
    </div>)}
  </div>
}
