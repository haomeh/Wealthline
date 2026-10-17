import { BANK_EXCLUSION_REASONS, INCOME_CATEGORIES, bankCategoryRuleIndex, classifyBankTransaction, normalizeBankKeyword, type BankCategoryRule, type BankTransaction, type Classification } from './bankTransactions'
import { CARD_CATEGORIES, EXPENSE_CATEGORIES, cardCategoryOption, expenseCategory, expenseCategoryRuleIndex, parseExpenseCategoryRules, type CardCategory, type Expense } from './expenses'
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
  return quickLookup(data)(ref)
}
// quickItem for many entries of one data: records indexed once (a queue can hold thousands).
export function quickLookup(data: WealthData): (ref: QuickRef) => QuickItem | undefined {
  const bank = new Map((data.bankTransactions ?? []).map((r) => [r.id, r])), card = new Map((data.expenses ?? []).map((e) => [e.id, e]))
  return (ref) => {
    if (ref.source === 'bank') { const row = bank.get(ref.id); return row && { source: 'bank', row } }
    const expense = card.get(ref.id)
    return expense && { source: 'card', expense }
  }
}

// Words that change from one line of a kind to the next: references, account numbers, dates, times, amounts.
const VARYING = /\d{3,}|^\d{1,2}[A-Z]{3}\d{0,2}$|^[\d.,:/-]+$/i
// A description without those words. Lines of one kind (the same transfer, the same merchant)
// share it even when each carries its own reference, as HSBC and DBS lines do. When too little is
// left to tell kinds apart, the whole description is used.
export function descriptionShape(description: string): string {
  const whole = normalizeBankKeyword(description).replace(/\s+/g, ' ').trim()
  const shape = whole.split(' ').filter((w) => !VARYING.test(w)).join(' ')
  return shape.replace(/[^\p{L}]/gu, '').length >= 4 ? shape : whole
}

// Other records still to classify whose description has the same shape, in the same direction
// (bank) or of the same sign (card: spending or refund), which one choice can classify together.
export function similarPending(data: WealthData, item: QuickItem): QuickRef[] {
  const shape = descriptionShape(quickDescription(item))
  if (item.source === 'bank') {
    const rules = data.bankCategoryRules ?? []
    return (data.bankTransactions ?? []).filter((r) => r.id !== item.row.id && r.direction === item.row.direction && descriptionShape(r.description) === shape && classifyBankTransaction(r, rules).kind === 'pending').map((r) => ({ source: 'bank', id: r.id }))
  }
  const rules = data.expenseCategoryRules ?? []
  return (data.expenses ?? []).filter((e) => e.id !== item.expense.id && (e.amount < 0) === (item.expense.amount < 0) && descriptionShape(e.description) === shape && expenseCategory(e, rules) === '未分類').map((e) => ({ source: 'card', id: e.id }))
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

// A rule keyword from a description: the longest run of words with no reference, account number,
// date or amount in it, before any name separator (:), so a rule matches the next statement's
// lines too and keeps no account numbers or names. A rule matches text the description contains,
// so the keyword is always one unbroken part of it. Empty when nothing useful is left.
export function suggestKeyword(description: string): string {
  const runs: string[][] = [[]]
  for (const word of description.trim().split(/\s+/)) {
    if (/^[:：]/.test(word)) break
    const separator = /[:：]$/.test(word)
    if (VARYING.test(word)) runs.push([])
    else {
      // A run stops at six words or 40 characters; the next word starts another, so each stays one unbroken part.
      const text = separator ? word.slice(0, -1) : word, run = runs.at(-1)!
      if (run.length < 6 && [...run, text].join(' ').length <= 40) run.push(text)
      else runs.push([text])
    }
    if (separator) break
  }
  const texts = runs.map((run) => {
    while (run.length && /^(REF|VALUE|DATE)$/i.test(run.at(-1)!)) run.pop()
    return run.join(' ')
  })
  const best = texts.reduce((a, b) => b.length > a.length ? b : a, '')
  return best.replace(/[^\p{L}]/gu, '').length >= 3 ? best : ''
}

// How many other records still to classify a rule with `keyword` would match (same direction for bank rows).
export function keywordPending(data: WealthData, item: QuickItem, keyword: string): number {
  const word = keyword.trim()
  if (!word) return 0
  if (item.source === 'bank') {
    const rules = data.bankCategoryRules ?? [], rule = { keyword: word, direction: item.row.direction, target: { kind: 'pending' } as Classification }
    return (data.bankTransactions ?? []).filter((r) => r.id !== item.row.id && bankCategoryRuleIndex(r, [rule]) === 0 && classifyBankTransaction(r, rules).kind === 'pending').length
  }
  const rules = data.expenseCategoryRules ?? []
  return (data.expenses ?? []).filter((e) => e.id !== item.expense.id && expenseCategoryRuleIndex(e.description, [{ keyword: word, category: '未分類' }]) === 0 && expenseCategory(e, rules) === '未分類').length
}

// Classifies the record (and `alsoIds`, records of the same source) by hand. With `ruleKeyword`,
// also adds a rule so records whose description contains it get the same classification, now and
// in later imports. Records the keyword matches that the rule still leaves unclassified (another
// rule matched first, or 未分類 was picked by hand) are classified by hand too, so none is left
// for another card. Throws when the result is not valid (for example a keyword with a personal identifier).
export function applyQuickChoice(data: WealthData, item: QuickItem, choice: QuickChoice, options: { alsoIds?: readonly string[]; ruleKeyword?: string } = {}): WealthData {
  const ids = new Set([quickId(item), ...(options.alsoIds ?? [])])
  const keyword = options.ruleKeyword?.trim()
  if (item.source === 'bank' && choice.source === 'bank') {
    const current = data.bankCategoryRules ?? []
    if (!keyword) return applyBankLedger(data, { transactions: (data.bankTransactions ?? []).map((r) => ids.has(r.id) ? { ...r, classification: choice.classification } : r) })
    const rule: BankCategoryRule = { keyword, direction: item.row.direction, target: choice.classification }
    // The first matching rule wins: the new rule goes before any rule that only leaves rows 未分類.
    const at = current.findIndex((r) => r.target.kind === 'pending')
    const rules = at < 0 ? [...current, rule] : [...current.slice(0, at), rule, ...current.slice(at)]
    const matches = (r: BankTransaction) => bankCategoryRuleIndex(r, [rule]) === 0
    return applyBankLedger(data, {
      rules,
      transactions: (data.bankTransactions ?? []).map((r) => ids.has(r.id) || (matches(r) && classifyBankTransaction(r, rules).kind === 'pending') ? { ...r, classification: choice.classification } : r),
    })
  }
  if (item.source === 'card' && choice.source === 'card') {
    const rules = keyword ? parseExpenseCategoryRules([...(data.expenseCategoryRules ?? []), { keyword, category: choice.category }]) : data.expenseCategoryRules ?? []
    const matches = (e: Expense) => !!keyword && expenseCategoryRuleIndex(e.description, [{ keyword, category: choice.category }]) === 0 && expenseCategory(e, rules) === '未分類'
    const next: WealthData = {
      ...data,
      expenses: (data.expenses ?? []).map((e) => ids.has(e.id) || matches(e) ? { ...e, category: choice.category } : e),
      ...(keyword && { expenseCategoryRules: rules }),
    }
    return { ...next, version: dataVersion(next, { minimumVersion: keyword ? 11 : 10 }) }
  }
  throw new Error('分類與紀錄來源不符')
}
