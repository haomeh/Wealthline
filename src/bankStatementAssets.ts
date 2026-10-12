import { accountIdentity, accountLabel, type Account, type WealthData } from './model'
import type { BankTransactionAccount } from './bankTransactions'
import { historyCatalog, instrumentKey, parseQuantityDays, validDate, validatePastDate, type QuantityEntry, type QuantityDay } from './quantityHistory'
const CASH_CURRENCIES=new Set(['TWD','USD','SGD','JPY','EUR','GBP','AUD','CAD','HKD','CHF','NZD','CNY'])

export interface StatementCashBalance { bank:string; date:string; currency:string; quantity:number }
export interface BankStatementBalance extends StatementCashBalance { id:string; ledgerAccountId:string; accountId:string; fileHash:string }
// Account confirmation is preview-only; the persisted record allowlist removes it.
export type StatementBalanceCandidate = StatementCashBalance & { ledgerAccountId:string; fileHash:string; confirmedAccountId?:string }
const institutions:Record<string,{name:string;country:string;aliases:string[]}> = {
 'HSBC Taiwan':{name:'HSBC',country:'TW',aliases:['HSBC','匯豐','匯豐銀行','滙豐銀行']},
 'HSBC Singapore':{name:'HSBC',country:'SG',aliases:['HSBC','匯豐','匯豐銀行','滙豐銀行']},
 'DBS Singapore':{name:'DBS',country:'SG',aliases:['DBS','DBS Bank','DBS銀行','星展','星展銀行']},
 'DBS Taiwan':{name:'DBS',country:'TW',aliases:['DBS','DBS Bank','DBS銀行','星展','星展銀行']},
 'Taishin':{name:'台新銀行',country:'TW',aliases:['Taishin','台新','台新銀行']},
 'Fubon':{name:'富邦銀行',country:'TW',aliases:['Fubon','富邦','富邦銀行','台北富邦銀行']},
 'E.SUN':{name:'玉山銀行',country:'TW',aliases:['E.SUN','ESUN','玉山','玉山銀行']},
}
export function bankStatementIdentity(bank:string) {
 const identity=Object.hasOwn(institutions,bank)?institutions[bank]:undefined
 return identity ? {...identity,label:accountLabel(identity)} : undefined
}
const normalized=(text:string)=>text.trim().toUpperCase().replace(/[ .]/g,'')
export function matchingStatementAssets(bank:string,accounts:readonly Account[]) {
 const identity=bankStatementIdentity(bank);if(!identity)return []
 return accounts.filter(a=>a.country.trim().toUpperCase()===identity.country&&identity.aliases.some(name=>normalized(name)===normalized(a.name.trim().replace(new RegExp(`\\s+(?:${identity.country}|\\(${identity.country}\\))$`,'i'),''))))
}
export const statementAccountLabel=(bank:string)=>bankStatementIdentity(bank)?.label??bank
export function statementBalanceConfirmation(bank:string,accounts:readonly Account[]) {
 const identity=bankStatementIdentity(bank),matched=matchingStatementAssets(bank,accounts)
 if(!identity||matched.length!==1||accountIdentity(matched[0])===accountIdentity(identity))return undefined
 return {accountId:matched[0].id,statementLabel:identity.label,assetLabel:accountLabel(matched[0])}
}

export function statementLedgerAccount(bank:string,accounts:readonly BankTransactionAccount[]) {
 const identity=bankStatementIdentity(bank);if(!identity)return undefined
 const candidates=accounts.filter(a=>bankStatementIdentity(a.bank)?.label===identity.label)
 const named=candidates.filter(a=>normalized(a.label)===normalized(identity.label))
 return named.length===1 ? named[0] : candidates.length===1 ? candidates[0] : undefined
}
const sourceKey=(b:StatementCashBalance & {fileHash:string})=>JSON.stringify([b.fileHash,bankStatementIdentity(b.bank)?.label,b.date,b.currency])
const fail=():never=>{throw new Error('銀行帳單餘額資料無效')}
export function parseBankStatementBalances(raw:unknown,accounts:readonly BankTransactionAccount[]):BankStatementBalance[] {
 if(!Array.isArray(raw)||raw.length>10000)return fail()
 const ids=new Set<string>(),sources=new Set<string>()
 return raw.map(value=>{
  const b=value as BankStatementBalance
  if(!b||typeof b.bank!=='string'||!bankStatementIdentity(b.bank)||typeof b.date!=='string'||!validDate(b.date)||!CASH_CURRENCIES.has(b.currency)||typeof b.quantity!=='number'||!Number.isFinite(b.quantity)||b.quantity<0||b.quantity>1e12||typeof b.fileHash!=='string'||!/^[a-f0-9]{64}$/.test(b.fileHash))return fail()
  if([b.id,b.ledgerAccountId,b.accountId].some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)))return fail()
  const ledger=accounts.find(a=>a.id===b.ledgerAccountId)
  if(!ledger||bankStatementIdentity(ledger.bank)?.label!==bankStatementIdentity(b.bank)!.label||ids.has(b.id)||sources.has(sourceKey(b)))return fail()
  ids.add(b.id);sources.add(sourceKey(b))
  return {id:b.id,ledgerAccountId:b.ledgerAccountId,accountId:b.accountId,bank:b.bank,date:b.date,currency:b.currency,quantity:b.quantity,fileHash:b.fileHash}
 })
}
export const statementBalanceRevision=(data:WealthData)=>JSON.stringify([data.accounts,data.history,data.bankStatementBalances])
/** Store only explicit closing cash quantities. Current positions and other currencies are never inferred. */
export function importStatementBalances(data:WealthData,candidates:readonly StatementBalanceCandidate[],now=new Date().toISOString()) {
 if(!candidates.length)return {data,added:0,skipped:0}
 const old=parseBankStatementBalances(data.bankStatementBalances??[],data.bankTransactionAccounts??[])
 const sources=new Set(old.map(sourceKey)),records=[...old],values=new Map<string,number>()
 let days=[...(data.history.quantityDays??[])],added=0,skipped=0
 for(const candidate of candidates){
  const identity=bankStatementIdentity(candidate.bank);if(!identity)return fail()
  validatePastDate(candidate.date,now)
  const source=sourceKey(candidate);if(sources.has(source)){skipped++;continue}
  const assets=matchingStatementAssets(candidate.bank,data.accounts)
  if(assets.length>1)throw new Error('同銀行與國家有多個資產帳戶，請先整併帳戶後再匯入餘額。')
  const asset=assets[0]
  if((candidate.confirmedAccountId!==undefined&&candidate.confirmedAccountId!==asset?.id)||(asset&&accountIdentity(asset)!==accountIdentity(identity)&&candidate.confirmedAccountId!==asset.id))throw new Error('帳單銀行名稱與資產帳戶不同，請先確認對應帳戶。')
  const previousRecords=records.filter(b=>bankStatementIdentity(b.bank)?.label===identity.label)
  const previousIds=new Set(previousRecords.map(b=>b.accountId)),previous=previousRecords[0]
  if(previousIds.size>1||(asset&&previous&&asset.id!==previous.accountId))throw new Error('既有帳單的歷史帳戶與資產帳戶不同，請先核對歷史帳戶後再匯入餘額。')
  const accountId=asset?.id??previous?.accountId??candidate.ledgerAccountId
  const record=parseBankStatementBalances([{...candidate,id:crypto.randomUUID(),accountId}],data.bankTransactionAccounts??[])[0]
  const entry:QuantityEntry={accountId,account:asset?.name??identity.name,category:asset?.category??'現金與外幣活存',country:identity.country,type:'cash',symbol:'',currency:candidate.currency,quantity:candidate.quantity}
  const valueKey=JSON.stringify([identity.label,candidate.date,candidate.currency])
  if(values.has(valueKey)&&values.get(valueKey)!==candidate.quantity)throw new Error('同日同銀行幣別的帳單餘額不一致，請分批匯入並核對。')
  values.set(valueKey,candidate.quantity)
  const day=days.find(d=>d.date===candidate.date),key=instrumentKey(entry)
  const entries=[...(day?.entries??[]).filter(e=>instrumentKey(e)!==key),entry]
  const addAccount=(accounts:{id:string;name:string}[])=>accounts.some(a=>a.id===accountId)?accounts:[...accounts,{id:accountId,name:entry.account}]
  const coverage=day?.inventory?.accounts??day?.completion?.accounts
  const known=new Set([...entries,...(day?.completion?.entries??[])].map(instrumentKey))
  const missing=coverage&&!coverage.some(a=>a.id===accountId)
   ? historyCatalog({...data,history:{...data.history,quantityDays:days}}).filter(e=>e.accountId===accountId&&!known.has(instrumentKey(e))).map(e=>({...e,quantity:null})) : []
  let next:QuantityDay=day ? {...day,updatedAt:now,entries,
   ...(day.inventory&&{inventory:{...day.inventory,accounts:addAccount(day.inventory.accounts)}}),
   ...(day.completion&&{completion:{...day.completion,accounts:addAccount(day.completion.accounts),entries:[...day.completion.entries.filter(e=>instrumentKey(e)!==key),...missing]}}),
  } : {date:candidate.date,updatedAt:now,entries,sparse:true}
  if(next.inventory&&missing.length){
   const {inventory,...partial}=next
   // Complete inventories and coverage gaps affect only this date, never later period events.
   next={...partial,entries:[entry],sparse:true,completion:{...inventory,entries:[...(day?.entries??[]).filter(e=>instrumentKey(e)!==key),...missing]}}
  }
  days=[...days.filter(d=>d.date!==candidate.date),parseQuantityDays([next])[0]]
  records.push(record);sources.add(source);added++
 }
 if(!added)return {data,added,skipped}
 return {data:{...data,version:14 as const,bankStatementBalances:parseBankStatementBalances(records,data.bankTransactionAccounts??[]),history:{...data.history,quantityDays:days.sort((a,b)=>a.date.localeCompare(b.date))}},added,skipped}
}
