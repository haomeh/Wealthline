// Version 14 splits the Drive data file so that no file grows past the upload limit
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
  const main: Row = { ...data, version: 14, datasetId, history: { ...data.history, ...keep } }
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

// The main file's content with its parts put back. Parts come in name order, so transactions
// come grouped by quarter (the views sort them by date). A record found twice, which an
// interrupted save that moved it between files can leave, is kept once: transactions by id,
// preferring the copy written last, then the copy in the part of its own date; history by content.
export function joinData(main: Row, parts: Part[]): Row {
  const sorted = [...parts].sort((a, b) => a.name.localeCompare(b.name))
  const ledger = (key: (typeof LEDGER_KEYS)[number]) => {
    const byId = new Map<unknown, { row: Row; sequence: number; home: boolean }>()
    const rows = [...((main[key] ?? []) as Row[]).map((row) => ({ row, part: '', sequence: -1 })), ...sorted.flatMap((p) => (p.content[key] ?? []).map((row) => ({ row, part: p.name, sequence: p.sequence })))]
    for (const { row, part, sequence } of rows) {
      const home = part === ledgerPart(String(row.date))
      const seen = byId.get(row.id)
      if (!seen || sequence > seen.sequence || (sequence === seen.sequence && home && !seen.home)) byId.set(row.id, { row, sequence, home })
    }
    return [...byId.values()].map((v) => v.row)
  }
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
