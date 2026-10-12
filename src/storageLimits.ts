// Size limits for one stored data file. Drive's simple and multipart uploads (drive.ts)
// are documented for files of 5 MB or less, so a write is refused before it reaches Drive.

export const MB = 1024 * 1024
export const WARN_BYTES = 3 * MB
export const BLOCK_BYTES = 4.5 * MB

export type StorageLevel = 'ok' | 'warn' | 'block'

// The Drive data file and downloads share this layout, so their sizes match.
export const serializeData = (data: unknown) => JSON.stringify(data, null, 2)

export const byteSize = (text: string) => new TextEncoder().encode(text).length

export const storageLevel = (bytes: number): StorageLevel => (bytes > BLOCK_BYTES ? 'block' : bytes > WARN_BYTES ? 'warn' : 'ok')

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

export class DataTooLargeError extends Error {
  readonly bytes: number
  constructor(bytes: number) {
    super(`資料檔有 ${formatBytes(bytes)}，超過單一檔案 ${formatBytes(BLOCK_BYTES)} 的上限，已停止儲存，原本的資料沒有變動。請先下載本機資料備份，再刪除不需要的消費明細或銀行流水後重試。`)
    this.name = 'DataTooLargeError'
    this.bytes = bytes
  }
}

// Throws before any write when `content` is over the limit.
export function assertWritable(content: string): number {
  const bytes = byteSize(content)
  if (storageLevel(bytes) === 'block') throw new DataTooLargeError(bytes)
  return bytes
}
