// Reads and writes the user's data as a main file plus part files in Google Drive (dataParts.ts).
// A version 14 or older single file loads as before and is split by its next save.
//
// Opening reads only the main file. The overview uses the summary stored in it (dataSummary.ts);
// the transaction parts and the archived history years are read when a page needs them
// (readGroup). Each data object carries which parts it holds (partsOf): a save writes a part only
// from data that holds it, or after reading it, so records this session never read are kept.

import type { AccessToken } from './auth'
import { DriveConflictError, createPart, findDataFile, listParts, parseJson, readFile, saveDataText, updatePart, type DriveVersion } from './drive'
import { joinData, parsePart, partFileName, serializePart, splitData, type Part, type PartContent } from '../dataParts'
import { cashflowMonths } from '../cashflow'
import { emptySummary, parseSummary, yearSummary, type DataSummary } from '../dataSummary'
import type { Change, Snapshot } from '../history'
import { newId, type WealthData } from '../model'
import { byteSize, serializeData } from '../storageLimits'

interface StoredFile extends DriveVersion {
  text: string
}

// A part file. `part` and `text` are set once this session has read or written it.
interface StoredPart {
  fileId: string
  size: number | null
  etag?: string
  text?: string
  part?: Part
}

// What this session last read from or wrote to Drive. Writes update it file by file, so a save
// that stops part way knows which files already hold the new content.
export interface DriveState {
  datasetId: string
  main?: StoredFile
  // Version 15 main file: its parts belong to `datasetId`. Before that, the single file holds everything.
  split: boolean
  parts: Map<string, StoredPart>
  summary: DataSummary
}

export const emptyDriveState = (): DriveState => ({ datasetId: newId(), split: false, parts: new Map(), summary: emptySummary() })

export type PartGroup = 'ledger' | 'history'
export const partGroup = (name: string): PartGroup => (name.startsWith('ledger-') ? 'ledger' : 'history')

// Which part files a data object holds all records of: 'all' when it was read from a single file.
// A symbol key: object spreads copy it, JSON leaves it out.
const PARTS = Symbol('wealthline.parts')
type Held = ReadonlySet<string> | 'all'
export const partsOf = (data: WealthData): Held => (data as WealthData & { [PARTS]?: Held })[PARTS] ?? new Set()
const withParts = (data: WealthData, held: Held): WealthData => ({ ...data, [PARTS]: held }) as WealthData
const holds = (held: Held, name: string) => held === 'all' || held.has(name)

// Parts of `group` stored in Drive whose records `data` does not hold yet.
export const missingParts = (state: DriveState, data: WealthData, group: PartGroup) =>
  [...state.parts.keys()].filter((name) => partGroup(name) === group && !holds(partsOf(data), name))

// Bytes of each stored file, for the size notices.
export const storedSizes = (state: DriveState) => [
  ...(state.main ? [byteSize(state.main.text)] : []),
  ...[...state.parts.values()].flatMap((p) => (p.text !== undefined ? [byteSize(p.text)] : p.size !== null ? [p.size] : [])),
]

// Transactions by id, history records by content.
const rowKey = (row: Record<string, unknown>) => (typeof row.id === 'string' ? row.id : JSON.stringify(row))
const rowKeys = (content: PartContent) => new Set(Object.values(content).flatMap((rows) => rows.map(rowKey)))

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

async function readPart(token: AccessToken, state: DriveState, name: string): Promise<Part> {
  const stored = state.parts.get(name)!
  if (stored.part) return stored.part
  const file = await readFile(token, stored.fileId)
  const part = parsePart(file.text, state.datasetId)
  if (part.name !== name) throw new Error(`Drive 中的分檔 ${name} 格式不正確，已停止載入。`)
  state.parts.set(name, { ...stored, etag: file.etag, text: file.text, size: byteSize(file.text), part })
  return part
}

// Returns null when the user has no data file yet. `parse` validates the data.
export async function loadDrive(token: AccessToken, parse: (raw: unknown) => WealthData): Promise<{ data: WealthData; state: DriveState } | null> {
  const fileId = await findDataFile(token)
  if (!fileId) return null
  const main = await readFile(token, fileId)
  const raw = parseJson(main.text) as Record<string, unknown>
  const datasetId = raw?.version === 15 && typeof raw.datasetId === 'string' && raw.datasetId ? raw.datasetId : ''
  // An older file, or one without a data set (a restored backup), holds everything itself.
  if (!datasetId) return { data: withParts(parse(raw), 'all'), state: { ...emptyDriveState(), main } }
  const parts = new Map<string, StoredPart>()
  // Two files for one part (two devices created it at once): the first is used.
  for (const p of await listParts(token, datasetId)) if (!parts.has(p.name)) parts.set(p.name, { fileId: p.id, size: p.size })
  const { summary, ...rest } = raw
  return { data: withParts(parse(joinData(rest, [])), new Set()), state: { datasetId, main, split: true, parts, summary: parseSummary(summary) } }
}

// Reads every part of `group`; parts read before are not read again.
export async function readGroup(token: AccessToken, state: DriveState, group: PartGroup): Promise<Part[]> {
  return eachLimited([...state.parts.keys()].filter((name) => partGroup(name) === group), (name) => readPart(token, state, name))
}

// What the overview shows for the archived years while they are not loaded; null when a year
// has no summary (its part is read instead) or nothing is archived.
export function archiveSummary(state: DriveState): { points: Snapshot[]; carried: Change[]; from: string } | null {
  const years = [...state.parts.keys()].filter((name) => partGroup(name) === 'history').map((name) => name.slice('history-'.length)).sort()
  if (!years.length || years.some((year) => !state.summary.history[year])) return null
  return {
    points: years.flatMap((year) => state.summary.history[year].points),
    carried: years.flatMap((year) => state.summary.history[year].carried),
    from: `${Number(years.at(-1)) + 1}-01-01`,
  }
}

// `data` with the records of `parts` added; parts it already holds are skipped.
export function mergeParts(data: WealthData, parts: Part[], parse: (raw: unknown) => WealthData): WealthData {
  const held = partsOf(data)
  const added = parts.filter((p) => !holds(held, p.name))
  if (!added.length) return data
  // Parsed together with the rest of the data, so the records are checked like at load.
  const joined = parse(JSON.parse(JSON.stringify(joinData(data as unknown as Record<string, unknown>, added))))
  const next: WealthData = {
    ...data,
    ...(joined.expenses !== undefined && { expenses: joined.expenses }),
    ...(joined.bankTransactions !== undefined && { bankTransactions: joined.bankTransactions }),
    history: { ...data.history, snapshots: joined.history.snapshots, changes: joined.history.changes, liabilityChanges: joined.history.liabilityChanges },
  }
  return withParts(next, held === 'all' ? 'all' : new Set([...held, ...added.map((p) => p.name)]))
}

const sameRules = (a: Record<string, unknown>, b: WealthData) =>
  JSON.stringify([a.expenseCategoryRules ?? null, a.bankCategoryRules ?? null]) === JSON.stringify([b.expenseCategoryRules ?? null, b.bankCategoryRules ?? null])

// Writes `data`, uploading only the files whose content changed. Order keeps every record
// readable if the save stops part way (a lost connection, or another device's write):
// 1. a main file that gains bank accounts is first rewritten as before plus those accounts,
//    so transactions in new parts never point at an account the main file lacks;
// 2. parts that only gain or change records, then parts that lose records, so a record moved
//    between parts is written to its new part before it leaves the old one;
// 3. the main file last, with the summary of what the parts now hold. Before the first split
//    the old single file still holds everything, so parts written ahead of it are ignored until
//    it is replaced.
// Duplicates an interrupted move leaves are removed when reading (joinData).
export async function saveDrive(token: AccessToken, data: WealthData, state: DriveState, now = data.updatedAt): Promise<WealthData> {
  const held = partsOf(data)
  const { main, parts } = splitData(data, state.datasetId, now, [...state.parts.keys()].filter((name) => partGroup(name) === 'history'))
  const before = state.main ? (parseJson(state.main.text) as Record<string, unknown>) : {}

  if (state.split && state.main) {
    const known = (before.bankTransactionAccounts ?? []) as { id: string }[]
    const added = (data.bankTransactionAccounts ?? []).filter((a) => !known.some((k) => k.id === a.id))
    if (added.length) {
      const text = serializeData({ ...before, bankTransactionAccounts: [...known, ...added] })
      const written = await saveDataText(token, text, state.main)
      state.main = { ...written, text }
    }
  }

  // A stored part the data does not hold, but that gets new records (an edit dated in it, or a
  // year that ended this session), is read first and keeps the records this session did not read.
  for (const [name, content] of parts) {
    if (!state.parts.has(name) || holds(held, name)) continue
    const stored = await readPart(token, state, name)
    const keys = rowKeys(content)
    for (const [key, rows] of Object.entries(stored.content) as [keyof PartContent, Record<string, unknown>[]][]) {
      content[key] = [...(content[key] ?? []), ...rows.filter((row) => !keys.has(rowKey(row)))]
    }
  }

  // Parts the data holds but that no longer have records keep their file, emptied. A part is
  // changed when its records differ; its sequence alone does not count.
  const names = new Set([...parts.keys(), ...[...state.parts.keys()].filter((name) => holds(held, name))])
  const changed = [...names].filter((name) => {
    const old = state.parts.get(name)
    return !old?.part || serializePart(name, state.datasetId, parts.get(name) ?? {}, old.part.sequence) !== old.text
  })
  const loses = (name: string) => {
    const old = state.parts.get(name)?.part
    if (!old) return false
    const kept = rowKeys(parts.get(name) ?? {})
    return [...rowKeys(old.content)].some((key) => !kept.has(key))
  }
  const ordered = [...changed.filter((name) => !loses(name)), ...changed.filter(loses)]

  // The cashflow summary covers every transaction part. Parts this session has not read are read
  // when transactions or the rules that set their categories change, or the summary is missing;
  // before writing, so that write sequences stay above every copy of a record (joinData).
  const ledger = [...state.parts.keys()].filter((name) => partGroup(name) === 'ledger')
  const summary: DataSummary = { ...state.summary, history: { ...state.summary.history } }
  const recount = !state.split || summary.cashflow === undefined || !sameRules(before, data) || ordered.some((name) => partGroup(name) === 'ledger')
  if (recount) await eachLimited(ledger, (name) => readPart(token, state, name))

  const created: string[] = []
  // One at a time: creating parts may create their folders, which must not happen twice.
  for (const name of ordered) {
    const old = state.parts.get(name)
    const sequence = Math.max(-1, ...[...state.parts.values()].map((p) => p.part?.sequence ?? -1)) + 1
    const part = { name, sequence, content: parts.get(name) ?? {} }
    const text = serializePart(name, state.datasetId, part.content, sequence)
    const written = old ? await updatePart(token, { fileId: old.fileId, etag: old.etag! }, text) : await createPart(token, name, partFileName(name), state.datasetId, text)
    if (!old) created.push(name)
    state.parts.set(name, { fileId: written.fileId, etag: written.etag, text, size: byteSize(text), part })
  }

  if (recount) {
    const all = [...state.parts.entries()].filter(([name]) => partGroup(name) === 'ledger').map(([, p]) => p.part!)
    const rows = joinData({ expenses: [], bankTransactions: [] }, all)
    summary.cashflow = cashflowMonths({
      expenses: rows.expenses as WealthData['expenses'],
      expenseRules: data.expenseCategoryRules,
      bankTransactions: rows.bankTransactions as WealthData['bankTransactions'],
      bankRules: data.bankCategoryRules,
    })
  }
  // Each archived year's summary is made when its part is written, or read when it is missing.
  for (const name of state.parts.keys()) {
    if (partGroup(name) !== 'history') continue
    const year = name.slice('history-'.length)
    if (summary.history[year] && !ordered.includes(name)) continue
    summary.history[year] = yearSummary(year, (await readPart(token, state, name)).content)
  }

  const mainText = serializeData({ ...main, summary })
  if (state.main?.text !== mainText) {
    const written = await saveDataText(token, mainText, state.main)
    state.main = { ...written, text: mainText }
  }
  state.split = true
  state.summary = summary
  return withParts({ ...data, version: 15 }, held === 'all' ? 'all' : new Set([...held, ...created]))
}

export { DriveConflictError }
