// Version 15 splits the Drive data file so that no file grows past the upload limit
// (storageLimits.ts) and a save only uploads the files it changed:
// - the main file keeps the current state, the rules and this year's history;
// - card expenses and bank transactions go to one part file per calendar quarter of their date;
// - snapshots and edit logs of earlier years go to one part file per year.
// Reading joins them back into the one data shape the app uses (model.ts).

import { localDate } from './history'
import type { WealthData } from './model'

export const PART_FORMAT = 'wealthline-part'
const LEDGER_KEYS = ['expenses', 'bankTransactions'] as const
const HISTORY_KEYS = ['snapshots', 'changes', 'liabilityChanges'] as const
type Row = Record<string, unknown>
// The records of one part file, by collection name.
export type PartContent = Partial<Record<(typeof LEDGER_KEYS)[number] | (typeof HISTORY_KEYS)[number], Row[]>>

// Part names: `ledger-2026-Q4` for a quarter's transactions, `history-2025` for a year's history.
const PART_NAME = /^(?:ledger-\d{4}-Q[1-4]|history-\d{4})$/
export const isPartName = (name: string) => PART_NAME.test(name)
export const ledgerPart = (date: string) => `ledger-${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
const historyPart = (year: string) => `history-${year}`
export const partFileName = (name: string) => `wealthline-${name}.json`

// The year a history record belongs to. Edit times are UTC so every device agrees.
const snapshotYear = (s: Row) => String(s.date).slice(0, 4)
const editYear = (c: Row) => String(c.at).slice(0, 4)

export interface SplitFiles {
  main: Row // the main file's content
  parts: Map<string, PartContent>
}

// `archived`: names of history parts already stored. A year moves to its part once it has
// ended on this device, or already has a part; records never move back, so that devices in
// different time zones around New Year cannot pull them in opposite directions.
export function splitData(data: WealthData, datasetId: string, now: string, archived: Iterable<string> = []): SplitFiles {
  const parts = new Map<string, PartContent>()
  const add = (name: string, key: keyof PartContent, row: Row) => {
    const part = parts.get(name) ?? {}
    ;(part[key] ??= []).push(row)
    parts.set(name, part)
  }
  for (const key of LEDGER_KEYS) for (const row of (data[key] ?? []) as unknown as Row[]) add(ledgerPart(String(row.date)), key, row)

  const thisYear = localDate(now).slice(0, 4)
  const stored = new Set(archived)
  const past = (year: string) => year < thisYear || stored.has(historyPart(year))
  const keep: Record<(typeof HISTORY_KEYS)[number], Row[]> = { snapshots: [], changes: [], liabilityChanges: [] }
  for (const key of HISTORY_KEYS) {
    const yearOf = key === 'snapshots' ? snapshotYear : editYear
    for (const row of (data.history[key] ?? []) as unknown as Row[]) {
      const year = yearOf(row)
      if (past(year)) add(historyPart(year), key, row)
      else keep[key].push(row)
    }
  }
  // The main file keeps an empty list for each ledger the data has, so a ledger without records
  // still reads back as an empty list.
  const main: Row = { ...data, version: 15, datasetId, history: { ...data.history, ...keep } }
  for (const key of LEDGER_KEYS) {
    if (data[key]) main[key] = []
    else delete main[key]
  }
  delete (main.history as Row).valuedQuantityDays
  return { main, parts }
}

// One record per line: readable, and much smaller than indenting every field. `sequence` counts
// part writes across the data set, so that the newer of two copies of a record is known (joinData).
export function serializePart(name: string, datasetId: string, content: PartContent, sequence: number): string {
  const keys = name.startsWith('ledger-') ? LEDGER_KEYS : HISTORY_KEYS
  const lines = ['{', `  "format": ${JSON.stringify(PART_FORMAT)},`, '  "formatVersion": 1,', `  "datasetId": ${JSON.stringify(datasetId)},`, `  "part": ${JSON.stringify(name)},`, `  "sequence": ${sequence},`]
  keys.forEach((key, i) => {
    const rows = content[key] ?? []
    const end = i < keys.length - 1 ? ',' : ''
    if (!rows.length) return lines.push(`  ${JSON.stringify(key)}: []${end}`)
    lines.push(`  ${JSON.stringify(key)}: [`)
    rows.forEach((row, j) => lines.push(`    ${JSON.stringify(row)}${j < rows.length - 1 ? ',' : ''}`))
    lines.push(`  ]${end}`)
  })
  lines.push('}')
  return lines.join('\n') + '\n'
}

// Checks the frame of a part file; the records themselves are checked by parseWealthData
// once joined with the main file.
export interface Part {
  name: string
  sequence: number
  content: PartContent
}

export function parsePart(text: string, datasetId: string): Part {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Drive 中的分檔不是有效的 JSON，已停止載入以免覆寫。')
  }
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Row
  const name = typeof obj.part === 'string' ? obj.part : ''
  const sequence = obj.sequence
  if (obj.format !== PART_FORMAT || obj.formatVersion !== 1 || !isPartName(name) || !(typeof sequence === 'number' && Number.isInteger(sequence) && sequence >= 0)) throw new Error('Drive 中的分檔格式不正確，已停止載入以免覆寫。')
  if (obj.datasetId !== datasetId) throw new Error(`Drive 中的分檔 ${name} 不屬於這份資料，已停止載入。`)
  const content: PartContent = {}
  for (const key of name.startsWith('ledger-') ? LEDGER_KEYS : HISTORY_KEYS) {
    if (obj[key] === undefined) continue
    if (!Array.isArray(obj[key])) throw new Error(`Drive 中的分檔 ${name} 格式不正確，已停止載入。`)
    content[key] = obj[key] as Row[]
  }
  return { name, sequence, content }
}

// One record's identity within a part: transactions by id, snapshots by date (one per day),
// edit records by content.
export const rowKey = (key: keyof PartContent, row: Row) =>
  `${key}:${key === 'snapshots' ? String(row.date) : typeof row.id === 'string' ? row.id : JSON.stringify(row)}`

// One part from several files of the same part name (two creates of one part, for example a
// create whose reply was lost and was then sent again). Every record of every copy is kept once,
// from the copy written last.
export function mergeCopies(copies: Part[]): Part {
  const sorted = [...copies].sort((a, b) => b.sequence - a.sequence)
  const name = sorted[0].name
  const content: PartContent = {}
  for (const key of name.startsWith('ledger-') ? LEDGER_KEYS : HISTORY_KEYS) {
    if (!sorted.some((c) => c.content[key])) continue
    const seen = new Set<string>()
    const rows: Row[] = []
    for (const c of sorted) for (const row of c.content[key] ?? []) {
      const k = rowKey(key, row)
      if (seen.has(k)) continue
      seen.add(k)
      rows.push(row)
    }
    content[key] = rows
  }
  return { name, sequence: sorted[0].sequence, content }
}

// Which copy of each transaction is kept when a record is found twice, which an interrupted
// save that moved it between files can leave: the copy written last, then the copy in the part
// of its own date. Returns, by part name ('' for the main file), the rows kept there.
export function keptLedger(main: Row, parts: Part[]): Map<string, PartContent> {
  const kept = new Map<string, PartContent>()
  for (const key of LEDGER_KEYS) {
    const byId = new Map<unknown, { row: Row; part: string; sequence: number; home: boolean }>()
    const rows = [...((main[key] ?? []) as Row[]).map((row) => ({ row, part: '', sequence: -1 })), ...parts.flatMap((p) => (p.content[key] ?? []).map((row) => ({ row, part: p.name, sequence: p.sequence })))]
    for (const { row, part, sequence } of rows) {
      const home = part === ledgerPart(String(row.date))
      const seen = byId.get(row.id)
      if (!seen || sequence > seen.sequence || (sequence === seen.sequence && home && !seen.home)) byId.set(row.id, { row, part, sequence, home })
    }
    for (const { row, part } of byId.values()) {
      const content = kept.get(part) ?? {}
      ;(content[key] ??= []).push(row)
      kept.set(part, content)
    }
  }
  return kept
}

// The main file's content with its parts put back. Parts come in name order, so transactions
// come grouped by quarter (the views sort them by date). A record found twice is kept once:
// transactions as keptLedger says, history records by content.
export function joinData(main: Row, parts: Part[]): Row {
  const sorted = [...parts].sort((a, b) => a.name.localeCompare(b.name))
  const kept = keptLedger(main, sorted)
  const ledger = (key: (typeof LEDGER_KEYS)[number]) => ['', ...sorted.map((p) => p.name)].flatMap((name) => kept.get(name)?.[key] ?? [])
  const history = (main.history ?? {}) as Row
  const merged = (key: (typeof HISTORY_KEYS)[number]) => {
    const seen = new Set<string>()
    const rows: Row[] = []
    for (const row of [...sorted.flatMap((p) => p.content[key] ?? []), ...((history[key] ?? []) as Row[])]) {
      const id = key === 'snapshots' ? String(row.date) : JSON.stringify(row)
      if (seen.has(id)) continue
      seen.add(id)
      rows.push(row)
    }
    return rows
  }
  const hasLedger = (key: (typeof LEDGER_KEYS)[number]) => main[key] !== undefined || sorted.some((p) => p.content[key])
  return {
    ...main,
    ...(hasLedger('expenses') && { expenses: ledger('expenses') }),
    ...(hasLedger('bankTransactions') && { bankTransactions: ledger('bankTransactions') }),
    history: { ...history, snapshots: merged('snapshots'), changes: merged('changes'), liabilityChanges: merged('liabilityChanges') },
  }
}

// Records of a part in a fixed form: collections in a fixed order, object keys sorted. Its
// hash says whether two versions of a part hold the same records, whatever the file's header
// (data set, part name, sequence) or key order.
const canonical = (value: unknown): string =>
  Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : typeof value === 'object' && value !== null ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Row)[k])}`).join(',')}}`
      : JSON.stringify(value) ?? 'null'

// SHA-256 as lowercase hex. Synchronous (crypto.subtle is not), so hashing adds no wait to a save.
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const length = Math.ceil((bytes.length + 9) / 64) * 64
  const message = new Uint8Array(length)
  message.set(bytes)
  message[bytes.length] = 0x80
  const view = new DataView(message.buffer)
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(length - 4, bytes.length * 8)
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = w[i - 16] + s0 + w[i - 7] + s1
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('')
}

export const recordsHash = (name: string, content: PartContent) =>
  sha256((name.startsWith('ledger-') ? LEDGER_KEYS : HISTORY_KEYS).map((key) => `${key}:${canonical(content[key] ?? [])}`).join('\n'))
export const canonicalHash = (value: unknown) => sha256(canonical(value))
