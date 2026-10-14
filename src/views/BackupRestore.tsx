import { useEffect, useRef } from 'react'
import { summarizeBackup } from '../backupPreview'
import type { WealthData } from '../model'
import { UploadButton } from './LocalData'

interface Props {
  source: ReturnType<typeof summarizeBackup>
  destination: WealthData | null
  destinationInvalid: boolean
  dirty: boolean
  busy: boolean
  error: string
  onConfirm: () => void
  onCancel: () => void
  onUpload: (file: File) => void
}

export function BackupRestore({ source, destination, destinationInvalid, dirty, busy, error, onConfirm, onCancel, onUpload }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector('button')?.focus() }, [])
  const counts = source.counts
  const date = source.updatedAt && !Number.isNaN(Date.parse(source.updatedAt)) ? new Date(source.updatedAt).toLocaleString('zh-TW') : '無資料'
  return <dialog ref={ref} className="data-privacy" aria-labelledby="backup-restore-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <div className="page-head"><div><h2 id="backup-restore-title">確認還原資料檔</h2><p className="muted">請先核對備份內容，再決定是否取代此瀏覽器的資料。</p></div></div>
    {error && <p className="banner error" role="alert">{error}</p>}
    <section className="panel">
      <h3>上傳的資料檔</h3>
      <p><strong>{source.name}</strong>（{(source.bytes / 1024).toFixed(1)} KB）</p>
      <p>資料最後儲存時間：{date}</p>
      <p>帳戶 {counts.accounts}、持倉 {counts.positions}、負債 {counts.liabilities}、消費明細 {counts.expenses}、銀行交易 {counts.bankTransactions}、每月核對 {counts.monthlyReviews}</p>
      <p>歷史日期範圍：{source.historyRange ? `${source.historyRange.from} 至 ${source.historyRange.to}` : '無資料'}</p>
    </section>
    <section className="panel">
      <h3>此瀏覽器目前的資料</h3>
      <p>{destinationInvalid ? '現有資料無法讀取；取代後將使用上方資料檔。' : destination ? `帳戶 ${destination.accounts.length}、持倉 ${destination.accounts.reduce((n, a) => n + a.positions.length, 0)}。確認後會完整取代。` : '目前沒有已儲存的資料。'}</p>
      {dirty && <p role="alert">目前有未儲存的修改；還原後這些修改會遺失。請先儲存或下載備份。</p>}
      <p>還原會取代此瀏覽器中目前的財務資料，不會變更 Google Drive。已下載的備份不受影響。</p>
      <p className="muted small">如果資料檔含已儲存的帳單密碼設定，在其他瀏覽器或裝置可能需要重新設定。</p>
    </section>
    <div className="row"><button type="button" onClick={onCancel} disabled={busy}>取消還原</button><UploadButton onFile={onUpload} disabled={busy}>選擇其他資料檔</UploadButton><button type="button" className="danger" onClick={onConfirm} disabled={busy}>確認取代本機資料</button></div>
  </dialog>
}
