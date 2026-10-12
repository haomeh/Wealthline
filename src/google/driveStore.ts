// Reads and writes the user's data as a main file plus part files in Google Drive (dataParts.ts).
// A version 14 or older single file loads as before and is split by its next save.
//
// Opening reads only the main file. The overview uses the summary stored in it, one entry per
// part (dataSummary.ts); the transaction parts and the archived history years are read when a
// page needs them (readGroup). Each data object carries which parts it holds (partsOf): a save
// writes a part only from data that holds it, or after reading it, so records this session never
// read are kept.
//
// Three checks, each for its own question:
// - records hash (SHA-256 of the records in a fixed form): did a part's records change? A save
//   uploads a part only when its hash changes, and updates only that part's summary entry;
// - Drive MD5 checksum, listed without downloading: is a part file still the one its summary
//   entry was made from? Opening reads and re-summarizes only the parts where it differs;
// - ETag with If-Match on every write: has anyone written the file since this session read it?
//   If so the write is refused (DriveConflictError) and nothing is overwritten.

import type { AccessToken } from './auth'
import { DriveConflictError, createPart, findDataFile, listParts, parseJson, readFile, saveDataText, updatePart, type DriveVersion } from './drive'
import { canonicalHash, joinData, keptLedger, parsePart, partFileName, recordsHash, serializePart, splitData, type Part, type PartContent } from '../dataParts'
import type { CashflowMonthTotals } from '../cashflow'
import { emptySummary, parseSummary, partSummary, rulesOf, type DataSummary, type Rules } from '../dataSummary'
import type { Change, Snapshot } from '../history'
import { newId, type WealthData } from '../model'
import { byteSize, serializeData } from '../storageLimits'

interface StoredFile extends DriveVersion {
  text: string
}

// A part file. `part`, `text` and `hash` (recordsHash) are set once this session has read or written it.
interface StoredPart {
  fileId: string
  size: number | null
  md5: string | null
  etag?: string
  text?: string
  part?: Part
  hash?: string
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
  // The category rules in the main file, which the transaction summaries are counted with.
  rules: Rules
}

export const emptyDriveState = (): DriveState => ({ datasetId: newId(), split: false, parts: new Map(), summary: emptySummary(), rules: {} })

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
  state.parts.set(name, { ...stored, etag: file.etag, text: file.text, size: byteSize(file.text), part, hash: recordsHash(name, part.content) })
  return part
}

const entryFor = (state: DriveState, name: string, content: PartContent): DataSummary['parts'][string] => {
  const stored = state.parts.get(name)!
  return { hash: stored.hash!, md5: stored.md5, sequence: stored.part!.sequence, ...partSummary(name, content, state.rules) }
}

// Makes again the summary entries that are missing or that no longer match their part: its
// records hash differs (the part was read), or its Drive checksum does (not read yet), or the
// rules changed. A transaction entry is counted from the copies joinData keeps, so a record an
// interrupted move left in two parts is counted once; that needs every transaction part, so they
// are all read when one is outdated. History years are made again one by one.
async function refreshSummary(token: AccessToken, state: DriveState): Promise<void> {
  const rules = canonicalHash(rulesOf(state.rules))
  const entries = state.summary.parts
  const outdated = (name: string) => {
    const entry = entries[name], stored = state.parts.get(name)!
    if (!entry) return true
    if (stored.hash !== undefined) return stored.hash !== entry.hash
    return stored.md5 !== null && entry.md5 !== null && stored.md5 !== entry.md5
  }
  const ledger = [...state.parts.keys()].filter((name) => partGroup(name) === 'ledger')
  if (state.summary.rules !== rules || ledger.some(outdated)) {
    const parts = await eachLimited(ledger, (name) => readPart(token, state, name))
    const kept = keptLedger({}, parts)
    for (const name of ledger) entries[name] = entryFor(state, name, kept.get(name) ?? {})
  }
  for (const name of state.parts.keys()) {
    if (partGroup(name) === 'history' && outdated(name)) entries[name] = entryFor(state, name, (await readPart(token, state, name)).content)
  }
  state.summary.rules = rules
}

// The overview's monthly cashflow from the summary; undefined when a transaction part has no entry.
export function summaryCashflow(state: DriveState): CashflowMonthTotals[] | undefined {
  const ledger = [...state.parts.keys()].filter((name) => partGroup(name) === 'ledger')
  if (ledger.some((name) => !state.summary.parts[name]?.cashflow)) return undefined
  return ledger.flatMap((name) => state.summary.parts[name].cashflow!)
}

// Returns null when the user has no data file yet. `parse` validates the data.
export async function loadDrive(token: AccessToken, parse: (raw: unknown) => WealthData): Promise<{ data: WealthData; state: DriveState } | null> {
  const fileId = await findDataFile(token)
  if (!fileId) return null
  const main = await readFile(token, fileId)
  const raw = parseJson(main.text) as Record<string, unknown>
  const datasetId = raw?.version === 15 && typeof raw.datasetId === 'string' && raw.datasetId ? raw.datasetId : ''
  // An older file, or one without a data set (a restored backup), holds everything itself.
  const rules = rulesFrom(raw)
  if (!datasetId) return { data: withParts(parse(raw), 'all'), state: { ...emptyDriveState(), main, rules } }
  const parts = new Map<string, StoredPart>()
  // Two files for one part (two devices created it at once): the first is used.
  for (const p of await listParts(token, datasetId)) if (!parts.has(p.name)) parts.set(p.name, { fileId: p.id, size: p.size, md5: p.md5 })
  const { summary, ...rest } = raw
  const data = withParts(parse(joinData(rest, [])), new Set())
  const state: DriveState = { datasetId, main, split: true, parts, summary: parseSummary(summary), rules }
  await refreshSummary(token, state)
  return { data, state }
}

const rulesFrom = (raw: Record<string, unknown>): Rules => ({ expenseCategoryRules: raw.expenseCategoryRules as Rules['expenseCategoryRules'], bankCategoryRules: raw.bankCategoryRules as Rules['bankCategoryRules'] })

// Reads every part of `group`; parts read before are not read again. Summary entries that do not
// match what was read are made again.
export async function readGroup(token: AccessToken, state: DriveState, group: PartGroup): Promise<Part[]> {
  const parts = await eachLimited([...state.parts.keys()].filter((name) => partGroup(name) === group), (name) => readPart(token, state, name))
  await refreshSummary(token, state)
  return parts
}

// What the overview shows for the archived years while they are not loaded; null when a year
// has no summary (its part is read instead) or nothing is archived.
export function archiveSummary(state: DriveState): { points: Snapshot[]; carried: Change[]; from: string } | null {
  const names = [...state.parts.keys()].filter((name) => partGroup(name) === 'history').sort()
  const entries = names.map((name) => state.summary.parts[name])
  if (!names.length || entries.some((entry) => !entry?.points)) return null
  return {
    points: entries.flatMap((entry) => entry.points!),
    carried: entries.flatMap((entry) => entry.carried!),
    from: `${Number(names.at(-1)!.slice('history-'.length)) + 1}-01-01`,
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
  // changed when its records hash differs; its header and key order do not count.
  const names = [...new Set([...parts.keys(), ...[...state.parts.keys()].filter((name) => holds(held, name))])]
  const hashes = new Map(names.map((name) => [name, recordsHash(name, parts.get(name) ?? {})]))
  const changed = names.filter((name) => {
    const old = state.parts.get(name)
    return !old?.part || old.hash !== hashes.get(name)
  })
  const loses = (name: string) => {
    const old = state.parts.get(name)?.part
    if (!old) return false
    const kept = rowKeys(parts.get(name) ?? {})
    return [...rowKeys(old.content)].some((key) => !kept.has(key))
  }
  const ordered = [...changed.filter((name) => !loses(name)), ...changed.filter(loses)]

  // Each written part gets a new summary entry; the others keep theirs. The sequence continues
  // from every part, read or not (their summary entries record theirs).
  const summary: DataSummary = { ...state.summary, parts: { ...state.summary.parts } }
  state.summary = summary
  state.rules = rulesFrom(data as unknown as Record<string, unknown>)
  const created: string[] = []
  // One at a time: creating parts may create their folders, which must not happen twice.
  for (const name of ordered) {
    const old = state.parts.get(name)
    const sequence = Math.max(-1, ...[...state.parts.values()].map((p) => p.part?.sequence ?? -1), ...Object.values(summary.parts).map((e) => e.sequence)) + 1
    const part = { name, sequence, content: parts.get(name) ?? {} }
    const text = serializePart(name, state.datasetId, part.content, sequence)
    const written = old ? await updatePart(token, { fileId: old.fileId, etag: old.etag! }, text) : await createPart(token, name, partFileName(name), state.datasetId, text)
    if (!old) created.push(name)
    state.parts.set(name, { fileId: written.fileId, etag: written.etag, md5: written.md5, text, size: byteSize(text), part, hash: hashes.get(name) })
    summary.parts[name] = entryFor(state, name, part.content)
  }
  // Changed rules recount every transaction part; missing entries are made.
  await refreshSummary(token, state)

  const mainText = serializeData({ ...main, summary })
  if (state.main?.text !== mainText) {
    const written = await saveDataText(token, mainText, state.main)
    state.main = { ...written, text: mainText }
  }
  state.split = true
  return withParts({ ...data, version: 15 }, held === 'all' ? 'all' : new Set([...held, ...created]))
}

export { DriveConflictError }
