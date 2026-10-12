import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BANK_PDF_ERRORS, bankStatementErrorMessage } from '../bankStatementErrors'
import { sha256 } from '../expenses'
import { mergeBankTransactions, prepareBankTransactions, validateBankLedger, type BankTransaction, type BankTransactionAccount, type BankTransactionRow, type BankCategoryRule, type BankRowProvenance } from '../bankTransactions'
import { protectBankText } from '../bankTextPrivacy'
import { unlockStatementPasswords, type StatementPassword } from '../statementPasswords'
import type { BankSection, BankStatementResult } from '../bankStatements'
import { BankRowFields } from './BankTransactionEditor'
import { BANK_SUMMARY_PENDING, BANK_TEXT_NOTICE, classificationLabel, summarizeBankWarnings } from './bankUiHelpers'

type PreviewRow={draft:BankTransaction;original:BankTransactionRow;provenance:BankRowProvenance;selected:boolean;manual?:boolean;narration?:{leading:string[];trailing:string[]};confirmed?:boolean}
type PreviewSection={id:string;bank:string;currency:string;hash:string;rows:PreviewRow[];accountId:string;newId:string;label:string;noTransactions:boolean;partial:boolean;warnings:ReturnType<typeof summarizeBankWarnings>}
type Review={accounts:BankTransactionAccount[];rows:BankTransaction[];context:BankTransaction[]}
export function BankStatementImport({accounts,existing,rules,passwords,passwordScope,busy,onCancel,onImport,onManagePasswords,onAddRule}: {accounts:BankTransactionAccount[];existing:BankTransaction[];rules:BankCategoryRule[];passwords:StatementPassword[];passwordScope?:string;busy:boolean;onCancel:()=>void;onManagePasswords:()=>void;onAddRule:(row:BankTransaction)=>void;onImport:(review:Review,keep:boolean)=>void}) {
 const [files,setFiles]=useState<File[]>([]),[password,setPassword]=useState(''),[parsing,setParsing]=useState(false),[sections,setSections]=useState<PreviewSection[]>([]),[reports,setReports]=useState<string[]>([]),[error,setError]=useState(''),[review,setReview]=useState<Review|null>(null),[keep,setKeep]=useState(false)
 const controller=useRef<AbortController|null>(null),latest=useRef({accounts,existing,busy})
 useEffect(()=>{latest.current={accounts,existing,busy}},[accounts,existing,busy])
 useEffect(()=>()=>controller.current?.abort(),[])
 const locked=busy||parsing
 function patch(id:string,change:Partial<PreviewSection>){setError('');setSections(list=>list.map(s=>s.id===id?{...s,...change}:s));setReview(null);setKeep(false)}
 function patchRow(id:string,index:number,draft:BankTransaction){setError('');setSections(list=>list.map(s=>s.id===id?{...s,rows:s.rows.map((r,i)=>i===index?{...r,draft,confirmed:r.confirmed&&draft.description===r.draft.description}:r)}:s));setReview(null);setKeep(false)}
 async function parse(e:FormEvent){e.preventDefault();if(locked||!files.length)return;if(sections.length && !confirm('重新解析會捨棄目前預覽、手動補登、帳戶映射及選取狀態。確定捨棄並重新解析？'))return;controller.current?.abort();const abort=new AbortController();controller.current=abort;setParsing(true);setError('');setReview(null);const secret=password;setPassword('');const outcomes:string[]=[],next:PreviewSection[]=[]
 try{
 const stored=await unlockStatementPasswords(passwordScope??'',passwords)
 if(abort.signal.aborted)return
 const candidates=[...stored.values,...secret.split(',').map(x=>x.trim()).filter(Boolean)]
 if(stored.unavailable)outcomes.push(`${stored.unavailable} 組密碼無法在此瀏覽器解鎖，請重新設定或手動輸入。`)
 const {readBankStatementPdf,parseBankStatement}=await import('../bankStatements')
 for(let index=0;index<files.length;index++){
 if(abort.signal.aborted)return
 try{
 const file=files[index];if(file.size>20*1024*1024)throw new Error(BANK_PDF_ERRORS.size)
 const bytes=new Uint8Array(await file.arrayBuffer());if(abort.signal.aborted)return
 if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw new Error(BANK_PDF_ERRORS.format)
 const hash=await sha256(bytes),document=await readBankStatementPdf(bytes,candidates,abort.signal)
 if(abort.signal.aborted)return
 const result:BankStatementResult=parseBankStatement(document.pages)
 outcomes.push(`檔案 ${index+1} · ${result.bank??'未辨識'} · ${result.status==='unsupported'?'不支持／未辨識':result.status==='partial'?'局部覆蓋':'已辨識'} · 有效 ${result.recognizedCount} 筆 · 解析問題事件 ${result.rejectedCount}（不是漏列筆數）`)
 for(const warning of summarizeBankWarnings(result.warnings))outcomes.push(`檔案 ${index+1} · ${warning.text} · ${warning.count} 個事件`)
 result.sections.forEach((s:BankSection)=>{
 const id=crypto.randomUUID();outcomes.push(`檔案 ${index+1} · ${s.currency} 帳戶區段 ${next.length+1} · ${s.noTransactions?'已證明無交易':`${s.rows.length} 筆已辨識`} ${s.partial?'· 僅局部轉出明細，不是完整月流水':''}`)
 next.push({id,bank:s.bank,currency:s.currency,hash,accountId:'',newId:crypto.randomUUID(),label:'',noTransactions:s.noTransactions,partial:s.partial,warnings:summarizeBankWarnings(s.warnings),rows:s.rows.map(r=>({draft:{id:crypto.randomUUID(),accountId:'',date:r.date,description:protectBankText(r.description),currency:r.currency,direction:r.direction,amount:r.amount},original:{date:r.date,description:protectBankText(r.description)||BANK_SUMMARY_PENDING,currency:r.currency,direction:r.direction,amount:r.amount},provenance:{page:r.page,sectionKey:r.sectionKey,rowKey:r.rowKey},selected:true,
 // Candidates stay preview-only metadata under the same protection as summaries.
 ...(r.ambiguousNarration && {narration:{leading:r.ambiguousNarration.leading.map(t=>protectBankText(t)),trailing:r.ambiguousNarration.trailing.map(t=>protectBankText(t))}})}))})
 })
 }catch(e){if(abort.signal.aborted)return;outcomes.push(`檔案 ${index+1} · 無法解析：${bankStatementErrorMessage(e).replace(/。$/, '')}。未加入任何此檔資料。`)}
 }
 if(!abort.signal.aborted){setReports(outcomes);setSections(next);setFiles([])}
 }catch{if(!abort.signal.aborted)setError('無法解鎖或讀取帳單，請重新設定密碼或手動輸入。')}finally{if(!abort.signal.aborted)setParsing(false)}
 }
 async function prepare(){if(locked)return;const abort=new AbortController();controller.current=abort;setParsing(true);setError('');setKeep(false)
 try{
 const additions:BankTransactionAccount[]=[],rows:BankTransaction[]=[],context:BankTransaction[]=[]
 // Conservative: a selected row with unowned narration needs a non-empty, explicitly confirmed summary.
 if(sections.some(s=>s.rows.some(r=>r.selected&&r.narration&&(!r.confirmed||!protectBankText(r.draft.description)))))throw new Error('narration')
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
 }catch(e){if(!abort.signal.aborted)setError(e instanceof Error&&e.message==='narration'?'已選交易的摘要歸屬尚未確認：請逐筆核對候選敘述、填寫摘要並勾選確認，或取消勾選該筆。未修改任何資料。':'請明確選擇每個已選區段的獨立帳戶，並檢查標籤及所有交易欄位。未修改任何資料。')}finally{if(!abort.signal.aborted)setParsing(false)}
 }
 let result:ReturnType<typeof mergeBankTransactions>|undefined
 let reviewError=''
 if(review)try{result=mergeBankTransactions(existing,review.rows,review.accounts,review.context,{keepSuspectedDuplicates:keep})}catch{reviewError='無法核對重複，請檢查已選交易與帳戶，或重新檢查映射。未修改任何資料。'}
 return <section className="panel bank-import"><div className="panel-head"><h2>匯入銀行帳單</h2><button onClick={()=>{controller.current?.abort();onCancel()}}>取消匯入</button></div>
 <p className="muted">本機 PDF 解析；不保存原始文件、餘額或完整擷取文字。確認後只更新獨立流水，仍需按「儲存變更」。{BANK_TEXT_NOTICE}</p><p className="notice">辨識到的交易不代表完整月流水。星展交易版型尚未支持；玉山僅局部轉出明細。未知或歧義列不自動推算，請核對並手動補登。解析問題事件數不是漏列筆數；「摘要可能不完整」指已匯入列需核對摘要，「未匯入的金額列」指該金額不在已辨識筆數內。</p>
 <form onSubmit={parse}><fieldset disabled={locked} className="bank-fields"><label className="field"><span>銀行帳單 PDF（每份最多 20 MB）</span><input aria-label="銀行帳單 PDF" type="file" multiple accept=".pdf,application/pdf" onChange={e=>{setFiles(Array.from(e.target.files??[]));setPassword('')}}/></label><label className="field"><span>PDF 密碼（多組以逗號分隔）</span><input aria-label="銀行 PDF 密碼" type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)}/></label></fieldset><div className="row"><button disabled={locked||!files.length} className="primary">{parsing?'正在本機處理…':'解析銀行帳單'}</button>{passwordScope && <button type="button" disabled={locked} onClick={onManagePasswords}>管理帳單密碼</button>}</div></form>
 {reports.length>0 && <ul aria-label="銀行解析結果" className="notice">{reports.map((r,i)=><li key={i}>{r}</li>)}</ul>}
 {sections.map((s,index)=><section key={s.id} className="bank-section" aria-label={`帳戶區段 ${index+1}`}><h3>{s.bank} · {s.currency} · 帳戶區段 {index+1}</h3>{s.partial && <p role="status">僅局部紀錄／轉出明細；不是完整月流水。</p>}{s.noTransactions && <p>此區段已有無交易證據；不捏造零金額交易。</p>}{s.warnings.length>0 && <div role="status" aria-label={`區段 ${index+1} 解析警告`} className="bank-review-flag"><p>需逐筆核對：此區段有 {s.warnings.reduce((n,w)=>n+w.count,0)} 個解析問題事件（事件數不是漏列筆數）。{s.warnings.some(w=>w.kind==='summary') && '已辨識交易的摘要可能不完整，請逐筆核對下列交易。'}{s.warnings.some(w=>w.kind==='amount') && '另有未匯入的金額列，已辨識筆數不涵蓋該金額，請對照原帳單補登。'}</p><ul>{s.warnings.map(w=><li key={w.code}>{w.text} · {w.count} 個事件</li>)}</ul></div>}<div className="bank-fields">{s.rows.every(r=>r.manual) && <label className="field"><span>銀行名稱</span><input aria-label={`區段 ${index+1} 銀行`} disabled={locked} maxLength={100} value={s.bank} onChange={e=>patch(s.id,{bank:e.target.value})}/></label>}<label className="field"><span>選擇獨立流水帳戶</span><select aria-label={`區段 ${index+1} 帳戶`} disabled={locked} value={s.accountId} onChange={e=>patch(s.id,{accountId:e.target.value})}><option value="">請明確選擇（不可自動合併）</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.label} · {a.bank}</option>)}<option value="new">新增獨立帳戶標籤</option></select></label>{s.accountId==='new' && <label className="field"><span>新帳戶標籤</span><input aria-label={`區段 ${index+1} 新標籤`} disabled={locked} maxLength={100} value={s.label} onChange={e=>patch(s.id,{label:e.target.value})}/></label>}</div>
 {s.rows.map((r,i)=><article className="bank-preview-row" key={r.draft.id}><label><input aria-label={`區段 ${index+1} 選取 ${i+1}`} type="checkbox" disabled={locked} checked={r.selected} onChange={e=>{patch(s.id,{rows:s.rows.map((v,j)=>j===i?{...v,selected:e.target.checked}:v)})}}/>交易 {i+1} · {classificationLabel(r.draft,rules)}</label><BankRowFields prefix={`區段 ${index+1} 交易 ${i+1} `} row={r.draft} onChange={draft=>patchRow(s.id,i,draft)} disabled={locked} rules={rules}/>{r.narration && <div className="bank-review-flag" role="group" aria-label={`區段 ${index+1} 交易 ${i+1} 摘要歸屬`}><p><strong>摘要待確認</strong>：下列敘述行在帳單上緊鄰本筆，無法判定屬於本筆或相鄰交易，未自動併入摘要、也不用於自動分類。請對照原帳單，把屬於本筆的內容加入或直接修改摘要後勾選確認；未確認的已選交易不能匯入。</p><ul>{[...r.narration.leading.map(text=>({text,lead:true})),...r.narration.trailing.map(text=>({text,lead:false}))].map((c,k)=><li key={k}>{c.lead?'本筆之前':'本筆之後'}：{c.text} <button type="button" disabled={locked} aria-label={`區段 ${index+1} 交易 ${i+1} 加入候選 ${k+1}`} onClick={()=>patchRow(s.id,i,{...r.draft,description:(c.lead?`${c.text} ${r.draft.description}`:`${r.draft.description} ${c.text}`).trim()})}>加入本筆摘要</button></li>)}</ul><label><input type="checkbox" aria-label={`區段 ${index+1} 交易 ${i+1} 確認摘要`} disabled={locked} checked={!!r.confirmed} onChange={e=>patch(s.id,{rows:s.rows.map((v,j)=>j===i?{...v,confirmed:e.target.checked}:v)})}/>我已核對原帳單，確認本筆摘要</label></div>}<button disabled={locked} onClick={()=>onAddRule(r.draft)}>編輯匹配規則／新增規則</button></article>)}
 <button disabled={locked} onClick={()=>{const draft:BankTransaction={id:crypto.randomUUID(),accountId:'',date:'',description:'',currency:s.currency,direction:'debit',amount:0};patch(s.id,{noTransactions:false,partial:true,rows:[...s.rows,{draft,original:draft,provenance:{page:1,sectionKey:'manual',rowKey:'manual'},selected:true,manual:true}]})}}>補登此區段交易</button></section>)}
 {(error||reviewError) && <p role="alert" className="banner error">{error||reviewError}</p>}
 <button disabled={locked} onClick={()=>{const draft:BankTransaction={id:crypto.randomUUID(),accountId:'',date:'',description:'',currency:'TWD',direction:'debit',amount:0};setSections(list=>[...list,{id:crypto.randomUUID(),bank:'手動輸入',currency:'TWD',hash:'0'.repeat(64),accountId:'',newId:crypto.randomUUID(),label:'',noTransactions:false,partial:true,warnings:[],rows:[{draft,original:draft,provenance:{page:1,sectionKey:'manual',rowKey:'manual'},selected:true,manual:true}]}]);setReview(null)}}>手動補登區段</button>
 {!!sections.length && <button disabled={locked} onClick={()=>void prepare()}>檢查映射與重複</button>}
 {review && result && <section className="notice" aria-label="銀行重複核對"><p>可新增 {result.added} 筆 · 略過 {result.duplicates} 筆 · 疑似重複 {result.suspectedDuplicates} 筆。跨帳單同值交易沒有銀行 reference 時無法保證準確。</p>{result.suspectedDuplicateRows.length>0 && <><ul>{result.suspectedDuplicateRows.map(r=><li key={r.id}>{r.date} · {r.description} · {r.direction} · {r.currency} {r.amount}</li>)}</ul><label><input type="checkbox" aria-label="保留疑似重複" disabled={locked} checked={keep} onChange={e=>setKeep(e.target.checked)}/>我已核對，保留疑似重複（相同文件位置仍略過）</label></>}<button disabled={locked||!result.added} className="primary" onClick={()=>{if(latest.current.busy)return;try{onImport(review,keep)}catch{setError('確認失敗，資料可能已變更；請重新核對。未新增孤兒帳戶。')}}}>確認銀行匯入</button></section>}
 </section>
}
