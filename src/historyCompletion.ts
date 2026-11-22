import type { WealthData } from './model'
import { quantityBaselines, quantityOnly, type QuantityBaseline } from './historyBaseline'
import { localDate } from './history'
import { destinationEvidence, expandPeriodDays, resolveCompletion } from './holdingPeriods'
import { applyQuantityDay, instrumentKey, isUnrecordedPartialDay, parseQuantityDays, type QuantityDay, type QuantityEntry } from './quantityHistory'

export function nearestBaseline(data:WealthData,date:string,now=new Date().toISOString()):QuantityBaseline|undefined {
  const distance=(d:string)=>Math.abs(Date.parse(`${d}T00:00:00Z`)-Date.parse(`${date}T00:00:00Z`))
  return quantityBaselines(data,now).filter(b=>!b.error && b.verified && !(b.kind==='day' && b.date===date))
    .sort((a,b)=>distance(a.date)-distance(b.date)||a.date.localeCompare(b.date)||Number(a.kind==='current')-Number(b.kind==='current'))[0]
}
export function completionRevision(data:WealthData) {
  return JSON.stringify({accounts:data.accounts,days:data.history.quantityDays,periods:data.history.holdingPeriods,changes:data.history.changes,snapshots:data.history.snapshots})
}
export function prepareCompletion(data:WealthData,date:string,entry:QuantityEntry,zeros:string[]=[],now=new Date().toISOString()):{day:QuantityDay;source?:QuantityBaseline;filled:string[];projectedEntries?:QuantityEntry[]} {
  const original=data.history.quantityDays?.find(d=>d.date===date)
  const key=instrumentKey(entry)
  const oldEntries=original?.entries ?? []
  const entries=oldEntries.some(e=>instrumentKey(e)===key) ? oldEntries.map(e=>instrumentKey(e)===key?quantityOnly(entry):e) : [...oldEntries,quantityOnly(entry)]
  if(original?.inventory) return {day:parseQuantityDays([{...original,updatedAt:now,entries}])[0],filled:[]}
  const source=original?.completion ? undefined : nearestBaseline(data,date,now)
  const scope=original?.completion
  if(!source && !scope) return {day:parseQuantityDays([{date,updatedAt:now,entries,sparse:true}])[0],filled:[]}
  const rawKeys=new Set(entries.map(instrumentKey))
  const evidence=new Map(destinationEvidence(data,date).map(e=>[instrumentKey(e),e]))
  const supplements=new Map((scope?.entries ?? source!.entries).filter(e=>!rawKeys.has(instrumentKey(e))).map(e=>[instrumentKey(e),quantityOnly(e)]))
  // Include destination-only proven instruments, but do not turn them into new events.
  if(!scope) for(const e of evidence.values()) if(!rawKeys.has(instrumentKey(e))) {
    // A different split basis needs destination market lookup before persisting an
    // absolute count. Until then keep it unknown, never save an unadjusted count.
    const needsSplit=e.type==='holding' && e.quantityAsOf && e.quantityAsOf!==date && e.quantity!==0
    supplements.set(instrumentKey(e),{...quantityOnly(e),quantity:needsSplit?null:e.quantity})
  }
  const filled=[...supplements.keys()].filter(k=>!evidence.has(k) && !scope)
  for(const k of zeros) if(filled.includes(k)) supplements.set(k,{...supplements.get(k)!,quantity:0})
  const accounts=new Map((scope?.accounts ?? source!.accounts).map(a=>[a.id,a]))
  for(const e of [...entries,...supplements.values()]) accounts.set(e.accountId,{id:e.accountId,name:e.account})
  const day=parseQuantityDays([{date,updatedAt:now,entries,sparse:true,completion:{source:scope?.source ?? {kind:source!.kind,date:source!.date},accounts:[...accounts.values()],entries:[...supplements.values()]}}])[0]
  const projectedEntries=[...entries,...[...supplements].map(([key,e])=>!scope && evidence.has(key)?evidence.get(key)!:e)]
  return {day,source,filled,projectedEntries}
}
export function applyCompletion(data:WealthData,day:QuantityDay,revision:string,confirmed:boolean):WealthData {
  if(completionRevision(data)!==revision) throw new Error('來源或目的日資料已變更，請重新預覽')
  if(day.completion && !confirmed) throw new Error('請確認當日補齊範圍與差異')
  return applyQuantityDay(data,day,data.history.quantityDays?.find(d=>d.date===day.date))
}
export function prepareSingleEntry(data:WealthData,date:string,entry:QuantityEntry,now=new Date().toISOString()):QuantityDay {
  const original=data.history.quantityDays?.find(d=>d.date===date)
  const key=instrumentKey(entry)
  const oldEntries=original?.entries ?? []
  const clean=quantityOnly(entry)
  const entries=oldEntries.some(e=>instrumentKey(e)===key) ? oldEntries.map(e=>instrumentKey(e)===key?clean:e) : [...oldEntries,clean]
  if(original?.inventory) return parseQuantityDays([{...original,updatedAt:now,entries}])[0]
  if(original?.completion) {
    const accounts=original.completion.accounts.some(a=>a.id===clean.accountId)
      ? original.completion.accounts
      : [...original.completion.accounts,{id:clean.accountId,name:clean.account}]
    const supplements=original.completion.entries.filter(e=>instrumentKey(e)!==key)
    return parseQuantityDays([{...original,updatedAt:now,entries,completion:{...original.completion,accounts,entries:supplements}}])[0]
  }
  return parseQuantityDays([{date,updatedAt:now,entries,sparse:true}])[0]
}
export function applySingleEntry(data:WealthData,day:QuantityDay,revision:string):WealthData {
  if(completionRevision(data)!==revision) throw new Error('來源或目的日資料已變更，請重新預覽')
  return applyQuantityDay(data,day,data.history.quantityDays?.find(d=>d.date===day.date))
}
export function removalMessage(data:WealthData,date:string):string {
  const day=data.history.quantityDays?.find(d=>d.date===date)
  const after={...data,history:{...data.history,quantityDays:data.history.quantityDays?.filter(d=>d.date!==date)}}
  const remaining=expandPeriodDays(after).find(d=>d.date===date)
  const hasPeriod=remaining?.periodDerived && !isUnrecordedPartialDay(remaining)
  const result=data.history.snapshots.some(s=>s.date===date) ? '恢復原始快照（快照不會刪除）' : date===localDate(new Date().toISOString()) ? '恢復目前持倉估值' : hasPeriod ? '依剩餘期間重新推算' : '這天會從每日列表消失'
  return `移除 ${date} 的${day?.inventory ? '完整回補' : '手動補登與當日補齊'}？${result}。原本單日明確數量若曾接續持有期間，移除後也會重新計算後續日期；補齊項目僅影響這天。目前持倉不變。`
}
export { resolveCompletion }
