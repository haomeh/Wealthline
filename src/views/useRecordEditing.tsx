import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WealthData } from '../model'
import { bankCategoryRuleIndex, type BankCategoryRule, type BankTransaction } from '../bankTransactions'
import type { Expense } from '../expenses'
import { bankDisplayAccounts, removeBankTransaction, removeExpense, saveBankRule, saveBankTransaction, saveExpense, saveExpenseRule } from '../ledgerEdits'
import { BankRuleDialog } from './BankCategoryRules'
import { BankTransactionEditor } from './BankTransactionEditor'
import { CategoryRuleDialog } from './ExpenseCategoryRules'
import { ExpenseEditor } from './ExpenseEditor'

// Editing the card and bank records listed on the cashflow overview, with the same dialogs and editors
// as the 信用卡消費 and 銀行流水 pages. Changes go to `onChange` like on those pages; saving stays with the app's
// save bar. Without `onChange` or while the records are still loading, nothing is editable (`on` is false).
export function useRecordEditing({ data, onChange, busy, loading }: { data: WealthData; onChange?: (next: WealthData) => void; busy: boolean; loading: boolean }) {
  const latest = useRef({ data, onChange })
  useLayoutEffect(() => { latest.current = { data, onChange } })
  const [bankEdit, setBankEdit] = useState<BankTransaction | null>(null)
  const [bankRule, setBankRule] = useState<{ index?: number; rule?: BankCategoryRule } | null>(null)
  const [expenseEdit, setExpenseEdit] = useState<Expense | null>(null)
  const [expenseRule, setExpenseRule] = useState<{ expense: Expense; index?: number } | null>(null)
  // Narrow screens: the bank row whose buttons a left swipe revealed.
  const [revealed, setRevealed] = useState<string | null>(null)
  const [error, setError] = useState('')
  const on = !!onChange && !loading
  const bankRules = data.bankCategoryRules ?? [], expenseRules = data.expenseCategoryRules ?? []
  const accounts = useMemo(() => bankDisplayAccounts(data.bankTransactionAccounts ?? []), [data.bankTransactionAccounts])

  // Applies one edit to the latest data; a rejected edit (an invalid ledger) is reported, not saved.
  const apply = (edit: (current: WealthData) => WealthData) => {
    const { data: current, onChange: emit } = latest.current
    if (!emit || busy) return false
    try { emit(edit(current)); setError(''); return true } catch (e) { setError(e instanceof Error ? e.message : '無法套用修改'); return false }
  }

  const editor: ReactNode = bankEdit ? <BankTransactionEditor transaction={bankEdit} accounts={accounts} rules={bankRules} busy={busy}
    onCancel={() => setBankEdit(null)}
    onSave={(row) => { if (apply((d) => saveBankTransaction(d, row))) setBankEdit(null) }}
    onRemove={() => { if (apply((d) => removeBankTransaction(d, bankEdit.id))) setBankEdit(null) }} />
    : expenseEdit ? <ExpenseEditor expense={expenseEdit} rules={expenseRules} busy={busy}
      onCancel={() => setExpenseEdit(null)}
      onSave={(expense) => { if (apply((d) => saveExpense(d, expense))) setExpenseEdit(null) }}
      onRemove={() => { if (apply((d) => removeExpense(d, expenseEdit.id))) setExpenseEdit(null) }} />
      : null

  const dialogs: ReactNode = <>
    {bankRule && <BankRuleDialog key={bankRule.index ?? 'new'} rule={bankRule.rule} busy={busy} onCancel={() => setBankRule(null)}
      onSave={(rule) => { if (apply((d) => saveBankRule(d, rule, bankRule.index))) setBankRule(null) }} />}
    {expenseRule && <CategoryRuleDialog expense={expenseRule.expense} rule={expenseRule.index === undefined ? undefined : expenseRules[expenseRule.index]} busy={busy} onCancel={() => setExpenseRule(null)}
      onSave={(rule) => { if (apply((d) => saveExpenseRule(d, rule, expenseRule.index))) setExpenseRule(null) }} />}
  </>

  return {
    on, busy, error, editor, dialogs, editing: !!editor, revealed, setRevealed,
    // The same starting rule as the bank page: the one that already applies to the row, else a new one from its description.
    editBankRule: (row: BankTransaction) => {
      const index = bankCategoryRuleIndex(row, bankRules)
      setBankRule(index >= 0 ? { index, rule: bankRules[index] } : { rule: { keyword: row.description.slice(0, 100), direction: row.direction, target: row.classification ?? { kind: 'pending' } } })
    },
    editBank: setBankEdit,
    editExpense: setExpenseEdit,
    editExpenseRule: (expense: Expense, index?: number) => setExpenseRule({ expense, index }),
  }
}
export type RecordEditing = ReturnType<typeof useRecordEditing>
