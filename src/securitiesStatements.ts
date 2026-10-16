import type { BankPage, PositionedItem } from './bankStatements/common'

// Securities account statements (持倉、現金、成交、現金異動). Pure and synchronous over the same positioned pages
// the bank reader builds; nothing is persisted. A table that does not look as expected is reported as a warning
// and makes the result `partial`: rows are never dropped silently.

export interface SecuritiesPosition { symbol: string; name: string; exchange: string; currency: string; quantity: number; price?: number; value: number; page: number }
export interface SecuritiesCash { currency: string; starting?: number; ending: number }
export interface SecuritiesTrade {
  date: string; time?: string; direction: string; symbol: string; name: string; exchange: string; currency: string; price: number; quantity: number; amount: number
  /** Commission. Some brokers print the transaction tax and the net settlement amount as well. */
  fee?: number; tax?: number; net?: number; page: number
}
/** A subscription or redemption still in transit at the statement date: neither in positions nor in cash yet. */
export interface SecuritiesInTransit { type: string; symbol: string; name: string; currency: string; amount: number; rate?: number; baseAmount?: number; page: number }
export interface SecuritiesCashflow { date: string; type: string; currency: string; amount: number; comment: string; page: number }
export interface SecuritiesWarning { code: string; page: number; detail?: string }
export interface SecuritiesStatementResult {
  status: 'recognized' | 'partial'
  broker: 'moomoo' | '台新證券'
  /** Display label without the full account number. */
  account: string
  /** Ending date of the statement (YYYY-MM-DD). */
  statementDate?: string
  baseCurrency?: string
  positions: SecuritiesPosition[]
  /** Positions held at the start and sold or transferred out by the end: reported, not part of `positions`. */
  closedCount: number
  cash: SecuritiesCash[]
  trades: SecuritiesTrade[]
  cashflows: SecuritiesCashflow[]
  inTransit: SecuritiesInTransit[]
  /** Page-1 figures: the net asset value in the base currency and the exchange rates to it. */
  statedNav?: number
  rates?: Record<string, number>
  /** The statement's own figures this result was checked against (the CLI lists them, so a skipped check is visible). */
  checked: string[]
  /** Net assets the statement states, when it lists no holdings of its own. */
  netAssets?: { currency: string; value: number }
  warnings: SecuritiesWarning[]
}

interface Row { y: number; items: PositionedItem[]; text: string }
const right = (i: PositionedItem) => i.x + i.width
const centre = (i: PositionedItem) => i.x + i.width / 2
const num = (text: string): number | undefined => {
  const t = text.replace(/,/g, '').replace(/^\+/, '').trim()
  return /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : undefined
}

/** Items of one page grouped by baseline. Statements print some cells twice at the same spot: those are one item. */
function pageRows(items: readonly PositionedItem[]): Row[] {
  const seen: PositionedItem[] = []
  for (const i of items) {
    if (!i.text.trim()) continue
    if (!seen.some(s => s.text === i.text && Math.abs(s.x - i.x) < 1 && Math.abs(s.y - i.y) < 1)) seen.push(i)
  }
  // Baselines of one printed line differ by up to ~2 points, so a fragment can sit between two lines (a name line
  // and the data line it belongs to). Tight clusters first; a short fragment joins the fullest line within 2.5.
  const tight: Row[] = []
  for (const item of [...seen].sort((a, b) => b.y - a.y)) {
    const row = tight.find(r => Math.abs(r.y - item.y) <= 1.2)
    if (row) row.items.push(item)
    else tight.push({ y: item.y, items: [item], text: '' })
  }
  const fragment = (r: Row) => r.items.length <= 2
  const rows: Row[] = tight.filter(r => !fragment(r))
  for (const r of tight.filter(fragment)) {
    const near = (rows.length ? rows : tight).filter(x => x !== r && !fragment(x) && Math.abs(x.y - r.y) <= 2.5).sort((a, b) => b.items.length - a.items.length || Math.abs(a.y - r.y) - Math.abs(b.y - r.y))[0]
    if (near) near.items.push(...r.items)
    else rows.push(r)
  }
  // Fragments left over that sit within 2.5 of each other form one line.
  rows.sort((a, b) => b.y - a.y)
  for (let k = rows.length - 1; k > 0; k--) if (fragment(rows[k]) && fragment(rows[k - 1]) && rows[k - 1].y - rows[k].y <= 2.5) { rows[k - 1].items.push(...rows[k].items); rows.splice(k, 1) }
  rows.sort((a, b) => b.y - a.y)
  for (const r of rows) { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map(i => i.text.trim()).join(' ') }
  // Page footer: preparation date, client and account number.
  return rows.filter(r => !/^(Preparation Date|Client Name):/.test(r.text))
}

const MOOMOO_TITLE = /^(Monthly|Daily) Statement of .*Account.*Securities/i
const POSITION_HEADER = ['Symbol', 'Exchange', 'Currency', 'Quantity', 'Closing Price', 'Position Value', 'Quantity', 'Closing Price', 'Position Value', 'Buy Quantity', 'Sell Quantity', 'Transfer In', 'Transfer Out']
const sameLabels = (items: readonly PositionedItem[], labels: readonly string[]) => items.length === labels.length && items.every((i, n) => i.text.trim() === labels[n])
const nearest = (x: number, centres: readonly number[]) => centres.reduce((best, c, n) => Math.abs(c - x) < Math.abs(centres[best] - x) ? n : best, 0)

/** Securities statement of any supported broker, or undefined when the pages are not one. */
export function parseSecuritiesStatement(pages: readonly BankPage[]): SecuritiesStatementResult | undefined {
  return parseMoomoo(pages) ?? parseTaishinSecurities(pages)
}

function parseMoomoo(pages: readonly BankPage[]): SecuritiesStatementResult | undefined {
  const all = pages.map(p => ({ page: p.page, rows: pageRows(p.items) }))
  const title = all.flatMap(p => p.rows).find(r => MOOMOO_TITLE.test(r.text))
  if (!title) return undefined

  const warnings: SecuritiesWarning[] = []
  const warn = (page: number, code: string, detail?: string) => warnings.push({ page, code, ...(detail && { detail }) })
  const result: SecuritiesStatementResult = { status: 'recognized', broker: 'moomoo', account: 'moomoo', positions: [], closedCount: 0, cash: [], trades: [], cashflows: [], inTransit: [], checked: [], warnings }

  const first = all[0]?.rows ?? []
  // The same account is labelled the same across layouts: by the end of its number (older statements name only "Universal Account").
  const accountDigits = first.map(r => r.text.match(/Account Number\s+\d*?(\d{4})(?:\s|$)/)?.[1]).find(Boolean) ?? first.map(r => r.text.match(/Account Name\s+.*?\((\d{3,6})\)/)?.[1]).find(Boolean)
  if (accountDigits) result.account = `moomoo (${accountDigits})`
  const baseText = first.map(r => r.text.match(/Base Currency:\s*([A-Z]{3})/)?.[1]).find(Boolean)
  result.baseCurrency = baseText
  const ending = first.map(r => r.text.match(/Ending Net Asset Value\s+(\d{4})(\d{2})(\d{2})/)).find(Boolean)
  if (ending) result.statementDate = `${ending[1]}-${ending[2]}-${ending[3]}`
  else warn(1, 'statement-date-missing')

  // Exchange rates and totals on page 1, for cross-checking what was read.
  const rates = new Map<string, number>()
  const totals: { portfolio?: number; cash?: number; nav?: number } = {}
  {
    const rows = first
    const endRow = rows.findIndex(r => /Ending Net Asset Value/.test(r.text))
    if (endRow >= 0) {
      const heads = rows.slice(endRow, endRow + 3).flatMap(r => r.items).filter(i => /^[A-Z]{3}$/.test(i.text.trim()))
      const rateItems = rows.slice(endRow, endRow + 6).flatMap(r => r.items).filter(i => /^exchange rate :/.test(i.text.trim()))
      for (const r of rateItems) {
        const value = num(r.text.replace(/^exchange rate :\s*/, ''))
        if (value === undefined || !heads.length) continue
        const head = heads.reduce((best, h) => Math.abs(centre(h) - centre(r)) < Math.abs(centre(best) - centre(r)) ? h : best)
        rates.set(head.text.trim(), value)
      }
    }
    // "Net Asset Value:" is the sum of holdings, cash and the assets in transit.
    const navRow = rows.find(r => r.items.some(i => /^Net Asset Value:/.test(i.text.trim())))
    totals.nav = navRow && num(navRow.items.filter(i => i.x > 80).map(i => i.text).find(t => num(t) !== undefined) ?? '')
    const labelRow = rows.findIndex(r => r.items.some(i => i.text.trim() === 'Portfolio Value'))
    if (labelRow >= 0) {
      const labels = rows[labelRow].items.filter(i => ['Portfolio Value', 'Cash Balance'].includes(i.text.trim()))
      const values = rows.slice(labelRow + 1, labelRow + 3).flatMap(r => r.items).filter(i => num(i.text) !== undefined)
      for (const l of labels) {
        const v = values.filter(i => Math.abs(centre(i) - centre(l)) < 70).sort((a, b) => Math.abs(centre(a) - centre(l)) - Math.abs(centre(b) - centre(l)))[0]
        if (v) totals[l.text.trim() === 'Portfolio Value' ? 'portfolio' : 'cash'] = num(v.text)
      }
    }
  }

  // --- Positions ---------------------------------------------------------------------------------------------
  // Two tables list holdings: the movement table (starting / ending / changes) and, on daily statements, "Ending
  // Positions" with exact quantities and the base-currency value. Each row is a block: name lines, one numeric
  // line, then the symbol code.
  const ENDING_HEADER = ['Symbol', 'Exchange', 'Currency', 'Settled Quantity', 'Unsettled Quantity', 'Quantity', 'Multiplier', 'Closing Price', 'Market Value', 'Exchange Rate']
  type Cells = Map<number, string>
  interface Block { symbol: string; name: string; cells: Cells; text: string }
  // A block is: name lines, the numeric line (it holds the currency), then the symbol code line. Name lines may
  // also follow the numeric line, so the symbol is the first symbol-shaped line after it.
  const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,19}$/
  const readBlocks = (page: number, body: Row[], centres: number[], currencyCol: number): Block[] => {
    const isNumeric = (r: Row) => r.items.some(i => /^[A-Z]{3}$/.test(i.text.trim()) && Math.abs(centre(i) - centres[currencyCol]) < 25)
    const leftOf = (r: Row) => r.items.filter(i => i.x < 100).map(i => i.text.trim()).join(' ')
    const groups: Row[][] = []
    let cur: Row[] = [], seen = false
    const close = () => { if (cur.length) groups.push(cur); cur = []; seen = false }
    for (const row of body) {
      if (isNumeric(row)) {
        if (seen) close()
        cur.push(row); seen = true
      } else if (seen && cur.length && row.items.every(i => i.x >= 100) && num(row.items[0]?.text ?? '') !== undefined && !leftOf(row)) {
        // Continuation of the previous numbers (a wrapped total): part of the block, not a new row.
        cur.push(row)
      } else {
        cur.push(row)
        if (seen && SYMBOL.test(leftOf(row)) && row.items.every(i => i.x < 100)) close()
      }
    }
    close()
    const out: Block[] = []
    for (const g of groups) {
      const text = g.map(r => r.text).join(' ').slice(0, 80)
      const numeric = g.filter(isNumeric)
      if (numeric.length === 0 && out.length && g.every(r => !leftOf(r))) {
        // A number wrapped onto its own line below the row it repeats (an ending value, a total).
        const prev = out[out.length - 1], seenValues = new Set(prev.cells.values())
        if (g.every(r => r.items.every(i => seenValues.has(i.text.trim()) || (num(i.text) !== undefined && [...seenValues].some(v => num(v) === num(i.text)))))) continue
      }
      if (numeric.length !== 1) { if (g.some(r => r.items.some(i => num(i.text) !== undefined))) warn(page, 'position-row-unrecognized', text); continue }
      const cells: Cells = new Map()
      for (const r of g) for (const i of r.items) if (i.x >= 100) cells.set(nearest(centre(i), centres), i.text.trim())
      const lines = g.map(leftOf).filter(Boolean)
      const symbol = lines.length > 1 ? lines[lines.length - 1] : (lines[0] ?? '')
      if (!symbol || !SYMBOL.test(symbol)) { warn(page, 'position-row-unrecognized', text); continue }
      out.push({ symbol, name: lines.slice(0, -1).join(' '), cells, text })
    }
    return out
  }
  // A section heading is a line of its own; a holding named "Securities Co" is not one.
  const isTableEnd = (r: Row) => /^[A-Z]{3} Total\b/.test(r.text) || /^Total\b/.test(r.text) || r.items.some(i => i.x < 60 && r.items.length <= 3 && /^(Securities|Funds|Ending Positions|Ending Assets in Transit|Trades - .*|Changes in .*)$/.test(i.text.trim()))
  const positionValueByCurrency = new Map<string, number>()
  const exact = new Map<string, { quantity: number; baseValue?: number; price?: number }>()
  const endingBase: { listed: number; stated?: number } = { listed: 0 }
  let sinceTotal = 0
  for (const { page, rows } of all) {
    for (let h = 0; h < rows.length; h++) {
      // A heading wraps over a few lines whose baselines differ slightly: its labels are every item within 6 points.
      if (!rows[h].items.some(i => i.text.trim() === 'Symbol')) continue
      const band = rows.filter(r => Math.abs(r.y - rows[h].y) <= 6)
      const union = band.flatMap(r => r.items)
      if (!(union.some(i => i.text.trim() === 'Currency') && union.some(i => /Closing Price/.test(i.text)))) continue
      const changes = union.find(i => /^Changes in/.test(i.text.trim()))
      const headerItems = union.filter(i => !/^(Convert to Base|Starting|Ending|Changes in|Currency\()/.test(i.text.trim()) && !(changes && ['Position Value', 'Value'].includes(i.text.trim()) && Math.abs(centre(i) - centre(changes)) < 40))
        .sort((a, b) => a.x - b.x)
      const ending = sameLabels(headerItems, ENDING_HEADER)
      const movement = sameLabels(headerItems, POSITION_HEADER)
      if (!movement && !ending) { warn(page, 'position-header-unrecognized'); continue }
      // The base-currency column of the ending table is headed "Currency(SGD)".
      const baseHead = ending ? union.find(i => /^Currency\(/.test(i.text.trim())) : undefined
      const centres = [...headerItems.map(centre), ...(baseHead ? [centre(baseHead)] : [])]
      if (movement) {
        // "Changes in / Position Value" sits between the ending value and the buy quantity.
        if (!changes) { warn(page, 'position-header-unrecognized', 'Changes in'); continue }
        centres.splice(9, 0, centre(changes))
      }
      // movement: 0 Symbol 1 Exchange 2 Currency 3-5 starting qty/price/value 6-8 ending 9 change 10-13 buy/sell/transfer
      // ending:   0 Symbol 1 Exchange 2 Currency 3 settled 4 unsettled 5 quantity 6 multiplier 7 price 8 value 9 rate 10 base value
      const bandEnd = Math.max(...band.map(r => rows.indexOf(r)))
      let end = bandEnd + 1
      while (end < rows.length && !isTableEnd(rows[end])) end++
      const body = rows.slice(bandEnd + 1, end).filter(r => !/^(Position Value|Changes in|Convert to Base)( Position Value)?$/.test(r.text) && r.items.some(i => i.x < 100 || num(i.text) !== undefined))
      let sum = 0
      for (const block of readBlocks(page, body, centres, 2)) {
        const currency = block.cells.get(2) ?? ''
        if (movement) {
          const quantity = num(block.cells.get(6) ?? ''), startQuantity = num(block.cells.get(3) ?? '')
          const value = num(block.cells.get(8) ?? '') ?? 0, price = num(block.cells.get(7) ?? '')
          if (quantity === undefined || !currency) { warn(page, 'position-row-unrecognized', block.text); continue }
          sum += value
          if (quantity === 0) { if ((startQuantity ?? 0) !== 0) result.closedCount++; continue }
          // The quantity is what gets imported: it has to agree with the printed price and value.
          const printedValue = num(block.cells.get(8) ?? '')
          if (price === undefined || printedValue === undefined) warn(page, 'position-price-missing', block.symbol)
          else if (Math.abs(quantity * price - printedValue) > Math.max(0.02, Math.abs(printedValue) * 3e-4)) warn(page, 'position-value-mismatch', `${block.symbol} ${quantity}×${price} ≠ ${printedValue}`)
          result.positions.push({ symbol: block.symbol, name: block.name, exchange: block.cells.get(1) ?? '', currency, quantity, ...(price !== undefined && { price }), value, page })
          positionValueByCurrency.set(currency, (positionValueByCurrency.get(currency) ?? 0) + value)
        } else {
          const quantity = num((block.cells.get(5) ?? '').replace(/,/g, '')), baseValue = num(block.cells.get(10) ?? ''), price = num(block.cells.get(7) ?? '')
          if (quantity === undefined || !currency) { warn(page, 'position-row-unrecognized', block.text); continue }
          endingBase.listed += baseValue ?? 0
          exact.set(`${block.symbol}|${currency}`, { quantity, ...(baseValue !== undefined && { baseValue }), ...(price !== undefined && { price }) })
        }
      }
      const totalRow = rows[end]
      // A table that runs to the end of the page without a total may go on over the page break.
      if (!totalRow && body.length) {
        const nextRows = all.find(x => x.page === page + 1)?.rows ?? []
        // It goes on if the next page prints the heading again (that table is read too) or starts with the total.
        const goesOn = nextRows.some(r => r.items.some(i => i.text.trim() === 'Symbol') && r.items.some(i => i.text.trim() === 'Currency')) || nextRows.filter(r => r.y < 560).slice(0, 3).some(r => /^([A-Z]{3} )?Total\b/.test(r.text))
        if (!goesOn) warn(page, 'position-table-unterminated')
      }
      if (movement) {
        sinceTotal += sum
        if (totalRow && /^[A-Z]{3} Total\b/.test(totalRow.text)) {
          const cell = totalRow.items.filter(i => num(i.text) !== undefined).map(i => ({ n: nearest(centre(i), centres), v: num(i.text)! })).find(c => c.n === 8)
          if (cell && Math.abs(cell.v - sinceTotal) > 0.011 * 20) warn(page, 'position-total-mismatch', `${totalRow.text.slice(0, 3)} ${sinceTotal.toFixed(2)} ≠ ${cell.v}`)
          sinceTotal = 0
        }
      }
    }
  }
  // "Total | Number: N | value" closes each ending table; the value can sit a few points above its label. The
  // "Ending Assets in Transit" table that follows lists subscriptions and redemptions not yet settled.
  const transitStated = { listed: 0, stated: undefined as number | undefined }
  {
    let inTransit = false
    for (const { page, rows } of all) {
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k]
        if (r.items.some(i => i.x < 60 && /^Ending Assets in Transit/.test(i.text.trim()))) { inTransit = true; continue }
        if (r.items.some(i => i.x < 60 && /^Important Notice/.test(i.text.trim()))) inTransit = false
        if (/^Total\b/.test(r.text) && r.items.some(i => /^Number:/.test(i.text.trim()))) {
          let value = r.items.map(i => num(i.text)).filter((v): v is number => v !== undefined).pop()
          const above = rows[k - 1]
          if (value === undefined && above && above.y - r.y <= 4.5 && above.items.every(i => num(i.text) !== undefined)) value = num(above.items[above.items.length - 1].text)
          if (inTransit) transitStated.stated = (transitStated.stated ?? 0) + (value ?? 0)
          else endingBase.stated = (endingBase.stated ?? 0) + (value ?? 0)
          continue
        }
        // A transit line: type at the left, currency, then amount, rate and base amount; the name wraps over lines.
        const type = inTransit ? r.items.find(i => i.x < 100 && /^(Subscription|Redemption)\b/i.test(i.text.trim())) : undefined
        if (!type) continue
        const numbers = r.items.filter(i => i.x > 150 && num(i.text) !== undefined)
        const after: Row[] = []
        for (let j = k + 1; j < rows.length && !/^Total\b/.test(rows[j].text) && rows[j].y > 40; j++) { after.push(rows[j]); if (SYMBOL.test(rows[j].items.map(i => i.text.trim()).join(' '))) break }
        const before: Row[] = []
        for (let j = k - 1; j >= 0 && rows[j].y - (before.length ? before[before.length - 1].y : r.y) <= 10 && !/^(Total|Convert to Base|Ending Assets|Type)/.test(rows[j].text) && !rows[j].items.some(i => num(i.text) !== undefined); j--) before.unshift(rows[j])
        // The currency may sit on the name line above the amounts.
        const currency = [r, ...before, ...after].flatMap(x => x.items).find(i => /^[A-Z]{3}$/.test(i.text.trim()) && i.x > 150 && i.x < 260)?.text.trim()
        if (!currency || numbers.length < 3) { warn(page, 'transit-row-unrecognized', r.text.slice(0, 80)); continue }
        const symbolRow = after[after.length - 1]
        const symbol = symbolRow && SYMBOL.test(symbolRow.text) ? symbolRow.text : ''
        const nameParts = [...before, ...after.filter(x => x !== symbolRow)].flatMap(x => x.items.filter(i => i.x >= 100 && i.x < 180).map(i => i.text.trim()))
        const amount = num(numbers[numbers.length - 3].text)!, baseAmount = num(numbers[numbers.length - 1].text), rate = num(numbers[numbers.length - 2].text)
        if (!symbol) { warn(page, 'transit-row-unrecognized', r.text.slice(0, 80)); continue }
        // The amount, its exchange rate and the amount in the base currency are printed side by side: they must agree.
        if (rate === undefined || baseAmount === undefined) warn(page, 'transit-row-unrecognized', r.text.slice(0, 80))
        else if (Math.abs(amount * rate - baseAmount) > Math.max(0.02, Math.abs(baseAmount) * 5e-4)) warn(page, 'transit-amount-mismatch', `${symbol} ${amount}×${rate} ≠ ${baseAmount}`)
        result.inTransit.push({ type: type.text.trim(), symbol, name: nameParts.join(' '), currency, amount, ...(rate !== undefined && { rate }), ...(baseAmount !== undefined && { baseAmount }), page })
        transitStated.listed += baseAmount ?? 0
      }
    }
  }
  if (transitStated.stated !== undefined && Math.abs(transitStated.listed - transitStated.stated) > 0.011) warn(1, 'transit-total-mismatch', `${transitStated.listed.toFixed(2)} ≠ ${transitStated.stated}`)
  if (!transitStated.stated && result.inTransit.length) warn(1, 'transit-total-missing')
  if (exact.size && endingBase.stated === undefined) warn(1, 'ending-positions-total-missing')
  if (endingBase.stated !== undefined && Math.abs(endingBase.listed - endingBase.stated) > 0.011 * 20) warn(1, 'ending-positions-total-mismatch', `${endingBase.listed.toFixed(2)} ≠ ${endingBase.stated}`)
  // Quantities of the ending table are exact (funds print four decimals above); the movement table supplies the rest.
  for (const p of result.positions) {
    const e = exact.get(`${p.symbol}|${p.currency}`)
    if (e && Math.abs(e.quantity - p.quantity) < 0.01 + Math.abs(p.quantity) * 1e-6) p.quantity = e.quantity
    else if (e) warn(p.page, 'ending-position-quantity-mismatch', `${p.symbol} ${p.quantity} ≠ ${e.quantity}`)
    else if (exact.size) warn(p.page, 'ending-position-missing', p.symbol)
  }
  for (const key of exact.keys()) {
    const [symbol, currency] = key.split('|')
    if (!result.positions.some(p => p.symbol === symbol && p.currency === currency)) warn(1, 'ending-position-extra', symbol)
  }

  // --- Cash by currency --------------------------------------------------------------------------------------
  {
    let currency: string | undefined
    for (const { page, rows } of all) {
      const amountHead = rows.flatMap(r => r.items).find(i => i.text.trim() === 'Amount' && i.x > 400 && i.x < 700)
      for (const row of rows) {
        const head = row.items.find(i => /^[A-Z]{3}$/.test(i.text.trim()) && i.x < 100)
        if (head && row.items.some(i => i.text.trim() === 'Date/Time') && row.items.some(i => i.text.trim() === 'Type')) { currency = head.text.trim(); continue }
        if (!currency) continue
        const label = row.items[0]?.text.trim()
        const value = row.items.map(i => num(i.text)).find(v => v !== undefined)
        if (label === 'Ending Cash' && value !== undefined) {
          const existing = result.cash.find(c => c.currency === currency)
          if (existing) existing.ending = value; else result.cash.push({ currency, ending: value })
        } else if (label === 'Starting Cash' && value !== undefined) {
          const existing = result.cash.find(c => c.currency === currency)
          if (existing) existing.starting = value; else result.cash.push({ currency, starting: value, ending: 0 })
        }
        // Dated rows are cash movements (dividends, tax, transfers); zero "-" rows are per-type subtotals.
        const date = row.items.find(i => /^\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(i.text.trim()))
        if (date) {
          const type = row.items.find(i => i.x > date.x + date.width && i.x < (amountHead?.x ?? 549) - 20)
          const amountItem = row.items.find(i => num(i.text) !== undefined && i.x > (type ? right(type) : date.x))
          const amount = amountItem ? num(amountItem.text) : undefined
          if (!type || amount === undefined) { warn(page, 'cashflow-row-unrecognized', row.text.slice(0, 80)); continue }
          const comment = rows.filter(r => Math.abs(r.y - row.y) <= 10).flatMap(r => r.items.filter(i => i.x >= 660)).sort((a, b) => b.y - a.y || a.x - b.x).map(i => i.text.trim()).join(' ')
          result.cashflows.push({ date: date.text.trim().slice(0, 10).replace(/\//g, '-'), type: type.text.trim(), currency, amount, comment, page })
        }
      }
    }
    if (!result.cash.length) warn(1, 'cash-missing')
  }

  // --- Trades ------------------------------------------------------------------------------------------------
  // Stock trades (Buy/Sell, closed by a "Subtotal:" line) and fund orders (Subscription/Redemption, with an order
  // number and a fee column) share one reader. A trade is its direction line, the date line above it and the
  // time and symbol-code lines below it; the table runs across pages, so rows are read as one flow.
  {
    type Flow = Row & { page: number; continuation?: boolean }
    const DIRECTION = /^(Buy|Sell|Subscription|Redemption)\b/i
    const DATE = /^\d{4}\/\d{2}\/\d{2}$/, TIME = /^\d{2}:\d{2}:\d{2}$/
    const isDir = (i: PositionedItem) => i.x < 100 && DIRECTION.test(i.text.trim())
    let flow: Flow[] = [], active = false, header: Row | undefined
    const flush = () => {
      const rows = flow
      flow = []
      if (!header) return
      const col = (label: string) => header!.items.find(i => i.text.trim() === label)
      const need = ['Direction', 'Symbol', 'Currency', 'Date/Time', 'Price', 'Quantity', 'Amount']
      if (need.some(l => !col(l))) { warn(rows[0]?.page ?? 1, 'trade-header-unrecognized'); return }
      const sorted = [...header.items].sort((x, y) => x.x - y.x)
      const symbolIndex = sorted.indexOf(col('Symbol')!)
      const symbolX = col('Symbol')!.x - 8, symbolEnd = sorted[symbolIndex + 1].x - 8
      const inSymbol = (i: PositionedItem) => i.x >= symbolX && i.x < symbolEnd
      const exchange = col('Exchange'), capacity = col('Order Capacity'), currencyHead = col('Currency')!
      const feeHead = col('Fee')
      for (let n = 0; n < rows.length; n++) {
        const row = rows[n]
        if (row.continuation || /^Subtotal:/.test(row.text)) continue
        const dir = row.items.find(isDir)
        if (!dir) {
          // Anything numeric that no trade line claims is reported by the date check below.
          continue
        }
        const above: Flow[] = []
        for (let k = n - 1; k >= 0 && !rows[k].continuation && !/^Subtotal:/.test(rows[k].text) && !rows[k].items.some(isDir) && rows[k].y - (above.length ? above[above.length - 1].y : row.y) <= 10; k--) above.push(rows[k])
        const below: Flow[] = []
        for (let k = n + 1; k < rows.length && !rows[k].continuation && !/^Subtotal:/.test(rows[k].text) && !rows[k].items.some(isDir) && (below.length ? below[below.length - 1].y : row.y) - rows[k].y <= 10; k++) below.push(rows[k])
        const dateItem = [...above, row].flatMap(r => r.items).find(i => DATE.test(i.text.trim()))
        const timeItem = [...below, row].flatMap(r => r.items).find(i => TIME.test(i.text.trim()))
        // Numbers are right-aligned under their headings: each belongs to the heading with the nearest right edge.
        const numericHeads = ['Price', 'Quantity', 'Amount', 'Fee', 'GST'].flatMap(l => { const h = col(l); return h ? [{ l, edge: right(h) }] : [] })
        const cellOf = new Map<string, string>()
        for (const i of row.items) {
          if (i.x < 100 || num(i.text) === undefined) continue
          const head = numericHeads.reduce((best, h) => Math.abs(h.edge - right(i)) < Math.abs(best.edge - right(i)) ? h : best)
          if (Math.abs(head.edge - right(i)) < 25) cellOf.set(head.l, i.text)
        }
        const price = num(cellOf.get('Price') ?? ''), quantity = num(cellOf.get('Quantity') ?? ''), amount = num(cellOf.get('Amount') ?? '')
        const feeOf = (l: string) => num(cellOf.get(l) ?? '')
        const symbolRow = below.find(r => r.items.some(i => inSymbol(i) && SYMBOL.test(i.text.trim()) && !TIME.test(i.text.trim())))
        const symbol = symbolRow?.items.filter(inSymbol).map(i => i.text.trim()).join(' ') ?? ''
        const name = [...[...above].reverse().flatMap(r => r.items.filter(inSymbol)), ...row.items.filter(inSymbol), ...below.filter(r => r !== symbolRow && !r.items.some(i => TIME.test(i.text.trim()) && false)).flatMap(r => r.items.filter(inSymbol))]
          .map(i => i.text.trim()).filter(t => t && !DATE.test(t) && !TIME.test(t)).join(' ')
        if (!dateItem || price === undefined || quantity === undefined || amount === undefined || !symbol) { warn(row.page, 'trade-row-unrecognized', row.text.slice(0, 80)); continue }
        const subtotal = rows.slice(n + 1).find(r => /^Subtotal:/.test(r.text))
        const nextDir = rows.slice(n + 1).findIndex(r => r.items.some(isDir))
        const subtotalFee = subtotal && (nextDir < 0 || rows.indexOf(subtotal) < n + 1 + nextDir) ? num(subtotal.items.find(i => num(i.text) !== undefined)?.text ?? '') : undefined
        const fee = feeHead ? (feeOf('Fee') ?? 0) + (feeOf('GST') ?? 0) : subtotalFee
        result.trades.push({ date: dateItem.text.trim().replace(/\//g, '-'), ...(timeItem && { time: timeItem.text.trim() }), direction: dir.text.trim(), symbol, name,
          exchange: exchange ? row.items.filter(i => i.x >= exchange.x - 8 && i.x < (capacity ?? currencyHead).x - 8).map(i => i.text.trim()).join(' ') : '',
          currency: row.items.filter(i => i.x >= currencyHead.x - 8 && i.x < col('Date/Time')!.x - 8 && /^[A-Z]{3}$/.test(i.text.trim())).map(i => i.text.trim()).join(' '),
          price, quantity, amount, ...(fee !== undefined && { fee }), page: row.page })
      }
      // Each Subtotal line states how many trades it closes.
      let count = 0
      for (const r of rows) {
        if (r.continuation) continue
        if (r.items.some(isDir)) count++
        const m = /^Subtotal:.*?Number of Transactions:\s*(\d+)/.exec(r.text)
        if (m) { if (Number(m[1]) !== count) warn(r.page, 'trade-count-mismatch', `${count} ≠ ${m[1]}`); count = 0 }
      }
    }
    const isHeader = (r: Row) => r.items.some(i => i.text.trim() === 'Direction') && r.items.some(i => i.text.trim() === 'Date/Time') && r.items.some(i => i.text.trim() === 'Price')
    for (const { page, rows } of all) {
      const h = rows.find(isHeader)
      if (h) {
        // A header repeated on the next page continues the same table; a different one starts another.
        if (active && header && h.items.map(i => i.text.trim()).join('|') !== header.items.map(i => i.text.trim()).join('|')) flush()
        header = h; active = true
      }
      for (const row of rows) {
        if (!active || (h && row.y >= h.y) || (!h && row.y > 560)) continue
        if (/^(Total of Transaction Fee|Changes in Cash)/.test(row.text) || /^[A-Z]{3} Total\b/.test(row.text) && !/Subtotal/.test(row.text)) { flush(); active = false; continue }
        // A Subtotal line wraps onto further fee lines ("Consumption Tax: 0.15"): they belong to it.
        const afterSubtotal = flow.length > 0 && (/^Subtotal:/.test(flow[flow.length - 1].text) || flow[flow.length - 1].continuation)
        const starts = row.items.some(isDir) || row.items.some(i => DATE.test(i.text.trim())) || row.items.some(i => i.x < 100 && !/:/.test(i.text) && num(i.text) === undefined && !/Tax|Fee/.test(i.text))
        flow.push({ ...row, page, continuation: afterSubtotal && !starts })
      }
    }
    if (active) flush()
    // The statement's own totals per currency and direction (the label "Buy" / "Sell" sits under each total line).
    for (const { page, rows } of all) rows.forEach((row, k) => {
      const m = row.text.match(/^Total of Transaction Fee.*?(?<!Net )Transactions Amount:\s*([\d,]+\.\d+)/)
      if (!m) return
      const prior = rows.slice(0, k).filter(r => /^[A-Z]{3} Total\b/.test(r.text)).pop()
      const currency = prior?.text.slice(0, 3)
      const label = rows.slice(k + 1, k + 3).flatMap(r => r.items).find(i => i.x < 70 && /^(Buy|Sell)$/.test(i.text.trim()))?.text.trim().toLowerCase()
      const sum = result.trades.filter(t => t.currency === currency && !/^(Subscription|Redemption)/i.test(t.direction) && (!label || t.direction.toLowerCase().startsWith(label))).reduce((s2, t) => s2 + t.amount, 0)
      const total = num(m[1])
      if (currency && total !== undefined && Math.abs(sum - total) > 0.011 * Math.max(1, result.trades.length)) warn(page, 'trade-total-mismatch', `${currency} ${label ?? ''} ${sum.toFixed(2)} ≠ ${total}`)
    })
  }

  result.statedNav = totals.nav
  result.rates = Object.fromEntries(rates)
  // --- Cross-check against the page-1 summary ---------------------------------------------------------------
  // Nothing is imported on trust: a figure the statement should print and this reader cannot find is a warning too.
  {
    const base = result.baseCurrency
    if (!base) warn(1, 'base-currency-missing')
    const rateOf = (currency: string) => currency === base ? 1 : rates.get(currency)
    const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 0.0005)
    for (const [label, value] of [['portfolio-value', totals.portfolio], ['cash-balance', totals.cash], ['net-asset-value', totals.nav]] as const) if (value === undefined) warn(1, `${label}-missing`)
    const used = new Set([...positionValueByCurrency.keys(), ...result.cash.filter(c => c.ending !== 0).map(c => c.currency), ...result.inTransit.map(t => t.currency)])
    const unrated = [...used].filter(c => rateOf(c) === undefined)
    for (const c of unrated) warn(1, 'exchange-rate-missing', c)
    if (!unrated.length && base) {
      const holdings = [...positionValueByCurrency].reduce((sum, [c, v]) => sum + v * rateOf(c)!, 0)
      const cash = result.cash.reduce((sum, c) => sum + (c.ending === 0 ? 0 : c.ending * rateOf(c.currency)!), 0)
      const transit = result.inTransit.reduce((sum, t) => sum + (t.baseAmount ?? t.amount * rateOf(t.currency)!), 0)
      if (totals.portfolio !== undefined) { result.checked.push('投資組合市值'); if (!close(holdings, totals.portfolio)) warn(1, 'portfolio-value-mismatch', `${holdings.toFixed(2)} ≠ ${totals.portfolio}`) }
      if (totals.cash !== undefined) { result.checked.push('現金餘額'); if (!close(cash, totals.cash)) warn(1, 'cash-balance-mismatch', `${cash.toFixed(2)} ≠ ${totals.cash}`) }
      if (totals.nav !== undefined) { result.checked.push('淨資產'); if (!close(holdings + cash + transit, totals.nav)) warn(1, 'net-asset-value-mismatch', `${(holdings + cash + transit).toFixed(2)} ≠ ${totals.nav}`) }
      if (exact.size && endingBase.stated !== undefined) result.checked.push('持倉表合計')
      if (transitStated.stated !== undefined) result.checked.push('在途合計')
      if (result.trades.length) result.checked.push('成交合計與筆數')
    }
  }
  if (warnings.length) result.status = 'partial'
  return result
}

// --- 台新證券 --------------------------------------------------------------------------------------------------
// Two documents: the trade confirmation of one day (成交資料, "TSSCO Bill") and the monthly combined statement
// (綜合月對帳單) with its domestic trades. Neither lists holdings. The confirmation prints no ticker code, only the
// short name, which can wrap over several lines.

const BUY = /^(現買|零買|資買|券買|買)/, SELL = /^(現賣|零賣|資賣|券賣|賣)/
const tokens = (items: readonly PositionedItem[]) => items.flatMap(i => i.text.trim().split(/\s+/).filter(Boolean).map(t => ({ t, x: i.x, right: right(i) })))
const rocDate = (y: string, m: string, d: string) => `${Number(y) + 1911}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`

function parseTaishinSecurities(pages: readonly BankPage[]): SecuritiesStatementResult | undefined {
  const all = pages.map(p => ({ page: p.page, rows: pageRows(p.items) }))
  const flat = all.flatMap(p => p.rows.map(r => ({ ...r, page: p.page })))
  const dated = flat.map(r => r.text.replace(/\s+/g, '').match(/民國(\d+)年(\d+)月(\d+)日的成交資料/)).find(Boolean)
  const monthly = flat.map(r => r.text.replace(/\s+/g, '').match(/(\d{4})\/(\d{2})在台新綜合證券有價證券電子對帳單/)).find(Boolean)
  if (!dated && !monthly) return undefined
  if (!flat.some(r => /台新證券|台新綜合證券/.test(r.text.replace(/\s+/g, '')))) return undefined

  const warnings: SecuritiesWarning[] = []
  const warn = (page: number, code: string, detail?: string) => warnings.push({ page, code, ...(detail && { detail }) })
  const result: SecuritiesStatementResult = { status: 'recognized', broker: '台新證券', account: '台新證券', baseCurrency: 'TWD', positions: [], closedCount: 0, cash: [], trades: [], cashflows: [], inTransit: [], checked: ['成交小計'], warnings }
  const branchAccount = flat.map(r => r.text.replace(/\s+/g, '').match(/\(([^()-]*)-(\d{4,})\)/)).find(Boolean)
  const accountTail = branchAccount?.[2].slice(-4) ?? flat.map(r => r.text.replace(/\s+/g, '').match(/帳號[：:][\dA-Za-z]*-?(\d{4,})/)).find(Boolean)?.[1].slice(-4)
  if (accountTail) result.account = `台新證券 (${accountTail})`
  const push = (t: Omit<SecuritiesTrade, 'exchange' | 'currency'>) => result.trades.push({ ...t, exchange: 'TW', currency: 'TWD' })
  const direction = (raw: string, page: number) => { if (!BUY.test(raw) && !SELL.test(raw)) warn(page, 'trade-kind-unrecognized', raw); return raw }

  if (dated) {
    result.statementDate = rocDate(dated[1], dated[2], dated[3])
    // Header rows: 類別 / 股票 / 數量 ... ; the table ends at "提醒您".
    const headerAt = flat.findIndex(r => r.items.some(i => i.text.trim() === '類別') && r.items.some(i => i.text.trim() === '成交價'))
    if (headerAt < 0) { warn(1, 'trade-header-unrecognized'); result.status = 'partial'; return result }
    const body = flat.slice(headerAt + 1).filter(r => r.page === flat[headerAt].page)
    const stop = body.findIndex(r => /^提醒您/.test(r.text))
    const rows = stop < 0 ? body : body.slice(0, stop)
    const isSubtotal = (r: Row) => r.items.some(i => /^小計/.test(i.text.trim()))
    const category = (r: Row) => r.items.find(i => i.x < 90 && /^[\u4e00-\u9fff]{1,4}$/.test(i.text.trim()) && i.text.trim() !== '小計')
    const dataRows = rows.filter(r => category(r) && !isSubtotal(r))
    const used = new Set<Row>()
    const sums = { amount: 0, fee: 0, tax: 0, net: 0 }
    for (const row of dataRows) {
      used.add(row)
      const nums = tokens(row.items.filter(i => i.x >= 130)).map(x => x.t)
      const v = nums.map(t => num(t))
      // quantity, day-trade quantity, price, amount, commission, transaction tax, one more charge column, net amount
      if (v.length !== 8 || v.some(x => x === undefined)) { warn(row.page, 'trade-row-unrecognized', row.text.slice(0, 80)); continue }
      const [quantity, , price, amount, fee, tax, other, net] = v as number[]
      const cat = category(row)!.text.trim()
      const buy = BUY.test(cat), sell = SELL.test(cat)
      if (other !== 0) warn(row.page, 'trade-charge-unrecognized', row.text.slice(0, 80))
      if (Math.abs(quantity * price - amount) >= 1) warn(row.page, 'trade-amount-mismatch', `${quantity}×${price} ≠ ${amount}`)
      const expected = buy ? -(amount + fee) : amount - fee - tax
      if (!buy && !sell) { /* reported by direction() */ } else if (Math.abs(expected - net) > 1.5) warn(row.page, 'trade-net-mismatch', `${expected} ≠ ${net}`)
      // The short name sits on the line itself, or wraps onto the lines just above and below it.
      const own = row.items.filter(i => i.x >= 90 && i.x < 132 && !/^[-\d,.]+$/.test(i.text.trim()) ).map(i => ({ y: row.y, text: i.text.trim() }))
      const wrapped = rows.filter(r => !used.has(r) && !category(r) && !isSubtotal(r) && r.items.every(i => i.x >= 90 && i.x < 132) && Math.abs(r.y - row.y) <= 9)
        .filter(r => !dataRows.some(d => d !== row && Math.abs(d.y - r.y) < Math.abs(row.y - r.y)))
        .flatMap(r => r.items.map(i => ({ y: r.y, text: i.text.trim() })))
      const name = [...own, ...wrapped].sort((a, b) => b.y - a.y).map(p => p.text).join('')
      push({ date: result.statementDate, direction: direction(cat, row.page), symbol: '', name, price, quantity, amount, fee, tax, net, page: row.page })
      sums.amount += amount; sums.fee += fee; sums.tax += tax; sums.net += net
    }
    const subtotal = rows.find(isSubtotal)
    if (!dataRows.length) warn(flat[headerAt].page, 'trade-rows-missing')
    if (!subtotal) warn(flat[headerAt].page, 'trade-subtotal-missing')
    else {
      const t = tokens(subtotal.items.filter(i => !/^小計/.test(i.text.trim()))).map(x => num(x.t))
      // amount, commission, transaction tax, [other charges], net
      const stated = { amount: t[0], fee: t[1], tax: t[2], net: t[t.length - 1] }
      for (const k of ['amount', 'fee', 'tax', 'net'] as const) if (stated[k] === undefined || Math.abs((stated[k] as number) - sums[k]) > 0.011) warn(subtotal.page, 'trade-subtotal-mismatch', `${k} ${sums[k]} ≠ ${stated[k]}`)
    }
  } else if (monthly) {
    const year = monthly[1]
    // Each trade is two lines: date, code, quantity, price, commission / category, name, amount, tax, net amount.
    const sums = { amount: 0, fee: 0, tax: 0, net: 0 }
    let count = 0
    for (const page of all) {
      const rows = page.rows
      for (let k = 0; k < rows.length; k++) {
        const a = rows[k]
        const date = a.items.find(i => i.x < 60 && /^\d{2}\/\d{2}@?$/.test(i.text.trim()))
        if (!date) continue
        const b = rows[k + 1]
        const cat = b?.items.find(i => i.x < 60 && /^[\u4e00-\u9fff]{1,4}$/.test(i.text.trim()))
        const code = a.items.find(i => i.x >= 60 && i.x < 120)?.text.trim()
        const nums = (r: Row, from: number) => r.items.filter(i => i.x >= from).map(i => num(i.text))
        if (!b || !cat || !code) { warn(page.page, 'trade-row-unrecognized', a.text.slice(0, 80)); continue }
        const [quantity, price, fee] = nums(a, 120)
        const name = b.items.filter(i => i.x >= 60 && i.x < 120).map(i => i.text.replace(/\s+/g, '')).join('')
        const [amount, tax, ...rest] = nums(b, 120)
        const net = rest[rest.length - 1]
        if (quantity === undefined || price === undefined || fee === undefined || amount === undefined || tax === undefined || net === undefined) { warn(page.page, 'trade-row-unrecognized', a.text.slice(0, 80)); continue }
        const buy = BUY.test(cat.text.trim())
        if (Math.abs(quantity * price - amount) >= 1) warn(page.page, 'trade-amount-mismatch', `${quantity}×${price} ≠ ${amount}`)
        if (Math.abs((buy ? -(amount + fee) : amount - fee - tax) - net) > 1.5) warn(page.page, 'trade-net-mismatch')
        const [m, d] = date.text.trim().replace('@', '').split('/')
        push({ date: `${year}-${m}-${d}`, direction: direction(cat.text.trim(), page.page), symbol: code, name, price, quantity, amount, fee, tax, net, page: page.page })
        count++
        sums.amount += amount; sums.fee += fee; sums.tax += tax; sums.net += net
        k++
      }
    }
    // "合計:" row: commission; the next row: amount, tax, ..., net amount.
    const totalAt = flat.findIndex(r => r.items.some(i => /^合計/.test(i.text.trim())))
    if (totalAt < 0) { if (count) warn(2, 'trade-subtotal-missing') }
    else {
      const fee = flat[totalAt].items.map(i => num(i.text)).find(v => v !== undefined)
      const next = flat[totalAt + 1]?.items.map(i => num(i.text)).filter((v): v is number => v !== undefined) ?? []
      const stated = { fee, amount: next[0], tax: next[1], net: next[next.length - 1] }
      for (const k of ['amount', 'fee', 'tax', 'net'] as const) if (stated[k] === undefined || Math.abs((stated[k] as number) - sums[k]) > 0.011) warn(flat[totalAt].page, 'trade-subtotal-mismatch', `${k} ${sums[k]} ≠ ${stated[k]}`)
    }
    const net = flat.find(r => /^資產總淨額/.test(r.items[0]?.text.trim() ?? ''))
    const netValue = net && num(net.items.map(i => i.text).find(t => num(t) !== undefined) ?? '')
    if (netValue !== undefined) result.netAssets = { currency: 'TWD', value: netValue }
    result.statementDate = `${year}-${monthly[2]}`
  }
  if (warnings.length) result.status = 'partial'
  return result
}

const csvCell = (v: string | number) => { const t = String(v); return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }

/**
 * Cash per currency as the accounts page should hold it: the ending cash plus the subscriptions and redemptions still
 * in transit. The statement counts them in its net asset value but in neither the holdings nor the cash balance
 * (a redemption in transit is negative: the fund still lists its units while the cash has already arrived).
 */
export function securitiesCash(r: SecuritiesStatementResult): { currency: string; amount: number }[] {
  const byCurrency = new Map<string, number>()
  for (const c of r.cash) byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + c.ending)
  for (const t of r.inTransit) byCurrency.set(t.currency, (byCurrency.get(t.currency) ?? 0) + t.amount)
  // Rounded so that adding two printed figures leaves no float noise.
  return [...byCurrency].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 1e8) / 1e8 })).filter(c => c.amount !== 0)
}

/** The symbol a holding is saved under, and the price to pin: a listed ticker is left to the quote update. */
function savedHolding(p: SecuritiesPosition): { symbol: string; price?: number } {
  const symbol = p.symbol.toUpperCase()
  if (p.exchange === 'SGX' && /^[A-Z0-9]{2,6}$/.test(symbol)) return { symbol: `${symbol}.SI` }
  if (p.exchange === 'US' && /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(symbol)) return { symbol: symbol.replace('.', '-') }
  if (p.exchange === 'HK' && /^\d{1,5}$/.test(symbol)) return { symbol: `${symbol.padStart(4, '0')}.HK` }
  // Funds and anything else a quote lookup cannot find keep the statement's closing price.
  return { symbol: p.symbol, ...(p.price !== undefined && { price: p.price }) }
}

/**
 * The statement's cash and holdings as a position CSV (docs/csv-import.md, type=position) for the accounts import.
 * Listed tickers are left unpriced, so the next quote update prices them; funds and other codes carry the
 * statement's closing price. `category` is only for a new account (an existing one keeps its own). Empty when the
 * statement lists neither.
 */
export function securitiesPositionCsv(r: SecuritiesStatementResult, accountName: string = r.account, category = ''): string {
  const country = r.broker === '台新證券' ? 'TW' : 'SG'
  const head = ['type', 'account', 'kind', 'country', ...(category ? ['category'] : []), 'currency', 'symbol', 'quantity', 'price']
  const cells = (currency: string, symbol: string, quantity: number, price?: number) =>
    ['position', accountName, 'investment', country, ...(category ? [category] : []), currency, symbol, quantity, price ?? ''].map(csvCell).join(',')
  const lines = [
    ...securitiesCash(r).map(c => cells(c.currency, '', c.amount)),
    ...r.positions.map(p => { const h = savedHolding(p); return cells(p.currency, h.symbol, p.quantity, h.price) }),
  ]
  return lines.length ? [head.join(','), ...lines].join('\n') : ''
}
