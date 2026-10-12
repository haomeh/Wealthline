// How big the stored data file is, against the size limit in storageLimits.ts.

import type { CSSProperties } from 'react'
import { BLOCK_BYTES, formatBytes, storageLevel } from '../storageLimits'

export function StorageMeter({ bytes }: { bytes: number }) {
  const level = storageLevel(bytes)
  const share = Math.min(1, bytes / BLOCK_BYTES)
  return (
    <div className={`storage-meter ${level}`}>
      <span className="small">資料檔大小：{formatBytes(bytes)} / 上限 {formatBytes(BLOCK_BYTES)}</span>
      <span className="storage-meter-bar" role="meter" aria-label="資料檔大小" aria-valuemin={0} aria-valuemax={BLOCK_BYTES} aria-valuenow={Math.min(bytes, BLOCK_BYTES)} aria-valuetext={`${formatBytes(bytes)}，上限 ${formatBytes(BLOCK_BYTES)}`}>
        <span style={{ '--storage-share': `${share * 100}%` } as CSSProperties} />
      </span>
    </div>
  )
}

// Shown only when the file is near or over the limit.
export function StorageNotice({ bytes, local }: { bytes: number; local: boolean }) {
  const level = storageLevel(bytes)
  if (level === 'ok') return null
  const size = formatBytes(bytes)
  const limit = formatBytes(BLOCK_BYTES)
  return (
    <div className={`banner storage-notice ${level}`} role={level === 'block' ? 'alert' : 'status'}>
      {level === 'block'
        ? <p>資料檔有 {size}，超過單一檔案 {limit} 的上限，{local ? '可能無法再儲存到此瀏覽器' : '無法再儲存到 Google Drive'}。請先下載資料備份，再刪除不需要的消費明細或銀行流水。</p>
        : <p>資料檔已有 {size}，接近單一檔案 {limit} 的上限。{local ? '瀏覽器的儲存空間有限，請定期下載資料檔備份。' : '主要是消費明細和銀行流水佔用空間；請定期下載資料備份。'}</p>}
    </div>
  )
}
