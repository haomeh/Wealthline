import type { CashflowInput } from './cashflow'
import { expenseCategoryEvidence, type Expense } from './expenses'
import { bankClassificationEvidence } from './bankTransactions'

export type CashflowSource = {kind:'bank'; accountId:string} | {kind:'card'; card:string}
export type ClassifiedKind = 'income' | 'consumption' | 'pending' | 'excluded'
export interface ClassificationEvidence {
  basis: 'manual' | 'custom-rule' | 'builtin' | 'unclassified'
  rule?: {keyword:string; direction?:'credit' | 'debit'}
}
export interface CashflowEntry {
  source: CashflowSource
  recordId: string
  date: string
  description: string
  currency: string
  amount: number
  direction?: 'credit' | 'debit'
  classification: ClassifiedKind
  category?: string
  exclusionReason?: string
  evidence: ClassificationEvidence
  income: number
  consumption: number
  difference: number
  metric: 'income' | 'consumption' | 'excluded'
  sourceKey?: string
  importKey?: string
}

function validateRecord(row: Pick<Expense, 'date' | 'currency' | 'amount'>, bank: boolean): void {
  if (typeof row.date !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(row.date)) throw new Error('收支紀錄日期無效')
  const parsed = new Date(row.date + 'T00:00:00.000Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== row.date) throw new Error('收支紀錄日期無效')
  if (typeof row.amount !== 'number' || !Number.isFinite(row.amount) || Math.abs(row.amount) > 1e12 || (bank && row.amount < 0)) throw new Error('收支紀錄金額無效')
  if (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)) throw new Error('收支紀錄幣別無效')
}

/** Read-only row evidence. Summaries cannot substitute for unloaded source records. */
export function cashflowEntries(input: CashflowInput): CashflowEntry[] {
  const result: CashflowEntry[] = []
  const common = (row: Expense | NonNullable<CashflowInput['bankTransactions']>[number]) => ({
    recordId:row.id,date:row.date,description:row.description,currency:row.currency,amount:row.amount,
    ...(row.sourceKey !== undefined && {sourceKey:row.sourceKey}),...(row.importKey !== undefined && {importKey:row.importKey}),
  })
  for (const row of input.expenses ?? []) {
    validateRecord(row,false)
    const {category,evidence} = expenseCategoryEvidence(row,input.expenseRules)
    result.push({...common(row),source:{kind:'card',card:row.card},classification:'consumption',category,evidence,
      income:0,consumption:row.amount,difference:-row.amount,metric:'consumption'})
  }
  for (const row of input.bankTransactions ?? []) {
    validateRecord(row,true)
    if (row.direction !== 'debit' && row.direction !== 'credit') throw new Error('收支紀錄方向無效')
    const {classification:effective,evidence} = bankClassificationEvidence(row,input.bankRules)
    const classification = effective.kind === 'expense' ? 'consumption' : effective.kind
    const metric = classification === 'excluded' ? 'excluded' : classification === 'income' ? 'income'
      : classification === 'consumption' ? 'consumption' : row.direction === 'credit' ? 'income' : 'consumption'
    const income = metric === 'income' ? (row.direction === 'credit' ? row.amount : -row.amount) : 0
    const consumption = metric === 'consumption' ? (row.direction === 'debit' ? row.amount : -row.amount) : 0
    result.push({...common(row),source:{kind:'bank',accountId:row.accountId},direction:row.direction,classification,
      ...('category' in effective ? {category:effective.category} : effective.kind === 'pending' ? {category:'未分類'} : {exclusionReason:effective.reason}),
      evidence,income,consumption,difference:income-consumption,metric})
  }
  return result
}
