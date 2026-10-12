import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BANK_PDF_ERRORS, bankStatementErrorMessage, type BankImportStage } from '../bankStatementErrors'
import { sha256 } from '../expenses'
import { bankCategoryRuleIndex, mergeBankTransactions, prepareBankTransactions, validateBankLedger, type BankTransaction, type BankTransactionAccount, type BankTransactionRow, type BankCategoryRule, type BankRowProvenance } from '../bankTransactions'
import { protectBankText } from '../bankTextPrivacy'
import { unlockStatementPasswords, type StatementPassword } from '../statementPasswords'
import type { BankSection, BankStatementResult } from '../bankStatements'
import { BankRowFields } from './BankTransactionEditor'
import { ActionIcon } from './ActionIcon'
import { fmt } from '../format'
import { BANK_SUMMARY_PENDING, BANK_TEXT_NOTICE, classificationLabel, summarizeBankWarnings } from './bankUiHelpers'

type PreviewRow={draft:BankTransaction;original:BankTransactionRow;provenance:BankRowProvenance;selected:boolean;manual?:boolean;narration?:{leading:string[];trailing:string[]}}
type PreviewSection={id:string;bank:string;currency:string;hash:string;rows:PreviewRow[];accountId:string;newId:string;label:string;noTransactions:boolean;partial:boolean;warnings:ReturnType<typeof summarizeBankWarnings>}
type Review={accounts:BankTransactionAccount[];rows:BankTransaction[];context:BankTransaction[]}
export function BankStatementImport({accounts,existing,rules,passwords,passwordScope,busy,onCancel,onImport,onManagePasswords,onAddRule}: {accounts:BankTransactionAccount[];existing:BankTransaction[];rules:BankCategoryRule[];passwords:StatementPassword[];passwordScope?:string;busy:boolean;onCancel:()=>void;onManagePasswords:()=>void;onAddRule:(row:BankTransaction)=>void;onImport:(review:Review,keep:boolean)=>void}) {
 const [files,setFiles]=useState<File[]>([]),[password,setPassword]=useState(''),[parsing,setParsing]=useState(false),[sections,setSections]=useState<PreviewSection[]>([]),[reports,setReports]=useState<string[]>([]),[error,setError]=useState(''),[review,setReview]=useState<Review|null>(null),[keep,setKeep]=useState(false)
 const controller=useRef<AbortController|null>(null),latest=useRef({accounts,existing,busy})
 useEffect(()=>{latest.current={accounts,existing,busy}},[accounts,existing,busy])
 useEffect(()=>()=>controller.current?.abort(),[])
 const locked=busy||parsing
 function patch(id:string,change:Partial<PreviewSection>){setError('');setSections(list=>list.map(s=>s.id===id?{...s,...change}:s));setReview(null);setKeep(false)}
 function patchRow(id:string,index:number,draft:BankTransaction){setError('');setSections(list=>list.map(s=>s.id===id?{...s,rows:s.rows.map((r,i)=>i===index?{...r,draft}:r)}:s));setReview(null);setKeep(false)}
 async function parse(e:FormEvent){e.preventDefault();if(locked||!files.length)return;if(sections.length && !confirm('重新解析會捨棄目前預覽、手動補登、帳戶映射及選取狀態。確定捨棄並重新解析？'))return;controller.current?.abort();const abort=new AbortController();controller.current=abort;setParsing(true);setError('');setReview(null);const secret=password;setPassword('');const outcomes:string[]=[],next:PreviewSection[]=[]
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
 try{
 const file=files[index];if(file.size>20*1024*1024)throw new Error(BANK_PDF_ERRORS.size)
 const bytes=new Uint8Array(await file.arrayBuffer());if(abort.signal.aborted)return
 if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error(BANK_PDF_ERRORS.format)
 stage='fingerprint';const hash=await sha256(bytes)
 stage='module';const {readBankStatementPdf,parseBankStatement}=await import('../bankStatements')
 stage='open';const document=await readBankStatementPdf(bytes,candidates,abort.signal)
 if(abort.signal.aborted)return
 stage='parse'
 const result:BankStatementResult=parseBankStatement(document.pages)
 stage='preview';const fileReports:string[]=[],fileSections:PreviewSection[]=[]
 fileReports.push(`檔案 ${index+1} · ${result.bank??'未辨識'} · ${result.status==='unsupported'?'不支持／未辨識':result.status==='partial'?'局部覆蓋':'已辨識'} · 有效 ${result.recognizedCount} 筆 · 解析問題事件 ${result.rejectedCount}（不是漏列筆數）`)
 for(const warning of summarizeBankWarnings(result.warnings))fileReports.push(`檔案 ${index+1} · ${warning.text} · ${warning.count} 個事件`)
 result.sections.forEach((s:BankSection)=>{
 const id=crypto.randomUUID();fileReports.push(`檔案 ${index+1} · ${s.currency} 帳戶區段 ${next.length+fileSections.length+1} · ${s.noTransactions?'已證明無交易':`${s.rows.length} 筆已辨識`} ${s.partial?'· 僅局部轉出明細，不是完整月流水':''}`)
 fileSections.push({id,bank:s.bank,currency:s.currency,hash,accountId:'',newId:crypto.randomUUID(),label:'',noTransactions:s.noTransactions,partial:s.partial,warnings:summarizeBankWarnings(s.warnings),rows:s.rows.map(r=>({draft:{id:crypto.randomUUID(),accountId:'',date:r.date,description:protectBankText(r.description),currency:r.currency,direction:r.direction,amount:r.amount},original:{date:r.date,description:protectBankText(r.description)||BANK_SUMMARY_PENDING,currency:r.currency,direction:r.direction,amount:r.amount},provenance:{page:r.page,sectionKey:r.sectionKey,rowKey:r.rowKey},selected:true,
 // Candidates stay preview-only metadata under the same protection as summaries.
 ...(r.ambiguousNarration && {narration:{leading:r.ambiguousNarration.leading.map(t=>protectBankText(t)),trailing:r.ambiguousNarration.trailing.map(t=>protectBankText(t))}})}))})
 })
 // Commit one file only after every section has been prepared successfully.
 next.push(...fileSections);outcomes.push(...fileReports)
 }catch(e){if(abort.signal.aborted)return;outcomes.push(`檔案 ${index+1} · 無法解析：${bankStatementErrorMessage(e,stage).replace(/。$/, '')}。未加入任何此檔資料。`)}
 }
 stage='result'
 if(!abort.signal.aborted){setReports(outcomes);setSections(next);setFiles([])}
 }catch(e){if(!abort.signal.aborted)setError(bankStatementErrorMessage(e,stage))}finally{if(!abort.signal.aborted)setParsing(false)}
 }
 async function prepare(){if(locked)return;const abort=new AbortController();controller.current=abort;setParsing(true);setError('');setKeep(false)
 try{
 const additions:BankTransactionAccount[]=[],rows:BankTransaction[]=[],context:BankTransaction[]=[]
 // Selection accepts the current summary; optional narration stays preview-only.
 if(sections.some(s=>s.rows.some(r=>r.selected&&!protectBankText(r.draft.description))))throw new Error('summary')
 for(const s of sections){if(!s.rows.some(r=>r.selected))continue
 if(!s.accountId)throw new Error('mapping')
 const accountId=s.accountId==='new'?s.newId:s.accountId
 if(s.accountId==='new')additions.push({id:accountId,label:protectBankText(s.label),bank:protectBankText(s.bank)})
 const parsedRows=s.rows.filter(r=>!r.manual),manualRows=s.rows.filter(r=>r.manual)
 // Unchecked rows are occurrence context only: use their parser-original values.
 const prepared=await prepareBankTransactions(parsedRows.map(r=>r.selected?r.draft:{...r.draft,...r.original}),accountId,s.hash,parsedRows.map(r=>r.provenance),{},parsedRows.map(r=>r.original))
 if(abort.signal.aborted)return
 context.push(...prepared);rows.push(...prepared.filter((_,i)=>parsedRows[i].selected))
 // Parsed sections retain full occurrence context; unchecked manual drafts
 // have no source provenance and must not enter validation/merge context.
 manualRows.filter(r=>r.selected).forEach(r=>{const row={...r.draft,accountId,description:protectBankText(r.draft.description)};context.push(row);rows.push(row)})
 }
 if(!rows.length)throw new Error('empty')
 const current=latest.current
 const validated=validateBankLedger([...current.accounts,...additions],[...current.existing,...rows],rules)
 if(!abort.signal.aborted)setReview({accounts:validated.accounts,rows,context})
 }catch(e){if(!abort.signal.aborted)setError(e instanceof Error&&e.message==='summary'?'請填寫已選交易的摘要，或取消勾選該筆。未修改任何資料。':'請明確選擇每個已選區段的獨立帳戶，並檢查標籤及所有交易欄位。未修改任何資料。')}finally{if(!abort.signal.aborted)setParsing(false)}
 }
 let result:ReturnType<typeof mergeBankTransactions>|undefined
 let reviewError=''
 if(review)try{result=mergeBankTransactions(existing,review.rows,review.accounts,review.context,{keepSuspectedDuplicates:keep})}catch{reviewError='無法核對重複，請檢查已選交易與帳戶，或重新檢查映射。未修改任何資料。'}
 const previewCount=sections.reduce((n,s)=>n+s.rows.length,0)
 const selectedCount=sections.reduce((n,s)=>n+s.rows.filter(r=>r.selected).length,0)
 const narrationCount=sections.reduce((n,s)=>n+s.rows.filter(r=>r.selected&&r.narration).length,0)
 return <section className="panel bank-import">
  <div className="panel-head"><h2>匯入銀行帳單</h2><button onClick={()=>{controller.current?.abort();onCancel()}}>取消匯入</button></div>
  <p className="bank-import-intro muted">PDF 在本機解析，不上傳原始文件。核對並匯入後，請按「儲存變更」。</p>
  <details className="bank-help"><summary>支援範圍與資料保護</summary>
   <p className="muted">不保存原始文件、餘額或完整擷取文字；確認後只更新獨立流水。{BANK_TEXT_NOTICE}</p>
   <p>辨識到的交易不代表完整月流水。新加坡星展目前支援 SGD 收支明細；玉山僅局部轉出明細。未知或歧義列不自動推算，請核對並手動補登。</p>
  </details>
  <form onSubmit={parse}>
   <fieldset disabled={locked} className="bank-fields bank-upload-fields">
    <label className="field"><span>銀行帳單 PDF（每份最多 20 MB）</span><input aria-label="銀行帳單 PDF" type="file" multiple accept=".pdf,application/pdf" onChange={e=>{setFiles(Array.from(e.target.files??[]));setPassword('')}}/></label>
    <label className="field"><span>PDF 密碼（選填，多組以逗號分隔）</span><input aria-label="銀行 PDF 密碼" type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label>
   </fieldset>
   <div className="row bank-upload-actions"><button disabled={locked||!files.length} className="primary">{parsing?'正在本機處理…':'解析銀行帳單'}</button>{passwordScope && <button type="button" disabled={locked} onClick={onManagePasswords}>管理帳單密碼</button>}</div>
  </form>
  {reports.length>0 && <details className="bank-import-report" open={reports.some(r=>/無法解析|不支持／未辨識|無法自動讀取|無法在此瀏覽器解鎖/.test(r))||undefined}>
   <summary><span>解析報告</span><span className="muted">{previewCount} 筆 · {sections.length} 個區段</span></summary>
   <ul aria-label="銀行解析結果">{reports.map((r,i)=><li key={i}>{r}</li>)}</ul>
  </details>}
  {sections.map((s,index)=><section key={s.id} className="bank-section" aria-label={`帳戶區段 ${index+1}`}>
   <div className="bank-section-head"><h3>{s.bank}</h3><span className="muted small">{s.currency} · 區段 {index+1} · {s.rows.length} 筆</span></div>
   {s.partial && <p role="status" className="bank-section-note">僅局部紀錄／轉出明細；不是完整月流水。</p>}
   {s.noTransactions && <p>此區段已有無交易證據；不捏造零金額交易。</p>}
   {s.warnings.length>0 && <div role="status" aria-label={`區段 ${index+1} 解析警告`} className="bank-review-flag bank-section-warning">
    <p><strong>需逐筆核對</strong>{s.warnings.some(w=>w.kind==='summary') && '：已辨識交易的摘要可能不完整。'}{s.warnings.some(w=>w.kind==='amount') && '另有未匯入的金額列，請對照原帳單補登。'}{s.warnings.some(w=>w.kind==='scope'||!w.kind) && '請對照原帳單確認區段範圍。'}</p>
    <details className="bank-help"><summary>{s.warnings.reduce((n,w)=>n+w.count,0)} 個解析事件 · 查看說明</summary>
     <p>事件數不是漏列筆數。「摘要可能不完整」表示已辨識列需核對摘要；「未匯入的金額列」不在已辨識筆數內。</p>
     <ul>{s.warnings.map(w=><li key={w.code}>{w.text} · {w.count} 個事件</li>)}</ul>
    </details>
   </div>}
   <div className="bank-fields bank-account-mapping">
    {s.rows.every(r=>r.manual) && <label className="field"><span>銀行名稱</span><input aria-label={`區段 ${index+1} 銀行`} disabled={locked} maxLength={100} value={s.bank} onChange={e=>patch(s.id,{bank:e.target.value})}/></label>}
    <label className="field"><span>選擇獨立流水帳戶</span><select aria-label={`區段 ${index+1} 帳戶`} disabled={locked} value={s.accountId} onChange={e=>patch(s.id,{accountId:e.target.value})}><option value="">請選擇流水帳戶</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.label} · {a.bank}</option>)}<option value="new">新增獨立帳戶標籤</option></select></label>
    {s.accountId==='new' && <label className="field"><span>新帳戶標籤</span><input aria-label={`區段 ${index+1} 新標籤`} disabled={locked} maxLength={100} value={s.label} onChange={e=>patch(s.id,{label:e.target.value})}/></label>}
   </div>
   <div className="bank-preview-list">{s.rows.map((r,i)=>{const category=classificationLabel(r.draft,rules);return <article className="bank-preview-row" key={r.draft.id}>
    <div className="bank-preview-overview">
     <label className="bank-preview-select"><input aria-label={`區段 ${index+1} 選取 ${i+1}`} type="checkbox" disabled={locked} checked={r.selected} onChange={e=>patch(s.id,{rows:s.rows.map((v,j)=>j===i?{...v,selected:e.target.checked}:v)})}/><span className="muted small">{i+1}</span></label>
     <div className="bank-preview-copy"><time className="muted small">{r.draft.date||'日期待填'}</time><strong>{protectBankText(r.draft.description)||'摘要待填'}</strong>
      <div className="bank-preview-tags"><button type="button" className="bank-preview-category" disabled={locked} title="編輯匹配規則／新增規則" aria-label={`區段 ${index+1} 交易 ${i+1} 分類規則`} onClick={()=>onAddRule(r.draft)}><span>{category==='待確認'?'未分類':category}</span><ActionIcon name={bankCategoryRuleIndex(r.draft,rules)>=0?'edit':'add'}/></button>{r.narration && <span className="bank-summary-pending">補充敘述</span>}</div>
     </div>
     <div className="bank-preview-amount"><span className="muted small">{r.draft.direction==='debit'?'支出':'入帳'}</span><strong>{fmt(r.draft.amount)}</strong><span className="muted small">{r.draft.currency}</span></div>
    </div>
    <details className="bank-row-details" open={r.manual||undefined}>
     <summary aria-label={`區段 ${index+1} 交易 ${i+1} 編輯與核對`}><span className="bank-row-expand">編輯交易</span><span className="bank-row-collapse">收合</span><ActionIcon name="edit"/></summary>
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
   <button type="button" className="bank-add-row" disabled={locked} onClick={()=>{const draft:BankTransaction={id:crypto.randomUUID(),accountId:'',date:'',description:'',currency:s.currency,direction:'debit',amount:0};patch(s.id,{noTransactions:false,partial:true,rows:[...s.rows,{draft,original:draft,provenance:{page:1,sectionKey:'manual',rowKey:'manual'},selected:true,manual:true}]})}}>補登此區段交易</button>
  </section>)}
  {(error||reviewError) && <p role="alert" className="banner error">{error||reviewError}</p>}
  <div className="bank-import-actions">
   {!!sections.length && <span className="muted small">已選 {selectedCount}／{previewCount} 筆</span>}
   <button disabled={locked} onClick={()=>{const draft:BankTransaction={id:crypto.randomUUID(),accountId:'',date:'',description:'',currency:'TWD',direction:'debit',amount:0};setSections(list=>[...list,{id:crypto.randomUUID(),bank:'手動輸入',currency:'TWD',hash:'0'.repeat(64),accountId:'',newId:crypto.randomUUID(),label:'',noTransactions:false,partial:true,warnings:[],rows:[{draft,original:draft,provenance:{page:1,sectionKey:'manual',rowKey:'manual'},selected:true,manual:true}]}]);setReview(null)}}>手動補登區段</button>
   {!!sections.length && <button className="primary" disabled={locked} onClick={()=>void prepare()}>檢查映射與重複</button>}
  </div>
  {review && result && <section className="notice bank-import-review" aria-label="銀行重複核對"><p>可新增 {result.added} 筆 · 略過 {result.duplicates} 筆 · 疑似重複 {result.suspectedDuplicates} 筆。跨帳單同值交易沒有銀行 reference 時無法保證準確。</p>{narrationCount>0 && <p>{narrationCount} 筆有補充敘述；確認匯入會使用目前摘要，可返回預覽修改。</p>}{result.suspectedDuplicateRows.length>0 && <><ul>{result.suspectedDuplicateRows.map(r=><li key={r.id}>{r.date} · {r.description} · {r.direction} · {r.currency} {r.amount}</li>)}</ul><label className="bank-summary-check"><input type="checkbox" aria-label="保留疑似重複" disabled={locked} checked={keep} onChange={e=>setKeep(e.target.checked)}/><span>我已核對，保留疑似重複（相同文件位置仍略過）</span></label></>}<button disabled={locked||!result.added} className="primary" onClick={()=>{if(latest.current.busy)return;try{onImport(review,keep)}catch{setError('確認失敗，資料可能已變更；請重新核對。未新增孤兒帳戶。')}}}>確認銀行匯入</button></section>}
 </section>
}
