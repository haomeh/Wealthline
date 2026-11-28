// Encrypted local cache of Google Drive file contents in IndexedDB.
// Files are keyed by (scope, fileId) and validated against Drive's md5Checksum before decryption.
// A non-extractable AES-GCM key per Google account stays in IndexedDB; entries expire after 30 days.

export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000

const DB_NAME = 'wealthline-drive-cache'
const DB_VERSION = 1
const KEY_STORE = 'keys'
const ENTRY_STORE = 'entries'

interface DeviceKey {
  id: string
  key: CryptoKey
}

interface CachedEntry {
  scope: string
  fileId: string
  md5: string
  keyId: string
  cachedAt: number
  iv: Uint8Array
  ciphertext: ArrayBuffer
}

export interface CachedDriveFile {
  etag: string
  text: string
}

const available = () => !!globalThis.indexedDB && !!globalThis.crypto?.subtle
const entryKey = (scope: string, fileId: string) => `${scope}:${fileId}`
const aad = (scope: string, fileId: string, md5: string) =>
  new TextEncoder().encode(JSON.stringify(['wealthline-drive-cache-v1', scope, fileId, md5]))

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    let blocked = false
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames?.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
      if (!db.objectStoreNames?.contains(ENTRY_STORE)) db.createObjectStore(ENTRY_STORE)
    }
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => {
      blocked = true
      reject(new Error('IndexedDB blocked'))
    }
    request.onsuccess = () => {
      const db = request.result
      if (blocked || !db.objectStoreNames?.contains(KEY_STORE) || !db.objectStoreNames?.contains(ENTRY_STORE)) {
        db.close()
        if (!blocked) reject(new Error('IndexedDB cache store unavailable'))
        return
      }
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

async function deviceKey(db: IDBDatabase, scope: string, create: boolean): Promise<DeviceKey | null> {
  const readOrPut = (candidate?: DeviceKey) =>
    new Promise<DeviceKey | null>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE, candidate ? 'readwrite' : 'readonly')
      const store = tx.objectStore(KEY_STORE)
      const req = store.get(scope)
      let value: DeviceKey | null = null
      req.onsuccess = () => {
        value = (req.result as DeviceKey | undefined) ?? candidate ?? null
        if (candidate && !req.result) store.put(candidate, scope)
      }
      tx.oncomplete = () => resolve(value)
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB key transaction failed'))
    })
  const existing = await readOrPut()
  if (existing || !create) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return readOrPut({ id: crypto.randomUUID(), key })
}

function txRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, mode)
    const req = run(tx.objectStore(ENTRY_STORE))
    let result: T
    req.onsuccess = () => { result = req.result }
    tx.oncomplete = () => resolve(result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB entry transaction failed'))
  })
}

export async function getCachedFile(scope: string, fileId: string, md5: string, now = Date.now()): Promise<CachedDriveFile | null> {
  if (!scope || !fileId || !md5 || !available()) return null
  let db: IDBDatabase | null = null
  try {
    db = await openCacheDb()
    const key = entryKey(scope, fileId)
    const entry = (await txRequest(db, 'readonly', (s) => s.get(key))) as CachedEntry | undefined
    if (!entry) return null
    if (entry.md5 !== md5 || now - entry.cachedAt >= CACHE_TTL_MS) {
      if (now - entry.cachedAt >= CACHE_TTL_MS) void txRequest(db, 'readwrite', (s) => s.delete(key)).catch(() => {})
      return null
    }
    const dev = await deviceKey(db, scope, false)
    if (!dev || dev.id !== entry.keyId) return null
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(entry.iv), additionalData: aad(scope, fileId, md5) },
      dev.key,
      entry.ciphertext,
    )
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)) as Partial<CachedDriveFile>
    if (typeof parsed.etag !== 'string' || typeof parsed.text !== 'string') return null
    return { etag: parsed.etag, text: parsed.text }
  } catch {
    return null
  } finally {
    db?.close()
  }
}

export async function putCachedFile(scope: string, fileId: string, md5: string, etag: string, text: string, now = Date.now()): Promise<void> {
  if (!scope || !fileId || !md5 || !etag || !available()) return
  let db: IDBDatabase | null = null
  try {
    db = await openCacheDb()
    const dev = await deviceKey(db, scope, true)
    if (!dev) return
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const payload = new TextEncoder().encode(JSON.stringify({ etag, text }))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(scope, fileId, md5) },
      dev.key,
      payload,
    )
    const entry: CachedEntry = { scope, fileId, md5, keyId: dev.id, cachedAt: now, iv, ciphertext }
    await txRequest(db, 'readwrite', (s) => s.put(entry, entryKey(scope, fileId)))
  } catch {
    // Cache writes are best-effort; Drive remains the source of truth.
  } finally {
    db?.close()
  }
}

export async function pruneDriveCache(scope: string, now = Date.now()): Promise<void> {
  if (!scope || !available()) return
  let db: IDBDatabase | null = null
  try {
    db = await openCacheDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(ENTRY_STORE, 'readwrite')
      const req = tx.objectStore(ENTRY_STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        const val = cursor.value as CachedEntry | undefined
        if (val?.scope === scope && now - val.cachedAt >= CACHE_TTL_MS) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB prune failed'))
    })
  } catch {
    // Best-effort cleanup.
  } finally {
    db?.close()
  }
}

export async function clearDriveCache(scope: string): Promise<void> {
  if (!scope || !available()) return
  let db: IDBDatabase | null = null
  try {
    db = await openCacheDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction([ENTRY_STORE, KEY_STORE], 'readwrite')
      tx.objectStore(KEY_STORE).delete(scope)
      const req = tx.objectStore(ENTRY_STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        const val = cursor.value as CachedEntry | undefined
        if (val?.scope === scope) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB clear failed'))
    })
  } catch {
    // Best-effort cleanup.
  } finally {
    db?.close()
  }
}
