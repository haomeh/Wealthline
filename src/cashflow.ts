import { EXPENSE_CATEGORIES, expenseCategory, type Expense, type ExpenseCategory, type ExpenseCategoryRule } from './expenses'
import { BANK_EXCLUSION_REASONS, INCOME_CATEGORIES, classifyBankTransaction, type BankCategoryRule, type BankTransaction, type Classification } from './bankTransactions'

export type CashflowPeriod = 1 | 3 | 6 | 12 | 'all'
export type IncomeCategory = Extract<Classification, {kind:'income'}>['category']
export type ExclusionReason = Extract<Classification, {kind:'excluded'}>['reason']
export interface CashflowInput {
  expenses?: readonly Expense[]
  expenseRules?: readonly ExpenseCategoryRule[]
  bankTransactions?: readonly BankTransaction[]
  bankRules?: readonly BankCategoryRule[]
  /** Precomputed totals (cashflowMonths) in place of the records, when they are not loaded. */
  months?: readonly CashflowMonthTotals[]
}
/** Amounts here are nonnegative magnitudes, not a net transfer or combined amount. */
export interface CashflowReviewTotals {
  count: number
  debitCount: number
  creditCount: number
  debitAmount: number
  creditAmount: number
}
export interface CashflowCategoryTotal<Category extends string> {
  category: Category
  count: number
  net: number
}
export interface CashflowExclusionTotal extends CashflowReviewTotals {reason: ExclusionReason}
export interface CashflowSourceCoverage {
  cardCount: number
  bankCount: number
  recordCount: number
  /** Observed records never establish complete month coverage. */
  complete: false
}
export interface CashflowInvestmentRecovery {
  count: number
  net: number
  /** Show the not-investment-gain warning even when reversals cancel the net. */
  hasRecords: boolean
}
export interface CashflowTotals {
  income: number
  consumption: number
  difference: number
  incomeCategories: CashflowCategoryTotal<IncomeCategory>[]
  consumptionCategories: CashflowCategoryTotal<ExpenseCategory>[]
  excluded: CashflowReviewTotals
  exclusions: CashflowExclusionTotal[]
  pending: CashflowReviewTotals
  investmentRecovery: CashflowInvestmentRecovery
}
export interface CashflowMonth extends Omit<CashflowTotals, 'income' | 'consumption' | 'difference'> {
  month: string
  /** null means no record of either source in this currency/month, not zero. */
  income: number | null
  consumption: number | null
  difference: number | null
  coverage: CashflowSourceCoverage
}
export interface CashflowCurrencySummary extends CashflowTotals {
  currency: string
  endMonth: string
  period: CashflowPeriod
  months: CashflowMonth[]
  coverage: CashflowSourceCoverage & {recordedMonths: number}
}

const reviewTotals = (): CashflowReviewTotals => ({count:0,debitCount:0,creditCount:0,debitAmount:0,creditAmount:0})
const sourceCoverage = (): CashflowSourceCoverage => ({cardCount:0,bankCount:0,recordCount:0,complete:false})
function emptyTotals(): CashflowTotals {
  return {income:0,consumption:0,difference:0,incomeCategories:[],consumptionCategories:[],excluded:reviewTotals(),exclusions:[],pending:reviewTotals(),investmentRecovery:{count:0,net:0,hasRecords:false}}
}
function monthsInPeriod(endMonth: string, period: Exclude<CashflowPeriod, 'all'>): string[] {
  if (typeof endMonth !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(endMonth) || ![1,3,6,12].includes(period)) throw new Error('收支分析期間無效')
  const [year,month] = endMonth.split('-').map(Number)
  const end = year * 12 + month - 1
  // Arithmetic avoids Date.UTC's special handling of years 0..99.
  if (end - period + 1 < 12) throw new Error('收支分析期間無效')
  return Array.from({length:period},(_,index)=> {
    const value = end - period + 1 + index
    return `${String(Math.floor(value / 12)).padStart(4,'0')}-${String(value % 12 + 1).padStart(2,'0')}`
  })
}
function validateRecord(row: Pick<Expense, 'date' | 'currency' | 'amount'>, bank: boolean): void {
  if (typeof row.date !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(row.date)) throw new Error('收支紀錄日期無效')
  const parsed = new Date(row.date + 'T00:00:00.000Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== row.date) throw new Error('收支紀錄日期無效')
  if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || Math.abs(row.amount) > 1e12 || (bank && row.amount < 0)) throw new Error('收支紀錄金額無效')
  if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) throw new Error('收支紀錄幣別無效')
}
function addCategory<C extends string>(categories: CashflowCategoryTotal<C>[], category: C, amount: number, count = 1): void {
  let total = categories.find(item=>item.category === category)
  if (!total) { total = {category,count:0,net:0}; categories.push(total) }
  total.count += count; total.net += amount
}
function addReview(total: CashflowReviewTotals, row: BankTransaction): void {
  total.count++
  if (row.direction === 'debit') { total.debitCount++; total.debitAmount += row.amount }
  else { total.creditCount++; total.creditAmount += row.amount }
}
function addBank(total: CashflowTotals, row: BankTransaction, classification: Classification): void {
  if (classification.kind === 'income') {
    const net = row.direction === 'credit' ? row.amount : -row.amount
    total.income += net
    addCategory(total.incomeCategories,classification.category,net)
    if (classification.category === '投資回收款') {
      total.investmentRecovery.count++; total.investmentRecovery.net += net; total.investmentRecovery.hasRecords = true
    }
  } else if (classification.kind === 'expense') {
    const net = row.direction === 'debit' ? row.amount : -row.amount
    total.consumption += net
    addCategory(total.consumptionCategories,classification.category,net)
  } else if (classification.kind === 'excluded') {
    addReview(total.excluded,row)
    let reason = total.exclusions.find(item=>item.reason === classification.reason)
    if (!reason) { reason = {reason:classification.reason,...reviewTotals()}; total.exclusions.push(reason) }
    addReview(reason,row)
  } else addReview(total.pending,row)
}
function finish(total: CashflowTotals): void {
  total.difference = total.income - total.consumption
  if (![total.income,total.consumption,total.difference].every(Number.isFinite)) throw new Error('收支合計金額超出範圍')
  // Stable canonical order; retain zero/negative nets for the complete signed table.
  total.incomeCategories.sort((a,b)=>INCOME_CATEGORIES.indexOf(a.category)-INCOME_CATEGORIES.indexOf(b.category))
  total.consumptionCategories.sort((a,b)=>EXPENSE_CATEGORIES.indexOf(a.category)-EXPENSE_CATEGORIES.indexOf(b.category))
  total.exclusions.sort((a,b)=>BANK_EXCLUSION_REASONS.indexOf(a.reason)-BANK_EXCLUSION_REASONS.indexOf(b.reason))
}

/** One currency's records in one month, before the period is chosen. Stored as the Drive summary. */
export interface CashflowMonthTotals {
  currency: string
  month: string
  totals: CashflowTotals
  coverage: CashflowSourceCoverage
}

function addReviewTotals(target: CashflowReviewTotals, add: CashflowReviewTotals): void {
  target.count += add.count; target.debitCount += add.debitCount; target.creditCount += add.creditCount
  target.debitAmount += add.debitAmount; target.creditAmount += add.creditAmount
}
function addTotals(target: CashflowTotals, add: CashflowTotals): void {
  target.income += add.income
  target.consumption += add.consumption
  for (const c of add.incomeCategories) addCategory(target.incomeCategories,c.category,c.net,c.count)
  for (const c of add.consumptionCategories) addCategory(target.consumptionCategories,c.category,c.net,c.count)
  addReviewTotals(target.excluded,add.excluded)
  addReviewTotals(target.pending,add.pending)
  for (const e of add.exclusions) {
    let reason = target.exclusions.find(item=>item.reason === e.reason)
    if (!reason) { reason = {reason:e.reason,...reviewTotals()}; target.exclusions.push(reason) }
    addReviewTotals(reason,e)
  }
  target.investmentRecovery.count += add.investmentRecovery.count
  target.investmentRecovery.net += add.investmentRecovery.net
  target.investmentRecovery.hasRecords ||= add.investmentRecovery.hasRecords
}
function addCoverage(target: CashflowSourceCoverage, add: CashflowSourceCoverage): void {
  target.cardCount += add.cardCount; target.bankCount += add.bankCount; target.recordCount += add.recordCount
}

/** Totals per currency and month of every record, in currency then month order. */
export function cashflowMonths(input: CashflowInput): CashflowMonthTotals[] {
  const points = new Map<string, CashflowMonthTotals>()
  const expenseRules = [...(input.expenseRules ?? [])]
  function target(currency: string, month: string) {
    const key = `${currency} ${month}`
    let point = points.get(key)
    if (!point) { point = {currency,month,totals:emptyTotals(),coverage:sourceCoverage()}; points.set(key,point) }
    return point
  }
  for (const row of input.expenses ?? []) {
    validateRecord(row,false)
    const point = target(row.currency,row.date.slice(0,7))
    point.totals.consumption += row.amount
    addCategory(point.totals.consumptionCategories,expenseCategory(row,expenseRules),row.amount)
    point.coverage.cardCount++; point.coverage.recordCount++
  }
  for (const row of input.bankTransactions ?? []) {
    validateRecord(row,true)
    if (row.direction !== 'debit' && row.direction !== 'credit') throw new Error('收支紀錄方向無效')
    const point = target(row.currency,row.date.slice(0,7))
    addBank(point.totals,row,classifyBankTransaction(row,input.bankRules ?? []))
    point.coverage.bankCount++; point.coverage.recordCount++
  }
  return [...points.values()].sort((a,b)=>a.currency.localeCompare(b.currency) || a.month.localeCompare(b.month))
}

/** The months a summary or the records cover, newest first. */
export const cashflowMonthList = (input: CashflowInput) =>
  [...new Set(input.months ? input.months.map(m=>m.month) : [...(input.expenses ?? []),...(input.bankTransactions ?? [])].map(r=>r.date.slice(0,7)))].sort().reverse()

/**
 * Immutable, currency-separated projection using card dates and bank booked dates as supplied.
 * Only currencies with records in the requested window are returned. Period totals sum observed
 * months; excluded/pending records establish coverage but never income or consumption. No FX,
 * asset valuation, deduplication, persistence or inferred completeness occurs here.
 * `input.months`, when given, stands for the records (cashflowMonths of them).
 */
export function cashflowSummary(input: CashflowInput, endMonth: string, period: CashflowPeriod): CashflowCurrencySummary[] {
  let months = monthsInPeriod(endMonth,period === 'all' ? 1 : period)
  const monthSet = new Set(months)
  const currencies = new Map<string, {totals:CashflowTotals; months:Map<string, CashflowMonthTotals>; coverage:CashflowSourceCoverage}>()
  for (const point of input.months ?? cashflowMonths(input)) {
    if (period !== 'all' && !monthSet.has(point.month)) continue
    let group = currencies.get(point.currency)
    if (!group) { group = {totals:emptyTotals(),months:new Map(),coverage:sourceCoverage()}; currencies.set(point.currency,group) }
    // One month can come in several entries (the summaries of two parts).
    let copy = group.months.get(point.month)
    if (!copy) { copy = {...point,totals:emptyTotals(),coverage:sourceCoverage()}; group.months.set(point.month,copy) }
    addTotals(copy.totals,point.totals); addCoverage(copy.coverage,point.coverage)
    addTotals(group.totals,point.totals); addCoverage(group.coverage,point.coverage)
  }
  if (period === 'all') months = [...new Set([...currencies.values()].flatMap(group=>[...group.months.keys()]))].sort()
  return [...currencies].sort(([a],[b])=>a.localeCompare(b)).map(([currency,group])=> {
    finish(group.totals)
    const points: CashflowMonth[] = months.map(month=> {
      const point = group.months.get(month)
      if (!point) return {...emptyTotals(),month,income:null,consumption:null,difference:null,coverage:sourceCoverage()}
      finish(point.totals)
      return {...point.totals,month,coverage:point.coverage}
    })
    return {...group.totals,currency,endMonth,period,months:points,coverage:{...group.coverage,recordedMonths:group.months.size}}
  })
}
