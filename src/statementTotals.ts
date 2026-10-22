import type { StatementRow } from './expenses'

// The statement's own total of this period's new charges, compared with the rows parsed from it,
// so a row the parser missed or added shows instead of passing silently. Each issuer prints it
// its own way; the rules below were checked on real statements (2026-10-22):
// - 玉山: 本期合計 (older layout), or the 本期新增款項 column of the summary row under its header;
// - 富邦: 本期新增, the fourth number of the row under 前期應繳總額 - 繳(退)金額 - 本期調整金額 + 本期新增;
// - 台新: +本期新增款項. A reward row is sometimes left out of it, so the positive rows may match instead;
// - 匯豐 SG: Purchases & Debits, the sum of the positive rows (payments and refunds are Payments & Credits).
// 匯豐 TW prints its labels as images, so it has none to check against.
export interface StatementTotalCheck {
  label: string
  currency: string
  stated: number
  parsed: number
  matches: boolean
}

const AMOUNT = /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/g
const amounts = (text: string) => [...text.matchAll(AMOUNT)].map((m) => Number(m[0].replace(/,/g, '')))
const cents = (n: number) => Math.round(n * 100) / 100
const compact = (line: string) => line.normalize('NFKC').replace(/\s+/g, '')

function stated(lines: readonly string[], bank: string | undefined, currency: string): { label: string; value: number; positiveOnly?: boolean; either?: boolean } | undefined {
  const text = lines.map((line) => line.normalize('NFKC'))
  const after = (label: RegExp) => {
    for (const line of text) {
      const match = line.match(label)
      if (match) {
        const [value] = amounts(line.slice(match.index! + match[0].length))
        if (value !== undefined) return value
      }
    }
    return undefined
  }
  // The numbers on the line after a header line that `header` matches.
  const below = (header: (compacted: string) => boolean) => {
    const index = text.findIndex((line) => header(compact(line)))
    return index >= 0 && index + 1 < text.length ? amounts(text[index + 1]) : undefined
  }
  if (bank === '玉山') {
    const total = after(/本期合計\s*:\s*(?:TWD|NT\$)?/)
    if (total !== undefined) return { label: '本期合計', value: total }
    const row = below((line) => line.includes('上期未繳餘額') && line.includes('本期新增款項'))
    if (row && row.length >= 2) return { label: '本期新增款項', value: row[1] }
  }
  if (bank === '富邦') {
    const row = below((line) => line.includes('前期應繳總額') && line.includes('本期新增') && line.includes('本期應繳總額'))
    if (row && row.length >= 5) return { label: '本期新增', value: row[3] }
  }
  if (bank === '台新') {
    const total = after(/\+?本期新增款項\s*/)
    if (total !== undefined) return { label: '本期新增款項', value: total, either: true }
  }
  if (bank === '匯豐' && currency === 'SGD') {
    const total = after(/Purchases\s*&\s*Debits\s*/i)
    if (total !== undefined) return { label: 'Purchases & Debits', value: total, positiveOnly: true }
  }
  return undefined
}

/** undefined when the statement prints no total this knows how to read. */
export function statementTotalCheck(lines: readonly string[], bank: string | undefined, currency: string, rows: readonly StatementRow[]): StatementTotalCheck | undefined {
  // Taiwanese issuers' rows and totals are in TWD (parseStatement); 匯豐 is in the statement's currency.
  const unit = bank === '匯豐' ? currency : 'TWD'
  const total = stated(lines, bank, unit)
  if (!total) return undefined
  const own = rows.filter((r) => r.currency === unit)
  const all = cents(own.reduce((n, r) => n + r.amount, 0))
  const positive = cents(own.filter((r) => r.amount > 0).reduce((n, r) => n + r.amount, 0))
  const value = cents(total.value)
  const parsed = total.positiveOnly ? positive : total.either && positive === value ? positive : all
  return { label: total.label, currency: unit, stated: value, parsed, matches: Math.abs(parsed - value) < 0.005 }
}
