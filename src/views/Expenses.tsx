import { useEffect, useRef, useState, type FormEvent } from 'react'
import { mergeExpenses, isUnrecognizedMerchant, parseExpense, prepareExpenses, sha256, expenseCategory, parseExpenseCategoryRules, EXPENSE_CATEGORIES, type ExpenseCategoryRule, type ExpenseCategory, type Expense } from '../expenses'
import { assertCreditCardFile, parseStatement, statementMetadata } from '../statements'
import { fmt } from '../format'
import { ExpenseCategoryRules, CategoryRuleButton, CategoryRuleDialog } from './ExpenseCategoryRules'
import { StatementPasswordSettings } from './StatementPasswordSettings'
import { parseStatementPasswords, statementPasswordStatus, unlockStatementPasswords, type StatementPassword } from '../statementPasswords'
import type { WealthData } from '../model'

export function Expenses({data,onChange,busy,passwordScope}: {passwordScope?:string;data:WealthData;onChange:(next:WealthData)=>void;busy:boolean}) {
  const [importing,setImporting] = useState(false)
  const [editing,setEditing] = useState<Expense|null>(null)
  const [message,setMessage] = useState('')
  const [managingPasswords,setManagingPasswords] = useState(false)
  const [ruleExpense,setRuleExpense] = useState<{expense:Expense;index?:number}|null>(null)
  const expenses = data.expenses ?? []
  const rules = data.expenseCategoryRules ?? []
  const passwords = data.statementPasswords ?? []
  const passwordDialog = managingPasswords && passwordScope && <StatementPasswordSettings scope={passwordScope} passwords={passwords} busy={busy} onClose={()=>setManagingPasswords(false)} onSave={p=>onChange({...data,version:12,statementPasswords:parseStatementPasswords(passwords.some(x=>x.id===p.id)?passwords.map(x=>x.id===p.id?p:x):[...passwords,p])})} onRemove={id=>onChange({...data,version:12,statementPasswords:passwords.filter(p=>p.id!==id)})}/>

  const ruleDialog = ruleExpense && <CategoryRuleDialog expense={ruleExpense.expense} rule={ruleExpense.index===undefined?undefined:rules[ruleExpense.index]} busy={busy} onCancel={()=>setRuleExpense(null)} onSave={rule=>{
    onChange({...data,version:data.version===12 || data.statementPasswords!==undefined ? 12 : 11,expenseCategoryRules:parseExpenseCategoryRules(ruleExpense.index===undefined?[...rules,rule]:rules.map((r,i)=>i===ruleExpense.index?rule:r))})
    setRuleExpense(null)
  }}/>
  if(importing) return <>{ruleDialog}{passwordDialog}<StatementImport passwords={passwords} passwordScope={passwordScope} onManagePasswords={()=>setManagingPasswords(true)} onAddRule={(expense,index)=>setRuleExpense({expense,index})} rules={rules} existing={expenses} busy={busy} onCancel={()=>setImporting(false)} onImport={(rows,context)=>{
    const result = mergeExpenses(expenses,rows,context)
    if(result.added) onChange({...data,version:data.version===12 || data.statementPasswords!==undefined ? 12 : data.version===11 || data.expenseCategoryRules!==undefined ? 11 : 10,expenses:result.expenses})
    setMessage(`已加入 ${result.added} 筆，略過 ${result.duplicates} 筆重複。`)
    setImporting(false)
  }}/></>
  if(editing) return <ExpenseEditor rules={rules} expense={editing} busy={busy} onCancel={()=>setEditing(null)} onSave={expense=>{
    onChange({...data,version:data.version===12 || data.statementPasswords!==undefined ? 12 : data.version===11 || data.expenseCategoryRules!==undefined ? 11 : 10,expenses:expenses.map(e=>e.id===expense.id?expense:e)})
    setEditing(null)
  }} onRemove={()=>{
    onChange({...data,version:data.version===12 || data.statementPasswords!==undefined ? 12 : data.version===11 || data.expenseCategoryRules!==undefined ? 11 : 10,expenses:expenses.filter(e=>e.id!==editing.id)})
    setEditing(null)
    setMessage('已移除這筆消費，請按「儲存變更」保存。')
  }}/>
  return <div className="expenses-page">
    {ruleDialog}{passwordDialog}
    <div className="page-head"><div><h2>消費明細</h2><p className="muted">從信用卡帳單匯入並整理交易。修改後請按「儲存變更」保存；這些紀錄不會自動扣除資產或變更信用卡負債。</p></div><button className="primary" disabled={busy} onClick={()=>{setMessage('');setImporting(true)}}>匯入信用卡帳單</button></div>
    {passwordScope && <div className="statement-password-summary"><span className="muted small">帳單密碼 · {passwords.length?`${passwords.length} 組設定`:'可設定後自動套用'}</span><button disabled={busy} onClick={()=>setManagingPasswords(true)}>管理帳單密碼</button></div>}
    <ExpenseCategoryRules rules={rules} busy={busy} onChange={expenseCategoryRules=>onChange({...data,version:data.version===12 || data.statementPasswords!==undefined ? 12 : 11,expenseCategoryRules})}/>
    {message && <p role="status" className="notice">{message}</p>}
    {!expenses.length ? <section className="panel empty"><p>還沒有消費紀錄。選擇文字 PDF 帳單，預覽確認後即可匯入。</p></section> : <section className="panel">
      <h3>{expenses.length} 筆交易</h3>
      <div className="table-wrap"><table className="data expense-table"><thead><tr><th>日期</th><th>銀行／卡片</th><th>商家／說明</th><th>類別</th><th className="num">金額</th><th>操作</th></tr></thead><tbody>
        {[...expenses].sort((a,b)=>b.date.localeCompare(a.date)).map(e=><tr key={e.id}><td>{e.date}</td><td>{e.card}</td><td>{e.description}</td><td><div className="expense-category-cell"><span>{expenseCategory(e,rules)}</span><CategoryRuleButton expense={e} rules={rules} busy={busy} onClick={index=>setRuleExpense({expense:e,index})}/></div></td><td className="num">{e.currency} {fmt(e.amount)}</td><td><button disabled={busy} aria-label={`編輯消費 ${e.date} ${e.description}`} onClick={()=>setEditing(e)}>編輯</button></td></tr>)}
      </tbody></table></div>
    </section>}
  </div>
}

function ExpenseEditor({expense,busy,onSave,onCancel,onRemove,rules}: {rules:ExpenseCategoryRule[];expense:Expense;busy:boolean;onSave:(e:Expense)=>void;onCancel:()=>void;onRemove:()=>void}) {
  const [draft,setDraft] = useState(expense)
  const [amount,setAmount] = useState(String(expense.amount))
  const [error,setError] = useState('')
  return <form className="panel form" onSubmit={e=>{e.preventDefault();try {if(isUnrecognizedMerchant(draft.description)) throw new Error('請補上可辨識的商家，並核對是否為繳款');if(!amount.trim()) throw new Error('請填寫金額');onSave(parseExpense({...draft,amount:Number(amount)}))} catch(e){setError(e instanceof Error?e.message:'資料無效')}}}>
    <h2>編輯消費明細</h2>
    <fieldset disabled={busy} className="expense-fields">
      <label className="field"><span>消費日期</span><input type="date" required value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label>
      <label className="field"><span>銀行／卡片名稱</span><input required maxLength={100} value={draft.card} onChange={e=>setDraft({...draft,card:e.target.value})}/></label>
      <label className="field"><span>商家／說明</span><input required maxLength={500} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <label className="field"><span>金額（退款填負數）</span><input required type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <label className="field"><span>消費類別</span><select value={draft.category ?? ''} onChange={e=>setDraft({...draft,category:e.target.value ? e.target.value as ExpenseCategory : undefined})}><option value="">自動判斷（{expenseCategory({description:draft.description},rules)}）</option>{EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label className="field"><span>幣別</span><input required pattern="[A-Z]{3}" value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value.toUpperCase()})}/></label>
    </fieldset>
    {error && <p role="alert" className="banner error">{error}</p>}
    <div className="row"><button className="primary" disabled={busy}>套用修改</button><button type="button" onClick={onCancel}>取消</button><button type="button" className="danger" disabled={busy} onClick={()=>{if(confirm(`移除「${expense.description}」這筆消費？按「儲存變更」後才會保存。`)) onRemove()}}>移除這筆消費</button></div>
  </form>
}

type Draft = Expense & {selected:boolean;amountText:string;needsReview?:boolean;sourceFile?:number}
function StatementImport({existing,busy,onCancel,onImport,rules,onAddRule,passwords,passwordScope,onManagePasswords}: {passwords:StatementPassword[];passwordScope?:string;onManagePasswords:()=>void;onAddRule:(expense:Expense,index?:number)=>void;rules:ExpenseCategoryRule[];existing:Expense[];busy:boolean;onCancel:()=>void;onImport:(rows:Expense[],context:Expense[])=>void}) {
  const [files,setFiles] = useState<File[]>([])
  const [reports,setReports] = useState<{name:string;bank?:string;month?:string;source?:string;currency?:string;count?:number;error?:string;ocr?:boolean;warning?:string}[]>([])
  const [password,setPassword] = useState('')
  const [available,setAvailable] = useState<string[]>([])
  const [passwordNotice,setPasswordNotice] = useState('')
  useEffect(()=>{let cancelled=false;void statementPasswordStatus(passwordScope ?? '',passwords).then(ids=>{if(!cancelled)setAvailable(ids)});return()=>{cancelled=true}},[passwordScope,passwords])
  const [card,setCard] = useState('')
  const [month,setMonth] = useState('')
  const [currency,setCurrency] = useState('TWD')
  const [parsing,setParsing] = useState(false)
  const [progress,setProgress] = useState('')
  const [drafts,setDrafts] = useState<Draft[]|null>(null)
  const [skipped,setSkipped] = useState<string[]>([])
  const [error,setError] = useState('')
  const controller = useRef<AbortController|null>(null)
  useEffect(()=>()=>controller.current?.abort(),[])
  const locked = busy || parsing
  const patch = (id:string,fields:Partial<Draft>) => setDrafts(rows=>rows?.map(r=>r.id===id?{...r,...fields}:r) ?? null)
  const selected = (drafts ?? []).filter(r=>r.selected)
  const existingSourceKeys = new Set(existing.map(e=>e.sourceKey))
  const existingImportKeys = new Set(existing.map(e=>e.importKey))
  let result:ReturnType<typeof mergeExpenses>|null = null
  let validation = ''
  try {
    result = mergeExpenses(existing,selected.map(r=>{
      if(!r.amountText.trim()) throw new Error('請填寫每筆金額')
      return {...r,amount:Number(r.amountText)}
    }),drafts ?? [])
  } catch(e) {validation = e instanceof Error?e.message:'請檢查資料'}

  async function parse(e:FormEvent) {
    e.preventDefault()
    if(locked || !files.length) return
    setError('');setReports([]);setProgress('');setParsing(true)
    const abort = new AbortController()
    controller.current = abort
    const secret = password
    setPassword('')
    const previews:Draft[] = [], ignored:string[] = []
    const outcomes:typeof reports = []
    try {
      const stored = await unlockStatementPasswords(passwordScope ?? '',passwords)
      if(abort.signal.aborted)return
      const candidates = passwords.length ? [...stored.values,...secret.split(',').map(p=>p.trim()).filter(Boolean)] : secret
      setPasswordNotice(stored.unavailable?`${stored.unavailable} 組密碼無法在此瀏覽器解鎖；請重新設定或手動輸入。`:'')
      for(const file of files) {
        if(abort.signal.aborted) return
        try {
          assertCreditCardFile(file.name)
          if(file.size > 20*1024*1024) throw new Error('帳單超過 20 MB，請拆分後再匯入')
          const bytes = new Uint8Array(await file.arrayBuffer())
          if(abort.signal.aborted) return
          if(new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new Error('請選擇有效的 PDF 檔案')
          const fileHash = await sha256(bytes)
          const {readStatementPdf} = await import('../statementPdf')
          if(abort.signal.aborted) return
          const pdf = await readStatementPdf(bytes,candidates,abort.signal,file.name,message=>{if(!abort.signal.aborted)setProgress(message)})
          const info = statementMetadata(pdf.lines,pdf.title,file.name)
          const statementMonth = info.month || month
          const statementCard = card.trim() || (info.bank ? `${info.bank}${info.currency === 'SGD' ? ' (SG)' : ''}` : '')
          if(!statementMonth) throw new Error('無法辨識帳單月份，請填寫備用月份後重試')
          if(!statementCard.trim()) throw new Error('無法辨識銀行，請填寫備用銀行／卡片名稱後重試')
          const parsed = parseStatement(pdf.lines,statementMonth,info.currency || currency || 'TWD',info.bank || file.name,pdf.transactionIndexes)
          if(!parsed.rows.length && !(info.bank === '匯豐' && parsed.skipped.length)) throw new Error(pdf.ocrError || '沒有辨識到交易。此帳單的排版暫不支援，尚未匯入任何資料。')
          const rows = await prepareExpenses(parsed.rows,statementCard,fileHash,info.bank === '匯豐' ? parsed.sourceIndexes : undefined)
          if(abort.signal.aborted) return
          previews.push(...rows.map(r=>({...r,selected:!pdf.ocrUsed,needsReview:pdf.ocrUsed,amountText:String(r.amount),sourceFile:outcomes.length})))
          ignored.push(...parsed.skipped.map(line=>`${file.name}：${line}`))
          outcomes.push({name:file.name,bank:statementCard,month:statementMonth,source:info.monthSource || '手動備用',currency:info.currency || currency || 'TWD',count:rows.length,ocr:pdf.ocrUsed,warning:pdf.ocrError || (!rows.length ? '沒有辨識到可匯入的交易，請核對下方未匯入文字列並手動補登。' : undefined)})
        } catch(e) {
          if(abort.signal.aborted) return
          outcomes.push({name:file.name,error:e instanceof Error?e.message:'無法解析帳單'})
        }
      }
      if(abort.signal.aborted) return
      setReports(outcomes)
      if(outcomes.some(r=>!r.error)) {setDrafts(previews);setSkipped(ignored);setFiles([])}
      else setError('所有檔案都未匯入，請查看各檔案的原因後重試。')
    } finally {if(!abort.signal.aborted) setParsing(false)}
  }

  return <section className="panel statement-import">
    <div className="panel-head"><h2>匯入信用卡帳單</h2><button onClick={()=>{controller.current?.abort();onCancel()}}>取消匯入</button></div>
    <p className="statement-privacy">PDF 與解密都只在瀏覽器處理，原始帳單不保存、不上傳。選擇保存的密碼會加密；密碼設定與確認匯入的消費明細，儲存後才會存於本機或自己的 Google Drive。</p>
    {passwordScope && !drafts && <div className="statement-password-summary"><span className="muted small">{available.length?`已設定 ${available.length} 組密碼，解析時自動套用。`:'可先設定常用帳單密碼。'}{passwords.length>available.length?` ${passwords.length-available.length} 組需在此瀏覽器重新設定。`:''}</span><button disabled={locked} onClick={onManagePasswords}>管理帳單密碼</button></div>}
    {passwordNotice && <p role="status" className="notice">{passwordNotice}</p>}
    {parsing && progress && <p role="status">{progress}</p>}
    {error && <p className="banner error" role="alert">{error}</p>}
    {!!reports.length && <ul className="notice" aria-label="各帳單解析結果">{reports.map((r,i)=><li key={i}><strong>{r.name}</strong>：{r.error || `${r.bank} · ${r.month}（${r.source}）· ${r.count} 筆待核對${r.ocr?' · OCR 商家請核對':''}${r.warning?` · ${r.warning}`:''}`}</li>)}</ul>}
    {!drafts ? <form onSubmit={parse}>
      <fieldset className="statement-upload-fields" disabled={locked}>
        <label className="field statement-upload"><span>帳單 PDF（可選多份）</span><small className="muted">選擇信用卡帳單 · 每份最多 20 MB</small><input type="file" multiple accept=".pdf,application/pdf" required onChange={e=>{setFiles(Array.from(e.target.files??[]));setPassword('');setError('');setReports([])}}/></label>
        <label className="field statement-password"><span>PDF 密碼（多組以逗號 , 分隔）</span><input type="password" autoComplete="off" placeholder="未加密的帳單可留空" value={password} onChange={e=>setPassword(e.target.value)}/><small className="muted">不同帳單的密碼以逗號分隔。</small></label>
      </fieldset>
      <details className="statement-options"><summary>進階選項<span className="muted small">辨識不到時再填寫</span></summary>
        <fieldset className="expense-fields" disabled={locked}>
          <label className="field"><span>銀行／卡片名稱（選填）</span><input maxLength={100} placeholder="留空自動辨識" value={card} onChange={e=>setCard(e.target.value)}/><small className="muted">填寫會套用到全部檔案；多家銀行請留空。同張卡請沿用既有名稱，避免重複匯入。</small></label>
          <label className="field"><span>備用帳單月份</span><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/><small className="muted">優先讀取帳單標題、結帳日與檔名，辨識不到才使用此值。</small></label>
          <label className="field"><span>帳單金額幣別</span><input pattern="[A-Z]{3}" maxLength={3} placeholder="TWD" value={currency} onInvalid={e=>e.currentTarget.closest('details')?.setAttribute('open','')} onChange={e=>setCurrency(e.target.value.toUpperCase())}/><small className="muted">優先使用帳單幣別，未辨識時預設 TWD。</small></label>
        </fieldset>
      </details>
      <button className="primary" disabled={locked || !files.length}>{parsing?'正在本機解析…':`解析並預覽${files.length?`（${files.length} 份）`:''}`}</button>
    </form> : <>
      <div className="page-head"><div><h3>確認交易 · {reports.filter(r=>!r.error).length} 份帳單</h3><p className="muted">辨識 {drafts.length} 筆。可取消勾選或修改內容；相同交易依出現次數比對，保留同日同額的多筆消費。</p></div></div>
      <div className="expense-preview">{[...reports.map((report,index)=>({report,index})).filter(({report})=>!report.error),...(drafts.some(r=>r.sourceFile===undefined)?[{report:{name:'手動補登'},index:undefined}]:[])].map(({report,index})=>
        <section className="statement-group" key={index ?? 'manual'} aria-label={`來源：${report.name}`}>
          <header><strong>{report.name}</strong><span className="muted small">{drafts.filter(r=>r.sourceFile===index).length} 筆</span></header>
          <div className="table-wrap"><table className="data statement-preview-table"><thead><tr><th>選取</th><th>銀行／卡片</th><th>日期</th><th>商家／說明</th><th>類別</th><th className="num">金額</th><th>幣別</th></tr></thead><tbody>
          {drafts.map((r,i)=>{
            if(r.sourceFile!==index) return null
            const duplicate = (r.sourceKey && existingSourceKeys.has(r.sourceKey)) || (r.importKey && existingImportKeys.has(r.importKey))
            return <tr key={r.id} aria-label={`交易 ${i+1}`}>
              <td><label className="expense-select"><input type="checkbox" disabled={busy} aria-label={`第 ${i+1} 筆`} checked={r.selected} onChange={e=>patch(r.id,{selected:e.target.checked})}/><span>{i+1}</span>{r.needsReview && <span className="tag" title="請核對商家、日期、金額並排除繳款">核對</span>}{duplicate && <span className="tag">重複</span>}</label></td>
              <td><PreviewField label={`第 ${i+1} 筆卡片`} value={r.card} maxLength={100} disabled={busy} onChange={card=>patch(r.id,{card})}/></td>
              <td><PreviewField label={`第 ${i+1} 筆日期`} type="date" value={r.date} disabled={busy} onChange={date=>patch(r.id,{date})}/></td>
              <td><PreviewField label={`第 ${i+1} 筆商家`} value={r.description} maxLength={500} disabled={busy} onChange={description=>patch(r.id,{description})}/></td>
              <td><div className="expense-category-cell"><PreviewCategory rules={rules} expense={r} label={`第 ${i+1} 筆類別`} disabled={busy} onChange={category=>patch(r.id,{category})}/><CategoryRuleButton expense={r} rules={rules} busy={busy} label={`新增第 ${i+1} 筆分類規則`} editLabel={`編輯第 ${i+1} 筆分類規則`} onClick={index=>onAddRule(r,index)}/></div></td>
              <td className="num"><PreviewField label={`第 ${i+1} 筆金額`} type="number" value={r.amountText} disabled={busy} onChange={amountText=>patch(r.id,{amountText})}/></td>
              <td><PreviewField label={`第 ${i+1} 筆幣別`} value={r.currency} maxLength={3} disabled={busy} onChange={currency=>patch(r.id,{currency:currency.toUpperCase()})}/></td>
            </tr>
          })}</tbody></table></div>
          {!drafts.some(r=>r.sourceFile===index) && <p className="muted small">沒有辨識到可匯入的交易，請核對未匯入文字列。</p>}
        </section>
      )}</div>
      <button disabled={busy} onClick={()=>{setDrafts(null);setSkipped([]);setReports([]);setError('')}}>重新選擇帳單</button>
      <button disabled={busy} onClick={()=>setDrafts(rows=>[...(rows??[]),{id:crypto.randomUUID(),date:`${month || reports.find(r=>r.month)?.month || new Date().toISOString().slice(0,7)}-01`,description:'',amount:0,amountText:'',currency:reports.find(r=>r.month)?.currency || currency || 'TWD',card:card || reports.find(r=>r.bank)?.bank || '',selected:true}])}>＋ 補上一筆交易</button>
      {!!skipped.length && <details className="notice"><summary>未匯入的文字列（{skipped.length}）：含總計、繳款與無法辨識內容</summary><p className="small">只在本次預覽顯示，離開後不保存。未辨識商家及單獨的 I、l／分隔線不列為消費。請核對是否有漏掉的交易，確認後可用「補上一筆交易」手動補登。</p><ul>{skipped.map((line,i)=><li key={i}>{line}</li>)}</ul></details>}
      {validation && <p role="alert" className="banner error">{validation}</p>}
      <p role="status">選取 {selected.length} 筆 · 可新增 {result?.added ?? 0} 筆 · 略過重複 {result?.duplicates ?? 0} 筆</p>
      <button className="primary" disabled={busy || !!validation || !result?.added} onClick={()=>{try{onImport(selected.map(r=>({...r,amount:Number(r.amountText)})),drafts)}catch(e){setError(e instanceof Error?e.message:'匯入失敗')}}}>確認匯入 {result?.added ?? 0} 筆</button>
    </>}
    <details className="statement-help"><summary>支援格式與注意事項</summary><p className="muted small">支援富邦、玉山文字帳單與 SG 匯豐 SGD 帳單；匯豐圖片商家欄以本機 OCR 補上。OCR 交易預設不勾選，請核對商家、日期、金額並排除繳款。證券帳單不支援，其他排版可能漏辨識。退款以負數記錄，繳款與總計不當作消費。</p></details>
  </section>
}

function PreviewField({label,value,type='text',maxLength,disabled,onChange}: {label:string;value:string;type?:string;maxLength?:number;disabled:boolean;onChange:(value:string)=>void}) {
  const [editing,setEditing] = useState<string|null>(null)
  if(editing!==null) return <input className="preview-input" aria-label={label} autoFocus disabled={disabled} type={type} step={type==='number'?'0.01':undefined} maxLength={maxLength} value={editing} onChange={e=>setEditing(e.target.value)} onBlur={()=>{onChange(editing);setEditing(null)}} onKeyDown={e=>{
    if(e.key==='Enter') {e.preventDefault();e.currentTarget.blur()}
    if(e.key==='Escape') {e.preventDefault();setEditing(null)}
  }}/>
  return <button type="button" className="preview-value" disabled={disabled} aria-label={`編輯${label}`} title={value || '點擊填寫'} onClick={()=>setEditing(value)}>{value || <span className="muted">待填寫</span>}</button>
}

function PreviewCategory({expense,label,disabled,onChange,rules}: {rules:ExpenseCategoryRule[];expense:Expense;label:string;disabled:boolean;onChange:(category:ExpenseCategory|undefined)=>void}) {
  const [editing,setEditing] = useState(false)
  if(editing) return <select className="preview-input" autoFocus aria-label={label} disabled={disabled} value={expense.category ?? ''} onBlur={()=>setEditing(false)} onChange={e=>{onChange(e.target.value ? e.target.value as ExpenseCategory : undefined);setEditing(false)}} onKeyDown={e=>{if(e.key==='Escape')setEditing(false)}}><option value="">自動判斷（{expenseCategory({description:expense.description},rules)}）</option>{EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select>
  return <button type="button" className="preview-value" disabled={disabled} aria-label={`編輯${label}`} title={expense.category?'手動分類':'自動判斷；點擊修改'} onClick={()=>setEditing(true)}>{expenseCategory(expense,rules)}</button>
}
