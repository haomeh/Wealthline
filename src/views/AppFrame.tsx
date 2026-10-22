import { Fragment, type MouseEvent, type ReactNode } from 'react'
import type { UserProfile } from '../google/auth'
import { DATA_FILE_NAME, FOLDER_NAME, HISTORY_FOLDER_NAME, LEDGER_FOLDER_NAME } from '../google/drive'
import { MOBILE_TABS, NAV_GROUPS, TABS, type Tab } from '../routes'
import { PAGES } from '../site'
import { Link, Logo } from './Site'
import { DeviceIcon, UploadButton } from './LocalData'
import { StorageMeter } from './StorageMeter'

// The signed-in app's frame around the pages: the sidebar, the phone's tab bar and save bar, and
// the account and data menu the sidebar and the phone's 更多 page share.

export type SyncState = 'dirty' | 'busy' | 'error' | 'ok'

const NavBadge = ({ count }: { count: number }) => count > 0 ? <span className="nav-badge" title={`${count} 筆銀行流水未分類`}>{count}</span> : null

export function Avatar({ user }: { user: UserProfile | null }) {
  return user
    ? user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{user.email[0]}</span>
    : <span className="avatar"><DeviceIcon /></span>
}

// Where the data is kept, its size, and the backup actions: Drive for a Google account, this browser in local mode.
export function DataMenu({ google, storedBytes, storedTotal, browserStorage, busy, saving, dirty, hasSaved, onDownloadBackup, onDownloadFile, onUpload, onLeaveLocal, onDeleteLocal }: {
  google: boolean
  storedBytes: number
  storedTotal: { files: number; bytes: number }
  browserStorage: { usage: number; quota: number } | null
  busy: boolean
  saving: boolean
  dirty: boolean
  hasSaved: boolean
  onDownloadBackup: () => void
  onDownloadFile: () => void
  onUpload: (file: File) => void
  onLeaveLocal: () => void
  onDeleteLocal: () => void
}) {
  return google ? <>
    <div className="menu-where">
      <span>
        我的雲端硬碟 / {FOLDER_NAME} / {DATA_FILE_NAME}<br />消費明細、銀行流水與往年歷史在「{LEDGER_FOLDER_NAME}」「{HISTORY_FOLDER_NAME}」子資料夾
      </span>
      {storedBytes > 0 && <StorageMeter bytes={storedBytes} total={storedTotal} />}
    </div>
    <button onClick={onDownloadBackup} disabled={busy || dirty || !hasSaved}>
      下載完整備份
    </button>
    {dirty ? <span className="muted small">請先儲存變更，再下載備份。</span> : <span className="muted small">一個檔案包含所有資料，可在本機模式上傳還原。</span>}
  </> : <>
    <div className="menu-where">
      <span>資料只存在這個瀏覽器。清除網站資料、換瀏覽器或換裝置都看不到，請定期下載資料檔備份。</span>
      {storedBytes > 0 && <StorageMeter bytes={storedBytes} browser={browserStorage} />}
    </div>
    <button onClick={onDownloadFile} disabled={busy || dirty || !hasSaved}>
      下載資料檔
    </button>
    {dirty ? <span className="muted small">請先儲存變更，再下載資料檔。</span> : !hasSaved && <span className="muted small">儲存過資料後就能下載。</span>}
    <UploadButton onFile={onUpload} disabled={busy}>上傳資料檔</UploadButton>
    <button onClick={onLeaveLocal} disabled={saving}>
      離開本機模式
    </button>
    <button className="danger" onClick={onDeleteLocal} disabled={saving}>
      刪除此瀏覽器中的資料
    </button>
  </>
}

export function MenuFoot({ signedIn, busy, onSignOut }: { signedIn: boolean; busy: boolean; onSignOut: () => void }) {
  return <div className="menu-foot">
    <Link to={PAGES.privacy.path} className="small">
      隱私權政策 Privacy Policy
    </Link>
    {signedIn && <button className="link danger" onClick={onSignOut} disabled={busy}>
      登出
    </button>}
  </div>
}

// The save state in one short line, for the phone's page headers.
export function SyncPill({ state, saving, local }: { state: SyncState; saving: boolean; local: boolean }) {
  return <span className={`sync-pill ${state}`}>
    {state === 'dirty' ? '● 有修改未儲存' : state === 'busy' ? (saving ? '儲存中…' : '更新報價…') : state === 'error' ? '同步未完成' : <><span aria-hidden>✓</span> {local ? '已存在此瀏覽器' : '已同步'}</>}
  </span>
}

export function Sidebar({ tab, importEntry, importingStatements, unclassified, onTab, onImportEntry, dirty, busy, refreshing, saving, syncError, local, savedAt, user, onRequestSave, onDataPrivacy, dataMenu, menuFoot }: {
  tab: Tab
  importEntry: boolean
  importingStatements: boolean
  unclassified: number
  onTab: (tab: Tab) => void
  onImportEntry: () => void
  dirty: boolean
  busy: boolean
  refreshing: boolean
  saving: boolean
  syncError: boolean
  local: boolean
  savedAt: string
  user: UserProfile | null
  onRequestSave: () => void
  onDataPrivacy: (event: MouseEvent<HTMLButtonElement>) => void
  dataMenu: ReactNode
  menuFoot: ReactNode
}) {
  return <aside className="sidebar" aria-label="導覽">
    <div className="brand">
      <Logo size={32} />
      <span className="brand-name">Wealthline</span>
    </div>
    <nav className="side-nav" aria-label="分頁">
      {NAV_GROUPS.map((g) => (
        <Fragment key={g.label}>
          <span className="nav-group">{g.label}</span>
          {g.tabs.map((t) => (
            <button
              key={t}
              className={t === tab && !importEntry ? 'active' : ''}
              aria-current={t === tab && !importEntry ? 'page' : undefined}
              onClick={() => onTab(t)}
            >
              {TABS[t]}
              {t === 'bank-transactions' && <NavBadge count={unclassified} />}
            </button>
          ))}
          {g.tabs.includes('cashflow') && <button className={importEntry ? 'active' : ''} aria-current={importEntry ? 'page' : undefined} disabled={importingStatements} title={importingStatements ? '正在匯入；可在匯入畫面切換為自動判斷' : undefined} onClick={onImportEntry}>匯入帳單</button>}
        </Fragment>
      ))}
    </nav>
    <div className="side-foot">
      {dirty ? (
        <div className="sync-card dirty" role="status">
          <strong>● 有修改未儲存</strong>
          <span>關閉分頁前會提醒你</span>
          <button className="primary save" onClick={onRequestSave} disabled={busy}>
            {busy ? '儲存中…' : '儲存變更'}
          </button>
        </div>
      ) : refreshing || saving ? (
        <div className="sync-card refreshing" role="status">
          <strong><span className="spinner" aria-hidden /> {saving ? '儲存中…' : '更新報價'}</strong>
        </div>
      ) : syncError ? (
        <div className="sync-card"><strong className="muted">同步未完成</strong></div>
      ) : (
        <div className="sync-card" title={local ? '資料存在這個瀏覽器的儲存空間（IndexedDB）' : `我的雲端硬碟 / ${FOLDER_NAME}`}>
          <strong className="synced"><span aria-hidden>✓</span> {local ? '已存在此瀏覽器' : '已同步 Google Drive'}</strong>
          {savedAt && <span>{savedAt} 儲存</span>}
        </div>
      )}
      <details className="account-menu">
        <summary aria-label={user ? '帳號選單' : '本機模式選單'}>
          <Avatar user={user} />
          <span className="who"><span>{user ? user.name : '本機模式'}</span><small>{user ? '帳號與備份' : '資料與備份'}</small></span>
        </summary>
        <div className="menu">
          {user ? <div className="menu-who">
            <Avatar user={user} />
            <div><strong>{user.name}</strong><span className="muted small">{user.email}</span></div>
          </div> : <strong>本機模式（未登入）</strong>}
          <button onClick={onDataPrivacy}>資料與隱私</button>
          {dataMenu}
          {menuFoot}
        </div>
      </details>
    </div>
  </aside>
}

// The phone's 收支 pages: 總覽, 信用卡 and 銀行流水 as one switch, and the import entry.
export function CashflowTabs({ tab, importEntry, importingStatements, unclassified, onTab, onImportEntry }: { tab: Tab; importEntry: boolean; importingStatements: boolean; unclassified: number; onTab: (tab: Tab) => void; onImportEntry: () => void }) {
  return <div className="segmented cashflow-tabs mobile-only" role="group" aria-label="收支分頁">
    {([['cashflow', '總覽'], ['expenses', '信用卡'], ['bank-transactions', '銀行流水']] as const).map(([t, label]) => <button key={t} className={t === tab && !importEntry ? 'on' : ''} aria-pressed={t === tab && !importEntry} onClick={() => onTab(t)}>{label}{t === 'bank-transactions' && <NavBadge count={unclassified} />}</button>)}
    <button className={importEntry ? 'on' : ''} aria-pressed={importEntry} disabled={importingStatements} onClick={onImportEntry}>匯入</button>
  </div>
}

export function SaveBar({ unsavedCount, busy, saving, onRequestSave }: { unsavedCount: number; busy: boolean; saving: boolean; onRequestSave: () => void }) {
  return <div className="save-bar">
    <span>{unsavedCount ? `${unsavedCount} 筆修改未儲存` : '有修改未儲存'}</span>
    <button className="primary" onClick={onRequestSave} disabled={busy}>{saving ? '儲存中…' : '檢查並儲存'}</button>
  </div>
}

export function TabBar({ tab, unclassified, onTab }: { tab: Tab; unclassified: number; onTab: (tab: Tab) => void }) {
  const current = MOBILE_TABS.find((t) => t.pages.includes(tab))?.tab
  return <nav className="tab-bar" aria-label="主要分頁">
    {MOBILE_TABS.map((t) => (
      <button key={t.tab} className={t.tab === current ? 'active' : ''} aria-current={t.tab === current ? 'page' : undefined} onClick={() => onTab(t.tab)}>
        <span className={`tab-icon ${t.tab}`} aria-hidden />
        {t.label}
        {t.tab === 'cashflow' && <NavBadge count={unclassified} />}
      </button>
    ))}
  </nav>
}
