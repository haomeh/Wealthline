// How big the stored data is. A Drive data file is measured against the per-file limit in
// storageLimits.ts; in local mode the limit is the browser's own storage quota.

import type { CSSProperties } from 'react'
import { BLOCK_BYTES, formatBytes, storageLevel, type StorageLevel } from '../storageLimits'

// The browser's storage use for this site (local mode); null when the browser does not say.
export type BrowserStorage = { usage: number; quota: number } | null

const browserLevel = ({ usage, quota }: { usage: number; quota: number }): StorageLevel =>
  usage > quota * 0.95 ? 'block' : usage > quota * 0.8 ? 'warn' : 'ok'

function Bar({ share, label, text }: { share: number; label: string; text: string }) {
  return (
    <span className="storage-meter-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, share) * 100)} aria-valuetext={text}>
      <span style={{ '--storage-share': `${Math.min(1, share) * 100}%` } as CSSProperties} />
    </span>
  )
}

// `bytes`: the largest stored file. `total` (Drive): how many files the data takes and their size.
// `browser` is given in local mode only.
export function StorageMeter({ bytes, total, browser }: { bytes: number; total?: { files: number; bytes: number }; browser?: BrowserStorage }) {
  if (browser !== undefined) {
    return (
      <div className={`storage-meter ${browser ? browserLevel(browser) : 'ok'}`}>
        <span className="small">資料大小：{formatBytes(bytes)}</span>
        {browser && <>
          <span className="small">此瀏覽器已使用 {formatBytes(browser.usage)} / 可用 {formatBytes(browser.quota)}</span>
          <Bar share={browser.usage / browser.quota} label="瀏覽器儲存空間" text={`已使用 ${formatBytes(browser.usage)}，可用 ${formatBytes(browser.quota)}`} />
        </>}
      </div>
    )
  }
  return (
    <div className={`storage-meter ${storageLevel(bytes)}`}>
      {total && total.files > 1 && <span className="small">資料共 {total.files} 個檔，合計 {formatBytes(total.bytes)}</span>}
      <span className="small">{total && total.files > 1 ? '最大的檔' : '資料檔大小'}：{formatBytes(bytes)} / 上限 {formatBytes(BLOCK_BYTES)}</span>
      <Bar share={bytes / BLOCK_BYTES} label="資料檔大小" text={`${formatBytes(bytes)}，上限 ${formatBytes(BLOCK_BYTES)}`} />
    </div>
  )
}

// Shown only when the data is near or over the limit. `browser` is given in local mode only.
export function StorageNotice({ bytes, browser }: { bytes: number; browser?: BrowserStorage }) {
  if (browser !== undefined) {
    if (!browser) return null
    const level = browserLevel(browser)
    if (level === 'ok') return null
    return (
      <div className={`banner storage-notice ${level}`} role={level === 'block' ? 'alert' : 'status'}>
        <p>此瀏覽器的儲存空間已使用 {formatBytes(browser.usage)}，可用 {formatBytes(browser.quota)}。{level === 'block' ? '空間快用完，之後可能無法儲存。' : ''}請下載資料檔備份，並清出瀏覽器空間。</p>
      </div>
    )
  }
  const level = storageLevel(bytes)
  if (level === 'ok') return null
  const size = formatBytes(bytes)
  const limit = formatBytes(BLOCK_BYTES)
  return (
    <div className={`banner storage-notice ${level}`} role={level === 'block' ? 'alert' : 'status'}>
      {level === 'block'
        ? <p>有一個資料檔已有 {size}，超過單一檔案 {limit} 的上限，無法再儲存到 Google Drive。請先下載資料備份，再刪除不需要的資料。</p>
        : <p>有一個資料檔已有 {size}，接近單一檔案 {limit} 的上限。請定期下載資料備份。</p>}
    </div>
  )
}
