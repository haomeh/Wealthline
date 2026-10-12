import { EXPENSE_CATEGORIES, type ExpenseCategory, sha256 } from './expenses'
import { normalizeBankText, protectBankText, type BankTextPrivacyContext } from './bankTextPrivacy'

export const INCOME_CATEGORIES = ['薪資','股利','利息','投資回收款','其他收入','未分類'] as const
export const BANK_EXCLUSION_REASONS = ['自有帳戶轉帳','信用卡繳款','投資本金移動','其他不計收支'] as const
export type Classification =
  | {kind:'income'; category:typeof INCOME_CATEGORIES[number]}
  | {kind:'expense'; category:ExpenseCategory}
  | {kind:'excluded'; reason:typeof BANK_EXCLUSION_REASONS[number]}
  | {kind:'pending'}
export interface BankTransactionAccount {id:string; label:string; bank:string}
export interface BankTransaction {
  id:string; accountId:string; date:string; description:string; currency:string
  direction:'debit'|'credit'; amount:number; classification?:Classification
  sourceKey?:string; importKey?:string
}
export interface BankCategoryRule {keyword:string; direction?:'debit'|'credit'; target:Classification}
export type BankTransactionRow = Pick<BankTransaction,'date'|'description'|'currency'|'direction'|'amount'|'classification'>
/** Opaque, non-sensitive parser location. Do not use customer/account identifiers as sectionKey/rowKey. */
export interface BankRowProvenance {page:number; sectionKey:string; rowKey:string}

const fail = (): never => { throw new Error('銀行流水資料無效') }
function object(raw: unknown): Record<string,unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
  return raw as Record<string,unknown>
}
function id(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(raw)) return fail()
  return raw
}
function text(raw: unknown, max: number, context: BankTextPrivacyContext): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max) return fail()
  const result = protectBankText(raw, context)
  if (!result || result.length > max) return fail()
  return result
}
function collection(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return fail()
  return raw
}
function unique<T extends {id:string}>(rows:T[]): T[] {
  if (new Set(rows.map(row=>row.id)).size !== rows.length) return fail()
  return rows
}
function date(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(raw)) return fail()
  const parsed = new Date(raw + 'T00:00:00.000Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== raw || raw.startsWith('0000')) return fail()
  return raw
}
function direction(raw: unknown): BankTransaction['direction'] {
  if (raw !== 'debit' && raw !== 'credit') return fail()
  return raw
}
export function parseBankClassification(raw: unknown): Classification {
  const value = object(raw)
  if (value.kind === 'income' || value.kind === 'expense') {
    if ('reason' in value || 'target' in value) return fail()
    if (value.kind === 'income' && INCOME_CATEGORIES.includes(value.category as typeof INCOME_CATEGORIES[number])) return {kind:'income',category:value.category as typeof INCOME_CATEGORIES[number]}
    if (value.kind === 'expense' && EXPENSE_CATEGORIES.includes(value.category as ExpenseCategory)) return {kind:'expense',category:value.category as ExpenseCategory}
  }
  if (value.kind === 'excluded' && !('category' in value) && !('target' in value) && BANK_EXCLUSION_REASONS.includes(value.reason as typeof BANK_EXCLUSION_REASONS[number])) return {kind:'excluded',reason:value.reason as typeof BANK_EXCLUSION_REASONS[number]}
  if (value.kind === 'pending' && !('category' in value) && !('reason' in value) && !('target' in value)) return {kind:'pending'}
  return fail()
}
export function parseBankTransactionAccounts(raw: unknown, context: BankTextPrivacyContext = {}): BankTransactionAccount[] {
  return unique(collection(raw).map(item=> {
    const a = object(item)
    return {id:id(a.id),label:text(a.label,100,context),bank:text(a.bank,100,context)}
  }))
}
function parseRow(raw: unknown, context: BankTextPrivacyContext): BankTransactionRow {
  const value = object(raw)
  if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0 || value.amount > 1e12) return fail()
  if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) return fail()
  return {date:date(value.date),description:text(value.description,500,context),currency:value.currency,direction:direction(value.direction),amount:value.amount === 0 ? 0 : value.amount,
    ...(value.classification !== undefined && {classification:parseBankClassification(value.classification)})}
}
export function parseBankTransactions(raw: unknown, accounts: readonly BankTransactionAccount[], context: BankTextPrivacyContext = {}): BankTransaction[] {
  const accountIds = new Set(parseBankTransactionAccounts(accounts,context).map(a=>a.id))
  return unique(collection(raw).map(item=> {
    const value = object(item), accountId = id(value.accountId)
    if (!accountIds.has(accountId)) return fail()
    const keys: Pick<BankTransaction,'sourceKey'|'importKey'> = {}
    for (const key of ['sourceKey','importKey'] as const) if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || !/^bank-v1:[a-f0-9]{64}$/.test(value[key])) return fail()
      keys[key] = value[key]
    }
    return {id:id(value.id),accountId,...parseRow(value,context),...keys}
  }))
}
export function parseBankCategoryRules(raw: unknown, context: BankTextPrivacyContext = {}): BankCategoryRule[] {
  const rows = collection(raw)
  if (rows.length > 100) return fail()
  return rows.map(item=> {
    const value = object(item)
    return {keyword:text(value.keyword,100,context),...(value.direction !== undefined && {direction:direction(value.direction)}),target:parseBankClassification(value.target)}
  })
}
/** Validate all collections before returning anything; integration can assign this result atomically. */
export function validateBankLedger(accounts: unknown, transactions: unknown, rules: unknown = [], context: BankTextPrivacyContext = {}) {
  const parsedAccounts = parseBankTransactionAccounts(accounts,context)
  return {accounts:parsedAccounts,transactions:parseBankTransactions(transactions,parsedAccounts,context),rules:parseBankCategoryRules(rules,context)}
}
export const normalizeBankKeyword = (value:string): string => normalizeBankText(value).toUpperCase()
export function bankCategoryRuleIndex(transaction: Pick<BankTransaction,'description'|'direction'>, rules: readonly BankCategoryRule[]): number {
  const description = normalizeBankKeyword(transaction.description)
  return rules.findIndex(rule=>(rule.direction === undefined || rule.direction === transaction.direction) && description.includes(normalizeBankKeyword(rule.keyword)))
}
export function classifyBankTransaction(transaction: Pick<BankTransaction,'description'|'direction'|'classification'>, rules: readonly BankCategoryRule[] = []): Classification {
  if (transaction.classification !== undefined) return parseBankClassification(transaction.classification)
  const rule = rules[bankCategoryRuleIndex(transaction,rules)]
  if (rule) return parseBankClassification(rule.target)
  const description = normalizeBankKeyword(transaction.description)
  if (transaction.direction === 'credit') {
    if (/薪資入帳|薪資轉入|薪資|\bSALARY\b|\bPAYROLL\b/.test(description)) return {kind:'income',category:'薪資'}
    if (/存款利息|利息入帳|\bINTEREST (?:CREDIT|PAID)\b/.test(description)) return {kind:'income',category:'利息'}
    if (/股利入帳|現金股利|\bDIVIDEND\b/.test(description)) return {kind:'income',category:'股利'}
  }
  if (transaction.direction === 'debit' && /信用卡繳款|繳信用卡款|\bCREDIT CARD PAYMENT\b/.test(description)) return {kind:'excluded',reason:'信用卡繳款'}
  return {kind:'pending'}
}
const signature = (row: BankTransactionRow, accountId:string): string => JSON.stringify([accountId,row.date,normalizeBankKeyword(row.description),row.currency,row.direction,row.amount])
const hashKey = async (parts: unknown[]): Promise<string> => 'bank-v1:' + await sha256(new TextEncoder().encode(JSON.stringify(['bank-v1',...parts])))
// Transient, bounded provenance evidence for prepared sources, never serialized.
// Opaque persisted hashes alone cannot prove that two locations share a document.
const preparedDocuments = new Map<string,string>()
const rememberDocument = (sourceKey:string, fileHash:string) => {
  if (preparedDocuments.size >= 100000) preparedDocuments.delete(preparedDocuments.keys().next().value!)
  preparedDocuments.set(sourceKey,fileHash)
}

/**
 * Map a section to an independent account BEFORE preparing. Re-run with original rows/location
 * when remapping; never copy source/import keys from the old mapping. After preparation, preview
 * edits preserve these keys. Pass originalRows if corrected preview values must be prepared anew.
 * Ordinals are assigned over the full section before selection. All inputs are validated first.
 */
export async function prepareBankTransactions(rows: readonly BankTransactionRow[], accountId: string, fileHash: string, provenance: readonly BankRowProvenance[], context: BankTextPrivacyContext = {}, originalRows: readonly BankTransactionRow[] = rows): Promise<BankTransaction[]> {
  id(accountId)
  if (!/^[a-f0-9]{64}$/.test(fileHash) || !Array.isArray(rows) || !Array.isArray(originalRows) || !Array.isArray(provenance) || provenance.length !== rows.length || originalRows.length !== rows.length) return fail()
  const locations = provenance.map(location=> {
    const value = object(location)
    if (!Number.isSafeInteger(value.page) || (value.page as number) < 1 || (value.page as number) > 100) return fail()
    return [value.page,id(value.sectionKey),id(value.rowKey)]
  })
  if (new Set(locations.map(location=>JSON.stringify(location))).size !== locations.length) return fail()
  const parsed = rows.map(row=>parseRow(row,context)), originals = originalRows.map(row=>parseRow(row,context))
  const counts = new Map<string,number>()
  return Promise.all(parsed.map(async (row,index)=> {
    const key = signature(originals[index],accountId), ordinal = (counts.get(key) ?? 0) + 1
    counts.set(key,ordinal)
    const sourceKey = await hashKey(['source',fileHash,...locations[index],accountId])
    rememberDocument(sourceKey,fileHash)
    return {id:crypto.randomUUID(),accountId,...row,sourceKey,importKey:await hashKey(['content',key,ordinal])}
  }))
}
export interface BankMergeOptions {keepSuspectedDuplicates?:boolean}
/**
 * Exact file locations are duplicates. Content/quantity matches across different documents are
 * only suspected: return their rows for review, or keep them explicitly. No balance inference.
 * statementRows is the FULL prepared statement context (including unchecked rows and
 * all mapped sections) for occurrence context. Same-file proof is transient; when
 * absent or evicted, equal content remains suspected rather than guessed unique.
 */
export function mergeBankTransactions(existing: readonly BankTransaction[], incoming: readonly BankTransaction[], accounts: readonly BankTransactionAccount[], statementRows: readonly BankTransaction[] = incoming, options: BankMergeOptions = {}) {
  const previous = parseBankTransactions(existing,accounts), rows = parseBankTransactions(incoming,accounts), context = parseBankTransactions(statementRows,accounts)
  const ids = new Set(previous.map(row=>row.id))
  if (rows.some(row=>ids.has(row.id))) return fail()
  const sourceKeys = new Set(previous.flatMap(row=>row.sourceKey ? [row.sourceKey] : []))
  const previousImports = new Map<string,BankTransaction[]>()
  for (const row of previous) if (row.importKey) {
    const matches = previousImports.get(row.importKey) ?? []
    matches.push(row)
    previousImports.set(row.importKey,matches)
  }
  const contextSources = new Set(context.flatMap(row=>row.sourceKey ? [row.sourceKey] : []))
  const contextImports = new Set(context.flatMap(row=>row.importKey ? [row.importKey] : []))
  const counts = new Map<string,number>()
  for (const row of previous) {
    if ((row.sourceKey && contextSources.has(row.sourceKey)) || (row.importKey && contextImports.has(row.importKey))) continue
    const key = signature(row,row.accountId)
    counts.set(key,(counts.get(key) ?? 0)+1)
  }
  const added: BankTransaction[] = [], suspectedDuplicateRows: BankTransaction[] = []
  const batchImports = new Map<string,Set<string | undefined>>()
  for (const row of rows) {
    if (row.sourceKey && sourceKeys.has(row.sourceKey)) continue
    const key = signature(row,row.accountId)
    const document = row.sourceKey ? preparedDocuments.get(row.sourceKey) : undefined
    const batchDocuments = row.importKey ? batchImports.get(row.importKey) : undefined
    // Distinct locations prepared from the same file are genuine occurrences,
    // even when section-local content ordinals collide. Unknown evidence and
    // other documents remain suspected. Existing matches remain suspected unless
    // their distinct same-file sources are explicitly in the full batch context.
    const batchMatch = !!batchDocuments && (!document || [...batchDocuments].some(value=>value !== document))
    const existingMatch = !!row.importKey && !!previousImports.get(row.importKey)?.some(value=>
      value.importKey === row.importKey && !(document && value.sourceKey && contextSources.has(value.sourceKey) && preparedDocuments.get(value.sourceKey) === document))
    const keyedMatch = existingMatch || batchMatch
    const countMatch = !keyedMatch && (counts.get(key) ?? 0) > 0
    if (countMatch) counts.set(key,counts.get(key)!-1)
    if (keyedMatch || countMatch) {
      suspectedDuplicateRows.push(row)
      if (!options.keepSuspectedDuplicates) continue
    }
    added.push(row)
    if (row.sourceKey) sourceKeys.add(row.sourceKey)
    if (row.importKey) {
      const documents = batchImports.get(row.importKey) ?? new Set<string | undefined>()
      documents.add(document)
      batchImports.set(row.importKey,documents)
    }
  }
  return {transactions:[...previous,...added],added:added.length,duplicates:rows.length-added.length,suspectedDuplicates:suspectedDuplicateRows.length,suspectedDuplicateRows}
}
