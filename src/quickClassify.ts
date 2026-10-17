import { BANK_EXCLUSION_REASONS, INCOME_CATEGORIES, classifyBankTransaction, normalizeBankKeyword, type BankCategoryRule, type BankTransaction, type Classification } from './bankTransactions'
import { CARD_CATEGORIES, EXPENSE_CATEGORIES, cardCategoryOption, expenseCategory, parseExpenseCategoryRules, type CardCategory, type Expense } from './expenses'
import { applyBankLedger } from './ledgerEdits'
import { dataVersion } from './dataVersion'
import type { WealthData } from './model'

// 快速分類: the records still to classify (bank rows left pending, card rows left 未分類), one card
// at a time. Pure helpers here; the dialog is views/QuickClassify.tsx.

export type QuickSource = 'bank' | 'card'
export type QuickItem = { source: 'bank'; row: BankTransaction } | { source: 'card'; expense: Expense }
export type QuickRef = { source: QuickSource; id: string }
export type QuickChoice = { source: 'bank'; classification: Classification } | { source: 'card'; category: CardCategory }
export interface QuickOption { key: string; label: string; choice: QuickChoice }
export interface QuickOptionGroup { label: string; options: QuickOption[] }

export const quickId = (item: QuickItem): string => item.source === 'bank' ? item.row.id : item.expense.id
export const quickDate = (item: QuickItem): string => item.source === 'bank' ? item.row.date : item.expense.date
export const quickDescription = (item: QuickItem): string => item.source === 'bank' ? item.row.description : item.expense.description

export function isQuickPending(data: WealthData, item: QuickItem): boolean {
  return item.source === 'bank'
    ? classifyBankTransaction(item.row, data.bankCategoryRules ?? []).kind === 'pending'
    : expenseCategory(item.expense, data.expenseCategoryRules ?? []) === '未分類'
}

// The records to classify, newest first. `inRange`: only records whose date (YYYY-MM-DD) it accepts.
export function quickQueue(data: WealthData, sources: readonly QuickSource[], inRange: (date: string) => boolean = () => true): QuickRef[] {
  const items: QuickItem[] = [
    ...(sources.includes('bank') ? (data.bankTransactions ?? []).map((row): QuickItem => ({ source: 'bank', row })) : []),
    ...(sources.includes('card') ? (data.expenses ?? []).map((expense): QuickItem => ({ source: 'card', expense })) : []),
  ]
  return items.filter((item) => inRange(quickDate(item)) && isQuickPending(data, item))
    .sort((a, b) => quickDate(b).localeCompare(quickDate(a)) || quickDescription(a).localeCompare(quickDescription(b)))
    .map((item) => ({ source: item.source, id: quickId(item) }))
}

// The record a queue entry names, as it is now; undefined once removed.
export function quickItem(data: WealthData, ref: QuickRef): QuickItem | undefined {
  if (ref.source === 'bank') { const row = data.bankTransactions?.find((r) => r.id === ref.id); return row && { source: 'bank', row } }
  const expense = data.expenses?.find((e) => e.id === ref.id)
  return expense && { source: 'card', expense }
}

const sameText = (a: string, b: string) => normalizeBankKeyword(a).replace(/\s+/g, ' ').trim() === normalizeBankKeyword(b).replace(/\s+/g, ' ').trim()

// Other records still to classify with the same description, in the same direction (bank) or of
// the same sign (card: spending or refund), which one choice can classify together.
export function similarPending(data: WealthData, item: QuickItem): QuickRef[] {
  if (item.source === 'bank') {
    const rules = data.bankCategoryRules ?? []
    return (data.bankTransactions ?? []).filter((r) => r.id !== item.row.id && r.direction === item.row.direction && sameText(r.description, item.row.description) && classifyBankTransaction(r, rules).kind === 'pending').map((r) => ({ source: 'bank', id: r.id }))
  }
  const rules = data.expenseCategoryRules ?? []
  return (data.expenses ?? []).filter((e) => e.id !== item.expense.id && (e.amount < 0) === (item.expense.amount < 0) && sameText(e.description, item.expense.description) && expenseCategory(e, rules) === '未分類').map((e) => ({ source: 'card', id: e.id }))
}

const bankOption = (classification: Classification, label: string): QuickOption => ({
  key: classification.kind === 'excluded' ? `excluded:${classification.reason}` : 'category' in classification ? `${classification.kind}:${classification.category}` : 'pending',
  label, choice: { source: 'bank', classification },
})
const incomeOptions = () => INCOME_CATEGORIES.filter((c) => c !== '未分類').map((category) => bankOption({ kind: 'income', category }, category))
const expenseOptions = () => EXPENSE_CATEGORIES.filter((c) => c !== '未分類').map((category) => bankOption({ kind: 'expense', category }, category))

// The choices for a record, most likely first: money out offers spending categories, money in
// income ones; both offer 不計收支 for transfers and card payments. The other side (a refund, or
// income paid back) comes last.
export function quickOptions(item: QuickItem): QuickOptionGroup[] {
  if (item.source === 'card') return [{
    label: item.expense.amount < 0 ? '退款分類' : '消費分類',
    options: CARD_CATEGORIES.filter((c) => c !== '未分類').map((category) => ({ key: category, label: cardCategoryOption(category), choice: { source: 'card', category } })),
  }]
  const excluded = { label: '不計收支', options: BANK_EXCLUSION_REASONS.map((reason) => bankOption({ kind: 'excluded', reason }, reason)) }
  return item.row.direction === 'debit'
    ? [{ label: '消費', options: expenseOptions() }, excluded, { label: '收入沖回', options: incomeOptions() }]
    : [{ label: '收入', options: incomeOptions() }, excluded, { label: '消費退款', options: expenseOptions() }]
}

// The option a record has now, when it was classified by hand (shown as chosen when going back).
export function quickChosenKey(item: QuickItem): string | undefined {
  if (item.source === 'card') return item.expense.category && item.expense.category !== '未分類' ? item.expense.category : undefined
  const c = item.row.classification
  return !c || c.kind === 'pending' ? undefined : bankOption(c, '').key
}

// A rule keyword from a description: its leading words, up to the first that looks like a
// reference, date, amount or name separator, so a rule matches the next statement's lines too
// and does not keep account numbers or names.
export function suggestKeyword(description: string): string {
  const words: string[] = []
  for (const word of description.trim().split(/\s+/)) {
    if (/\d{3,}|^:|^REF\b|^VALUE\b|\d{1,2}[A-Z]{3}\d{0,2}$/i.test(word) || (words.length && /[:：]$/.test(words.at(-1)!))) break
    words.push(word)
    if (words.join(' ').length >= 40 || words.length >= 6) break
  }
  return words.join(' ').replace(/[:：]$/, '').slice(0, 100)
}

// Classifies the record (and `alsoIds`, records of the same source) by hand. With `ruleKeyword`,
// also adds a rule so later records whose description contains it get the same classification.
// Throws when the result is not valid (for example a keyword with a personal identifier).
export function applyQuickChoice(data: WealthData, item: QuickItem, choice: QuickChoice, options: { alsoIds?: readonly string[]; ruleKeyword?: string } = {}): WealthData {
  const ids = new Set([quickId(item), ...(options.alsoIds ?? [])])
  const keyword = options.ruleKeyword?.trim()
  if (item.source === 'bank' && choice.source === 'bank') {
    const rule: BankCategoryRule | undefined = keyword ? { keyword, direction: item.row.direction, target: choice.classification } : undefined
    return applyBankLedger(data, {
      transactions: (data.bankTransactions ?? []).map((r) => ids.has(r.id) ? { ...r, classification: choice.classification } : r),
      ...(rule && { rules: [...(data.bankCategoryRules ?? []), rule] }),
    })
  }
  if (item.source === 'card' && choice.source === 'card') {
    const next: WealthData = {
      ...data,
      expenses: (data.expenses ?? []).map((e) => ids.has(e.id) ? { ...e, category: choice.category } : e),
      ...(keyword && { expenseCategoryRules: parseExpenseCategoryRules([...(data.expenseCategoryRules ?? []), { keyword, category: choice.category }]) }),
    }
    return { ...next, version: dataVersion(next, { minimumVersion: keyword ? 11 : 10 }) }
  }
  throw new Error('分類與紀錄來源不符')
}
