import type { CashflowEntry, CashflowSource } from './cashflowEntries'
import { targetDate as fxTargetDate, type CashflowFxEvidence } from './cashflowFx'
import { cashflowFingerprint } from './cashflowFingerprint'
import { parseMonthlyReviews, type MonthlyReview } from './monthlyReview'
import { monthlyReviewState, reviewSourceKey, type MonthlyReviewState } from './monthlyReviewState'
import { BANK_EXCLUSION_REASONS, INCOME_CATEGORIES } from './bankTransactions'
import { CATEGORY_TOKENS } from './cashflowQuery'
import { isCryptoCurrency } from './historicalFx'
import { fxSymbol } from './priceHistory'

export interface MonthlyReportEntry extends CashflowEntry { sourceLabel: string; fxKey: string; incomeTwd: number; consumptionTwd: number; differenceTwd: number }
type Totals = { income: number; consumption: number; difference: number }
export interface MonthlyReport {
 format: 'wealthline-monthly-report'; formatVersion: 1; policyVersion: 1
 month: string; asOfDate: string; generatedAt: string; sourceDataVersion: number; fingerprint: string
 bankLabels: Record<string, string>
 review: { record: MonthlyReview | null; state: MonthlyReviewState | null }
 entries: MonthlyReportEntry[]; fx: CashflowFxEvidence[]; totals: Totals | null
 categories: { metric: 'income' | 'consumption'; category: string; total: number }[]
 rounding: Totals
}
// Same ceiling as full-data uploads. Check File.size before file.text().
export const REPORT_MAX_BYTES = 100 * 1024 * 1024
const fail = (): never => { throw new Error('每月報表格式或驗證資料無效') }
const obj = (v: unknown): Record<string, unknown> => !v || typeof v !== 'object' || Array.isArray(v) ? fail() : v as Record<string, unknown>
function keys(v: unknown, allowed: string[]): Record<string, unknown> { const o=obj(v); if(Object.keys(o).some(k=>!allowed.includes(k)))fail(); return o }
const text = (v: unknown, max=10000): string => typeof v==='string' && v.length<=max ? v : fail()
const num = (v: unknown): number => typeof v==='number' && Number.isFinite(v) ? v : fail()
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : fail()
const bool = (v: unknown): boolean => typeof v==='boolean' ? v : fail()
const hash = (v: unknown): string => /^[a-f0-9]{64}$/.test(text(v,64)) ? v as string : fail()
const monthOf = (v: unknown): string => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(text(v,7)) ? v as string : fail()
function dateOf(v:unknown):string { const s=text(v,10); if(!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)fail(); return s }
function timestamp(v:unknown):string { const s=text(v,24); if(!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString()!==(s.length===20?s.slice(0,-1)+'.000Z':s))fail(); return s }
function source(v:unknown):CashflowSource { const s=keys(v,['kind','accountId','card']); if(s.kind==='bank'&&s.card===undefined&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(text(s.accountId,128)))return {kind:'bank',accountId:s.accountId as string}; if(s.kind==='card'&&s.accountId===undefined&&text(s.card,100).trim())return {kind:'card',card:s.card as string}; return fail() }
function close(actual:unknown, expected:number) { if(Math.abs(num(actual)-num(expected))>1e-9*Math.max(1,Math.abs(expected)))fail() }
// Shared formatters: toLocaleString builds a new one per call, which is slow over a whole ledger.
const plainNumber = new Intl.NumberFormat('en-US',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})
const displayNumber = new Intl.NumberFormat('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
// Match Intl display rounding, including negative half-cent ties.
export const reportDisplayedNumber = (n:number):number => Number(plainNumber.format(n))
export const reportDisplay = (n:number):string => displayNumber.format(n)
const metrics = ['income','consumption','difference'] as const
function aggregates(entries:MonthlyReportEntry[]) {
 const totals:Totals={income:0,consumption:0,difference:0}, rounding:Totals={income:0,consumption:0,difference:0}
 const cats=new Map<string,MonthlyReport['categories'][number]>()
 for(const e of entries){for(const k of metrics)totals[k]=num(totals[k]+e[`${k}Twd`]);if(e.metric!=='excluded'){const key=e.metric+':'+e.category;const c=cats.get(key)??{metric:e.metric,category:e.category!,total:0};c.total=num(c.total+e[`${e.metric}Twd`]);cats.set(key,c)}}
 for(const k of metrics)rounding[k]=reportDisplayedNumber(reportDisplayedNumber(totals[k])-entries.reduce((n,e)=>n+reportDisplayedNumber(e[`${k}Twd`]),0))
 return {totals:entries.length?totals:null,categories:[...cats].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,c])=>c),rounding}
}
const entryKey=(e:MonthlyReportEntry)=>JSON.stringify([e.source.kind,e.recordId])
function parseEntry(raw: unknown, month: string): MonthlyReportEntry {
 const value = keys(raw, ['source', 'recordId', 'date', 'description', 'currency', 'amount', 'direction',
  'classification', 'category', 'exclusionReason', 'evidence', 'income', 'consumption', 'difference',
  'metric', 'sourceKey', 'importKey', 'sourceLabel', 'fxKey', 'incomeTwd', 'consumptionTwd', 'differenceTwd'])
 const ref = source(value.source), id = text(value.recordId), date = dateOf(value.date)
 const currency = text(value.currency, 3), amount = num(value.amount)
 const validIdentity = !!id.trim() && (ref.kind !== 'bank' || /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))
 const validAmount = Math.abs(amount) <= 1e12 && (ref.kind !== 'bank' || amount >= 0)
 if (!validIdentity || !validAmount || !date.startsWith(month + '-') || !/^[A-Z]{3}$/.test(currency)) return fail()

 const classification = value.classification as CashflowEntry['classification']
 const metric = value.metric as CashflowEntry['metric']
 if (!['income', 'consumption', 'pending', 'excluded'].includes(classification)) return fail()
 if (!['income', 'consumption', 'excluded'].includes(metric)) return fail()
 if (ref.kind === 'bank' && !['credit', 'debit'].includes(String(value.direction))) return fail()
 if (ref.kind === 'card' && (value.direction !== undefined || classification !== 'consumption')) return fail()
 const wantedMetric = classification === 'excluded' ? 'excluded' : classification === 'pending'
  ? (value.direction === 'credit' ? 'income' : 'consumption') : classification
 if (metric !== wantedMetric) return fail()
 const income = metric === 'income' ? (value.direction === 'debit' ? -amount : amount) : 0
 const consumption = metric === 'consumption' ? (ref.kind === 'bank' && value.direction === 'credit' ? -amount : amount) : 0
 const originalContributions = { income, consumption, difference: income - consumption }
 for (const metric of metrics) {
  close(value[metric], originalContributions[metric])
  sameDisplay(num(value[metric]), originalContributions[metric])
 }

 const category = value.category === undefined ? undefined : text(value.category, 100)
 const incomeCategories: readonly string[] = INCOME_CATEGORIES
 if (metric !== 'excluded') {
  if (!category || !Object.values(CATEGORY_TOKENS).includes(category)) return fail()
  const categoryMatchesMetric = metric === 'income' ? incomeCategories.includes(category)
   : !incomeCategories.filter(category => category !== '未分類').includes(category)
  if (!categoryMatchesMetric || value.exclusionReason !== undefined) return fail()
 } else if (category !== undefined || !BANK_EXCLUSION_REASONS.includes(value.exclusionReason as typeof BANK_EXCLUSION_REASONS[number])) return fail()
 if (classification === 'pending' && category !== '未分類') return fail()

 const provenancePattern = ref.kind === 'bank' ? /^bank-v1:[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/
 for (const key of ['sourceKey', 'importKey'] as const) {
  if (value[key] !== undefined && !provenancePattern.test(text(value[key], 100))) return fail()
 }
 const evidence = keys(value.evidence, ['basis', 'rule'])
 const basis = evidence.basis as CashflowEntry['evidence']['basis']
 if (!['manual', 'custom-rule', 'builtin', 'unclassified'].includes(basis)) return fail()
 let rule: CashflowEntry['evidence']['rule']
 if (evidence.rule !== undefined) {
  const input = keys(evidence.rule, ['keyword', 'direction'])
  if (input.direction !== undefined && input.direction !== 'credit' && input.direction !== 'debit') return fail()
  rule = { keyword: text(input.keyword, 1000), ...(input.direction !== undefined ? { direction: input.direction as 'credit' | 'debit' } : {}) }
 }
 if (['custom-rule', 'builtin'].includes(basis) !== !!rule) return fail()
 return {
  source: ref, recordId: id, date, description: text(value.description), currency, amount,
  ...(value.direction !== undefined ? { direction: value.direction as 'credit' | 'debit' } : {}),
  classification, metric, ...(category !== undefined ? { category } : {}),
  ...(value.exclusionReason !== undefined ? { exclusionReason: text(value.exclusionReason, 500) } : {}),
  evidence: { basis, ...(rule ? { rule } : {}) },
  income: num(value.income), consumption: num(value.consumption), difference: num(value.difference),
  ...(value.sourceKey !== undefined ? { sourceKey: text(value.sourceKey) } : {}),
  ...(value.importKey !== undefined ? { importKey: text(value.importKey) } : {}),
  sourceLabel: text(value.sourceLabel, 500), fxKey: text(value.fxKey, 11),
  incomeTwd: num(value.incomeTwd), consumptionTwd: num(value.consumptionTwd), differenceTwd: num(value.differenceTwd),
 }
}
function parseFx(raw: unknown, month: string, asOfDate: string): CashflowFxEvidence {
 const value = keys(raw, ['month', 'currency', 'targetDate', 'rate', 'legs'])
 const currency = text(value.currency, 3)
 const targetDate = dateOf(value.targetDate)
 const rate = num(value.rate)
 if (value.month !== month || !/^[A-Z]{3}$/.test(currency) || rate <= 0) return fail()
 if (targetDate !== fxTargetDate(month, asOfDate)) return fail()
 if (currency !== 'TWD' && month > asOfDate.slice(0, 7)) return fail()

 const legs = array(value.legs).map(raw => {
  const leg = keys(raw, ['symbol', 'date', 'rate'])
  const date = dateOf(leg.date), rate = num(leg.rate)
  const age = (Date.parse(targetDate) - Date.parse(date)) / 86400000
  if (rate <= 0 || age < 0 || age > 7) return fail()
  return { symbol: text(leg.symbol, 50), date, rate }
 })
 const symbols = currency === 'TWD' ? [] : isCryptoCurrency(currency)
  ? [`${currency}-USD`, 'TWD=X'] : [fxSymbol(currency)]
 if (legs.length !== symbols.length || legs.some((leg, i) => leg.symbol !== symbols[i])) return fail()
 close(rate, legs.reduce((rate, leg) => rate * leg.rate, 1))
 return { month, currency, targetDate, rate, legs }
}

const compareSource = (a: CashflowSource, b: CashflowSource): number => {
 const left = reviewSourceKey(a), right = reviewSourceKey(b)
 return left < right ? -1 : left > right ? 1 : 0
}

function parseReview(raw: unknown, month: string): MonthlyReport['review'] {
 const value = keys(raw, ['record', 'state'])
 let record: MonthlyReview | null = null
 let state: MonthlyReviewState | null = null
 if (value.record !== null) {
  const input = keys(value.record, ['month', 'expectedSources', 'confirmations'])
  array(input.expectedSources).forEach(source)
  array(input.confirmations).forEach(raw => {
   const confirmation = keys(raw, ['source', 'decision', 'confirmedAt', 'fingerprint', 'exceptionNote'])
   source(confirmation.source)
  })
  record = parseMonthlyReviews([input])[0]
  if (record.month !== month) return fail()
  record.expectedSources.sort(compareSource)
  record.confirmations.sort((a, b) => compareSource(a.source, b.source))
 }
 if (value.state !== null) {
  const input = keys(value.state, ['status', 'currentMonth', 'sources'])
  if (!['unreviewed', 'in-progress', 'reviewed', 'stale'].includes(String(input.status))) return fail()
  const seen = new Set<string>()
  const sources = array(input.sources).map(raw => {
   const row = keys(raw, ['source', 'count', 'unclassifiedCount', 'fingerprint', 'current'])
   const ref = source(row.source), key = reviewSourceKey(ref)
   const count = num(row.count), unclassifiedCount = num(row.unclassifiedCount)
   const validCount = Number.isSafeInteger(count) && count >= 0
   const validUnclassifiedCount = Number.isSafeInteger(unclassifiedCount) && unclassifiedCount >= 0 && unclassifiedCount <= count
   if (seen.has(key) || !validCount || !validUnclassifiedCount) return fail()
   seen.add(key)
   return { source: ref, count, unclassifiedCount, fingerprint: hash(row.fingerprint), current: bool(row.current) }
  }).sort((a, b) => compareSource(a.source, b.source))
  state = { status: input.status as MonthlyReviewState['status'], currentMonth: bool(input.currentMonth), sources }
 }
 if ((record === null) !== (state === null)) return fail()
 return { record, state }
}

function referencedBanks(entries: readonly CashflowEntry[], review: MonthlyReport['review']): Set<string> {
 const sources = [...entries.map(entry => entry.source), ...(review.record?.expectedSources ?? []),
  ...(review.record?.confirmations.map(confirmation => confirmation.source) ?? [])]
 return new Set(sources.flatMap(source => source.kind === 'bank' ? [source.accountId] : []))
}

function parseBankLabels(raw: unknown, references: Set<string>): Record<string, string> {
 const labels = obj(raw)
 return Object.fromEntries(Object.entries(labels).map(([id, raw]) => {
  if (!references.has(id) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return fail()
  const label = text(raw, 500)
  if (!label.trim()) return fail()
  return [id, label]
 }))
}

// Review fingerprints bind the original contribution schema, without report-only fields.
function originalEntry(entry: MonthlyReportEntry): CashflowEntry {
 const { sourceLabel, fxKey, incomeTwd, consumptionTwd, differenceTwd, ...original } = entry
 void sourceLabel; void fxKey; void incomeTwd; void consumptionTwd; void differenceTwd
 return original
}

function sameDisplay(actual: number, expected: number): void {
 if (reportDisplayedNumber(actual) !== reportDisplayedNumber(expected)) fail()
}

function validateTotals(value: Record<string, unknown>, entries: MonthlyReportEntry[]): Pick<MonthlyReport, 'totals' | 'rounding' | 'categories'> {
 const calculated = aggregates(entries)
 const rawRounding = keys(value.rounding, [...metrics])
 const rounding: Totals = { income: num(rawRounding.income), consumption: num(rawRounding.consumption), difference: num(rawRounding.difference) }
 for (const metric of metrics) {
  close(rounding[metric], calculated.rounding[metric])
  if (reportDisplayedNumber(rounding[metric]) !== rounding[metric]) return fail()
 }

 let totals: Totals | null = null
 if (calculated.totals === null) {
  if (value.totals !== null) return fail()
 } else {
  const rawTotals = keys(value.totals, [...metrics])
  totals = { income: num(rawTotals.income), consumption: num(rawTotals.consumption), difference: num(rawTotals.difference) }
  for (const metric of metrics) {
   close(totals[metric], calculated.totals[metric])
   // A relative machine tolerance may exceed a cent for large amounts. Display checks do not.
   sameDisplay(totals[metric], calculated.totals[metric])
   const displayedRows = entries.reduce((sum, entry) => sum + reportDisplayedNumber(entry[`${metric}Twd`]), 0)
   sameDisplay(totals[metric], displayedRows + rounding[metric])
  }
 }

 const suppliedCategories = array(value.categories).map(raw => {
  const category = keys(raw, ['metric', 'category', 'total'])
  return { metric: text(category.metric), category: text(category.category), total: num(category.total) }
 })
 if (suppliedCategories.length !== calculated.categories.length) return fail()
 const categories = calculated.categories.map(category => {
  const matches = suppliedCategories.filter(item => item.metric === category.metric && item.category === category.category)
  if (matches.length !== 1) return fail()
  close(matches[0].total, category.total)
  sameDisplay(matches[0].total, category.total)
  return { ...category, total: matches[0].total }
 })
 return { totals, rounding, categories }
}

async function validatePayload(raw: unknown): Promise<Omit<MonthlyReport, 'fingerprint'>> {
 const value = keys(raw, ['format', 'formatVersion', 'policyVersion', 'month', 'asOfDate', 'bankLabels',
  'generatedAt', 'sourceDataVersion', 'fingerprint', 'review', 'entries', 'fx', 'totals', 'categories', 'rounding'])
 if (value.format !== 'wealthline-monthly-report' || value.formatVersion !== 1 || value.policyVersion !== 1) return fail()
 const month = monthOf(value.month), asOfDate = dateOf(value.asOfDate), generatedAt = timestamp(value.generatedAt)
 const sourceDataVersion = num(value.sourceDataVersion)
 if (!Number.isSafeInteger(sourceDataVersion) || sourceDataVersion < 1) return fail()

 const entries = array(value.entries).map(entry => parseEntry(entry, month))
  .sort((a, b) => entryKey(a) < entryKey(b) ? -1 : entryKey(a) > entryKey(b) ? 1 : 0)
 const fx = array(value.fx).map(quote => parseFx(quote, month, asOfDate))
  .sort((a, b) => a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0)
 if (new Set(entries.map(entryKey)).size !== entries.length || new Set(fx.map(quote => quote.currency)).size !== fx.length) return fail()
 for (const entry of entries) {
  const quote = fx.find(quote => quote.currency === entry.currency) ?? fail()
  if (entry.fxKey !== `${month}:${entry.currency}`) return fail()
  for (const metric of metrics) {
   close(entry[`${metric}Twd`], entry[metric] * quote.rate)
   sameDisplay(entry[`${metric}Twd`], entry[metric] * quote.rate)
  }
 }
 if (fx.some(quote => !entries.some(entry => entry.currency === quote.currency))) return fail()
 const money = validateTotals(value, entries)
 const review = parseReview(value.review, month)
 const bankLabels = parseBankLabels(value.bankLabels, referencedBanks(entries, review))
 for (const entry of entries) {
  const label = entry.source.kind === 'card' ? entry.source.card : bankLabels[entry.source.accountId] ?? '未知帳戶'
  if (entry.sourceLabel !== label) return fail()
 }
 if (review.record && review.state) {
  const derived = await monthlyReviewState(entries.map(originalEntry), review.record, asOfDate, bankLabels)
  const [derivedHash, suppliedHash] = await Promise.all([cashflowFingerprint(derived), cashflowFingerprint(review.state)])
  if (derivedHash !== suppliedHash) return fail()
 }
 return { format: 'wealthline-monthly-report', formatVersion: 1, policyVersion: 1, month, asOfDate, bankLabels,
  generatedAt, sourceDataVersion, review, entries, fx, ...money }
}
async function fingerprint(payload: Omit<MonthlyReport, 'fingerprint'>): Promise<string> {
 const { generatedAt, ...content } = payload
 void generatedAt
 return cashflowFingerprint(content)
}

export async function buildMonthlyReport(args: {
 month: string; asOfDate: string; generatedAt: string; sourceDataVersion: number
 entries: readonly CashflowEntry[]; fx: readonly CashflowFxEvidence[]
 review: MonthlyReport['review']; bankLabels: Readonly<Record<string, string>>
}): Promise<MonthlyReport> {
 const month = monthOf(args.month)
 const rows = args.entries.filter(entry => entry.date.startsWith(month + '-'))
 const entries = rows.map(entry => {
  const quote = args.fx.find(quote => quote.month === month && quote.currency === entry.currency) ?? fail()
  return { ...entry,
   sourceLabel: entry.source.kind === 'card' ? entry.source.card : args.bankLabels[entry.source.accountId] ?? '未知帳戶',
   fxKey: `${month}:${entry.currency}`, incomeTwd: entry.income * quote.rate,
   consumptionTwd: entry.consumption * quote.rate, differenceTwd: entry.difference * quote.rate,
  }
 }).sort((a, b) => entryKey(a) < entryKey(b) ? -1 : entryKey(a) > entryKey(b) ? 1 : 0)
 const references = referencedBanks(rows, args.review)
 const bankLabels = Object.fromEntries(Object.entries(args.bankLabels).filter(([id]) => references.has(id)))
 const payload = await validatePayload({ format: 'wealthline-monthly-report', formatVersion: 1, policyVersion: 1,
  month, asOfDate: args.asOfDate, bankLabels, generatedAt: args.generatedAt, sourceDataVersion: args.sourceDataVersion,
  review: args.review, entries,
  fx: args.fx.filter(quote => quote.month === month && rows.some(entry => entry.currency === quote.currency)),
  ...aggregates(entries),
 })
 return { ...payload, fingerprint: await fingerprint(payload) }
}

export async function parseMonthlyReport(raw: unknown): Promise<MonthlyReport> {
 if (new TextEncoder().encode(JSON.stringify(raw)).length > REPORT_MAX_BYTES) return fail()
 const expected = hash(obj(raw).fingerprint)
 const payload = await validatePayload(raw)
 if (await fingerprint(payload) !== expected) return fail()
 return { ...payload, fingerprint: expected }
}
export function monthlyReportWarnings(report:MonthlyReport):string[]{
 const warnings=['依已匯入紀錄，不代表完整月份。指紋可偵測內容變更，不代表真實性認證。']
 const pending=report.entries.filter(e=>e.classification==='pending').length,unclassified=report.entries.filter(e=>e.category==='未分類').length,excluded=report.entries.filter(e=>e.metric==='excluded').length
 if(pending)warnings.push(`${pending} 筆銀行流水未分類，暫依入帳／支出計入。`)
 if(unclassified)warnings.push(`保留 ${unclassified} 筆未分類。`)
 if(excluded)warnings.push(`${excluded} 筆不計收支，保留原始金額及原因。`)
 if(report.entries.some(e=>e.category==='投資回收款'))warnings.push('投資回收款：可能包含投入本金，不代表投資收益。')
 return warnings
}
