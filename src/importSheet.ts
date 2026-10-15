// Imports rows copied from the user's existing asset spreadsheet (tab-separated).
// Expected columns: 機構, 類別, 子類別, 幣別, 數量, 單價, 原幣市值, 匯率, 台幣市值, 佔比, 用途

import { CsvError, readPositionCsv, type PositionCsvRow } from './csvImport'
import { isSupportedCurrency } from './currencies'
import { BASE_CURRENCY, newId, type Account, type WealthData } from './model'

const COUNTRY_SUFFIX = /\s+(TW|SG|US|JP|HK|UK|CN)$/i
const COUNTRY_BY_CATEGORY: [RegExp, string][] = [
  [/台股/, 'TW'],
  [/美股/, 'US'],
  [/新股/, 'SG'],
]

// Name suffix first ("HSBC SG"), then the market in the category, then Chinese names as Taiwan.
function guessCountry(name: string, category: string): string {
  const suffix = name.match(COUNTRY_SUFFIX)?.[1]
  if (suffix) return suffix.toUpperCase()
  for (const [re, code] of COUNTRY_BY_CATEGORY) if (re.test(category)) return code
  return /[\u4e00-\u9fff]/.test(name) ? 'TW' : ''
}

function toNumber(cell: string | undefined): number {
  const value = (cell ?? '').replace(/[$,\s]/g, '')
  return value && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN
}

export interface ImportResult {
  data: WealthData
  accounts: number
  rows: number
  skipped: number
  errors: { line: number; message: string }[]
  replaced: Account[]
  rateChanges: { currency: string; before: number | undefined; after: number }[]
}

// Rows with the same 機構 become one account. An account with the same name as an
// existing one has its positions replaced; exchange rates in the sheet overwrite stored ones.
export function importSheet(data: WealthData, text: string): ImportResult {
  const imported = new Map<string, Account>()
  const fxRates = { ...data.fxRates }
  let rows = 0
  const errors: ImportResult['errors'] = []
  const seenRates = new Map<string, number>()

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const cells = line.split('\t').map((c) => c.trim())
    const [name, category, , rawCurrency] = cells
    const accountKey = name.toUpperCase()
    const currency = (rawCurrency ?? '').toUpperCase()
    const quantity = toNumber(cells[4])
    const price = cells[5] ? toNumber(cells[5]) : 1
    const rate = cells[7] ? toNumber(cells[7]) : undefined
    const reasons: string[] = []
    if (!name) reasons.push('缺少機構名稱')
    if (!isSupportedCurrency(currency)) reasons.push(`不支援的幣別「${currency}」`)
    if (!Number.isFinite(quantity)) reasons.push('數量必須是有效數字且不可空白')
    if (!Number.isFinite(price) || price < 0) reasons.push('單價必須是非負有限數字')
    if (!Number.isFinite(quantity * price)) reasons.push('市值超出有效數字範圍')
    if (rate !== undefined && (!Number.isFinite(rate) || rate <= 0)) reasons.push('匯率必須是正有限數字')
    if (currency === BASE_CURRENCY && rate !== undefined && rate !== 1) reasons.push('台幣匯率必須為 1')
    if (data.accounts.filter((a) => a.name.trim().toUpperCase() === accountKey).length > 1) reasons.push('同名帳戶有多筆，表格未提供國家，請使用帳戶頁編輯以免套用到錯誤帳戶')
    if (rate !== undefined && seenRates.has(currency) && seenRates.get(currency) !== rate) reasons.push('同幣別有不同匯率')
    if (reasons.length) {
      errors.push({ line: index + 1, message: reasons.join('；') })
      continue
    }
    rows++
    if (rate !== undefined) {
      seenRates.set(currency, rate)
      if (currency !== BASE_CURRENCY) fxRates[currency] = rate
    }

    const isCash = (category ?? '').includes('現金')
    let account = imported.get(accountKey)
    if (!account) {
      const existing = data.accounts.find((a) => a.name.trim().toUpperCase() === accountKey)
      account = {
        id: existing?.id ?? newId(),
        name,
        kind: isCash ? 'bank' : 'investment',
        country: existing?.country || guessCountry(name, category ?? ''),
        category: category || existing?.category || '其他',
        positions: [],
      }
      imported.set(accountKey, account)
    }
    if (!isCash) account.kind = 'investment'
    // The sheet tracks investment accounts by total value, so keep that as one
    // holding the user can later split into individual securities.
    account.positions.push(
      isCash
        ? { id: newId(), type: 'cash', currency, symbol: '', quantity: quantity * price, price: 1 }
        : { id: newId(), type: 'holding', currency, symbol: cells[2] || category || '市值', quantity, price, priceManual: true },
    )
  }

  const accounts = data.accounts.map((a) => imported.get(a.name.trim().toUpperCase()) ?? a)
  for (const a of imported.values()) if (!data.accounts.some((x) => x.name.trim().toUpperCase() === a.name.trim().toUpperCase())) accounts.push(a)

  const rateChanges = Object.entries(fxRates)
    .filter(([currency, after]) => data.fxRates[currency] !== after)
    .map(([currency, after]) => ({ currency, before: data.fxRates[currency], after }))
  return {
    // An invalid batch is never partly applied, even by a non-UI caller.
    data: errors.length || !rows ? data : { ...data, fxRates, accounts },
    accounts: imported.size, rows, skipped: errors.length, errors,
    replaced: data.accounts.filter((a) => imported.has(a.name.trim().toUpperCase())),
    rateChanges,
  }
}

// The CSV form of the same import (type=position, docs/csv-import.md): named columns instead of positions.
// Rows with the same account name become one account whose positions replace the stored ones. A position
// already held keeps its id, added date and price; a new holding without a price is priced by the next
// quote update.
export function importPositionCsv(data: WealthData, text: string): ImportResult {
  const empty = { data, accounts: 0, rows: 0, skipped: 0, replaced: [], rateChanges: [] }
  let rows: PositionCsvRow[]
  try {
    rows = readPositionCsv(text)
  } catch (e) {
    const issues = e instanceof CsvError ? [e.message, ...e.issues] : ['無法讀取 CSV。']
    // Line 0: the message already names its line, or is about the whole file.
    return { ...empty, skipped: issues.length, errors: issues.map((message) => ({ line: 0, message })) }
  }
  const errors: ImportResult['errors'] = []
  const imported = new Map<string, Account>()
  for (const r of rows) {
    const key = r.account.toUpperCase()
    const existing = data.accounts.filter((a) => a.name.trim().toUpperCase() === key)
    if (existing.length > 1) { errors.push({ line: r.line, message: '同名帳戶有多筆，請使用帳戶頁編輯以免套用到錯誤帳戶' }); continue }
    let account = imported.get(key)
    if (!account) {
      account = {
        id: existing[0]?.id ?? newId(),
        name: r.account,
        kind: r.kind,
        country: r.country || existing[0]?.country || guessCountry(r.account, r.category),
        category: r.category || existing[0]?.category || (r.kind === 'bank' ? '現金與外幣活存' : '其他'),
        positions: [],
      }
      imported.set(key, account)
    } else if (account.kind !== r.kind) {
      errors.push({ line: r.line, message: '同一帳戶的 kind 不一致' })
      continue
    }
    const held = existing[0]?.positions.find((p) => r.symbol ? p.type === 'holding' && p.symbol.toUpperCase() === r.symbol : p.type === 'cash' && p.currency === r.currency)
    if (account.positions.some((p) => r.symbol ? p.symbol === r.symbol : p.type === 'cash' && p.currency === r.currency)) {
      errors.push({ line: r.line, message: r.symbol ? `「${r.symbol}」在同一帳戶重複` : `${r.currency} 現金在同一帳戶重複` })
      continue
    }
    const base = { id: held?.id ?? newId(), ...(held?.addedAt && { addedAt: held.addedAt }) }
    account.positions.push(r.symbol
      ? { ...base, type: 'holding', currency: r.currency, symbol: r.symbol, quantity: r.quantity,
          ...(r.price !== undefined ? { price: r.price, priceManual: true }
            : { price: held?.price ?? 0, ...(held?.priceManual && { priceManual: true }), ...(held?.priceUpdatedAt && { priceUpdatedAt: held.priceUpdatedAt }) }),
          ...(held?.name && { name: held.name }) }
      : { ...base, type: 'cash', currency: r.currency, symbol: '', quantity: r.quantity, price: 1 })
  }
  if (errors.length) return { ...empty, skipped: errors.length, errors }
  const accounts = data.accounts.map((a) => imported.get(a.name.trim().toUpperCase()) ?? a)
  for (const a of imported.values()) if (!data.accounts.some((x) => x.name.trim().toUpperCase() === a.name.trim().toUpperCase())) accounts.push(a)
  return {
    data: { ...data, accounts }, accounts: imported.size, rows: rows.length, skipped: 0, errors: [],
    replaced: data.accounts.filter((a) => imported.has(a.name.trim().toUpperCase())), rateChanges: [],
  }
}
