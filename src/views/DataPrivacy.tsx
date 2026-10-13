import { useEffect, useRef } from 'react'
import { DATA_FILE_NAME, FOLDER_NAME, HISTORY_FOLDER_NAME, LEDGER_FOLDER_NAME, LEGACY_FOLDER_NAME } from '../google/drive'
import { PAGES } from '../site'
import { Link } from './Site'
import { UploadButton } from './LocalData'

interface Props {
  mode: 'google' | 'local'
  email?: string
  busy: boolean
  saving: boolean
  dirty: boolean
  hasSaved: boolean
  error: string
  onDownload: () => void
  onUpload: (file: File) => void
  onSignOut: () => void
  onLeaveLocal: () => void
  onDeleteLocal: () => void
  onClose: () => void
}

export function DataPrivacy({ mode, email, busy, saving, dirty, hasSaved, error, onDownload, onUpload, onSignOut, onLeaveLocal, onDeleteLocal, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
    ref.current?.querySelector('button')?.focus()
  }, [])
  const canDownload = !busy && !dirty && hasSaved

  return (
    <dialog ref={ref} className="data-privacy" aria-labelledby="data-privacy-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="page-head">
        <div><h2 id="data-privacy-title">資料與隱私</h2><p className="muted">查看資料位置、備份與各項資料控制。</p></div>
        <button type="button" aria-label="關閉資料與隱私" onClick={onClose}>關閉</button>
      </div>
      {error && <p className="banner error" role="alert">{error}</p>}
      <section className="panel">
        <h3>資料位置</h3>
        {mode === 'google' ? <>
          <p>目前登入：<strong>{email}</strong></p>
          <p>財務資料存放在這個帳號的 Google Drive：「我的雲端硬碟 / {FOLDER_NAME}」。主檔 {DATA_FILE_NAME}；消費明細、銀行流水與往年歷史分別存於「{LEDGER_FOLDER_NAME}」「{HISTORY_FOLDER_NAME}」子資料夾。較早建立的資料夾在下一次儲存前仍叫「{LEGACY_FOLDER_NAME}」；你自己改過的名稱或位置會保留。</p>
        </> : <p>財務資料只存在此瀏覽器的網站儲存空間。清除網站資料、更換瀏覽器或裝置後可能無法取回，請定期下載備份。</p>}
      </section>
      <section className="panel">
        <h3>備份</h3>
        <button type="button" onClick={onDownload} disabled={!canDownload}>{mode === 'google' ? '下載完整備份' : '下載資料檔'}</button>
        {dirty ? <p className="muted small">請先儲存變更，再下載備份。</p>
          : busy ? <p className="muted small">目前正在處理資料，完成後才能下載。</p>
          : !hasSaved ? <p className="muted small">儲存過資料後就能下載。</p>
          : <p className="muted small">備份會下載到你選擇的位置，之後需由你自行保管及刪除。</p>}
        {mode === 'local' && <UploadButton onFile={onUpload} disabled={busy}>上傳資料檔</UploadButton>}
        {mode === 'local' && <p className="muted small">上傳會取代此瀏覽器中目前的財務資料；取代前會要求確認。</p>}
      </section>
      <section className="panel">
        <h3>隱私與資料控制</h3>
        <Link to={PAGES.privacy.path} onClick={onClose}>隱私權政策 Privacy Policy</Link>
        {mode === 'google' ? <>
          <p>刪除 Google Drive 中的財務資料：請先登出並關閉其他已開啟的 Wealthline 分頁，再到 Google Drive 刪除「{FOLDER_NAME}」資料夾（較早建立的可能仍叫「{LEGACY_FOLDER_NAME}」，或是你自己改過的名稱）及其子資料夾，並清空垃圾桶。下載的備份需另外刪除。</p>
          <p>撤銷 Wealthline 授權不會刪除 Drive 檔案；登出也不會刪除 Drive 檔案。</p>
          <p className="muted small">目前 Wealthline 帳號：{email}。開啟下列 Google 頁面後，請自行核對 Google 頁面選取的帳號。</p>
          <div className="row">
            <a href="https://drive.google.com/drive/my-drive" target="_blank" rel="noopener noreferrer">前往 Google Drive 手動刪除</a>
            <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">前往 Google 帳戶撤銷授權</a>
          </div>
          <button type="button" onClick={onSignOut} disabled={busy}>登出</button>
        </> : <>
          <p>離開本機模式會保留已儲存的財務資料，供下次在此瀏覽器繼續使用。</p>
          <button type="button" onClick={onLeaveLocal} disabled={saving}>離開本機模式</button>
          <p>刪除只會移除此瀏覽器中的財務資料與舊版遷移備份；不會刪除 Google Drive 檔案、已下載的備份或此瀏覽器的密碼加密金鑰。</p>
          <button type="button" className="danger" onClick={onDeleteLocal} disabled={saving}>刪除此瀏覽器中的財務資料</button>
        </>}
      </section>
    </dialog>
  )
}
