import { validDate } from './quantityHistory'

export const EXPENSE_CATEGORIES = ['餐飲','交通','購物','旅遊住宿','娛樂','數位服務','生活繳費','醫療','政府規費','未分類'] as const
export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]
export interface ExpenseCategoryRule { keyword: string; category: ExpenseCategory }
export function parseExpenseCategoryRules(raw: unknown): ExpenseCategoryRule[] {
  if(!Array.isArray(raw) || raw.length > 100) throw new Error('分類規則必須是陣列，最多 100 筆')
  return raw.map(rule=>{
    if(!rule || typeof rule.keyword !== 'string' || !categoryText(rule.keyword) || rule.keyword.length > 100 || !EXPENSE_CATEGORIES.includes(rule.category)) throw new Error('分類規則需填寫關鍵字（最多 100 字）與有效類別')
    return {keyword:rule.keyword.trim(),category:rule.category}
  })
}
const categoryText = (text: string) => text.normalize('NFKC').toUpperCase().replace(/[*_-]+/g,' ').replace(/\s+/g,' ').trim()
const CATEGORY_RULES: [ExpenseCategory,RegExp][] = [
  ['政府規費',/移民署|監理|稅捐|IMMIGRATION/],
  ['數位服務',/CLAUDE\.?AI|ANTHROPIC|OPENAI|CHATGPT|APPLE\.COM\/BILL|MICROSOFT|ADOBE|AMAZON WEB SERVICES|\bAWS\b|GOOGLE.*\b(?:ONE|STORAGE)\b/],
  ['娛樂',/\bSTEAM(?:GAMES)?\b|NETFLIX|SPOTIFY|DISNEY|PLAYSTATION|NINTENDO|電影院|影城|遊戲/],
  ['交通',/UBER(?!\s*EATS)|\bGRAB\b(?!.*(?:FOOD|MART))|高鐵|台鐵|臺鐵|捷運|計程車|停車|加油|\bSHELL\b|\bESSO\b/],
  ['旅遊住宿',/AGODA|BOOKING\.COM|AIRBNB|HOTEL|飯店|旅館|AIRLINES|航空/],
  ['餐飲',/UBER\s*EATS|GRAB\s*FOOD|FOODPANDA|STARBUCKS|MCDONALD|RESTAURANT|CAFE|COFFEE|餐廳|餐飲|咖啡|麥當勞|肯德基/],
  ['醫療',/HOSPITAL|CLINIC|PHARMACY|醫院|診所|藥局/],
  ['生活繳費',/電費|水費|瓦斯|電信|中華電信|台灣大哥大|遠傳|SINGTEL|STARHUB/],
  ['購物',/AMAZON|SHOPEE|LAZADA|PCHOME|\bIKEA\b|\bWALMART\b|蝦皮|百貨|全聯|家樂福|便利商店|7 ?ELEVEN|FAMILY\s*MART/],
]

export function expenseCategory(e: Pick<Expense,'description'|'category'>, rules: ExpenseCategoryRule[] = []): ExpenseCategory {
  if(e.category) return e.category
  const merchant = categoryText(e.description)
  const custom = rules.find(rule=>merchant.includes(categoryText(rule.keyword)))
  if(custom) return custom.category
  return CATEGORY_RULES.find(([,rule])=>rule.test(merchant))?.[0] ?? '未分類'
}

export interface Expense {
  id: string
  date: string
  description: string
  amount: number // positive spending, negative refund; never modifies balances
  currency: string
  card: string // user-defined bank/card label, no full card number required
  category?: ExpenseCategory // only manual overrides are stored; absent means infer from merchant
  sourceKey?: string
  importKey?: string
}
export type StatementRow = Pick<Expense, 'date' | 'description' | 'amount' | 'currency'>

export function expenseMonthSummary(expenses: Expense[], month: string, rules: ExpenseCategoryRule[] = []) {
  const currencies = new Map<string, {currency:string;count:number;spending:number;refunds:number;net:number;cards:Map<string,{card:string;count:number;net:number}>;categories:Map<ExpenseCategory,{category:ExpenseCategory;spending:number;refunds:number;net:number}>}>()
  for(const e of expenses) {
    if(e.date.slice(0,7)!==month) continue
    const group = currencies.get(e.currency) ?? {currency:e.currency,count:0,spending:0,refunds:0,net:0,cards:new Map(),categories:new Map()}
    group.count++
    group.spending += Math.max(0,e.amount)
    group.refunds += Math.max(0,-e.amount)
    group.net += e.amount
    const card = group.cards.get(e.card) ?? {card:e.card,count:0,net:0}
    card.count++;card.net += e.amount
    group.cards.set(e.card,card)
    const category = expenseCategory(e,rules)
    const totals = group.categories.get(category) ?? {category,spending:0,refunds:0,net:0}
    totals.spending += Math.max(0,e.amount);totals.refunds += Math.max(0,-e.amount);totals.net += e.amount
    group.categories.set(category,totals)
    currencies.set(e.currency,group)
  }
  return [...currencies.values()].sort((a,b)=>a.currency.localeCompare(b.currency)).map(g=>({...g,cards:[...g.cards.values()].sort((a,b)=>b.net-a.net),categories:[...g.categories.values()].sort((a,b)=>b.spending-a.spending)}))
}

export function parseExpense(raw: unknown): Expense {
  const e = raw as Expense
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id.trim()) throw new Error('消費識別碼無效')
  if (typeof e.date !== 'string' || !validDate(e.date)) throw new Error('消費日期無效')
  if (typeof e.description !== 'string' || !e.description.trim() || e.description.length > 500) throw new Error('請填寫商家／說明（最多 500 字）')
  if (typeof e.card !== 'string' || !e.card.trim() || e.card.length > 100) throw new Error('請填寫銀行／卡片名稱（最多 100 字）')
  if (typeof e.amount !== 'number' || !Number.isFinite(e.amount) || Math.abs(e.amount) > 1e12) throw new Error('消費金額無效')
  if (typeof e.currency !== 'string' || !/^[A-Z]{3}$/.test(e.currency)) throw new Error('消費幣別必須是三碼，如 TWD')
  if(e.category!==undefined && !EXPENSE_CATEGORIES.includes(e.category)) throw new Error('消費類別無效')
  for (const key of ['sourceKey','importKey'] as const) if (e[key] !== undefined && (typeof e[key] !== 'string' || !/^[a-f0-9]{64}$/.test(e[key]))) throw new Error('消費匯入識別碼無效')
  return {id:e.id, date:e.date, description:e.description.trim(), amount:e.amount, currency:e.currency, card:e.card.trim(), ...(e.category!==undefined && {category:e.category}), ...(e.sourceKey && {sourceKey:e.sourceKey}), ...(e.importKey && {importKey:e.importKey})}
}

const normalized = (s: string) => s.normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase()
export const stripMerchantBorders = (text:string) => text.replace(/^[|｜│丨\s]+|[|｜│丨\s]+$/g,'')
export function isUnrecognizedMerchant(description:string):boolean {
  const value=normalized(stripMerchantBorders(description))
  return !value || value.startsWith('商家未能辨識') || /^[IL|丨]+$/.test(value.replace(/\s/g,''))
}
const signature = (e: StatementRow & {card:string}) => JSON.stringify([normalized(e.card),e.date,normalized(e.description),e.currency,e.amount])
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))), b => b.toString(16).padStart(2,'0')).join('')
}
const hashText = (text:string) => sha256(new TextEncoder().encode(text))

export async function prepareExpenses(rows: StatementRow[], card: string, fileHash: string, sourceIndexes?:number[]): Promise<Expense[]> {
  if(sourceIndexes && (sourceIndexes.length !== rows.length || new Set(sourceIndexes).size !== rows.length || sourceIndexes.some(i=>!Number.isSafeInteger(i) || i<0))) throw new Error('帳單來源列無效')
  const counts = new Map<string,number>()
  return Promise.all(rows.map(async (row,index) => {
    const e = parseExpense({...row,card,id:crypto.randomUUID()})
    const key = signature(e), ordinal = (counts.get(key) ?? 0) + 1
    counts.set(key,ordinal)
    return {...e,sourceKey:await hashText(JSON.stringify(sourceIndexes ? [normalized(card),fileHash,'source-line',sourceIndexes[index]] : [normalized(card),fileHash,index])),importKey:await hashText(JSON.stringify([key,ordinal]))}
  }))
}

// Count matching occurrences rather than collapsing two genuine identical purchases.
export function mergeExpenses(existing: Expense[], incoming: Expense[], statementRows: Expense[] = incoming): {expenses:Expense[]; added:number; duplicates:number} {
  const rows = incoming.map(parseExpense)
  if(rows.some(e=>isUnrecognizedMerchant(e.description))) throw new Error('請補上可辨識的商家，並核對是否為繳款')
  const sourceKeys = new Set(existing.flatMap(e => e.sourceKey ? [e.sourceKey] : []))
  const importKeys = new Set(existing.flatMap(e => e.importKey ? [e.importKey] : []))
  const contextSources = new Set(statementRows.flatMap(e=>e.sourceKey?[e.sourceKey]:[]))
  const contextImports = new Set(statementRows.flatMap(e=>e.importKey?[e.importKey]:[]))
  const counts = new Map<string,number>()
  // Exact matches already account for these occurrences, even when unchecked in the preview.
  for (const e of existing) {
    if((e.sourceKey && contextSources.has(e.sourceKey)) || (e.importKey && contextImports.has(e.importKey))) continue
    counts.set(signature(e),(counts.get(signature(e)) ?? 0) + 1)
  }
  const added:Expense[] = []
  for (const e of rows) {
    const key = signature(e)
    if ((e.sourceKey && sourceKeys.has(e.sourceKey)) || (e.importKey && importKeys.has(e.importKey))) continue
    if((counts.get(key) ?? 0)>0) {counts.set(key,counts.get(key)!-1);continue}
    added.push(e)
    if(e.sourceKey) sourceKeys.add(e.sourceKey)
    if(e.importKey) importKeys.add(e.importKey)
  }
  return {expenses:[...existing,...added],added:added.length,duplicates:rows.length-added.length}
}
