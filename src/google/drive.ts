// Reads and writes the app's data as one JSON file in the user's own Google Drive.
// The file lives in a visible "We Wealth" folder so the user can see, download or delete it.

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

export interface DriveVersion {
  fileId: string
  etag: string
}

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

export const FOLDER_NAME = 'We Wealth'
export const DATA_FILE_NAME = 'we-wealth-data.json'
// Tags the app's own files so a search finds them even if the user renames them.
const APP_PROP = { key: 'weWealth', folder: 'folder', data: 'data' }

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

async function ensureFolder(token: AccessToken): Promise<string> {
  const existing = await findFile(token, APP_PROP.folder)
  if (existing) return existing
  const res = await driveFetch(token, `${API}?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { [APP_PROP.key]: APP_PROP.folder },
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

// Returns null when the user has no data file yet. `parse` validates the file's contents.
export async function loadData<T>(token: AccessToken, parse: (raw: unknown) => T): Promise<DriveFile<T> | null> {
  const fileId = await findFile(token, APP_PROP.data)
  if (!fileId) return null
  const version = await readVersion(token, fileId)
  const res = await driveFetch(token, `${VERSIONED_API}/${fileId}?alt=media&revisionId=${encodeURIComponent(version.headRevisionId)}`, {
    // Media and metadata representations need not expose the same ETag.
    // Download exactly the revision paired with the metadata ETag, then recheck.
    cache: 'no-store',
  })
  let raw: unknown
  try {
    raw = JSON.parse(await res.text())
  } catch {
    throw new Error(`Drive 中的 ${DATA_FILE_NAME} 不是有效的 JSON，請修正或刪除該檔案後重新登入。`)
  }
  const after = await readVersion(token, fileId)
  if (after.etag !== version.etag || after.headRevisionId !== version.headRevisionId) throw new DriveConflictError()
  return { fileId: version.fileId, etag: version.etag, data: parse(raw) }
}

// Creates the file on first save; afterwards overwrites the same file.
// Refuses, before any request, a file over the size limit (storageLimits.ts).
export async function saveData<T>(token: AccessToken, data: T, version?: DriveVersion): Promise<DriveVersion> {
  const content = serializeData(data)
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
