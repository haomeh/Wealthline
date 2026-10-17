// CSV files the user (or an AI tool the user chose) prepares for import: card expenses, bank
// transactions, or account balances and holdings. The format is in docs/csv-import.md.
// Files are read in the browser only. A file with any invalid row is rejected as a whole.

import { BANK_EXCLUSION_REASONS, INCOME_CATEGORIES, type Classification } from './bankTransactions'
import { CARD_CATEGORIES, EXPENSE_CATEGORIES, isUnrecognizedMerchant, type CardCategory, type ExpenseCategory } from './expenses'
import { isSupportedCurrency } from './currencies'
import { validDate } from './quantityHistory'

export type CsvImportType = 'card' | 'bank' | 'position'
export const CSV_TYPE_NAMES: Record<CsvImportType, string> = { card: '信用卡消費', bank: '銀行流水', position: '帳戶餘額與持倉' }
export const CSV_MAX_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 20000
// Error lists stop here; the count of the rest is added.
const MAX_ISSUES = 20

export const isCsvFile = (file: { name?: string; type?: string }) => /\.csv$/i.test(file.name ?? '') || /^text\/csv\b/i.test(file.type ?? '')

export class CsvError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) { super(message); this.issues = issues }
}

/** Strict UTF-8 with an optional BOM; Big5 or other encodings are refused instead of guessed. */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes.length > CSV_MAX_BYTES) throw new CsvError('CSV 超過 5 MB，請拆分後再匯入。')
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    throw new CsvError('CSV 不是 UTF-8 編碼，請另存為「CSV UTF-8」後再匯入。')
  }
}

/** RFC 4180: comma separated, double quotes around fields that hold commas, quotes or line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, i = 0
  const input = text.replace(/^﻿/, '')
  while (i < input.length) {
    const c = input[i]
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i += 2; continue }
      if (c === '"') { quoted = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"' && field === '') { quoted = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r' || c === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
      i += c === '\r' && input[i + 1] === '\n' ? 2 : 1
      continue
    }
    field += c; i++
  }
  if (quoted) throw new CsvError('CSV 有未結束的引號，請檢查檔案是否完整。')
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

interface Table { header: string[]; rows: { line: number; cells: Record<string, string> }[] }

function table(text: string): Table {
  const lines = parseCsv(text)
  // Line numbers as a spreadsheet shows them; blank lines are skipped but still counted.
  const numbered = lines.map((cells, index) => ({ line: index + 1, cells })).filter(r => r.cells.some(c => c.trim()))
  if (!numbered.length) throw new CsvError('CSV 沒有內容。')
  const header = numbered[0].cells.map(h => h.trim().toLowerCase())
  if (!header.includes('type')) throw new CsvError('CSV 第一列必須是英文欄名，並包含 type 欄。')
  const duplicate = header.find((h, i) => h && header.indexOf(h) !== i)
  if (duplicate) throw new CsvError(`CSV 欄名「${duplicate}」重複。`)
  const body = numbered.slice(1)
  if (!body.length) throw new CsvError('CSV 只有欄名，沒有資料列。')
  if (body.length > MAX_ROWS) throw new CsvError(`CSV 超過 ${MAX_ROWS} 列，請拆分後再匯入。`)
  return {
    header,
    rows: body.map(r => ({ line: r.line, cells: Object.fromEntries(header.map((h, i) => [h, (r.cells[i] ?? '').trim()])) })),
  }
}

/** Whether the first non-blank line is a CSV header with a type column (pasted sheet rows are not). */
export function hasCsvHeader(text: string): boolean {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim()) ?? ''
  return first.includes(',') && first.split(',').some(c => c.trim().replace(/^"|"$/g, '').toLowerCase() === 'type')
}

function typeOf(rows: Table['rows']): CsvImportType {
  const types = new Set(rows.map(r => r.cells.type.toLowerCase()))
  if (types.size !== 1) throw new CsvError('同一個 CSV 只能放一種 type（card、bank 或 position）。')
  const [type] = types
  if (type !== 'card' && type !== 'bank' && type !== 'position') throw new CsvError('type 欄必須是 card、bank 或 position。')
  return type
}

/** The one `type` every row of the file has. Mixed or unknown types are refused. */
export const csvImportType = (text: string): CsvImportType => typeOf(table(text).rows)

function rowsOf(text: string, type: CsvImportType, required: string[]): Table['rows'] {
  const { header, rows } = table(text)
  const found = typeOf(rows)
  if (found !== type) throw new CsvError(`這是${CSV_TYPE_NAMES[found]} CSV，不能在${CSV_TYPE_NAMES[type]}匯入。`)
  const missing = required.filter(k => !header.includes(k))
  if (missing.length) throw new CsvError(`CSV 缺少欄位：${missing.join('、')}。`)
  return rows
}

function reject(issues: string[]): never {
  const shown = issues.slice(0, MAX_ISSUES)
  if (issues.length > shown.length) shown.push(`另有 ${issues.length - shown.length} 個問題未列出`)
  throw new CsvError(`CSV 有 ${issues.length} 個問題，整份檔案未匯入。`, shown)
}

// A plain decimal: optional minus sign, no thousands separators or currency symbols.
const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/
function number(value: string): number { return NUMBER.test(value) ? Number(value) : NaN }
// Text a spreadsheet would run as a formula when the file is opened again.
const FORMULA = /^[=+\-@\t\r]/

function text(cells: Record<string, string>, key: string, label: string, max: number, problems: string[], required = true): string {
  const value = cells[key] ?? ''
  if (!value) { if (required) problems.push(`缺少${label}`); return '' }
  if (value.length > max) problems.push(`${label}最多 ${max} 字`)
  if (FORMULA.test(value)) problems.push(`${label}不可用 = + - @ 開頭`)
  return value
}
function date(cells: Record<string, string>, key: string, label: string, problems: string[]): string {
  const value = cells[key] ?? ''
  if (!validDate(value)) problems.push(`${label}必須是 YYYY-MM-DD`)
  return value
}
// Ledger rows take ISO 4217 codes; balances and holdings also take the crypto codes the app prices.
function currency(cells: Record<string, string>, problems: string[], crypto = false): string {
  const value = (cells.currency ?? '').toUpperCase()
  if (!(crypto ? isSupportedCurrency(value) : /^[A-Z]{3}$/.test(value))) problems.push('幣別必須是 TWD、USD 這類三碼代號')
  return value
}
function amount(cells: Record<string, string>, key: string, label: string, problems: string[], positive = false): number {
  const value = number(cells[key] ?? '')
  if (!Number.isFinite(value) || Math.abs(value) > 1e12) problems.push(`${label}必須是不含千分位的數字`)
  else if (positive && value < 0) problems.push(`${label}不可為負數`)
  return value
}

export interface CardCsvRow {
  line: number
  date: string
  description: string
  amount: number
  currency: string
  card: string
  category?: CardCategory
  statementMonth?: string
  statementTotal?: number
}
export interface CardCsvCheck { card: string; month: string; currency: string; expected: number; actual: number; matches: boolean }

/** Card expense rows: spending positive, refunds negative. Stated statement totals are checked against the rows. */
export function readCardCsv(textContent: string): { rows: CardCsvRow[]; checks: CardCsvCheck[] } {
  const issues: string[] = [], rows: CardCsvRow[] = []
  for (const { line, cells } of rowsOf(textContent, 'card', ['type', 'date', 'description', 'amount', 'currency', 'card'])) {
    const problems: string[] = []
    const row: CardCsvRow = {
      line,
      date: date(cells, 'date', '日期', problems),
      description: text(cells, 'description', '商家／說明', 500, problems),
      amount: amount(cells, 'amount', '金額', problems),
      currency: currency(cells, problems),
      card: text(cells, 'card', '卡片名稱', 100, problems),
    }
    if (/^\d{12,19}$/.test(row.card.replace(/[\s-]/g, ''))) problems.push('卡片名稱不要填完整卡號')
    if (row.description && isUnrecognizedMerchant(row.description)) problems.push('商家／說明無法辨識')
    if (cells.category) {
      if ((CARD_CATEGORIES as readonly string[]).includes(cells.category)) row.category = cells.category as CardCategory
      else problems.push(`分類必須是 ${CARD_CATEGORIES.join('、')} 之一`)
    }
    if (cells.statement_month) {
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(cells.statement_month)) row.statementMonth = cells.statement_month
      else problems.push('帳單月份必須是 YYYY-MM')
    }
    if (cells.statement_total) {
      const total = number(cells.statement_total)
      if (Number.isFinite(total) && Math.abs(total) <= 1e12) row.statementTotal = total
      else problems.push('帳單總額必須是不含千分位的數字')
    }
    if (problems.length) issues.push(`第 ${line} 列：${problems.join('；')}`)
    else rows.push(row)
  }
  // One stated total per card, statement month and currency; the rows of that group must add up to it.
  const groups = new Map<string, CardCsvCheck>()
  for (const r of rows) {
    if (r.statementTotal === undefined) continue
    const key = JSON.stringify([r.card.toUpperCase(), r.statementMonth ?? '', r.currency])
    const group = groups.get(key)
    if (group && group.expected !== r.statementTotal) issues.push(`第 ${r.line} 列：同一張帳單的帳單總額不一致（${group.expected} 與 ${r.statementTotal}）`)
    else if (!group) groups.set(key, { card: r.card, month: r.statementMonth ?? '', currency: r.currency, expected: r.statementTotal, actual: 0, matches: false })
  }
  if (issues.length) reject(issues)
  for (const r of rows) {
    const group = groups.get(JSON.stringify([r.card.toUpperCase(), r.statementMonth ?? '', r.currency]))
    if (group) group.actual += r.amount
  }
  const checks = [...groups.values()].map((g) => {
    const actual = Math.round(g.actual * 100) / 100
    return { ...g, actual, matches: Math.abs(actual - g.expected) < 0.005 }
  })
  return { rows, checks }
}

export interface BankCsvRow {
  line: number
  account: string
  bank: string
  date: string
  description: string
  direction: 'debit' | 'credit'
  amount: number
  currency: string
  classification?: Classification
}
export interface BankCsvBalance { account: string; bank: string; date: string; currency: string; quantity: number; line: number }

const DIRECTIONS: Record<string, 'debit' | 'credit'> = { debit: 'debit', credit: 'credit', '支出': 'debit', '入帳': 'credit', '存入': 'credit' }

function classification(value: string, problems: string[]): Classification | undefined {
  if (!value || value === 'pending') return undefined
  const [kind, category] = value.split(':').map(s => s.trim())
  if (kind === 'income' && (INCOME_CATEGORIES as readonly string[]).includes(category)) return { kind, category: category as (typeof INCOME_CATEGORIES)[number] }
  if (kind === 'expense' && (EXPENSE_CATEGORIES as readonly string[]).includes(category)) return { kind, category: category as ExpenseCategory }
  if (kind === 'excluded' && (BANK_EXCLUSION_REASONS as readonly string[]).includes(category)) return { kind, reason: category as (typeof BANK_EXCLUSION_REASONS)[number] }
  problems.push('分類必須是 income:薪資、expense:餐飲、excluded:信用卡繳款 這類格式，或留空')
  return undefined
}

/** Bank rows: direction and a positive amount. A closing balance on any row is that account's balance on closing_date. */
export function readBankCsv(textContent: string): { rows: BankCsvRow[]; balances: BankCsvBalance[] } {
  const issues: string[] = [], rows: BankCsvRow[] = [], balances: BankCsvBalance[] = []
  for (const { line, cells } of rowsOf(textContent, 'bank', ['type', 'account', 'date', 'description', 'direction', 'amount', 'currency'])) {
    const problems: string[] = []
    const account = text(cells, 'account', '帳戶標籤', 100, problems)
    const bank = text(cells, 'bank', '銀行名稱', 100, problems, false) || account
    const direction = DIRECTIONS[(cells.direction ?? '').toLowerCase()]
    if (!direction) problems.push('direction 必須是 debit（支出）或 credit（入帳）')
    const row: BankCsvRow = {
      line, account, bank, direction,
      date: date(cells, 'date', '日期', problems),
      description: text(cells, 'description', '摘要', 500, problems),
      amount: amount(cells, 'amount', '金額', problems, true),
      currency: currency(cells, problems),
    }
    const classified = classification(cells.classification ?? '', problems)
    if (classified) row.classification = classified
    if (cells.closing_balance) {
      const quantity = amount(cells, 'closing_balance', '期末餘額', problems, true)
      const closing = date(cells, 'closing_date', '期末餘額日期', problems)
      if (!problems.length) balances.push({ account, bank, date: closing, currency: row.currency, quantity, line })
    }
    if (problems.length) issues.push(`第 ${line} 列：${problems.join('；')}`)
    else rows.push(row)
  }
  const seen = new Map<string, number>()
  for (const b of balances) {
    const key = JSON.stringify([b.account.toUpperCase(), b.date, b.currency])
    if (seen.has(key) && seen.get(key) !== b.quantity) issues.push(`第 ${b.line} 列：同帳戶同日同幣別的期末餘額不一致`)
    seen.set(key, b.quantity)
  }
  if (issues.length) reject(issues)
  const unique = balances.filter((b, i) => balances.findIndex(x => x.account.toUpperCase() === b.account.toUpperCase() && x.date === b.date && x.currency === b.currency) === i)
  return { rows, balances: unique }
}

export interface PositionCsvRow {
  line: number
  account: string
  kind: 'bank' | 'investment'
  country: string
  category: string
  currency: string
  symbol: string
  quantity: number
  price?: number
}

/** Account balances (no symbol) and holdings (symbol, quantity, optional price). */
export function readPositionCsv(textContent: string): PositionCsvRow[] {
  const issues: string[] = [], rows: PositionCsvRow[] = []
  for (const { line, cells } of rowsOf(textContent, 'position', ['type', 'account', 'kind', 'currency', 'quantity'])) {
    const problems: string[] = []
    const kind = cells.kind?.toLowerCase()
    if (kind !== 'bank' && kind !== 'investment') problems.push('kind 必須是 bank（銀行帳戶）或 investment（投資帳戶）')
    const country = (cells.country ?? '').toUpperCase()
    if (country && !/^[A-Z]{2}$/.test(country)) problems.push('國家必須是 TW、SG 這類兩碼代號')
    const symbol = text(cells, 'symbol', '代號', 40, problems, false).toUpperCase()
    if (symbol && kind === 'bank') problems.push('銀行帳戶只記錄現金餘額，代號請留空')
    const row: PositionCsvRow = {
      line, country, symbol,
      account: text(cells, 'account', '帳戶名稱', 100, problems),
      kind: kind === 'bank' ? 'bank' : 'investment',
      category: text(cells, 'category', '類別', 50, problems, false),
      currency: currency(cells, problems, true),
      quantity: amount(cells, 'quantity', '數量', problems),
    }
    if (cells.price) {
      if (!symbol) problems.push('現金餘額不需要單價')
      const price = amount(cells, 'price', '單價', problems, true)
      if (Number.isFinite(price)) row.price = price
    }
    if (problems.length) issues.push(`第 ${line} 列：${problems.join('；')}`)
    else rows.push(row)
  }
  if (issues.length) reject(issues)
  return rows
}

/** A message the import screens can show as is, with the first problems listed. */
export function csvErrorText(error: unknown): string {
  if (!(error instanceof CsvError)) return '無法讀取 CSV。'
  return error.issues.length ? `${error.message}${error.issues.join('。')}。` : error.message
}
