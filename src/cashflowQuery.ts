import type { CashflowEntry } from './cashflowEntries'
export type LedgerReadiness = 'not-loaded' | 'loading' | 'ready' | 'error'
export interface CashflowQuery {
 range: 'month' | 'year' | 'all'; year?: number; month?: string
 metric: 'all' | 'income' | 'consumption' | 'difference' | 'pending' | 'excluded'
 category?: string; source: 'all' | 'bank' | 'card'; panel: 'records' | 'review' | 'report'; page: number
}
export const CATEGORY_TOKENS: Record<string,string> = {salary:'薪資',dividends:'股利',interest:'利息','investment-recovery':'投資回收款','other-income':'其他收入',unclassified:'未分類',dining:'餐飲',transport:'交通',shopping:'購物',travel:'旅遊住宿',entertainment:'娛樂',digital:'數位服務',utilities:'生活繳費',medical:'醫療',government:'政府規費'}
export const categoryToken = (label:string) => Object.keys(CATEGORY_TOKENS).find(k=>CATEGORY_TOKENS[k]===label)
const defaults = ():CashflowQuery => ({range:'month',metric:'all',source:'all',panel:'records',page:1})
export function parseCashflowQuery(search:string): {query:CashflowQuery;corrected:boolean} {
 const p=new URLSearchParams(search), q=defaults()
 const bad=()=>({query:defaults(),corrected:true})
 for(const key of p.keys()) if(!['range','year','month','metric','category','source','panel','page'].includes(key)||p.getAll(key).length!==1)return bad()
 for(const [key,allowed] of Object.entries({range:['month','year','all'],metric:['all','income','consumption','difference','pending','excluded'],source:['all','bank','card'],panel:['records','review','report']})) {
 const v=p.get(key);if(v!==null){if(!allowed.includes(v))return bad();Object.assign(q,{[key]:v})}
 }
 const m=p.get('month'),y=p.get('year'),page=p.get('page'),category=p.get('category')
 if(m!==null){if(!/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(m)||q.range!=='month')return bad();q.month=m}
 if(y!==null){if(!/^[0-9]{1,4}$/.test(y)||Number(y)<1||q.range!=='year')return bad();q.year=Number(y)}
 if(q.range==='year'&&!q.year)return bad()
 if(q.panel!=='records'&&(q.range!=='month'||!q.month))return bad()
 if(page!==null){if(!/^[1-9][0-9]*$/.test(page)||!Number.isSafeInteger(Number(page)))return bad();q.page=Number(page)}
 if(category!==null){if(!Object.hasOwn(CATEGORY_TOKENS,category))return bad();const income=['salary','dividends','interest','investment-recovery','other-income'];if((q.metric==='income'&&!income.includes(category)&&category!=='unclassified')||(q.metric==='consumption'&&income.includes(category))||q.metric==='excluded'||(q.metric==='pending'&&category!=='unclassified'))return bad();q.category=category}
 return {query:q,corrected:false}
}
export function cashflowQueryString(q:CashflowQuery):string {
 const p=new URLSearchParams()
 if(q.range!=='month')p.set('range',q.range)
 if(q.range==='month'&&q.month)p.set('month',q.month)
 if(q.range==='year'&&q.year)p.set('year',String(q.year))
 if(q.metric!=='all')p.set('metric',q.metric)
 if(q.category)p.set('category',q.category)
 if(q.source!=='all')p.set('source',q.source)
 if(q.panel!=='records')p.set('panel',q.panel)
 if(q.page!==1)p.set('page',String(q.page))
 return p.size?'?'+p.toString():''
}
export function filterCashflowEntries(entries:readonly CashflowEntry[],q:CashflowQuery):CashflowEntry[]{
 return entries.filter(e=>(q.range==='all'||(q.range==='year'?e.date.slice(0,4)===String(q.year).padStart(4,'0'):!q.month||e.date.startsWith(q.month)))&&(q.source==='all'||e.source.kind===q.source)&&(q.metric==='all'||(q.metric==='difference'?e.metric!=='excluded':q.metric==='pending'?e.classification==='pending':e.metric===q.metric))&&(!q.category||e.category===CATEGORY_TOKENS[q.category]))
}
export function cashflowReturnTo(value:string|null):string|undefined {
 if(!value||!value.startsWith('/cashflow')||value.startsWith('//'))return
 const u=new URL(value,'https://local.invalid');if(u.origin!=='https://local.invalid'||u.pathname!=='/cashflow'||u.hash)return
 const parsed=parseCashflowQuery(u.search);if(parsed.corrected)return
 return '/cashflow'+cashflowQueryString(parsed.query)
}
