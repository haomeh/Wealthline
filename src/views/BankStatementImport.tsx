import { bankStatementIdentity, statementAccountLabel, statementBalanceConfirmation, statementLedgerAccount, importStatementBalances, statementBalanceRevision, type StatementBalanceCandidate } from '../bankStatementAssets'
import type { WealthData } from '../model'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BANK_PDF_ERRORS, bankStatementErrorMessage, pdfFormatError, type BankImportStage } from '../bankStatementErrors'
import { sha256 } from '../expenses'
import { bankCategoryRuleIndex, mergeBankTransactions, prepareBankTransactions, validateBankLedger, type BankTransaction, type BankTransactionAccount, type BankTransactionRow, type BankCategoryRule, type BankRowProvenance } from '../bankTransactions'
import { protectBankText } from '../bankTextPrivacy'
import { unlockStatementPasswords, type StatementPassword } from '../statementPasswords'
import type { BankSection, BankStatementResult } from '../bankStatements'
import type { BankPageProgress } from '../statementDocument'
import { BankRowFields } from './BankTransactionEditor'
import { ActionIcon } from './ActionIcon'
import { fmt } from '../format'
import { BANK_SUMMARY_PENDING, BANK_TEXT_NOTICE, bankFileSummary, classificationLabel, summarizeBankWarnings } from './bankUiHelpers'
import { ImportKind, ImportSteps } from './ImportSteps'

type PreviewRow={draft:BankTransaction;original:BankTransactionRow;provenance:BankRowProvenance;selected:boolean;manual?:boolean;narration?:{leading:string[];trailing:string[]}}
type PreviewSection={automatic?:boolean;id:string;bank:string;currency:string;hash:string;rows:PreviewRow[];accountId:string;newId:string;label:string;noTransactions:boolean;partial:boolean;warnings:ReturnType<typeof summarizeBankWarnings>}
type Review={balanceConfirmations:NonNullable<ReturnType<typeof statementBalanceConfirmation>>[];balances:StatementBalanceCandidate[];balanceCount:number;balanceRevision:string;accounts:BankTransactionAccount[];rows:BankTransaction[];context:BankTransaction[]}
type ParseProgress={processed:number;total:number;successes:number;failures:number;currentFile:string;page?:BankPageProgress;complete:boolean}
export function BankStatementImport({data,accounts,existing,rules,passwords,passwordScope,busy,onCancel,onImport,onManagePasswords,onAddRule,onSwitchKind}: {onSwitchKind?:()=>void;data:WealthData;accounts:BankTransactionAccount[];existing:BankTransaction[];rules:BankCategoryRule[];passwords:StatementPassword[];passwordScope?:string;busy:boolean;onCancel:()=>void;onManagePasswords:()=>void;onAddRule:(row:BankTransaction)=>void;onImport:(review:Review,keep:boolean)=>void}) {
 const [files,setFiles]=useState<File[]>([]),[password,setPassword]=useState(''),[parsing,setParsing]=useState(false),[sections,setSections]=useState<PreviewSection[]>([]),[reports,setReports]=useState<string[]>([]),[error,setError]=useState(''),[review,setReview]=useState<Review|null>(null),[keep,setKeep]=useState(false)
 const [balances,setBalances]=useState<(StatementBalanceCandidate & {sectionId:string})[]>([])
 const [preparing,setPreparing]=useState(false),[progress,setProgress]=useState<ParseProgress|null>(null),[sectionIndex,setSectionIndex]=useState(0),[rowPage,setRowPage]=useState(0)
 const controller=useRef<AbortController|null>(null),latest=useRef({accounts,existing,busy,data})
 useEffect(()=>{latest.current={accounts,existing,busy,data}},[accounts,existing,busy,data])
 useEffect(()=>()=>controller.current?.abort(),[])
 const locked=busy||parsing||preparing
 function patch(id:string,change:Partial<PreviewSection>){setError('');setSections(list=>list.map(s=>s.id===id?{...s,...change}:s));setReview(null);setKeep(false)}
 function patchRow(id:string,index:number,draft:BankTransaction){setError('');setSections(list=>list.map(s=>s.id===id?{...s,rows:s.rows.map((r,i)=>i===index?{...r,draft}:r)}:s));setReview(null);setKeep(false)}
 async function parse(e:FormEvent){e.preventDefault();if(locked||!files.length)return;if(sections.length && !confirm('重新解析會捨棄目前預覽、手動補登、帳戶映射及選取狀態。確定捨棄並重新解析？'))return;controller.current?.abort();const abort=new AbortController();controller.current=abort;setParsing(true);setError('');setReview(null);const secret=password;setPassword('');const outcomes:string[]=[],next:PreviewSection[]=[],nextBalances:(StatementBalanceCandidate & {sectionId:string})[]=[]
 let successes=0,failures=0
 setProgress({processed:0,total:files.length,successes,failures,currentFile:'',complete:false})
 let stage:BankImportStage='setup'
 try{
 let stored:Awaited<ReturnType<typeof unlockStatementPasswords>>={values:[],unavailable:0}
 try{stored=await unlockStatementPasswords(passwordScope??'',passwords)}
 catch{if(abort.signal.aborted)return;outcomes.push(BANK_PDF_ERRORS.passwordStore)}
 if(abort.signal.aborted)return
 const candidates=[...stored.values,...secret.split(',').map(x=>x.trim()).filter(Boolean)]
 if(stored.unavailable)outcomes.push(`${stored.unavailable} 組密碼無法在此瀏覽器解鎖，請重新設定或手動輸入。`)
 for(let index=0;index<files.length;index++){
 if(abort.signal.aborted)return
 stage='fileRead'
 // The picker already shows names; the report uses them instead of a position.
 const name=files[index]?.name?.trim()||`檔案 ${index+1}`
 setProgress({processed:index,total:files.length,successes,failures,currentFile:name,complete:false})
 try{
 const file=files[index];if(file.size>20*1024*1024)throw new Error(BANK_PDF_ERRORS.size)
 const bytes=new Uint8Array(await file.arrayBuffer());if(abort.signal.aborted)return
 const formatError=pdfFormatError(bytes);if(formatError)throw new Error(formatError)
 stage='fingerprint';const hash=await sha256(bytes)
 stage='module';const {readBankStatementPdf,parseBankStatement}=await import('../bankStatements')
 stage='open';const document=await readBankStatementPdf(bytes,candidates,abort.signal,page=>{if(!abort.signal.aborted&&controller.current===abort)setProgress(p=>p&&!p.complete&&p.processed===index?{...p,page}:p)})
 if(abort.signal.aborted)return
 stage='parse'
 const result:BankStatementResult=parseBankStatement(document.pages)
 stage='preview';const fileReports:string[]=[],fileSections:PreviewSection[]=[]
 fileReports.push(bankFileSummary(name,result))
 for(const warning of summarizeBankWarnings(result.warnings))fileReports.push(`${name} · ${warning.text} · ${warning.count} 個事件`)
 result.sections.forEach((s:BankSection)=>{
 const identity=bankStatementIdentity(s.bank),available=[...latest.current.accounts,...[...next,...fileSections].filter(p=>p.accountId==='new').map(p=>({id:p.newId,label:p.label,bank:p.bank}))],matched=statementLedgerAccount(s.bank,available)
 const automatic=!!identity&&(!!matched||!available.some(a=>bankStatementIdentity(a.bank)?.label===identity.label))
 const id=crypto.randomUUID();fileReports.push(`${name} · 區段 ${next.length+fileSections.length+1}（${s.currency}）· ${s.noTransactions?'已證明無交易':`${s.rows.length} 筆已辨識`}${s.partial?' · 此版型只列轉出交易，不是完整月流水':''}`)
 fileSections.push({automatic,id,bank:s.bank,currency:s.currency,hash,accountId:automatic?(matched?.id??'new'):'',newId:crypto.randomUUID(),label:identity?statementAccountLabel(s.bank):'',noTransactions:s.noTransactions,partial:s.partial,warnings:summarizeBankWarnings(s.warnings),rows:s.rows.map(r=>({draft:{id:crypto.randomUUID(),accountId:'',date:r.date,description:protectBankText(r.description),currency:r.currency,direction:r.direction,amount:r.amount},original:{date:r.date,description:protectBankText(r.description)||BANK_SUMMARY_PENDING,currency:r.currency,direction:r.direction,amount:r.amount},provenance:{page:r.page,sectionKey:r.sectionKey,rowKey:r.rowKey},selected:true,
 // Candidates stay preview-only metadata under the same protection as summaries.
 ...(r.ambiguousNarration && {narration:{leading:r.ambiguousNarration.leading.map(t=>protectBankText(t)),trailing:r.ambiguousNarration.trailing.map(t=>protectBankText(t))}})}))})
 })
 // Commit one file only after every section has been prepared successfully.
 const fileBalances=(result.balances??[]).map(b=>{const section=fileSections.find(s=>s.bank===b.bank&&s.currency===b.currency);if(!section)throw new Error('balance section');return {...b,fileHash:hash,ledgerAccountId:section.newId,sectionId:section.id}})
 next.push(...fileSections);nextBalances.push(...fileBalances);outcomes.push(...fileReports)
 if(result.status==='unsupported')failures++;else successes++
 }catch(e){if(abort.signal.aborted)return;failures++;outcomes.push(`${name} · 無法解析：${bankStatementErrorMessage(e,stage).replace(/。$/, '')}。未加入任何此檔資料。`)}
 if(abort.signal.aborted)return
 setProgress(p=>p?{...p,processed:index+1,successes,failures}:p)
 if(index+1<files.length)await new Promise<void>(resolve=>setTimeout(resolve,0))
 }
 stage='result'
 if(!abort.signal.aborted){setReports(outcomes);setSections(next);setBalances(nextBalances);setFiles([]);setSectionIndex(0);setRowPage(0);setProgress(p=>p?{...p,currentFile:'',page:undefined,complete:true}:p)}
 }catch(e){if(!abort.signal.aborted)setError(bankStatementErrorMessage(e,stage))}finally{if(!abort.signal.aborted)setParsing(false)}
 }
 async function prepare(){if(locked)return;const abort=new AbortController();controller.current=abort;setPreparing(true);setError('');setKeep(false)
 try{
 const additions:BankTransactionAccount[]=[],rows:BankTransaction[]=[],context:BankTransaction[]=[]
 // Selection accepts the current summary; optional narration stays preview-only.
 if(sections.some(s=>s.rows.some(r=>r.selected&&!protectBankText(r.draft.description))))throw new Error('summary')
 for(const s of sections){if(!s.rows.some(r=>r.selected)&&!balances.some(b=>b.sectionId===s.id))continue
 if(!s.accountId)throw new Error('mapping')
 const accountId=s.accountId==='new'?s.newId:s.accountId
 const owner=s.accountId==='new'?s:sections.find(p=>p.newId===accountId)
 if(owner&&!latest.current.accounts.some(a=>a.id===accountId)&&!additions.some(a=>a.id===accountId))additions.push({id:accountId,label:protectBankText(owner.label),bank:protectBankText(owner.bank)})
 const parsedRows=s.rows.filter(r=>!r.manual),manualRows=s.rows.filter(r=>r.manual)
 // Unchecked rows are occurrence context only: use their parser-original values.
 const prepared=await prepareBankTransactions(parsedRows.map(r=>r.selected?r.draft:{...r.draft,...r.original}),accountId,s.hash,parsedRows.map(r=>r.provenance),{},parsedRows.map(r=>r.original))
 if(abort.signal.aborted)return
 context.push(...prepared);rows.push(...prepared.filter((_,i)=>parsedRows[i].selected))
 // Parsed sections retain full occurrence context; unchecked manual drafts
 // have no source provenance and must not enter validation/merge context.
 manualRows.filter(r=>r.selected).forEach(r=>{const row={...r.draft,accountId,description:protectBankText(r.draft.description)};context.push(row);rows.push(row)})
 }
 const current=latest.current
 // Preview the correspondence, then require one explicit final confirmation before any write.
 const cashBalances=balances.map(({sectionId,...balance})=>{const s=sections.find(s=>s.id===sectionId)!,confirmation=statementBalanceConfirmation(balance.bank,current.data.accounts);return {...balance,ledgerAccountId:s.accountId==='new'?s.newId:s.accountId,...(confirmation&&{confirmedAccountId:confirmation.accountId})}})
 if(!rows.length&&!cashBalances.length)throw new Error('empty')
 const validated=validateBankLedger([...current.accounts,...additions],[...current.existing,...rows],rules)
 const balanceResult=importStatementBalances({...current.data,bankTransactionAccounts:validated.accounts},cashBalances)
 const balanceConfirmations=new Map<string,NonNullable<ReturnType<typeof statementBalanceConfirmation>>>()
 for(const b of balanceResult.data.bankStatementBalances?.slice(current.data.bankStatementBalances?.length??0)??[]){const confirmation=statementBalanceConfirmation(b.bank,current.data.accounts);if(confirmation)balanceConfirmations.set(confirmation.accountId,confirmation)}
 if(!abort.signal.aborted)setReview({accounts:validated.accounts,rows,context,balances:cashBalances,balanceCount:balanceResult.added,balanceRevision:statementBalanceRevision(current.data),balanceConfirmations:[...balanceConfirmations.values()]})
 }catch(e){if(!abort.signal.aborted)setError(e instanceof Error&&['帳單銀行名稱與資產帳戶不同，請先確認對應帳戶。','同日同銀行幣別的帳單餘額不一致，請分批匯入並核對。','同銀行與國家有多個資產帳戶，請先整併帳戶後再匯入餘額。','既有帳單的歷史帳戶與資產帳戶不同，請先核對歷史帳戶後再匯入餘額。','不可補登未來日期'].includes(e.message)?e.message+' 未修改任何資料。':e instanceof Error&&e.message==='summary'?'請填寫已選交易的摘要，或取消勾選該筆。未修改任何資料。':'請明確選擇每個已選區段的獨立帳戶，並檢查標籤及所有交易欄位。未修改任何資料。')}finally{if(!abort.signal.aborted)setPreparing(false)}
 }
 let result:ReturnType<typeof mergeBankTransactions>|undefined
 let reviewError=''
 if(review)try{result=mergeBankTransactions(existing,review.rows,review.accounts,review.context,{keepSuspectedDuplicates:keep})}catch{reviewError='無法核對重複，請檢查已選交易與帳戶，或重新檢查匯入。未修改任何資料。'}
 function finishImport(transactionsOnly=false){if(!review||latest.current.busy)return;try{onImport(transactionsOnly?{...review,balances:[],balanceCount:0,balanceConfirmations:[]}:review,keep)}catch{setError('確認失敗，資料可能已變更；請重新核對。未新增孤兒帳戶。')}}
 const previewCount=sections.reduce((n,s)=>n+s.rows.length,0)
 const selectedCount=sections.reduce((n,s)=>n+s.rows.filter(r=>r.selected).length,0)
 const narrationCount=sections.reduce((n,s)=>n+s.rows.filter(r=>r.selected&&r.narration).length,0)
 const activeSection=sections[Math.min(sectionIndex,Math.max(0,sections.length-1))],previewPages=Math.max(1,Math.ceil((activeSection?.rows.length??0)/50)),currentRowPage=Math.min(rowPage,previewPages-1)
 return <section className="panel bank-import">
  <div className="panel-head"><h2>匯入帳單</h2><ImportSteps step={sections.length ? 2 : 1} /><button onClick={()=>{controller.current?.abort();onCancel()}}>取消匯入</button></div>
  <ImportKind kind="bank" disabled={locked||!!sections.length} onSwitch={onSwitchKind}/>
  <p className="bank-import-intro muted">PDF 在本機解析，不上傳原始文件。核對並匯入後，請按「儲存變更」。</p>
  <details className="bank-help"><summary>支援範圍與資料保護</summary>
   <p className="muted">不保存原始文件或完整擷取文字；確認後保存收支明細，並將已辨識的期末餘額補入資產歷史。{BANK_TEXT_NOTICE}</p>
   <p>辨識到的交易不代表完整月流水。新加坡星展目前支援 SGD 收支明細；玉山舊版綜合對帳單僅局部轉出明細，2023 年起的版型為完整活存明細。Wise 與奈米投記錄的是基金買賣的款項進出。未知或歧義列不自動推算，請核對並手動補登。</p>
  </details>
  <form onSubmit={parse}>
   <fieldset disabled={locked} className="bank-fields bank-upload-fields">
    <label className="field"><span>銀行帳單 PDF（每份最多 20 MB）</span><input aria-label="銀行帳單 PDF" type="file" multiple accept=".pdf,application/pdf" onChange={e=>{setFiles(Array.from(e.target.files??[]));setPassword('')}}/></label>
    <label className="field"><span>PDF 密碼（選填，多組以逗號分隔）</span><input aria-label="銀行 PDF 密碼" type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/><small className="muted">僅供本次解析，不會保存。</small></label>
   </fieldset>
   <div className="row bank-upload-actions"><button disabled={locked||!files.length} className="primary">{parsing?'正在本機處理…':'解析銀行帳單'}</button>{passwordScope && <button type="button" disabled={locked} onClick={onManagePasswords}>管理帳單密碼</button>}</div>
  </form>
  {progress && <div className="notice bank-progress" role="status" aria-label="銀行解析進度" aria-live="polite"><progress value={progress.processed} max={progress.total} aria-label="銀行檔案處理進度"/><p>{progress.complete?'處理完成':'正在本機處理'} · {progress.processed}／{progress.total} 份 · {Math.floor(progress.processed/progress.total*100)}% · 成功 {progress.successes} 份 · 失敗 {progress.failures} 份（含未辨識）</p>{progress.currentFile && <p>目前檔案：{progress.currentFile}{progress.page && ` · ${progress.page.completed}／${progress.page.total} 頁完成文字擷取`}</p>}{progress.complete && <p>{previewCount} 筆預覽 · {previewCount||balances.length?'待核對匯入。':'沒有可匯入的預覽，請核對報告或手動補登。'}100% 表示檔案處理結束，尚未匯入或儲存；請檢查解析報告。</p>}</div>}
  {preparing && <p role="status" className="muted">正在準備重複交易與餘額核對…</p>}
  {reports.length>0 && <details className="bank-import-report" open={reports.some(r=>/無法解析|不支援／未辨識|無法自動讀取|無法在此瀏覽器解鎖/.test(r))||undefined}>
   <summary><span>解析報告</span><span className="muted">{previewCount} 筆 · {sections.length} 個區段</span></summary>
   <ul aria-label="銀行解析結果">{reports.map((r,i)=><li key={i}>{r}</li>)}</ul>
  </details>}
  {balances.length>0 && <section className="notice bank-closing-balances" aria-label="帳單期末餘額"><h3>補入資產歷史</h3><p className="muted small">只補入帳單日期的現金餘額；目前持倉不變，其他資產不推算。</p>{balances.map((b,i)=>{const confirmation=statementBalanceConfirmation(b.bank,data.accounts);return <div key={i}><p><strong>{statementAccountLabel(b.bank)}</strong> · {b.date} · {b.currency==='TWD'?'NT$':b.currency} {fmt(b.quantity,2)}</p>{confirmation && <p className="muted small">既有資產帳戶為 {confirmation.assetLabel}，補登前會請你確認對應。</p>}</div>})}</section>}
  {!!sections.length && <div className="bank-preview-navigation"><p className="muted" aria-label="銀行預覽總計">已選 {selectedCount}／{previewCount} 筆 · 共 {sections.length} 個區段，請逐一核對。</p><label className="field"><span>帳戶區段</span><select aria-label="銀行預覽區段" disabled={locked} value={sectionIndex} onChange={e=>{setSectionIndex(Number(e.target.value));setRowPage(0)}}>{sections.map((s,i)=><option value={i} key={s.id}>區段 {i+1} · {statementAccountLabel(s.bank)} · {s.currency} · {s.rows.filter(r=>r.selected).length}／{s.rows.length} 筆已選{s.warnings.length?' · 有解析警告':''}</option>)}</select></label><nav className="bank-pagination" aria-label="銀行預覽分頁"><button type="button" aria-label="銀行預覽上一頁" disabled={locked||currentRowPage===0} onClick={()=>setRowPage(currentRowPage-1)}>上一頁</button><span>第 {currentRowPage+1}／{previewPages} 頁 · 每頁最多 50 筆</span><button type="button" aria-label="銀行預覽下一頁" disabled={locked||currentRowPage+1===previewPages} onClick={()=>setRowPage(currentRowPage+1)}>下一頁</button></nav></div>}
  {sections.map((s,index)=>index===sectionIndex&&<section key={s.id} className="bank-section" aria-label={`帳戶區段 ${index+1}`}>
   <div className="bank-section-head"><h3>{statementAccountLabel(s.bank)}</h3><span className="muted small">{s.currency} · 區段 {index+1} · {s.rows.length} 筆</span></div>
   {s.partial && <p role="status" className="bank-section-note">僅局部紀錄／轉出明細；不是完整月流水。</p>}
   {s.noTransactions && <p>此區段已有無交易證據；不捏造零金額交易。</p>}
   {s.warnings.length>0 && <div role="status" aria-label={`區段 ${index+1} 解析警告`} className="bank-review-flag bank-section-warning">
    <p><strong>需逐筆核對</strong>{s.warnings.some(w=>w.kind==='summary') && '：已辨識交易的摘要可能不完整。'}{s.warnings.some(w=>w.kind==='amount') && '另有未匯入的金額列，請對照原帳單補登。'}{s.warnings.some(w=>w.kind==='scope'||!w.kind) && '請對照原帳單確認區段範圍。'}</p>
    <details className="bank-help"><summary>{s.warnings.reduce((n,w)=>n+w.count,0)} 個解析事件 · 查看說明</summary>
     <p>事件數不是漏列筆數。「摘要可能不完整」表示已辨識列需核對摘要；「未匯入的金額列」不在已辨識筆數內。</p>
     <ul>{s.warnings.map(w=><li key={w.code}>{w.text} · {w.count} 個事件</li>)}</ul>
    </details>
   </div>}
   {s.automatic ? <p className="bank-section-note">自動記入 {statementAccountLabel(s.bank)}，同銀行與國家沿用既有流水。</p> : <div className="bank-fields bank-account-mapping">
    {s.rows.every(r=>r.manual) && <label className="field"><span>銀行名稱</span><input aria-label={`區段 ${index+1} 銀行`} disabled={locked} maxLength={100} value={s.bank} onChange={e=>patch(s.id,{bank:e.target.value})}/></label>}
    <label className="field"><span>選擇獨立流水帳戶</span><select aria-label={`區段 ${index+1} 帳戶`} disabled={locked} value={s.accountId} onChange={e=>patch(s.id,{accountId:e.target.value})}><option value="">請選擇流水帳戶</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.label} · {a.bank}</option>)}<option value="new">新增獨立帳戶標籤</option></select></label>
    {s.accountId==='new' && <label className="field"><span>新帳戶標籤</span><input aria-label={`區段 ${index+1} 新標籤`} disabled={locked} maxLength={100} value={s.label} onChange={e=>patch(s.id,{label:e.target.value})}/></label>}
   </div>}
   <div className="bank-preview-list">{s.rows.slice(currentRowPage*50,(currentRowPage+1)*50).map((r,offset)=>{const i=currentRowPage*50+offset,category=classificationLabel(r.draft,rules);return <article className="bank-preview-row" key={r.draft.id}>
    <div className="bank-preview-overview">
     <label className="bank-preview-select"><input aria-label={`區段 ${index+1} 選取 ${i+1}`} type="checkbox" disabled={locked} checked={r.selected} onChange={e=>patch(s.id,{rows:s.rows.map((v,j)=>j===i?{...v,selected:e.target.checked}:v)})}/><span className="muted small">{i+1}</span></label>
     <div className="bank-preview-copy"><time className="muted small">{r.draft.date||'日期待填'}</time><strong title={protectBankText(r.draft.description)||undefined}>{protectBankText(r.draft.description)||'摘要待填'}</strong>
      <div className="bank-preview-tags"><button type="button" className="bank-preview-category" disabled={locked} title="編輯匹配規則／新增規則" aria-label={`區段 ${index+1} 交易 ${i+1} 分類規則`} onClick={()=>onAddRule(r.draft)}><span>{category}</span><ActionIcon name={bankCategoryRuleIndex(r.draft,rules)>=0?'edit':'add'}/></button>{r.narration && <span className="bank-summary-pending">補充敘述</span>}</div>
     </div>
     <div className="bank-preview-amount"><span className="muted small">{r.draft.direction==='debit'?'支出':'入帳'}</span><strong>{fmt(r.draft.amount)}</strong><span className="muted small">{r.draft.currency}</span></div>
    </div>
    <details className="bank-row-details" open={r.manual||undefined}>
     <summary title="編輯交易" aria-label={`區段 ${index+1} 交易 ${i+1} 編輯與核對`}><span className="bank-row-expand">編輯交易</span><span className="bank-row-collapse">收合</span><ActionIcon name="edit"/></summary>
     <div className="bank-row-editor">
      <BankRowFields prefix={`區段 ${index+1} 交易 ${i+1} `} row={r.draft} onChange={draft=>patchRow(s.id,i,draft)} disabled={locked} rules={rules}/>
      {r.narration && <div className="bank-review-flag bank-narration" role="group" aria-label={`區段 ${index+1} 交易 ${i+1} 摘要歸屬`}>
       <p><strong>補充敘述</strong>：可對照原帳單，將屬於本筆的內容加入摘要。</p>
       <details className="bank-help"><summary>為什麼沒有自動加入？</summary><p>這些敘述緊鄰本筆，可能屬於本筆或相鄰交易，因此不自動併入摘要，也不用於自動分類。匯入時會使用目前的摘要。</p></details>
       <ul>{[...r.narration.leading.map(text=>({text,lead:true})),...r.narration.trailing.map(text=>({text,lead:false}))].map((c,k)=><li key={k}>
        <div><span className="muted small">{c.lead?'本筆之前':'本筆之後'}</span><span className="bank-candidate-text">{c.text}</span></div>
        <button type="button" disabled={locked} title="加入本筆摘要" aria-label={`區段 ${index+1} 交易 ${i+1} 加入候選 ${k+1}`} onClick={()=>patchRow(s.id,i,{...r.draft,description:(c.lead?`${c.text} ${r.draft.description}`:`${r.draft.description} ${c.text}`).trim()})}><ActionIcon name="add"/><span>加入</span></button>
       </li>)}</ul>
      </div>}
     </div>
    </details>
   </article>})}</div>
   <button type="button" className="bank-add-row" disabled={locked} onClick={()=>{const draft:BankTransaction={id:crypto.randomUUID(),accountId:'',date:'',description:'',currency:s.currency,direction:'debit',amount:0};patch(s.id,{noTransactions:false,partial:true,rows:[...s.rows,{draft,original:draft,provenance:{page:1,sectionKey:'manual',rowKey:'manual'},selected:true,manual:true}]});setRowPage(Math.floor(s.rows.length/50))}}>補登此區段交易</button>
  </section>)}
  {(error||reviewError) && <p role="alert" className="banner error">{error||reviewError}</p>}
  <div className="bank-import-actions">
   {!!sections.length && <span className="muted small">已選 {selectedCount}／{previewCount} 筆</span>}
   <button disabled={locked} onClick={()=>{const draft:BankTransaction={id:crypto.randomUUID(),accountId:'',date:'',description:'',currency:'TWD',direction:'debit',amount:0};setSections(list=>[...list,{id:crypto.randomUUID(),bank:'手動輸入',currency:'TWD',hash:'0'.repeat(64),accountId:'',newId:crypto.randomUUID(),label:'',noTransactions:false,partial:true,warnings:[],rows:[{draft,original:draft,provenance:{page:1,sectionKey:'manual',rowKey:'manual'},selected:true,manual:true}]}]);setReview(null);setSectionIndex(sections.length);setRowPage(0)}}>手動補登區段</button>
   {!!sections.length && <button className="primary" disabled={locked} onClick={()=>void prepare()}>檢查匯入</button>}
  </div>
  {review && result && <section className="notice bank-import-review" aria-label="銀行重複核對">{review.balances.length>0 && <p>期末餘額可補入 {review.balanceCount} 筆 · 已匯入的帳單餘額會略過。</p>}<p>可新增 {result.added} 筆 · 略過 {result.duplicates} 筆 · 疑似重複 {result.suspectedDuplicates} 筆。跨帳單同值交易沒有銀行 reference 時無法保證準確。</p>{narrationCount>0 && <p>{narrationCount} 筆有補充敘述；確認匯入會使用目前摘要，可返回預覽修改。</p>}{result.suspectedDuplicateRows.length>0 && <><ul>{result.suspectedDuplicateRows.map(r=><li key={r.id}>{r.date} · {r.description} · {r.direction} · {r.currency} {r.amount}</li>)}</ul><label className="bank-summary-check"><input type="checkbox" aria-label="保留疑似重複" disabled={locked} checked={keep} onChange={e=>setKeep(e.target.checked)}/><span>我已核對，保留疑似重複（相同文件位置仍略過）</span></label></>}{review.balanceConfirmations.length>0 && <div aria-label="餘額帳戶對應"><p><strong>銀行名稱不同，請確認是同一個帳戶</strong></p><ul>{review.balanceConfirmations.map(c=><li key={c.accountId}><strong>{c.statementLabel}</strong> → {c.assetLabel}</li>)}</ul><p className="muted small">確認後補入右側帳戶的歷史餘額；既有帳戶名稱不變。若不是同一帳戶，可先只匯入流水。</p></div>}<div className="row bank-import-confirm-actions">{review.balanceConfirmations.length>0 && result.added>0 && <button disabled={locked} onClick={()=>finishImport(true)}>只匯入流水</button>}<button disabled={locked||(!result.added&&!review.balanceCount)} className="primary" onClick={()=>finishImport()}>{review.balanceConfirmations.length?'確認對應並匯入':'確認銀行匯入'}</button></div></section>}
 </section>
}
