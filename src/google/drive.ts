// Reads and writes the app's data files in the user's own Google Drive: the main data file in
// a visible "We Wealth" folder, and the part files (dataParts.ts) in its "明細" and "歷史"
// subfolders, so the user can see, download or delete them.

import type { AccessToken } from './auth'
import { assertWritable, serializeData } from '../storageLimits'

const API = 'https://www.googleapis.com/drive/v3/files'
// v2 exposes the file ETag in JSON (v3 removed this field). Keep v3 discovery
// and existing appProperties, but use v2 for versioned media reads/writes.
const VERSIONED_API = 'https://www.googleapis.com/drive/v2/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v2/files'

export class DriveConflictError extends Error {
  constructor(message = 'Google Drive 資料已由其他裝置更新，已停止儲存。本機未儲存修改仍保留；請先下載本機備份，再重新載入並比對合併。') {
    super(message)
    this.name = 'DriveConflictError'
  }
}

// A refused save that had already written some part files and could not put them all back.
export const PARTLY_SAVED = 'Google Drive 資料已由其他裝置更新，已停止儲存，但部分修改可能已寫入 Drive 的分檔。本機未儲存修改仍保留；請先下載本機備份，再重新載入並比對合併。'
// A part read after the main file was changed by another device.
export const RELOAD_NEEDED = 'Google Drive 中的資料已由其他裝置更新，這一頁的資料無法和目前開啟的版本合併。請重新載入頁面；Drive 中的檔案不需要修改。'

export interface DriveVersion {
  fileId: string
  etag: string
}

// A written part file, with Drive's MD5 checksum of its content (null when Drive does not say).
export interface PartVersion extends DriveVersion {
  md5: string | null
}
const partVersionOf = (raw: { id?: string; etag?: string; md5Checksum?: string }): PartVersion => ({ ...versionOf(raw), md5: raw.md5Checksum ?? null })

function versionOf(raw: { id?: string; etag?: string }): DriveVersion {
  if (!raw.id || !raw.etag || !/^"[^"]+"$/.test(raw.etag)) {
    throw new Error('Drive 未提供有效版本，無法安全儲存。請保留本機修改並重新載入。')
  }
  return { fileId: raw.id, etag: raw.etag }
}

async function readVersion(token: AccessToken, fileId: string): Promise<DriveVersion & { headRevisionId: string }> {
  const raw = await (await driveFetch(token, `${VERSIONED_API}/${fileId}?fields=id,etag,headRevisionId`, { cache: 'no-store' })).json()
  const version = versionOf(raw)
  if (version.fileId !== fileId || typeof raw.headRevisionId !== 'string' || !raw.headRevisionId) {
    throw new Error('Drive 未提供資料內容的版本，已停止載入以免配對錯誤。')
  }
  return { ...version, headRevisionId: raw.headRevisionId }
}

// Throws DriveConflictError (with `message`) when the file is no longer at `version`.
export async function assertCurrent(token: AccessToken, version: DriveVersion, message?: string): Promise<void> {
  if ((await readVersion(token, version.fileId)).etag !== version.etag) throw new DriveConflictError(message)
}

export const FOLDER_NAME = 'We Wealth'
export const DATA_FILE_NAME = 'we-wealth-data.json'
// Tags the app's own files so a search finds them even if the user renames them.
const APP_PROP = { key: 'weWealth', folder: 'folder', data: 'data', part: 'part' }
// Part files (dataParts.ts) sit in subfolders of the app folder.
export const LEDGER_FOLDER_NAME = '明細'
export const HISTORY_FOLDER_NAME = '歷史'
const PART_FOLDERS = { ledger: { role: 'ledger-folder', name: LEDGER_FOLDER_NAME }, history: { role: 'history-folder', name: HISTORY_FOLDER_NAME } }

async function driveFetch(token: AccessToken, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token.value}` },
  })
  if (res.status === 412) throw new DriveConflictError()
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Drive 錯誤 ${res.status}: ${body}`)
  }
  return res
}

async function findFile(token: AccessToken, role: string): Promise<string | null> {
  const q = `appProperties has { key='${APP_PROP.key}' and value='${role}' } and trashed = false`
  const url = `${API}?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id),nextPageToken&orderBy=createdTime&pageSize=100`
  const { files, nextPageToken } = (await (await driveFetch(token, url, { cache: 'no-store' })).json()) as { files: { id: string }[]; nextPageToken?: string }
  if (role === APP_PROP.data && (files.length > 1 || nextPageToken)) {
    throw new DriveConflictError('Drive 中有多個資料檔，已停止讀寫以免選錯版本。請先備份並在 Drive 比對整理；本機修改仍保留。')
  }
  return files[0]?.id ?? null
}

async function ensureFolder(token: AccessToken, role = APP_PROP.folder, name = FOLDER_NAME, parent?: string): Promise<string> {
  const existing = await findFile(token, role)
  if (existing) return existing
  const res = await driveFetch(token, `${API}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [APP_PROP.key]: role },
      ...(parent && { parents: [parent] }),
    }),
  })
  return ((await res.json()) as { id: string }).id
}

function multipartBody(metadata: object, content: string): { body: string; contentType: string } {
  const boundary = `we-wealth-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`
  return { body, contentType: `multipart/related; boundary=${boundary}` }
}

export interface DriveFile<T> extends DriveVersion {
  data: T
}

export interface DriveText extends DriveVersion {
  text: string
}

// Reads one file's text together with the ETag of exactly that content.
export async function readFile(token: AccessToken, fileId: string): Promise<DriveText> {
  const version = await readVersion(token, fileId)
  const res = await driveFetch(token, `${VERSIONED_API}/${fileId}?alt=media&revisionId=${encodeURIComponent(version.headRevisionId)}`, {
    // Media and metadata representations need not expose the same ETag.
    // Download exactly the revision paired with the metadata ETag, then recheck.
    cache: 'no-store',
  })
  const text = await res.text()
  const after = await readVersion(token, fileId)
  if (after.etag !== version.etag || after.headRevisionId !== version.headRevisionId) throw new DriveConflictError()
  return { fileId: version.fileId, etag: version.etag, text }
}

// The main data file's id, or null when the user has none yet.
export const findDataFile = (token: AccessToken) => findFile(token, APP_PROP.data)

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Drive 中的 ${DATA_FILE_NAME} 不是有效的 JSON，請修正或刪除該檔案後重新登入。`)
  }
}

// Returns null when the user has no data file yet. `parse` validates the file's contents.
export async function loadData<T>(token: AccessToken, parse: (raw: unknown) => T): Promise<DriveFile<T> | null> {
  const fileId = await findDataFile(token)
  if (!fileId) return null
  const file = await readFile(token, fileId)
  const raw = parseJson(file.text)
  return { fileId: file.fileId, etag: file.etag, data: parse(raw) }
}

// The ids of every part file of data set `datasetId` (see dataParts.ts).
// A part file as listed: its id, part name, size in bytes and MD5 checksum (null when Drive does not say).
export interface ListedPart {
  id: string
  name: string
  size: number | null
  md5: string | null
}

export async function listParts(token: AccessToken, datasetId: string): Promise<ListedPart[]> {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(datasetId)) throw new Error('資料集識別碼無效，已停止載入。')
  const q = `appProperties has { key='${APP_PROP.key}' and value='${APP_PROP.part}' } and appProperties has { key='dataset' and value='${datasetId}' } and trashed = false`
  const parts: ListedPart[] = []
  let page = ''
  do {
    const url = `${API}?q=${encodeURIComponent(q)}&spaces=drive&fields=files(id,appProperties,size,md5Checksum),nextPageToken&orderBy=createdTime&pageSize=1000${page && `&pageToken=${encodeURIComponent(page)}`}`
    const { files, nextPageToken } = (await (await driveFetch(token, url, { cache: 'no-store' })).json()) as { files: { id: string; appProperties?: Record<string, string>; size?: string; md5Checksum?: string }[]; nextPageToken?: string }
    for (const f of files) {
      const size = Number(f.size)
      parts.push({ id: f.id, name: f.appProperties?.part ?? '', size: f.size !== undefined && Number.isFinite(size) ? size : null, md5: f.md5Checksum ?? null })
    }
    page = nextPageToken ?? ''
  } while (page)
  return parts
}

// Creates part file `name` (e.g. ledger-2026-Q4) in its subfolder. Refuses oversized content.
export async function createPart(token: AccessToken, name: string, fileName: string, datasetId: string, content: string): Promise<PartVersion> {
  assertWritable(content)
  const folder = PART_FOLDERS[name.startsWith('ledger-') ? 'ledger' : 'history']
  const parent = await ensureFolder(token, folder.role, folder.name, await ensureFolder(token))
  const { body, contentType } = multipartBody(
    {
      title: fileName,
      mimeType: 'application/json',
      parents: [{ id: parent }],
      properties: [
        { key: APP_PROP.key, value: APP_PROP.part, visibility: 'PRIVATE' },
        { key: 'dataset', value: datasetId, visibility: 'PRIVATE' },
        { key: 'part', value: name, visibility: 'PRIVATE' },
      ],
    },
    content,
  )
  const res = await driveFetch(token, `${UPLOAD}?uploadType=multipart&fields=id,etag,md5Checksum`, { method: 'POST', headers: { 'Content-Type': contentType }, body })
  return partVersionOf(await res.json())
}

// Replaces a part file's content, only if it is still at `version`.
export async function updatePart(token: AccessToken, version: DriveVersion, content: string): Promise<PartVersion> {
  assertWritable(content)
  versionOf({ id: version.fileId, etag: version.etag })
  const res = await driveFetch(token, `${UPLOAD}/${version.fileId}?uploadType=media&fields=id,etag,md5Checksum`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': version.etag },
    body: content,
  })
  return partVersionOf(await res.json())
}

// Refuses, before any request, a file over the size limit (storageLimits.ts).
export const saveData = <T>(token: AccessToken, data: T, version?: DriveVersion) => saveDataText(token, serializeData(data), version)

// Writes the main data file's text: creates it on first save, afterwards overwrites the same file.
export async function saveDataText(token: AccessToken, content: string, version?: DriveVersion): Promise<DriveVersion> {
  assertWritable(content)
  if (version) {
    versionOf({ id: version.fileId, etag: version.etag })
    // A concurrent first creation may have appeared after this session loaded.
    // This detects ambiguity only; it is NOT the atomic version check.
    if (await findFile(token, APP_PROP.data) !== version.fileId) throw new DriveConflictError()
    // This condition must be enforced by Drive on the write itself, not a preflight GET.
    const res = await driveFetch(token, `${UPLOAD}/${version.fileId}?uploadType=media&fields=id,etag`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': version.etag },
      body: content,
    })
    return versionOf(await res.json())
  }
  // Never adopt and overwrite a file that appeared after this session loaded.
  if (await findFile(token, APP_PROP.data)) throw new DriveConflictError()
  const folderId = await ensureFolder(token)
  const { body, contentType } = multipartBody(
    {
      title: DATA_FILE_NAME,
      mimeType: 'application/json',
      parents: [{ id: folderId }],
      properties: [{ key: APP_PROP.key, value: APP_PROP.data, visibility: 'PRIVATE' }],
    },
    content,
  )
  const res = await driveFetch(token, `${UPLOAD}?uploadType=multipart&fields=id,etag`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  })
  const created = versionOf(await res.json())
  // Drive has no unique-name constraint. Concurrent first saves keep BOTH files;
  // refuse to choose one silently, here and on every subsequent load.
  if (await findFile(token, APP_PROP.data) !== created.fileId) throw new DriveConflictError()
  return created
}
