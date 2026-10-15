import { createStatementAssets, importStatementBalances, statementBalanceRevision, bankStatementIdentity, statementAccountLabel, type StatementBalanceCandidate } from './bankStatementAssets'
import { validateBankLedger, type BankCategoryRule, type BankTransaction, type BankTransactionAccount } from './bankTransactions'
import { dataVersion } from './dataVersion'
import { parseExpenseCategoryRules, type Expense, type ExpenseCategoryRule } from './expenses'
import type { WealthData } from './model'

// Edits to the bank ledger and the card expenses, shared by the pages that list them
// (銀行流水, 信用卡消費) and the cashflow overview. Each returns the next data; saving stays with the caller.

export interface BankLedgerPatch {
  accounts?: BankTransactionAccount[]
  transactions?: BankTransaction[]
  rules?: BankCategoryRule[]
  balances?: readonly StatementBalanceCandidate[]
  balanceRevision?: string
  // Create asset accounts for this import's banks that have none, so today's total includes them.
  createAssets?: boolean
}

// Throws when the ledger or the balance revision is no longer valid.
export function applyBankLedger(data: WealthData, patch: BankLedgerPatch): WealthData {
  const validated = validateBankLedger(patch.accounts ?? data.bankTransactionAccounts ?? [], patch.transactions ?? data.bankTransactions ?? [], patch.rules ?? data.bankCategoryRules ?? [])
  if (patch.balances?.length && patch.balanceRevision !== statementBalanceRevision(data)) throw new Error('資產歷史已變更，請重新預覽')
  const next = { ...data, bankTransactionAccounts: validated.accounts, bankTransactions: validated.transactions, bankCategoryRules: validated.rules }
  const imported = importStatementBalances(next, patch.balances ?? [])
  const withAssets = patch.createAssets ? createStatementAssets(imported.data, new Set((patch.balances ?? []).map((b) => statementAccountLabel(b.bank)))) : imported.data
  return { ...withAssets, version: dataVersion(withAssets) }
}

// Keep legacy mapping identities unchanged; presentation leads with the bank and country recognized from the PDF.
// A label the user chose (typed in a CSV or the preview, or renamed) follows it, so their own name stays visible.
const sameName = (a: string, b: string) => a.trim().toUpperCase().replace(/[ .()（）]/g, '') === b.trim().toUpperCase().replace(/[ .()（）]/g, '')
export function bankDisplayAccounts(accounts: readonly BankTransactionAccount[]): BankTransactionAccount[] {
  return accounts.map((a) => {
    if (!bankStatementIdentity(a.bank)) return a
    const label = statementAccountLabel(a.bank)
    const chosen = a.label.trim() && !sameName(a.label, a.bank) && !sameName(a.label, label)
    return { ...a, label: chosen ? `${label} · ${a.label}` : label }
  })
}

// One bank transaction replaced by its edited version (added when it is new).
export function saveBankTransaction(data: WealthData, row: BankTransaction): WealthData {
  const current = data.bankTransactions ?? []
  return applyBankLedger(data, { transactions: current.some((r) => r.id === row.id) ? current.map((r) => r.id === row.id ? row : r) : [...current, row] })
}

export const removeBankTransaction = (data: WealthData, id: string): WealthData =>
  applyBankLedger(data, { transactions: (data.bankTransactions ?? []).filter((r) => r.id !== id) })

// A bank category rule added, or the one at `index` replaced.
export const saveBankRule = (data: WealthData, rule: BankCategoryRule, index?: number): WealthData => {
  const current = data.bankCategoryRules ?? []
  return applyBankLedger(data, { rules: index === undefined ? [...current, rule] : current.map((r, i) => i === index ? rule : r) })
}

export const saveExpenseRule = (data: WealthData, rule: ExpenseCategoryRule, index?: number): WealthData => {
  const current = data.expenseCategoryRules ?? []
  return { ...data, version: dataVersion(data, { minimumVersion: 11 }), expenseCategoryRules: parseExpenseCategoryRules(index === undefined ? [...current, rule] : current.map((r, i) => i === index ? rule : r)) }
}

export const saveExpense = (data: WealthData, expense: Expense): WealthData =>
  ({ ...data, version: dataVersion(data, { minimumVersion: 10 }), expenses: (data.expenses ?? []).map((e) => e.id === expense.id ? expense : e) })

export const removeExpense = (data: WealthData, id: string): WealthData =>
  ({ ...data, version: dataVersion(data, { minimumVersion: 10 }), expenses: (data.expenses ?? []).filter((e) => e.id !== id) })
