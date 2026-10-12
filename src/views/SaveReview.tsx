import { useEffect, useRef } from 'react'
import { changeRatio, type Change, type LiabilityChange } from '../history'
import { LiabilityChangeRow } from './LiabilityChange'
import { ChangeRow } from './History'

interface Props {
  changes: Change[]
  liabilityChanges?: LiabilityChange[]
  onRevertLiability?: (id: string) => void
  busy: boolean
  canRevert: (c: Change) => boolean
  onRevert: (c: Change) => void
  onConfirm: () => void
  onCancel: () => void
}

// Shown before a save that changes balances or holdings: these edits become history,
// so a typo is caught (and undone) here instead of being kept forever.
export function SaveReview({ changes, liabilityChanges = [], onRevertLiability, busy, canRevert, onRevert, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const isBig = (c: Change) => !!c.before && !!c.after && changeRatio(c) >= 0.5
  const big = changes.filter(isBig).length
  // Large changes first: they are the likely typos.
  const ordered = [...changes].sort((x, y) => Number(isBig(y)) - Number(isBig(x)))
  const total = changes.length + liabilityChanges.length

  return (
    <dialog ref={ref} className="review" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }} aria-labelledby="review-title">
      <h3 id="review-title">確認 {total} 筆修改</h3>
      <p className="muted small">
        儲存後會記入歷史，原本的數字會保留。打錯的可以按「復原」改回去。
      </p>
      {big > 0 && (
        <p className="notice">
          <span aria-hidden>⚠</span> 有 {big} 項變動超過 50%，請確認不是多打或少打了位數。
        </p>
      )}
      <div className="changes review-list">
        <ul>
          {ordered.map((c, i) => {
            const ratio = changeRatio(c)
            return (
              <ChangeRow
                key={i}
                className={isBig(c) ? 'big' : ''}
                c={c}
                showAccount
                showTime={false}
                extra={
                  <>
                    {Number.isFinite(ratio) && ratio >= 0.5 && <span className="tag warn">變動 {Math.round(ratio * 100)}%，請確認不是打錯</span>}
                    {canRevert(c) && (
                      <button className="small" onClick={() => onRevert(c)} disabled={busy}>
                        復原
                      </button>
                    )}
                  </>
                }
              />
            )
          })}
        </ul>
      </div>
      {liabilityChanges.length > 0 && <div className="review-list"><h4>負債變更</h4><ul className="liability-changes">
        {liabilityChanges.map((c) => <LiabilityChangeRow key={c.liabilityId} change={c} showTime={false} extra={onRevertLiability && <button className="small" disabled={busy} onClick={() => onRevertLiability(c.liabilityId)}>復原負債</button>} />)}
      </ul></div>}
      <div className="row review-actions">
        <button onClick={onCancel} disabled={busy}>
          繼續編輯
        </button>
        <button className="primary" onClick={onConfirm} disabled={busy}>
          {busy ? '儲存中…' : '確認儲存'}
        </button>
      </div>
    </dialog>
  )
}
