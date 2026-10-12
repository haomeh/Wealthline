// Reads and writes the user's data as a main file plus part files in Google Drive (dataParts.ts).
// A version 13 or older single file loads as before and is split by its next save.

import type { AccessToken } from './auth'
import { DriveConflictError, createPart, findDataFile, listParts, parseJson, readFile, saveDataText, updatePart, type DriveVersion } from './drive'
import { joinData, parsePart, partFileName, serializePart, splitData, type Part, type PartContent } from '../dataParts'
import { newId, type WealthData } from '../model'
import { byteSize, serializeData } from '../storageLimits'

interface StoredFile extends DriveVersion {
  text: string
}

// What this session last read from or wrote to Drive. Writes update it file by file, so a save
// that stops part way knows which files already hold the new content.
export interface DriveState {
  datasetId: string
  main?: StoredFile
  // Version 14 main file: its parts belong to `datasetId`. Before that, the single file holds everything.
  split: boolean
  parts: Map<string, StoredPart>
}

interface StoredPart extends StoredFile {
  part: Part
}

export const emptyDriveState = (): DriveState => ({ datasetId: newId(), split: false, parts: new Map() })

// Bytes of each stored file, for the size notices.
export const storedSizes = (state: DriveState) => [state.main, ...state.parts.values()].flatMap((f) => (f ? [byteSize(f.text)] : []))

// Transactions by id, history records by content.
const rowKeys = (content: PartContent) => new Set(Object.values(content).flatMap((rows) => rows.map((row) => (typeof row.id === 'string' ? row.id : JSON.stringify(row)))))

const POOL = 4
async function eachLimited<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await task(items[i])
    }
  }))
  return results
}

// Returns null when the user has no data file yet. `parse` validates the joined data.
export async function loadDrive(token: AccessToken, parse: (raw: unknown) => WealthData): Promise<{ data: WealthData; state: DriveState } | null> {
  const fileId = await findDataFile(token)
  if (!fileId) return null
  const main = await readFile(token, fileId)
  const raw = parseJson(main.text) as Record<string, unknown>
  const datasetId = raw?.version === 14 && typeof raw.datasetId === 'string' && raw.datasetId ? raw.datasetId : ''
  // An older file, or one without a data set (a restored backup), holds everything itself.
  if (!datasetId) return { data: parse(raw), state: { ...emptyDriveState(), main } }
  const files = await eachLimited(await listParts(token, datasetId), (id) => readFile(token, id))
  const parts = new Map<string, StoredPart>()
  const contents = files.map((file) => {
    const part = parsePart(file.text, datasetId)
    // Two files for one part (two devices created it at once): both are read; the first stays the one written.
    if (!parts.has(part.name)) parts.set(part.name, { ...file, part })
    return part
  })
  return { data: parse(joinData(raw, contents)), state: { datasetId, main, split: true, parts } }
}

// Writes `data`, uploading only the files whose content changed. Order keeps every record
// readable if the save stops part way (a lost connection, or another device's write):
// 1. a main file that gains bank accounts is first rewritten as before plus those accounts,
//    so transactions in new parts never point at an account the main file lacks;
// 2. parts that only gain or change records, then parts that lose records, so a record moved
//    between parts is written to its new part before it leaves the old one;
// 3. the main file last. Before the first split the old single file still holds everything,
//    so parts written ahead of it are ignored until it is replaced.
// Duplicates an interrupted move leaves are removed when reading (joinData).
export async function saveDrive(token: AccessToken, data: WealthData, state: DriveState, now = data.updatedAt): Promise<WealthData> {
  const { main, parts } = splitData(data, state.datasetId, now, [...state.parts.keys()].filter((name) => name.startsWith('history-')))
  const mainText = serializeData(main)

  if (state.split && state.main) {
    const before = parseJson(state.main.text) as Record<string, unknown>
    const known = (before.bankTransactionAccounts ?? []) as { id: string }[]
    const added = (data.bankTransactionAccounts ?? []).filter((a) => !known.some((k) => k.id === a.id))
    if (added.length) {
      const text = serializeData({ ...before, bankTransactionAccounts: [...known, ...added] })
      const written = await saveDataText(token, text, state.main)
      state.main = { ...written, text }
    }
  }

  // Parts that no longer have records keep their file, emptied. A part is changed when its
  // records differ; its sequence alone does not count.
  const names = new Set([...parts.keys(), ...state.parts.keys()])
  const changed = [...names].filter((name) => {
    const old = state.parts.get(name)
    return !old || serializePart(name, state.datasetId, parts.get(name) ?? {}, old.part.sequence) !== old.text
  })
  const loses = (name: string) => {
    const old = state.parts.get(name)
    if (!old) return false
    const kept = rowKeys(parts.get(name) ?? {})
    return [...rowKeys(old.part.content)].some((key) => !kept.has(key))
  }
  const ordered = [...changed.filter((name) => !loses(name)), ...changed.filter(loses)]
  // One at a time: creating parts may create their folders, which must not happen twice.
  for (const name of ordered) {
    const old = state.parts.get(name)
    const part = { name, sequence: Math.max(-1, ...[...state.parts.values()].map((p) => p.part.sequence)) + 1, content: parts.get(name) ?? {} }
    const text = serializePart(name, state.datasetId, part.content, part.sequence)
    const written = old ? await updatePart(token, old, text) : await createPart(token, name, partFileName(name), state.datasetId, text)
    state.parts.set(name, { ...written, text, part })
  }

  if (state.main?.text !== mainText) {
    const written = await saveDataText(token, mainText, state.main)
    state.main = { ...written, text: mainText }
  }
  state.split = true
  return { ...data, version: 14 }
}

export { DriveConflictError }
