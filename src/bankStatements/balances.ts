import { isoDate, money, type SpatialLine, type Table, type Layout } from './common'
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
