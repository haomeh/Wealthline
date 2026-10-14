import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { WealthData } from '../model'
import { cashflowEntries } from '../cashflowEntries'
import { filterCashflowEntries, CATEGORY_TOKENS, type CashflowQuery, type LedgerReadiness } from '../cashflowQuery'
import { generateMonthlyReport, downloadMonthlyReport, readMonthlyReportFile, type CaptureReport } from '../monthlyReportExport'
import { monthlyReportWarnings, reportDisplay, type MonthlyReport as Report, type MonthlyReportEntry } from '../monthlyReport'
import { cashflowFingerprint } from '../cashflowFingerprint'
import { navigate } from '../site'
import { routePath } from '../routes'
import { cashflowQueryString } from '../cashflowQuery'

export interface MonthlyReportProps {data:WealthData;month:string;today:string;readiness:LedgerReadiness;dirty?:boolean;busy?:boolean;sessionIdentity?:number;captureReport?:CaptureReport;onClose:()=>void}
export function MonthlyReport({data,month,today,readiness,dirty,busy,sessionIdentity,captureReport,onClose}:MonthlyReportProps){
 const [view,setView]=useState<{report:Report;snapshot:boolean;data:WealthData}|null>(null)
 const [working,setWorking]=useState(false),[error,setError]=useState('')
 const [query,setQuery]=useState<CashflowQuery>({range:'month',month,metric:'all',source:'all',panel:'report',page:1})
 const latest=useRef({data,month,readiness,dirty,busy,sessionIdentity}),generation=useRef(0)
 useLayoutEffect(()=>{latest.current={data,month,readiness,dirty,busy,sessionIdentity}})
 useEffect(()=>()=>{generation.current++},[])
 const current=view?.snapshot?view: view?.data===data?view:null
 const report=current?.report
 const start=()=>{setError('');setWorking(true);return ++generation.current}
 const valid=(id:number)=>id===generation.current
 async function generate(format?:'json'|'csv'){
  const id=start(),captured=latest.current
  try{
   if(readiness!=='ready'||busy||format&&dirty)throw new Error('請先載入完整明細並儲存變更。')
   const owner=format?captureReport?.():{data,isCurrent:()=>latest.current.data===data&&latest.current.readiness==='ready'&&latest.current.sessionIdentity===captured.sessionIdentity}
   if(!owner)throw new Error('尚無可匯出的已儲存版本。')
   const isCurrent=()=>valid(id)&&latest.current.month===captured.month&&owner.isCurrent()&&(!format||!latest.current.dirty&&!latest.current.busy)
   const result=await generateMonthlyReport({data:owner.data,isCurrent},month,today)
   if(!isCurrent())throw new Error('資料已變更，請重新產生報表。')
   if(format)downloadMonthlyReport(result,format)
   setView({report:result,snapshot:false,data});setQuery(q=>({...q,month,page:1}))
  }catch(e){if(valid(id))setError(e instanceof Error?e.message:'報表產生失敗')}finally{if(valid(id))setWorking(false)}
 }
 async function open(file:File){const id=start();try{const report=await readMonthlyReportFile(file);if(valid(id)){setView({report,snapshot:true,data});setQuery({range:'month',month:report.month,metric:'all',source:'all',panel:'report',page:1})}}catch(e){if(valid(id))setError(e instanceof Error?e.message:'無法開啟報表')}finally{if(valid(id))setWorking(false)}}
 async function currentRecord(entry:MonthlyReportEntry){
  if(readiness!=='ready'){setError('目前資料明細尚未完整載入，無法比對。');return}
  const row=cashflowEntries({expenses:data.expenses,expenseRules:data.expenseCategoryRules,bankTransactions:data.bankTransactions,bankRules:data.bankCategoryRules}).find(e=>e.source.kind===entry.source.kind&&e.recordId===entry.recordId)
  if(!row){setError('目前資料已找不到這筆紀錄；原始快照仍保留。');return}
  const {sourceLabel,fxKey,incomeTwd,consumptionTwd,differenceTwd,...original}=entry
  void fxKey;void incomeTwd;void consumptionTwd;void differenceTwd
  const captured=latest.current,comparisonGeneration=generation.current
  const [a,b]=await Promise.all([cashflowFingerprint(original),cashflowFingerprint(row)])
  if(comparisonGeneration!==generation.current)return
  if(latest.current!==captured){setError('目前資料已變更，請重新比對。');return}
  const label=row.source.kind==='card'?row.source.card:data.bankTransactionAccounts?.find(a=>a.id===(row.source.kind==='bank'?row.source.accountId:''))?.label??'未知帳戶'
  if(a!==b||sourceLabel!==label){setError('目前紀錄與原始快照不同。請離開快照後從收支明細查看目前資料。');return}
  navigate(routePath({tab:row.source.kind==='card'?'expenses':'bank-transactions',recordId:row.recordId,returnTo:'/cashflow'+cashflowQueryString({...query,panel:'records'})}))
 }
 const filtered=report?filterCashflowEntries(report.entries,query) as MonthlyReportEntry[]:[]
 const pages=Math.max(1,Math.ceil(filtered.length/100)),page=Math.min(query.page,pages)
 const reviewLabel=report?.review.state?.status==='reviewed'?(report.review.state.currentMonth?'截至目前已核對':'已人工核對'):report?.review.state?.status==='stale'?'需重新核對':'未核對'
 return <section className="panel monthly-report" aria-label="每月報表">
  <div className="row"><h2>{report?.month??month} 每月報表</h2><button onClick={onClose}>{current?.snapshot?'離開快照，查看目前收支資料':'返回收支明細'}</button></div>
  <p>{current?.snapshot?'原始 JSON 快照 · 唯讀，不受目前資料變更影響':dirty?'目前資料預覽 · 包含未儲存修改；匯出前請儲存':'目前資料預覽 · 匯出使用已儲存版本'}</p>
  <div className="row"><button disabled={working||busy||readiness!=='ready'} onClick={()=>void generate()}>產生目前資料預覽</button><button disabled={working||busy||dirty||readiness!=='ready'||!captureReport} onClick={()=>void generate('json')}>匯出 JSON</button><button disabled={working||busy||dirty||readiness!=='ready'||!captureReport} onClick={()=>void generate('csv')}>匯出 CSV</button><label>開啟 JSON 快照<input aria-label="開啟 JSON 快照" type="file" accept=".json,application/json" disabled={working} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void open(file)}}/></label></div>
  {readiness!=='ready'&&<p role="status">目前明細尚未完整載入，無法產生完整報表；仍可開啟既有快照。</p>}
  {working&&<p role="status">正在驗證報表…</p>}{error&&<p role="alert">{error}</p>}
  {report&&<><h3>{reviewLabel}</h3><p>政策基準日 {report.asOfDate} · 產生時間 {report.generatedAt} · 資料版本 {report.sourceDataVersion} · 政策 {report.policyVersion}</p><p className="report-fingerprint">內容指紋 {report.fingerprint}</p>
   {monthlyReportWarnings(report).map(w=><p key={w} className="notice">{w}</p>)}
   {report.review.record?.confirmations.map(c=><p key={JSON.stringify(c.source)}>{c.source.kind==='card'?c.source.card:report.bankLabels[c.source.accountId]??`已移除帳戶 ${c.source.accountId}`}：{c.decision==='no-activity'?'人工確認無活動':'人工核對'}{c.exceptionNote?` · ${c.exceptionNote}`:''}</p>)}
   <p>{report.totals?`TWD 收入 ${reportDisplay(report.totals.income)} · 消費 ${reportDisplay(report.totals.consumption)} · 差額 ${reportDisplay(report.totals.difference)}`:'無觀測紀錄；收入、消費及差額未知，不代表零。'}</p>
   <p>顯示四捨五入調整 TWD：收入 {reportDisplay(report.rounding.income)} · 消費 {reportDisplay(report.rounding.consumption)} · 差額 {reportDisplay(report.rounding.difference)}</p>
   <div className="row"><label>報表指標<select aria-label="報表指標" value={query.metric} onChange={e=>setQuery({...query,metric:e.target.value as CashflowQuery['metric'],category:undefined,page:1})}>{[['all','全部'],['income','收入'],['consumption','消費'],['difference','差額'],['pending','未分類銀行流水'],['excluded','不計收支']].map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label><label>報表來源<select aria-label="報表來源" value={query.source} onChange={e=>setQuery({...query,source:e.target.value as CashflowQuery['source'],page:1})}><option value="all">全部</option><option value="bank">銀行</option><option value="card">信用卡</option></select></label><label>報表分類<select aria-label="報表分類" value={query.category??''} onChange={e=>setQuery({...query,category:e.target.value||undefined,page:1})}><option value="">全部</option>{Object.entries(CATEGORY_TOKENS).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label></div>
   <p>符合篩選 {filtered.length} 筆{filtered.length?` · TWD 收入 ${reportDisplay(filtered.reduce((n,e)=>n+e.incomeTwd,0))} · 消費 ${reportDisplay(filtered.reduce((n,e)=>n+e.consumptionTwd,0))}`:''}</p>
   <div className="report-entries">{filtered.slice((page-1)*100,page*100).map(e=><article key={e.source.kind+':'+e.recordId}><h4>{e.date} · {e.sourceLabel} · {e.description}</h4><p>{e.source.kind} / {e.recordId} · {e.classification} · {e.category??e.exclusionReason} · 分類依據 {e.evidence.basis}{e.evidence.rule?` / ${e.evidence.rule.keyword}`:''}</p><p>原幣 {e.currency} {reportDisplay(e.amount)} {e.direction==='credit'?'入帳':e.direction==='debit'?'支出':''} · TWD 收入 {reportDisplay(e.incomeTwd)} · 消費 {reportDisplay(e.consumptionTwd)} · 差額 {reportDisplay(e.differenceTwd)}</p><p>匯率參照 {e.fxKey}</p>{current?.snapshot&&<button onClick={()=>void currentRecord(e)}>比對並離開快照，查看目前紀錄</button>}</article>)}</div>
   {pages>1&&<nav aria-label="報表明細分頁"><button disabled={page===1} onClick={()=>setQuery({...query,page:page-1})}>上一頁</button>{page} / {pages}<button disabled={page===pages} onClick={()=>setQuery({...query,page:page+1})}>下一頁</button></nav>}
   <details><summary>凍結匯率證據</summary>{report.fx.map(f=><p key={f.currency}>{f.month} {f.currency} → TWD：{f.rate} · 目標日 {f.targetDate}{f.legs.map(l=>` · ${l.symbol} ${l.date} ${l.rate}`).join('')}</p>)}</details>
  </>}
 </section>
}
