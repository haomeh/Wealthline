import { isoDate, money, currencies, type SpatialLine, type Table, type Layout } from './common'
export function statementClosingDate(lines:readonly SpatialLine[],periodEnd?:string) {
 const dates=new Set<string>(periodEnd?[periodEnd]:[])
 for(const line of lines){
  if(line.y<100)continue
  for(const m of line.text.matchAll(/\b(?:as at|Statement Date)\s*[:：]?\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/gi)){
   if(!/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)$/i.test(m[2]))return undefined
   const date=isoDate(`${m[1].padStart(2,'0')}${m[2].slice(0,3)}${m[3]}`,'sg');if(!date)return undefined;dates.add(date)
  }
 }
 return dates.size===1?[...dates][0]:undefined
}
export function closingCashAmount(line:SpatialLine,table:Table,layout:Layout) {
 if(table.balanceX===undefined)return undefined
 const label=line.items.find(i=>i.x>=table.descriptionX-4&&i.x<table.descriptionEnd)?.text??''
 if(!/^(?:Total Balance Carried Forward in SGD:|Closing Balance|期末(?:結餘|餘額))$/i.test(label))return undefined
 const cells=line.items.filter(i=>i.x>=Math.max(table.creditEdge,table.debitEdge)+8*table.scale&&i.x+i.width>table.balanceX!&&i.x+i.width<table.balanceX!+100*table.scale)
 if(cells.length!==1)return undefined
 return money(cells[0].text,!!layout.decimalOnly)
}
type Item=SpatialLine['items'][number]
type Pages=readonly {lines:readonly SpatialLine[]}[]
interface Columns { kindX:number; amount:(i:Item)=>boolean; currency:{x:number;width:number;near?:boolean}|string }
interface Holdings { date:(pages:Pages,periodEnd?:string)=>string|undefined; header:(lines:readonly SpatialLine[],n:number)=>Columns|undefined; row:RegExp }
const label=(line:SpatialLine|undefined,text:string)=>line?.items.find(i=>i.text.replace(/\s+/g,'')===text)
const rightAt=(head:Item)=>(i:Item)=>Math.abs(i.x+i.width-(head.x+head.width))<6
// One date for the whole statement, or none.
const single=(pages:Pages,read:(line:SpatialLine)=>string|null|undefined)=>{const dates=new Set<string>();for(const p of pages)for(const l of p.lines){const d=read(l);if(d===null)return undefined;if(d)dates.add(d)}return dates.size===1?[...dates][0]:undefined}
const after=(name:string,kind:Layout['dateKind'])=>(l:SpatialLine)=>{const n=l.items.findIndex(i=>i.text===name);return n<0?undefined:isoDate(l.items[n+1]?.text.replace(/\s+/g,'')??'',kind)??null}
/** Each bank's account summary: the demand deposit balance of every account, printed apart from the transactions. */
const holdings:Record<string,Holdings>={
 'HSBC Taiwan':{date:p=>single(p,after('對帳單日期','dmy')),row:/./,header:(lines,n)=>{
  if(!label(lines[n-1],'一般活存/支存帳戶概要'))return undefined
  const kind=label(lines[n],'帳戶種類'),currency=label(lines[n],'幣別/帳戶號碼'),closing=label(lines[n],'結餘')
  return kind&&currency&&closing?{kindX:kind.x,currency,amount:rightAt(closing)}:undefined}},
 'Fubon':{row:/活期/,date:p=>single(p,l=>{const m=l.text.match(/對帳單期間\s*[:：]?\s*\d{4}\/\d{2}\/\d{2}\s*[~～\-–至]\s*(\d{4}\/\d{2}\/\d{2})/);return m?isoDate(m[1],'ymd')??null:undefined}),header:(lines,n)=>{
  const kind=label(lines[n],'帳戶種類'),currency=label(lines[n],'幣別'),before=label(lines[n],'存單號碼'),end=label(lines[n],'起存日')
  return kind&&currency&&before&&end&&label(lines[n],'餘額')?{kindX:kind.x,currency,amount:i=>i.x>=before.x+before.width&&i.x+i.width<=end.x}:undefined}},
 'Taishin':{row:/活存|活期/,date:p=>single(p,l=>{const m=l.text.replace(/\s+/g,'').match(/現值參考日[:：](\d{4}\/\d{2}\/\d{2})/);return m?isoDate(m[1],'ymd')??null:undefined}),header:(lines,n)=>{
  const kind=label(lines[n],'帳號類別'),note=label(lines[n],'備註')
  // 新臺幣: one header line. 外幣: 帳戶餘額 above, (原幣)/(新臺幣) below, the currency printed beside each row.
  const twd=label(lines[n],'帳戶餘額'),original=label(lines[n+1],'(原幣)'),converted=label(lines[n+1],'(新臺幣)'),currency=label(lines[n],'幣別/匯率')
  if(kind&&note&&twd&&!currency)return {kindX:kind.x,currency:'TWD',amount:i=>i.x>=twd.x-5&&i.x+i.width<=note.x}
  if(kind&&currency&&original&&converted)return {kindX:kind.x,currency:{...currency,near:true},amount:i=>i.x>=original.x-15&&i.x+i.width<=converted.x}
  // Before 2021-07 the 外幣 table printed the code in its own column and the original amount under 原幣別/金額.
  const code=label(lines[n],'幣別'),amount=label(lines[n+1],'金額'),deposit=label(lines[n-1],'定存')
  return kind&&code&&amount&&deposit?{kindX:kind.x,currency:code,amount:i=>i.x>=amount.x-30&&i.x+i.width<=deposit.x}:undefined},
  },
 'HSBC Singapore':{row:/SAVINGS|CURRENT|EVERYDAY/i,date:p=>single(p,after('Statement Date','sg')),header:(lines,n)=>{
  const kind=label(lines[n],'DEPOSITSANDINVESTMENTS'),currency=label(lines[n],'CCY/Unit'),closing=label(lines[n],'Balance(DR=Debit)')
  return kind&&currency&&closing?{kindX:kind.x,currency,amount:rightAt(closing)}:undefined}},
 'E.SUN':{row:/活存|活期/,date:(_,end)=>end,header:(lines,n)=>{
  const kind=label(lines[n],'項目'),currency=label(lines[n],'幣別'),closing=label(lines[n],'存款餘額(元)')
  return kind&&currency&&closing?{kindX:kind.x,currency,amount:rightAt(closing)}:undefined}},
}
// Only a printed ISO code, never a wrapped currency name.
const codeIn=(line:SpatialLine,c:{x:number;width:number})=>line.items.filter(i=>i.x>=c.x-12&&i.x<=c.x+c.width+12).map(i=>i.text.split(/\s+/)[0]).find(code=>/^[A-Z]{3}$/.test(code)&&currencies(code)[0]===code)
/**
 * Closing cash balances per currency from the account summary, read apart from the transaction tables, so a
 * currency without activity has its balance too. Every demand deposit row must read cleanly, or nothing is returned.
 */
export function summaryBalances(bank:string,pages:Pages,periodEnd?:string) {
 const spec=Object.hasOwn(holdings,bank)?holdings[bank]:undefined,date=spec?.date(pages,periodEnd)
 if(!spec||!date)return undefined
 const totals=new Map<string,number>()
 for(const page of pages)for(let n=0;n<page.lines.length;n++){
  const columns=spec.header(page.lines,n);if(!columns)continue
  let kind=''
  for(const [k,line] of page.lines.entries()){
   if(k<=n)continue
   if(line.items.some(i=>i.width>150||/合計|總計|TOTAL|概要|說明/i.test(i.text)))break
   const amounts=line.items.filter(columns.amount),c=columns.currency,named=line.items.find(i=>i.x>columns.kindX-35&&i.x<columns.kindX+8&&!/\d/.test(i.text))
   kind=named?.text??kind
   // The kind may start left of its centered label.
   // A row has an amount, its own account kind, or its own currency cell; wrapped names and rates are not rows.
   if(!amounts.length&&!named&&(typeof c==='string'||c.near||!codeIn(line,c)))continue
   if(!spec.row.test(kind))continue
   const currency=typeof c==='string'?c:c.near?page.lines.filter(l=>Math.abs(l.y-line.y)<=10).sort((a,b)=>Math.abs(a.y-line.y)-Math.abs(b.y-line.y)).map(l=>codeIn(l,c)).find(Boolean):codeIn(line,c)
   const quantity=amounts.length===1?money(amounts[0].text):undefined
   if(!currency||quantity===undefined)return undefined
   totals.set(currency,(totals.get(currency)??0)+quantity)
  }
 }
 return totals.size?[...totals].map(([currency,quantity])=>({bank,date,currency,quantity:Math.round(quantity*100)/100})):undefined
}
