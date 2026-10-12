// Local mode: the same data file as the Drive mode, kept in this browser instead of Google
// Drive, with no sign-in. The user can download it as a JSON file and upload that file later
// (in this or another browser) to restore it.
//
// The data lives in IndexedDB, which has far more room than localStorage's ~5 MB. Data saved by
// earlier versions in localStorage moves there on the next open, with no step for the user
// (see `migrate`). Browsers without a usable IndexedDB keep using localStorage. Once the data
// is in IndexedDB, a page load that cannot open it stops instead: localStorage would show no
// data, and what was saved there would later be moved aside as old data.

import { localDate } from './history'
import { parseWealthData, type WealthData } from './model'
import { serializeData } from './storageLimits'

// Where earlier versions kept the data file, and still the fallback without IndexedDB.
const DATA_KEY = 'wealthline.local.data'
// The localStorage text moved aside after it was copied to IndexedDB, kept for BACKUP_DAYS.
const BACKUP_KEY = 'wealthline.local.data.backup'
const BACKUP_AT_KEY = 'wealthline.local.data.backup-at'
const BACKUP_DAYS = 30
// Set while IndexedDB holds the data, so the home page can tell without waiting for it.
const STORED_KEY = 'wealthline.local.stored'
// Set while the user is in local mode, so a reload of an app page reopens it.
// index.html reads this key too, to hide the prerendered sign-in page on such a reload.
const ACTIVE_KEY = 'wealthline.local.active'
// Set in sessionStorage when the user chose local mode in this tab. That choice decides the
// tab's mode on reload, whatever other tabs did to the shared flag above and even with a
// Google token left in the tab (one whose loading failed). index.html reads this key too.
const TAB_KEY = 'wealthline.local.tab'

const DB_NAME = 'wealthline'
const DB_STORE = 'files'
const CORE = 'core'

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024

export class LocalConflictError extends Error {
  constructor() {
    super('此瀏覽器中的資料已在其他分頁更新，已停止儲存。這個分頁的未儲存修改仍保留；請先下載本機備份，再重新載入並比對合併。')
    this.name = 'LocalConflictError'
  }
}

// The stored text is the version: a save only goes through when it still matches what this tab read.
export interface LocalFile {
  data: WealthData
  raw: string
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function forget(...keys: string[]) {
  try {
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Storage blocked: nothing to remove.
  }
}

const FULL = '此瀏覽器的儲存空間不足或已停用，資料沒有儲存。請先下載本機備份。'
const UNAVAILABLE = '此瀏覽器的 Wealthline 資料存在 IndexedDB，但這次無法開啟它，所以沒有讀取或寫入任何資料。請重新載入頁面；若仍無法開啟，請確認瀏覽器沒有封鎖或清除此網站的資料。'

// The stored data file's text. `put` and `remove` run only under the lock below.
interface Backend {
  get(): Promise<string | null>
  put(raw: string): Promise<void>
  remove(): Promise<void>
}

const done = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

function openDb(): Promise<IDBDatabase> {
  const request = indexedDB.open(DB_NAME, 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE)
  }
  return done(request).then((db) => {
    // A later version opened in another tab: let it upgrade; this tab reopens on next use.
    db.onversionchange = () => { db.close(); database = null }
    return db
  })
}

let database: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  database ??= openDb().catch((e) => { database = null; throw e })
  return database
}

// One request in its own transaction; resolves once a write is committed.
async function run<T>(mode: IDBTransactionMode, task: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const tx = (await db()).transaction(DB_STORE, mode)
  const result = done(task(tx.objectStore(DB_STORE)))
  result.catch(() => {}) // reported through the transaction below
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
  return result
}

const indexedBackend: Backend = {
  get: async () => ((await run('readonly', (store) => store.get(CORE))) as string | undefined) ?? null,
  async put(raw) {
    try {
      await run('readwrite', (store) => store.put(raw, CORE))
    } catch {
      throw new Error(FULL)
    }
    try { localStorage.setItem(STORED_KEY, '1') } catch { /* only a hint for the home page */ }
  },
  async remove() {
    await run('readwrite', (store) => store.delete(CORE))
    forget(STORED_KEY)
  },
}

const storageBackend: Backend = {
  get: async () => read(DATA_KEY),
  async put(raw) {
    try {
      localStorage.setItem(DATA_KEY, raw)
    } catch {
      throw new Error(FULL)
    }
  },
  async remove() {
    forget(DATA_KEY)
  },
}

// IndexedDB when this browser can open it; decided once per page load. When IndexedDB already
// holds the data but does not open, this rejects (and the next call tries again).
let chosen: Promise<Backend> | null = null
function backend(): Promise<Backend> {
  chosen ??= (typeof indexedDB === 'undefined' ? Promise.reject(new Error('no IndexedDB')) : db())
    .then(() => indexedBackend, () => {
      if (read(STORED_KEY) !== '1') return storageBackend
      chosen = null
      throw new Error(UNAVAILABLE)
    })
  return chosen
}

// Copies data an earlier version left in localStorage into IndexedDB, then moves the old text
// aside. Removing it stops a tab still running an earlier version from saving over it: its next
// save no longer finds the text it read and stops with LocalConflictError. When IndexedDB already
// holds data, that data wins and the localStorage text only becomes the backup.
async function migrate(store: Backend) {
  const legacy = read(DATA_KEY)
  if (store === storageBackend || legacy === null) return
  if ((await store.get()) === null) {
    await store.put(legacy)
    if ((await store.get()) !== legacy) {
      await store.remove().catch(() => {})
      throw new Error('IndexedDB did not return the copied data')
    }
  }
  forget(DATA_KEY)
  try {
    localStorage.setItem(BACKUP_KEY, legacy)
    localStorage.setItem(BACKUP_AT_KEY, new Date().toISOString())
  } catch {
    // No room for the backup copy: the data itself is already in IndexedDB.
  }
}

function expireBackup() {
  const at = Date.parse(read(BACKUP_AT_KEY) ?? '')
  if (read(BACKUP_KEY) !== null && !(Date.now() - at < BACKUP_DAYS * 86400_000)) forget(BACKUP_KEY, BACKUP_AT_KEY)
}

export const isLocalActive = () => read(ACTIVE_KEY) === '1'
export function localChosenInTab(): boolean {
  try {
    return sessionStorage.getItem(TAB_KEY) === '1'
  } catch {
    return false
  }
}
export const hasLocalData = () => read(STORED_KEY) === '1' || read(DATA_KEY) !== null

// Whether a page load opens local mode: this tab's own choice first; otherwise the shared
// flag, unless the tab holds a live Google session.
export const opensLocal = (hasGoogleToken: boolean) => localChosenInTab() || (isLocalActive() && !hasGoogleToken)

export function setLocalActive(active: boolean) {
  try {
    if (active) {
      localStorage.setItem(ACTIVE_KEY, '1')
      sessionStorage.setItem(TAB_KEY, '1')
    } else {
      localStorage.removeItem(ACTIVE_KEY)
      sessionStorage.removeItem(TAB_KEY)
    }
  } catch {
    // Storage blocked: local mode still works in this tab, it just won't reopen on reload.
  }
}

// Throws when the stored data is not a valid data file.
export async function loadLocal(): Promise<LocalFile | null> {
  let store = await backend()
  // Without Web Locks nothing is written (see `locked`), so data left in localStorage is read where it is.
  const raw = hasLocks() ? await locked(async () => {
    try {
      await migrate(store)
    } catch (e) {
      // IndexedDB already holds data but failed now: localStorage would hide it.
      if (read(STORED_KEY) === '1') throw new Error(UNAVAILABLE, { cause: e })
      // IndexedDB could not take the data (full, or failing): keep using localStorage on this
      // page load, where the data still is, and try again on the next open.
      store = storageBackend
      chosen = Promise.resolve(storageBackend)
    }
    expireBackup()
    return store.get()
  }) : store === storageBackend ? read(DATA_KEY) : (await store.get()) ?? read(DATA_KEY)
  if (raw === null) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error('此瀏覽器保存的資料不是有效的 JSON。可以上傳備份的資料檔取代它。')
  }
  return { data: parseWealthData(json, 'browser'), raw }
}

// Every write (save, upload, delete) runs under one lock shared by all tabs of this site, so
// checking the stored version and writing cannot interleave with another tab's write.
// localStorage itself has no cross-tab locking, so without Web Locks local mode does not write at all.
const LOCK = 'wealthline.local'

const hasLocks = () => typeof navigator !== 'undefined' && !!navigator.locks

function locked<T>(task: () => T | Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) {
    return Promise.reject(new Error('這個瀏覽器不支援跨分頁鎖定（Web Locks），為避免分頁互相覆蓋資料，本機模式無法寫入。請改用新版瀏覽器，並先下載本機備份。'))
  }
  return locks.request(LOCK, () => task())
}

let persistAsked = false
async function write(store: Backend, data: WealthData): Promise<string> {
  const raw = JSON.stringify(data)
  await store.put(raw)
  // Once per page load, ask the browser not to evict this site's data under storage pressure.
  if (!persistAsked) {
    persistAsked = true
    void navigator.storage?.persist?.().catch(() => {})
  }
  return raw
}

// Writes `data` unless another tab changed the stored data since `expected` was read
// (null: nothing was stored). Resolves to the new stored text, the version for the next save.
export async function saveLocal(data: WealthData, expected: string | null): Promise<string> {
  const store = await backend()
  return locked(async () => {
    if ((await store.get()) !== expected || (store !== storageBackend && read(DATA_KEY) !== null)) throw new LocalConflictError()
    return write(store, data)
  })
}

// Replaces the stored data with an uploaded file, whatever was there, unless `wanted` says the
// user has since left local mode or deleted the data. Resolves to the new stored text, or null.
export async function replaceLocal(data: WealthData, wanted: () => boolean): Promise<string | null> {
  const store = await backend()
  return locked(async () => {
    if (!wanted()) return null
    const raw = await write(store, data)
    // The upload replaces any data an earlier version left in localStorage too.
    if (store !== storageBackend) forget(DATA_KEY)
    return raw
  })
}

// Removes the data, including the backup of data moved from localStorage, and leaves local
// mode. Downloaded files are not affected. Fails, saying so, when IndexedDB holds the data but
// cannot be opened (see `backend`).
export async function clearLocal(): Promise<void> {
  const store = await backend()
  return locked(async () => {
    await store.remove()
    forget(DATA_KEY, BACKUP_KEY, BACKUP_AT_KEY, ACTIVE_KEY)
  })
}

// How much of this browser's storage the site uses, when the browser says.
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {}
    return typeof usage === 'number' && typeof quota === 'number' && quota > 0 ? { usage, quota } : null
  } catch {
    return null
  }
}

// Reads a data file the user picked: a download from local mode, or a full backup downloaded
// in the Drive mode. A version 14 or older Drive data file holds everything too. Since version
// 15 the Drive main file does not (the transactions and earlier years are in its part files),
// so it is refused rather than restored without them.
export async function readDataFile(file: File): Promise<WealthData> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('檔案太大，不像是 Wealthline 的資料檔。')
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    throw new Error('這個檔案不是有效的 JSON，請選擇 Wealthline 的資料檔。')
  }
  const obj = json as Record<string, unknown> | null
  if (obj?.version === 15 && typeof obj.datasetId === 'string' && obj.datasetId && obj.summary !== undefined) {
    throw new Error('這是 Google Drive 中的主檔，不含消費明細、銀行流水與往年歷史，不能當作完整備份還原。請用 Google 登入後，在帳號選單中按「下載完整備份」，再上傳那個檔案。')
  }
  return parseWealthData(json, 'file')
}

// Saves `data` as a JSON file, formatted like the Drive data file.
export function downloadDataFile(data: WealthData, name = `wealthline-data-${localDate(new Date().toISOString())}.json`) {
  const url = URL.createObjectURL(new Blob([serializeData(data)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
