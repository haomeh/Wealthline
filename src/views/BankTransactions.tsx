import { bankStatementIdentity } from '../bankStatementAssets'
import { applyBankLedger, bankDisplayAccounts, type BankLedgerPatch } from '../ledgerEdits'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { WealthData } from '../model'
import type { LedgerScope } from '../google/driveStore'
import { dataVersion } from '../dataVersion'
import { bankCategoryRuleIndex, classifyBankTransaction, mergeBankTransactions, type BankTransaction, type BankTransactionAccount, type BankCategoryRule } from '../bankTransactions'
import { protectBankText } from '../bankTextPrivacy'
import { mergeStatementPasswords, parseStatementPasswords } from '../statementPasswords'
import { StatementPasswordSettings } from './StatementPasswordSettings'
import { BankCategoryRules, BankRuleDialog } from './BankCategoryRules'
import { BankStatementImport } from './BankStatementImport'
import { ImportKind } from './ImportSteps'
import { BankTransactionEditor } from './BankTransactionEditor'
import { BANK_TEXT_NOTICE, classificationLabel, classificationTag } from './bankUiHelpers'
import { fmt } from '../format'
import { ActionIcon } from './ActionIcon'
import { DetailRecord, type RecordProps } from './DetailRecord'

// Drive: the transactions loaded when earlier quarters are not (driveStore.ts ledgerScope), with
// the state of a load ('loading' or a failure's message) and the actions that load more.
// onLoadMonth reads only the quarter of one month (YYYY-MM), for the month filter.
export type BankLedgerScope = LedgerScope & {status?:string;onLoadEarlier:()=>void;onLoadAll:()=>void;onLoadMonth:(month:string)=>void}

// `ledger`: set while earlier quarters are not loaded. The list, counts and filters then cover
// the loaded months only; importing and deleting an account first load every quarter.
export function BankTransactions({data,onChange,busy,passwordScope,historyReady=true,historyStatus,onLoadHistory,ledger,importing:routed,onImporting,onImportCard}: {data:WealthData;onChange:(next:WealthData)=>void;busy:boolean;passwordScope?:string;historyReady?:boolean;historyStatus?:string;onLoadHistory?:()=>void;ledger?:BankLedgerScope;importing?:boolean;onImporting?:(open:boolean)=>void;onImportCard?:()=>void}) {
 const latest=useRef<{data:WealthData;busy:boolean;onChange:(next:WealthData)=>void;loadMonth?:(month:string)=>void}>({data,busy,onChange})
 useLayoutEffect(()=>{latest.current={data,busy,onChange,loadMonth:ledger?.onLoadMonth}})
 // The app keeps the open import in the URL; mounted on its own, the page keeps it itself.
 const [opened,setOpened]=useState(false),importing=routed??opened,setImporting=onImporting??setOpened
 const [editing,setEditing]=useState<BankTransaction|null>(null),[managingPasswords,setManagingPasswords]=useState(false),[ruleEditor,setRuleEditor]=useState<{index?:number;rule?:BankCategoryRule}|null>(null)
 const [label,setLabel]=useState(''),[bank,setBank]=useState(''),[message,setMessage]=useState(''),[accountFilter,setAccountFilter]=useState(''),[currencyFilter,setCurrencyFilter]=useState(''),[monthFilter,setMonthFilter]=useState(''),[kindFilter,setKindFilter]=useState<''|'pending'|'classified'>('')
 const [page,setPage]=useState(0),[adding,setAdding]=useState(false)
 // An account to delete once every quarter is loaded, which shows whether any record still uses it.
 const [removing,setRemoving]=useState<string|null>(null)
 const ledgerError=ledger?.status&&ledger.status!=='loading'?ledger.status:''
 // Narrow screens: the row whose buttons a left swipe revealed.
 const [revealed,setRevealed]=useState<string|null>(null)
 const accounts=data.bankTransactionAccounts??[],rows=data.bankTransactions??[],rules=data.bankCategoryRules??[],passwords=data.statementPasswords??[]
 // Keep legacy mapping identities unchanged; presentation follows the bank and country recognized from the PDF.
 const displayAccounts=useMemo(()=>bankDisplayAccounts(data.bankTransactionAccounts??[]),[data.bankTransactionAccounts])
 // Rows still to classify, counted once per change of the rows or rules.
 const pendingIds=useMemo(()=>new Set((data.bankTransactions??[]).filter(r=>classifyBankTransaction(r,data.bankCategoryRules??[]).kind==='pending').map(r=>r.id)),[data.bankTransactions,data.bankCategoryRules])
 // Months with records: those loaded, and those the summary lists in quarters not loaded yet.
 const months=useMemo(()=>[...new Set([...(data.bankTransactions??[]).map(r=>r.date.slice(0,7)),...(ledger?.months??[])])].sort().reverse(),[data.bankTransactions,ledger?.months])
 // A chosen month in a quarter not loaded: only that quarter is read.
 const monthUnloaded=!!ledger&&!!monthFilter&&ledger.months.includes(monthFilter)
 useEffect(()=>{if(monthUnloaded)latest.current.loadMonth?.(monthFilter)},[monthUnloaded,monthFilter])
 const filtered=useMemo(()=>(data.bankTransactions??[]).filter(r=>(!accountFilter||r.accountId===accountFilter)&&(!currencyFilter||r.currency===currencyFilter)&&(!monthFilter||r.date.startsWith(monthFilter))&&(!kindFilter||pendingIds.has(r.id)===(kindFilter==='pending'))).sort((a,b)=>b.date.localeCompare(a.date)),[data.bankTransactions,accountFilter,currencyFilter,monthFilter,kindFilter,pendingIds])
 const filteredPending=useMemo(()=>filtered.filter(r=>pendingIds.has(r.id)).length,[filtered,pendingIds])
 const pageCount=Math.max(1,Math.ceil(filtered.length/100)),currentPage=Math.min(page,pageCount-1)
 if(page!==currentPage)setPage(currentPage)
 const rowCounts=useMemo(()=>{const counts=new Map<string,number>();for(const r of data.bankTransactions??[])counts.set(r.accountId,(counts.get(r.accountId)??0)+1);return counts},[data.bankTransactions])
 const accountLabels=useMemo(()=>new Map(displayAccounts.map(a=>[a.id,a.label])),[displayAccounts])
 // Each month of the filtered rows: its count and money in and out per currency, over every page.
 const monthTotals=useMemo(()=>{
  const totals=new Map<string,{count:number;currencies:Map<string,{credit:number;debit:number}>}>()
  for(const row of filtered){
   const month=totals.get(row.date.slice(0,7))??{count:0,currencies:new Map()}
   const money=month.currencies.get(row.currency)??{credit:0,debit:0}
   money[row.direction]+=row.amount;month.count++
   month.currencies.set(row.currency,money);totals.set(row.date.slice(0,7),month)
  }
  return totals
 },[filtered])
 const groups=useMemo(()=>{
  const groups=new Map<string,BankTransaction[]>()
  for(const row of filtered.slice(currentPage*100,(currentPage+1)*100)){
   const month=row.date.slice(0,7),group=groups.get(month)
   if(group)group.push(row)
   else groups.set(month,[row])
  }
  return groups
 },[filtered,currentPage])
 const setFilter=(set:(value:string)=>void)=>(e:{target:{value:string}})=>{set(e.target.value);setPage(0)}
 function change(patch:BankLedgerPatch) {
 const current=latest.current;if(current.busy)return
 current.onChange(applyBankLedger(current.data,patch))
 }
 const dialogs=<>{ruleEditor && <BankRuleDialog key={ruleEditor.index??'new'} rule={ruleEditor.rule} busy={busy} onCancel={()=>setRuleEditor(null)} onSave={rule=>{const current=latest.current.data.bankCategoryRules??[];change({rules:ruleEditor.index===undefined?[...current,rule]:current.map((r,i)=>i===ruleEditor.index?rule:r)});setRuleEditor(null)}}/>}{managingPasswords && passwordScope && <StatementPasswordSettings scope={passwordScope} passwords={passwords} busy={busy} onClose={()=>setManagingPasswords(false)} onSave={rows=>{const current=latest.current;if(current.busy)return;current.onChange({...current.data,version:dataVersion(current.data,{minimumVersion:12}),statementPasswords:parseStatementPasswords(mergeStatementPasswords(current.data.statementPasswords??[],rows))})}} onRemove={id=>{const current=latest.current;if(!current.busy)current.onChange({...current.data,version:dataVersion(current.data,{minimumVersion:12}),statementPasswords:(current.data.statementPasswords??[]).filter(s=>s.id!==id)})}} onRemoveAll={()=>{const current=latest.current;if(!current.busy)current.onChange({...current.data,version:dataVersion(current.data,{minimumVersion:12}),statementPasswords:[]})}}/>}</>
 function removeAccount(id:string){const current=latest.current.data;if(current.bankTransactions?.some(r=>r.accountId===id)||current.bankStatementBalances?.some(b=>b.ledgerAccountId===id)){setMessage('帳戶仍被流水引用，請先清除流水。');return}change({accounts:(current.bankTransactionAccounts??[]).filter(v=>v.id!==id)})}
 useEffect(()=>{
  if(!removing)return
  if(ledgerError){setRemoving(null);setMessage('無法載入全部流水，沒有刪除帳戶。');return}
  if(!ledger){setRemoving(null);setMessage('');removeAccount(removing)}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[removing,ledgerError,!ledger])
 const editRule=(row:BankTransaction)=>{const index=bankCategoryRuleIndex(row,rules);setRuleEditor(index>=0?{index,rule:rules[index]}:{rule:{keyword:row.description.slice(0,100),direction:row.direction,target:row.classification??{kind:'pending'}}})}
 // Importing finds duplicates among every record, and checks balances against every year of history.
 // However the import was opened (this page's button, the shared entry or its URL), it starts both loads,
 // before paint so an earlier failed load does not flash its error first.
 useLayoutEffect(()=>{
  if(!importing)return
  if(!historyReady)onLoadHistory?.()
  ledger?.onLoadAll()
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[importing])
 if(importing&&(!historyReady||ledger)){const historyFailed=!historyReady&&historyStatus&&historyStatus!=='loading',failed=historyFailed||ledgerError;return <div className="bank-page">{dialogs}<section className="panel" aria-busy={!failed}><div className="panel-head"><h2>匯入帳單</h2><button onClick={()=>setImporting(false)}>取消匯入</button></div><ImportKind kind="bank" onSwitch={onImportCard}/>{historyFailed?<div className="banner error" role="alert"><p>{historyStatus}</p><button onClick={onLoadHistory}>重試</button></div>:ledgerError?<div className="banner error" role="alert"><p>{ledgerError}</p><button onClick={ledger!.onLoadAll}>重試</button></div>:<p className="muted">{ledger?'正在載入全部銀行流水，完成後才能比對重複的流水…':'正在載入往年歷史，完成後可核對帳單餘額…'}</p>}</section></div>}
 if(importing)return <div className="bank-page">{dialogs}<BankStatementImport onSwitchKind={onImportCard} data={data} accounts={accounts} existing={rows} rules={rules} passwords={passwords} passwordScope={passwordScope} busy={busy} onManagePasswords={()=>setManagingPasswords(true)} onAddRule={editRule} onCancel={()=>setImporting(false)} onImport={(review,keep)=>{
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
 const pager=pageCount>1&&<nav className="bank-pagination" aria-label="銀行流水分頁"><button type="button" aria-label="銀行流水上一頁" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一頁</button><span>{filtered.length} 筆符合篩選 · 第 {currentPage+1}／{pageCount} 頁 · 每頁最多 100 筆</span><button type="button" aria-label="銀行流水下一頁" disabled={currentPage+1===pageCount} onClick={()=>setPage(currentPage+1)}>下一頁</button></nav>
 return <div className="bank-page">{dialogs}<div className="page-head"><div><h2>銀行流水</h2><p className="muted">銀行收支與信用卡消費分開記錄；帳單期末餘額可補入資產歷史，不改動目前持倉與負債。變更後請按「儲存變更」。</p></div><button disabled={busy} className="primary" onClick={()=>setImporting(true)}>匯入銀行帳單</button></div>{message && <p role="status" className="notice">{message}</p>}
 <section className="panel bank-record-panel"><div className="panel-head"><h3>{rows.length} 筆銀行流水</h3><button disabled={busy||!accounts.length} title={accounts.length?undefined:'先在下方「流水帳戶」新增帳戶'} onClick={()=>setEditing({id:crypto.randomUUID(),accountId:accounts[0].id,date:'',description:'',direction:'debit',amount:0,currency:'TWD'})}>手動新增流水</button></div>
 {ledger && <LedgerScopeNotice ledger={ledger}/>}
 {(!!rows.length||!!ledger?.months.length) && <><div className="bank-fields bank-filters"><label className="field"><span>月份</span><select aria-label="流水月份篩選" value={monthFilter} onChange={setFilter(setMonthFilter)}><option value="">全部月份</option>{(monthFilter&&!months.includes(monthFilter)?[monthFilter,...months]:months).map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label><label className="field"><span>帳戶</span><select aria-label="流水帳戶篩選" value={accountFilter} onChange={setFilter(setAccountFilter)}><option value="">全部帳戶</option>{displayAccounts.map(a=><option value={a.id} key={a.id}>{a.label}</option>)}</select></label><label className="field"><span>幣別</span><select aria-label="流水幣別篩選" value={currencyFilter} onChange={setFilter(setCurrencyFilter)}><option value="">全部幣別</option>{[...new Set(rows.map(r=>r.currency))].sort().map(c=><option key={c}>{c}</option>)}</select></label><label className="field"><span>分類</span><select aria-label="流水分類篩選" value={kindFilter} onChange={setFilter(v=>setKindFilter(v as ''|'pending'|'classified'))}><option value="">全部</option><option value="pending">未分類</option><option value="classified">已分類</option></select></label></div>
 <p className="bank-swipe-hint muted small">向左滑一筆流水可編輯或設定分類。</p><p className="bank-filter-summary"><span>{filtered.length} 筆符合篩選</span>{filteredPending>0&&kindFilter!=='pending'&&<button type="button" className="link" onClick={()=>{setKindFilter('pending');setPage(0)}}>其中 {filteredPending} 筆未分類，只看這些</button>}{(monthFilter||accountFilter||currencyFilter||kindFilter)&&<button type="button" className="link" onClick={()=>{setMonthFilter('');setAccountFilter('');setCurrencyFilter('');setKindFilter('');setPage(0)}}>清除篩選</button>}</p></>}
 {!rows.length&&!ledger?.months.length && <p className="empty">{ledger?`${monthLabel(ledger.from)}起沒有銀行流水。`:'還沒有銀行流水。匯入支援版型的 PDF 帳單，或先在下方「流水帳戶」新增帳戶後手動新增。'}</p>}
 {monthUnloaded ? <MonthLoading month={monthFilter} status={ledger!.status} onRetry={()=>ledger!.onLoadMonth(monthFilter)}/> : (!!rows.length||!!ledger?.months.length)&&!filtered.length && <p className="empty">沒有符合篩選的流水。</p>}
 <div className="bank-records">{[...groups.entries()].map(([month,monthRows])=>{const totals=monthTotals.get(month);return <section key={month} className="bank-month" aria-label={`${monthLabel(month)} 銀行流水`}>
  <header className="bank-month-head"><h4>{monthLabel(month)}</h4><span className="muted small">{totals?.count ?? monthRows.length} 筆</span>{totals&&<span className="bank-month-totals">{[...totals.currencies].sort(([a],[b])=>a.localeCompare(b)).map(([currency,money])=><span key={currency}><small>{currency}</small>{money.credit>0&&<span className="bank-month-in">+{fmt(money.credit)}</span>}{money.debit>0&&<span>−{fmt(money.debit)}</span>}</span>)}</span>}</header>
  {monthRows.map(row=><BankRecord key={row.id} row={row} date={row.date} account={accountLabels.get(row.accountId)??'未辨識帳戶'} rules={rules} busy={busy} revealed={revealed===row.id} onReveal={open=>setRevealed(open?row.id:null)} onEdit={()=>setEditing(row)} onRule={()=>editRule(row)}/>)}
 </section>})}</div>{ledger&&hasEarlier(ledger)&&!monthFilter&&currentPage+1===pageCount&&<LoadEarlier ledger={ledger}/>}{pager}</section>
 <section className="panel bank-settings" aria-label="銀行流水設定">
 <BankCategoryRules rules={rules} busy={busy} onEdit={index=>setRuleEditor(index===undefined?{}:{index,rule:rules[index]})} onRemove={index=>change({rules:(latest.current.data.bankCategoryRules??[]).filter((_,i)=>i!==index)})}/>
 <details className="bank-setting bank-accounts" open={!accounts.length}><summary><span>流水帳戶</span><span className="muted small">{accounts.length} 個</span></summary><p className="muted small">每筆流水屬於一個帳戶，用來篩選和標示來源，與資產頁的帳戶分開。匯入帳單時會自動建立；只有手動記帳的銀行才需要在這裡新增。{ledger&&`筆數只算 ${monthLabel(ledger.from)}起已載入的流水；刪除帳戶前會先載入全部流水確認。`}</p><ul>{displayAccounts.map(a=><AccountLabel key={`${a.id}:${a.label}`} account={a} automatic={!!bankStatementIdentity(a.bank)} count={rowCounts.get(a.id)??0} partial={!!ledger} referenced={rowCounts.has(a.id)||!!data.bankStatementBalances?.some(b=>b.ledgerAccountId===a.id)} busy={busy||removing!==null} onRename={label=>{try{change({accounts:(latest.current.data.bankTransactionAccounts??[]).map(v=>v.id===a.id?{...v,label:protectBankText(label)}:v)})}catch{setMessage('標籤無效，未修改帳戶。')}}} onRemove={()=>{if(!ledger)return removeAccount(a.id);setRemoving(a.id);setMessage('正在載入全部流水，確認沒有流水使用這個帳戶後就會刪除…');ledger.onLoadAll()}}/>)}</ul>{accounts.length&&!adding?<button className="bank-account-add-open" disabled={busy} onClick={()=>setAdding(true)}>＋ 新增帳戶</button>:<form className="bank-account-add" onSubmit={e=>{e.preventDefault();if(busy)return;try{change({accounts:[...(latest.current.data.bankTransactionAccounts??[]),{id:crypto.randomUUID(),label:protectBankText(label),bank:protectBankText(bank)}]});setLabel('');setBank('');setAdding(false);setMessage('已新增流水帳戶；請儲存變更。')}catch{setMessage('請填寫有效的帳戶標籤及銀行名稱。')}}}><label className="field"><span>帳戶標籤（不用完整帳號）</span><input aria-label="帳戶標籤" maxLength={100} required disabled={busy} value={label} onChange={e=>setLabel(e.target.value)}/></label><label className="field"><span>銀行名稱</span><input aria-label="銀行名稱" maxLength={100} required disabled={busy} value={bank} onChange={e=>setBank(e.target.value)}/></label><button disabled={busy}>新增流水帳戶</button>{!!accounts.length&&<button type="button" onClick={()=>setAdding(false)}>取消</button>}</form>}{(!accounts.length||adding)&&<p className="muted small">{BANK_TEXT_NOTICE}</p>}</details>
 {passwordScope && <div className="bank-setting bank-passwords"><span>帳單密碼</span><span className="muted small">{passwords.length?`${passwords.length} 組`:'未設定'}</span><button disabled={busy} onClick={()=>setManagingPasswords(true)}>管理帳單密碼</button></div>}
 </section></div>
}
// The width below which rows hide their buttons until swiped (index.css); unknown counts as narrow.
// Width of the buttons a left swipe shows (index.css: two 56px buttons).
const SWIPE_WIDTH=112
const clearDrag=(row:HTMLElement)=>{row.removeAttribute('data-dragging');row.style.removeProperty('--swipe');row.style.removeProperty('--swipe-p')}
const narrow=()=>window.matchMedia?.('(max-width: 640px)').matches??true
const monthLabel=(month:string)=>`${month.slice(0,4)} 年 ${Number(month.slice(5,7))} 月`
// A quarter's part name (ledger-2026-Q2) as its months: 2026 年 4–6 月.
const quarterLabel=(part:string)=>{const quarter=Number(part.slice(13));return `${part.slice(7,11)} 年 ${quarter*3-2}–${quarter*3} 月`}

// What the list covers while earlier quarters are not loaded.
const hasEarlier=(ledger:BankLedgerScope)=>!ledger.earlier||ledger.earlier.rows>0
function LedgerScopeNotice({ledger}:{ledger:BankLedgerScope}) {
 const earlier=ledger.earlier
 const rest=!earlier?'捲到底會載入更早的流水':earlier.rows?`捲到底會載入更早的 ${earlier.rows.toLocaleString()} 筆`:'更早的期間沒有銀行流水'
 return <p className="bank-scope" role="status">已載入 <strong>{monthLabel(ledger.from)}</strong>起的流水，{rest}。{hasEarlier(ledger)&&'筆數與篩選只涵蓋已載入的月份。'}</p>
}

// A chosen month whose quarter is being read.
function MonthLoading({month,status,onRetry}:{month:string;status?:string;onRetry:()=>void}) {
 if(status&&status!=='loading')return <div className="bank-load-more banner error" role="alert"><p>{status}</p><button type="button" onClick={onRetry}>重試</button></div>
 return <p className="bank-load-more muted" aria-busy>正在載入 {monthLabel(month)}的流水…</p>
}

// The end of the list while earlier quarters are not loaded: reaching it loads the next one, and
// a list that still ends on screen after that load (a narrow filter) loads the one after.
function LoadEarlier({ledger}:{ledger:BankLedgerScope}) {
 const ref=useRef<HTMLDivElement>(null)
 const loading=ledger.status==='loading',failed=ledger.status&&!loading?ledger.status:''
 const observe=typeof IntersectionObserver!=='undefined'
 const load=useRef(ledger.onLoadEarlier)
 useLayoutEffect(()=>{load.current=ledger.onLoadEarlier})
 // A new observer for each quarter loaded reports at once whether the end is still on screen.
 useEffect(()=>{
  const end=ref.current
  if(!end||loading||failed||!observe)return
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load.current()}},{rootMargin:'200px 0px'})
  observer.observe(end)
  return ()=>observer.disconnect()
 },[ledger.next,loading,failed,observe])
 if(loading)return <p className="bank-load-more muted" aria-busy>正在載入 {quarterLabel(ledger.next)}的流水…</p>
 if(failed)return <div className="bank-load-more banner error" role="alert"><p>{failed}</p><button type="button" onClick={ledger.onLoadEarlier}>重試</button></div>
 return <div ref={ref} className="bank-load-more" data-load-earlier="">{!observe&&<button type="button" onClick={ledger.onLoadEarlier}>載入更早的流水</button>}</div>
}
// The transactions loaded so far; earlier ones not loaded yet (`partial`) are not counted.
const loadedCount=(count:number)=>count?`已載入 ${count} 筆流水`:'已載入的期間沒有流水'
function AccountLabel({account,automatic,count,partial,referenced,busy,onRename,onRemove}:{account:BankTransactionAccount;automatic:boolean;count:number;partial:boolean;referenced:boolean;busy:boolean;onRename:(label:string)=>void;onRemove:()=>void}) {
 const [label,setLabel]=useState(account.label),[editing,setEditing]=useState(false)
 const detail=[account.bank,partial?loadedCount(count):count?`${count} 筆流水`:'沒有流水',automatic&&'依帳單辨識'].filter(Boolean).join(' · ')
 if(editing)return <li className="bank-account editing"><form className="bank-account-rename" onSubmit={e=>{e.preventDefault();if(!busy){onRename(label);setEditing(false)}}}><label className="field"><span>{detail}</span><input aria-label={`帳戶標籤 ${account.id}`} maxLength={100} required autoFocus value={label} disabled={busy} onChange={e=>setLabel(e.target.value)}/></label><button className="primary" disabled={busy}>改名</button><button type="button" onClick={()=>{setLabel(account.label);setEditing(false)}}>取消</button></form></li>
 return <li className="bank-account"><span className="bank-account-name"><strong>{account.label}</strong><span className="muted small">{detail}</span></span><div className="row">{!automatic&&<button disabled={busy} title="改帳戶名稱" aria-label={`編輯帳戶 ${account.id}`} onClick={()=>setEditing(true)}><ActionIcon name="edit"/></button>}<button disabled={busy||referenced} title={referenced?'還有流水或帳單餘額使用這個帳戶，不能刪除':'刪除帳戶'} aria-label={`刪除帳戶 ${account.label}`} onClick={onRemove}><ActionIcon name="delete"/></button></div></li>
}

// `date`: show the day, account and category under the description (the ledger page lists
// rows by month); without it the caller's group heading already says the date and account.
// `showTag`: without `date`, still show the category under the description.
// `onReveal`: on narrow screens the buttons stay hidden until a left swipe (or focus) shows them.
export function BankRecord({row,account,rules,busy=false,date,showTag=false,revealed=false,onReveal,onEdit,onRule}:{row:BankTransaction;account:string;rules:BankCategoryRule[];busy?:boolean;date?:string;showTag?:boolean;revealed?:boolean;onReveal?:(open:boolean)=>void;onEdit?:()=>void;onRule?:()=>void}) {
 const category=classificationLabel(row,rules),direction=row.direction==='debit'?'支出':'入帳',tag=date||showTag?classificationTag(row,rules):null
 // A touch drag moves the row with the finger (--swipe, set without re-rendering); on release
 // it settles open (buttons showing) past half of their width, else closed.
 const drag=useRef<{x:number;y:number;base:number;dx:number;horizontal?:boolean}|null>(null),swiped=useRef(false)
 const swipe:RecordProps|undefined=onReveal&&{
  'data-swipe':'','data-revealed':revealed?'':undefined,
  onPointerDown:e=>{swiped.current=false;drag.current=e.pointerType==='touch'?{x:e.clientX,y:e.clientY,base:revealed?-SWIPE_WIDTH:0,dx:0}:null},
  onPointerMove:e=>{
   const d=drag.current;if(!d)return
   const dx=e.clientX-d.x,dy=e.clientY-d.y
   if(d.horizontal===undefined){if(Math.abs(dx)<8&&Math.abs(dy)<8)return;d.horizontal=Math.abs(dx)>Math.abs(dy);if(!d.horizontal){drag.current=null;return}e.currentTarget.setAttribute('data-dragging','')}
   d.dx=dx;const offset=Math.min(0,Math.max(-SWIPE_WIDTH-24,d.base+dx));e.currentTarget.style.setProperty('--swipe',`${offset}px`);e.currentTarget.style.setProperty('--swipe-p',String(Math.min(1,-offset/SWIPE_WIDTH)))
  },
  onPointerUp:e=>{const d=drag.current;drag.current=null;if(!d?.horizontal)return;swiped.current=true;clearDrag(e.currentTarget);onReveal(d.base+d.dx<-SWIPE_WIDTH/2)},
  onPointerCancel:e=>{drag.current=null;clearDrag(e.currentTarget)},
  // The click that ends a drag, and a tap on a row whose buttons are showing, do not open the row.
  onClickCapture:e=>{const inActions=!!(e.target as HTMLElement).closest('.detail-record-actions');if(swiped.current&&!inActions){swiped.current=false;e.preventDefault();e.stopPropagation();return}swiped.current=false;if(revealed&&narrow()&&!inActions){e.preventDefault();e.stopPropagation();onReveal(false)}},
  onFocusCapture:e=>{if((e.target as HTMLElement).closest('.detail-record-actions'))onReveal(true)},
 }
 return <DetailRecord className="bank-record" title={row.description} label={`查看流水 ${row.id}`} articleProps={swipe}
  subtitle={tag&&<>{date&&<><time dateTime={date}>{Number(date.slice(8))} 日</time><span className="bank-record-account">{account}</span></>}<span className={`tag${tag.tone?` ${tag.tone}`:''}`}>{tag.text}</span></>}
  value={<span className="record-money" data-direction={row.direction} aria-label={`${direction} ${row.currency} ${fmt(row.amount)}`}><small>{row.currency}</small><strong>{row.direction==='credit'?'+':'−'}{fmt(row.amount)}</strong></span>}
  actions={onEdit && onRule && <>
   <button type="button" className="bank-record-rule" data-pending={classifyBankTransaction(row,rules).kind==='pending'||undefined} disabled={busy} aria-label={`分類規則：${category}`} title="編輯匹配規則／新增規則" onClick={onRule}><span className="swipe-icon"><ActionIcon name="tag"/></span></button>
   <button type="button" disabled={busy} aria-label={`編輯流水 ${row.id}`} title="編輯流水" onClick={onEdit}><span className="swipe-icon"><ActionIcon name="edit"/></span></button>
  </>}>
  <p>{row.description}</p><dl className="record-evidence"><dt>日期／帳戶</dt><dd>{row.date} · {account}</dd><dt>分類</dt><dd>{category}</dd></dl>
 </DetailRecord>
}
