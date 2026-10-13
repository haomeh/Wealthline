import { bankStatementIdentity, statementAccountLabel, importStatementBalances, statementBalanceRevision, type StatementBalanceCandidate } from '../bankStatementAssets'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WealthData } from '../model'
import { dataVersion } from '../dataVersion'
import { bankCategoryRuleIndex, classifyBankTransaction, mergeBankTransactions, validateBankLedger, type BankTransaction, type BankTransactionAccount, type BankCategoryRule } from '../bankTransactions'
import { protectBankText } from '../bankTextPrivacy'
import { mergeStatementPasswords, parseStatementPasswords } from '../statementPasswords'
import { StatementPasswordSettings } from './StatementPasswordSettings'
import { BankCategoryRules, BankRuleDialog } from './BankCategoryRules'
import { BankStatementImport } from './BankStatementImport'
import { BankTransactionEditor } from './BankTransactionEditor'
import { BANK_TEXT_NOTICE, classificationLabel } from './bankUiHelpers'
import { fmt } from '../format'
import { ActionIcon } from './ActionIcon'
import { DetailRecord } from './DetailRecord'

export function BankTransactions({data,onChange,busy,passwordScope,historyReady=true,historyPanel,onLoadHistory}: {data:WealthData;onChange:(next:WealthData)=>void;busy:boolean;passwordScope?:string;historyReady?:boolean;historyPanel?:ReactNode;onLoadHistory?:()=>void}) {
 const latest=useRef({data,busy,onChange})
 useLayoutEffect(()=>{latest.current={data,busy,onChange}},[data,busy,onChange])
 const [importing,setImporting]=useState(false),[editing,setEditing]=useState<BankTransaction|null>(null),[managingPasswords,setManagingPasswords]=useState(false),[ruleEditor,setRuleEditor]=useState<{index?:number;rule?:BankCategoryRule}|null>(null)
 const [label,setLabel]=useState(''),[bank,setBank]=useState(''),[message,setMessage]=useState(''),[accountFilter,setAccountFilter]=useState(''),[currencyFilter,setCurrencyFilter]=useState(''),[monthFilter,setMonthFilter]=useState('')
 const [page,setPage]=useState(0)
 const accounts=data.bankTransactionAccounts??[],rows=data.bankTransactions??[],rules=data.bankCategoryRules??[],passwords=data.statementPasswords??[]
 const referencedAccounts=useMemo(()=>new Set((data.bankTransactions??[]).map(r=>r.accountId)),[data.bankTransactions]),currencies=useMemo(()=>[...new Set((data.bankTransactions??[]).map(r=>r.currency))].sort(),[data.bankTransactions])
 // Keep legacy mapping identities unchanged; presentation follows the bank and country recognized from the PDF.
 const displayAccounts=useMemo(()=>(data.bankTransactionAccounts??[]).map(a=>{const identity=bankStatementIdentity(a.bank);if(!identity)return a;const label=statementAccountLabel(a.bank),multiple=(data.bankTransactionAccounts??[]).some(other=>other.id!==a.id&&bankStatementIdentity(other.bank)?.label===identity.label);return {...a,label:multiple&&a.label!==label?`${label} · ${a.label}`:label}}),[data.bankTransactionAccounts])
 const filtered=useMemo(()=>(data.bankTransactions??[]).filter(r=>(!accountFilter||r.accountId===accountFilter)&&(!currencyFilter||r.currency===currencyFilter)&&(!monthFilter||r.date.startsWith(monthFilter))).sort((a,b)=>b.date.localeCompare(a.date)),[data.bankTransactions,accountFilter,currencyFilter,monthFilter])
 const pageCount=Math.max(1,Math.ceil(filtered.length/100)),currentPage=Math.min(page,pageCount-1)
 const groups=useMemo(()=>{
  const groups=new Map<string,{date:string;account:string;rows:BankTransaction[]}>()
  for(const row of filtered.slice(currentPage*100,(currentPage+1)*100)){
   const key=JSON.stringify([row.date,row.accountId]),group=groups.get(key)
   if(group)group.rows.push(row)
   else groups.set(key,{date:row.date,account:displayAccounts.find(a=>a.id===row.accountId)?.label??'未辨識帳戶',rows:[row]})
  }
  return groups
 },[filtered,currentPage,displayAccounts])
 function change(patch:{accounts?:BankTransactionAccount[];transactions?:BankTransaction[];rules?:BankCategoryRule[];balances?:readonly StatementBalanceCandidate[];balanceRevision?:string}) {
 const current=latest.current;if(current.busy)return
 const validated=validateBankLedger(patch.accounts??current.data.bankTransactionAccounts??[],patch.transactions??current.data.bankTransactions??[],patch.rules??current.data.bankCategoryRules??[])
 if(patch.balances?.length&&patch.balanceRevision!==statementBalanceRevision(current.data))throw new Error('資產歷史已變更，請重新預覽')
 const next={...current.data,bankTransactionAccounts:validated.accounts,bankTransactions:validated.transactions,bankCategoryRules:validated.rules}
 const imported=importStatementBalances(next,patch.balances??[])
 current.onChange({...imported.data,version:dataVersion(imported.data)})
 }
 const dialogs=<>{ruleEditor && <BankRuleDialog key={ruleEditor.index??'new'} rule={ruleEditor.rule} busy={busy} onCancel={()=>setRuleEditor(null)} onSave={rule=>{const current=latest.current.data.bankCategoryRules??[];change({rules:ruleEditor.index===undefined?[...current,rule]:current.map((r,i)=>i===ruleEditor.index?rule:r)});setRuleEditor(null)}}/>}{managingPasswords && passwordScope && <StatementPasswordSettings scope={passwordScope} passwords={passwords} busy={busy} onClose={()=>setManagingPasswords(false)} onSave={rows=>{const current=latest.current;if(current.busy)return;current.onChange({...current.data,version:dataVersion(current.data,{minimumVersion:12}),statementPasswords:parseStatementPasswords(mergeStatementPasswords(current.data.statementPasswords??[],rows))})}} onRemove={id=>{const current=latest.current;if(!current.busy)current.onChange({...current.data,version:dataVersion(current.data,{minimumVersion:12}),statementPasswords:(current.data.statementPasswords??[]).filter(s=>s.id!==id)})}} onRemoveAll={()=>{const current=latest.current;if(!current.busy)current.onChange({...current.data,version:dataVersion(current.data,{minimumVersion:12}),statementPasswords:[]})}}/>}</>
 const editRule=(row:BankTransaction)=>{const index=bankCategoryRuleIndex(row,rules);setRuleEditor(index>=0?{index,rule:rules[index]}:{rule:{keyword:row.description.slice(0,100),direction:row.direction,target:row.classification??{kind:'pending'}}})}
 if(importing&&!historyReady)return <div className="bank-page">{dialogs}<div className="page-head"><h2>匯入銀行帳單</h2><button onClick={()=>setImporting(false)}>取消匯入</button></div><p className="muted">帳單餘額要與往年歷史核對，請先等候載入。</p>{historyPanel}</div>
 if(importing)return <div className="bank-page">{dialogs}<BankStatementImport data={data} accounts={accounts} existing={rows} rules={rules} passwords={passwords} passwordScope={passwordScope} busy={busy} onManagePasswords={()=>setManagingPasswords(true)} onAddRule={editRule} onCancel={()=>setImporting(false)} onImport={(review,keep)=>{
 const current=latest.current;if(current.busy)return
 const existingAccounts=current.data.bankTransactionAccounts??[]
 const accountIds=new Set(existingAccounts.map(a=>a.id))
 const mappedAccounts=[...existingAccounts,...review.accounts.filter(a=>!accountIds.has(a.id))]
 const result=mergeBankTransactions(current.data.bankTransactions??[],review.rows,mappedAccounts,review.context,{keepSuspectedDuplicates:keep})
 // Don't retain preview-only new labels when all of their rows were deduplicated.
 const used=new Set([...result.transactions.map(r=>r.accountId),...review.balances.map(b=>b.ledgerAccountId)])
 change({accounts:mappedAccounts.filter(a=>accountIds.has(a.id)||used.has(a.id)),transactions:result.transactions,balances:review.balances,balanceRevision:review.balanceRevision})
 setMessage(`已新增 ${result.added} 筆，略過 ${result.duplicates} 筆。期末餘額補入 ${review.balanceCount} 筆。請按「儲存變更」。`);setImporting(false)
 }}/></div>
 if(editing)return <div className="bank-page">{dialogs}<BankTransactionEditor transaction={editing} accounts={displayAccounts} rules={rules} busy={busy} onCancel={()=>setEditing(null)} onSave={row=>{const current=latest.current.data.bankTransactions??[];change({transactions:current.some(r=>r.id===row.id)?current.map(r=>r.id===row.id?row:r):[...current,row]});setEditing(null)}} onRemove={()=>{change({transactions:(latest.current.data.bankTransactions??[]).filter(r=>r.id!==editing.id)});setEditing(null)}}/></div>
 return <div className="bank-page">{dialogs}<div className="page-head"><div><h2>銀行流水</h2><p className="muted">銀行收支與信用卡消費分開記錄；帳單期末餘額可補入資產歷史，不改動目前持倉與負債。變更後請按「儲存變更」。</p></div><button disabled={busy} className="primary" onClick={()=>{setImporting(true);if(!historyReady)onLoadHistory?.()}}>匯入銀行帳單</button></div><p className="muted small">{BANK_TEXT_NOTICE}</p>{passwordScope && <button disabled={busy} onClick={()=>setManagingPasswords(true)}>管理帳單密碼</button>}{message && <p role="status" className="notice">{message}</p>}
 <section className="panel bank-accounts"><h3>獨立流水帳戶</h3><form onSubmit={e=>{e.preventDefault();if(busy)return;try{change({accounts:[...(latest.current.data.bankTransactionAccounts??[]),{id:crypto.randomUUID(),label:protectBankText(label),bank:protectBankText(bank)}]});setLabel('');setBank('');setMessage('已新增獨立帳戶；請儲存變更。')}catch{setMessage('請填寫有效的帳戶標籤及銀行名稱。')}}}><fieldset disabled={busy} className="bank-fields"><label className="field"><span>帳戶標籤（不用完整帳號）</span><input aria-label="帳戶標籤" maxLength={100} required value={label} onChange={e=>setLabel(e.target.value)}/></label><label className="field"><span>銀行名稱</span><input aria-label="銀行名稱" maxLength={100} required value={bank} onChange={e=>setBank(e.target.value)}/></label></fieldset><button disabled={busy}>新增流水帳戶</button></form><ul>{displayAccounts.map(a=><AccountLabel key={`${a.id}:${a.label}`} account={a} automatic={!!bankStatementIdentity(a.bank)} referenced={referencedAccounts.has(a.id)||!!data.bankStatementBalances?.some(b=>b.ledgerAccountId===a.id)} busy={busy} onRename={label=>{try{change({accounts:(latest.current.data.bankTransactionAccounts??[]).map(v=>v.id===a.id?{...v,label:protectBankText(label)}:v)})}catch{setMessage('標籤無效，未修改帳戶。')}}} onRemove={()=>{const current=latest.current.data;if(current.bankTransactions?.some(r=>r.accountId===a.id)||current.bankStatementBalances?.some(b=>b.ledgerAccountId===a.id)){setMessage('帳戶仍被流水引用，請先清除流水。');return}change({accounts:(current.bankTransactionAccounts??[]).filter(v=>v.id!==a.id)})}}/>)}</ul></section>
 <BankCategoryRules rules={rules} busy={busy} onEdit={index=>setRuleEditor(index===undefined?{}:{index,rule:rules[index]})} onRemove={index=>change({rules:(latest.current.data.bankCategoryRules??[]).filter((_,i)=>i!==index)})}/>
 <section className="panel bank-record-panel"><div className="panel-head"><h3>{rows.length} 筆銀行流水</h3><button disabled={busy||!accounts.length} onClick={()=>setEditing({id:crypto.randomUUID(),accountId:accounts[0].id,date:'',description:'',direction:'debit',amount:0,currency:'TWD'})}>手動新增流水</button></div><div className="bank-fields"><label className="field"><span>帳戶篩選</span><select aria-label="流水帳戶篩選" value={accountFilter} onChange={e=>{setAccountFilter(e.target.value);setPage(0)}}><option value="">全部帳戶</option>{displayAccounts.map(a=><option value={a.id} key={a.id}>{a.label}</option>)}</select></label><label className="field"><span>幣別篩選</span><select aria-label="流水幣別篩選" value={currencyFilter} onChange={e=>{setCurrencyFilter(e.target.value);setPage(0)}}><option value="">全部幣別</option>{currencies.map(c=><option key={c}>{c}</option>)}</select></label><label className="field"><span>月份篩選</span><input aria-label="流水月份篩選" type="month" value={monthFilter} onChange={e=>{setMonthFilter(e.target.value);setPage(0)}}/></label></div>
 {filtered.length>0 && <nav className="bank-pagination" aria-label="銀行流水分頁"><button type="button" aria-label="銀行流水上一頁" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一頁</button><span>{filtered.length} 筆符合篩選 · 第 {currentPage+1}／{pageCount} 頁 · 每頁最多 100 筆</span><button type="button" aria-label="銀行流水下一頁" disabled={currentPage+1===pageCount} onClick={()=>setPage(currentPage+1)}>下一頁</button></nav>}
 {!rows.length && <p className="empty">還沒有銀行流水；可先建立帳戶並手動新增，或匯入支持版型的 PDF。</p>}<div className="bank-records record-groups">{[...groups.entries()].map(([key,group])=><section key={key} className="bank-record-group">
  <header className="record-group-head"><time dateTime={group.date}>{group.date}</time><span title={group.account}>{group.account}</span></header>
  {group.rows.map(row=><BankRecord key={row.id} row={row} account={group.account} rules={rules} busy={busy} onEdit={()=>setEditing(row)} onRule={()=>editRule(row)}/>)}
 </section>)}</div></section></div>
}
function AccountLabel({account,automatic,referenced,busy,onRename,onRemove}:{account:BankTransactionAccount;automatic:boolean;referenced:boolean;busy:boolean;onRename:(label:string)=>void;onRemove:()=>void}) {
 const [label,setLabel]=useState(account.label)
 return <li className="bank-account">{automatic?<div className="field"><span>{account.bank}</span><strong>{account.label}</strong><span className="muted small">銀行與國家依帳單辨識</span></div>:<><label className="field"><span>{account.bank}</span><input aria-label={`帳戶標籤 ${account.id}`} maxLength={100} value={label} disabled={busy} onChange={e=>setLabel(e.target.value)}/></label><button disabled={busy} onClick={()=>onRename(label)}>改名</button></>}<button disabled={busy||referenced} title={referenced?'先清除所有引用流水才可刪除帳戶':undefined} onClick={onRemove}>刪除帳戶</button>{referenced && <span className="muted small">有流水引用，不能刪除</span>}</li>
}

export function BankRecord({row,account,rules,busy=false,onEdit,onRule}:{row:BankTransaction;account:string;rules:BankCategoryRule[];busy?:boolean;onEdit?:()=>void;onRule?:()=>void}) {
 const category=classificationLabel(row,rules),direction=row.direction==='debit'?'支出':'入帳'
 return <DetailRecord className="bank-record" title={row.description} label={`查看流水 ${row.id}`}
  value={<span className="record-money" data-direction={row.direction} aria-label={`${direction} ${row.currency} ${fmt(row.amount)}`}><small>{row.currency}</small><strong>{row.direction==='credit'?'+':'−'}{fmt(row.amount)}</strong></span>}
  actions={onEdit && onRule && <>
   <button type="button" className="bank-record-rule" data-pending={classifyBankTransaction(row,rules).kind==='pending'||undefined} disabled={busy} aria-label={`分類規則：${category}`} title="編輯匹配規則／新增規則" onClick={onRule}><ActionIcon name="tag"/></button>
   <button type="button" disabled={busy} aria-label={`編輯流水 ${row.id}`} title="編輯流水" onClick={onEdit}><ActionIcon name="edit"/></button>
  </>}>
  <p>{row.description}</p><dl className="record-evidence"><dt>日期／帳戶</dt><dd>{row.date} · {account}</dd><dt>分類</dt><dd>{category}</dd></dl>
 </DetailRecord>
}
