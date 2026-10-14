import type { WealthData } from './model'
import { cashflowEntries } from './cashflowEntries'
import { cashflowSummary } from './cashflow'
import { cashflowWithFxEvidence } from './cashflowFx'
import { monthlyReviewState } from './monthlyReviewState'
import { buildMonthlyReport, parseMonthlyReport, monthlyReportWarnings, reportDisplay, REPORT_MAX_BYTES, type MonthlyReport } from './monthlyReport'
import type { HistoryFetcher } from './historicalFx'
export interface ReportCapture { data: WealthData; isCurrent: () => boolean }
export type CaptureReport = () => ReportCapture
const check=(capture:ReportCapture)=>{if(!capture.isCurrent())throw new Error('資料、帳號或儲存狀態已變更，請重新產生報表。')}
// The owner captures a ready saved revision. No history or partial-backup fallback.
export async function generateMonthlyReport(capture:ReportCapture,month:string,today:string,fetcher?:HistoryFetcher):Promise<MonthlyReport>{
 check(capture)
 const data=capture.data, input={expenses:data.expenses,expenseRules:data.expenseCategoryRules,bankTransactions:data.bankTransactions,bankRules:data.bankCategoryRules}
 const entries=cashflowEntries(input).filter(e=>e.date.startsWith(month+'-'))
 const bankLabels=Object.fromEntries((data.bankTransactionAccounts??[]).map(a=>[a.id,a.label]))
 const {fx}=await cashflowWithFxEvidence(cashflowSummary(input,month,1),today,fetcher);check(capture)
 const record=data.monthlyReviews?.find(r=>r.month===month)??null
 const state=record?await monthlyReviewState(entries,record,today,bankLabels):null;check(capture)
 const report=await buildMonthlyReport({month,asOfDate:today,generatedAt:new Date().toISOString(),sourceDataVersion:data.version,entries,fx,review:{record,state},bankLabels});check(capture)
 return report
}
export const csvText=(value:string):string=>'"'+(/^[\s]*[=+@-]|^[\t\r\n]/.test(value)?"'"+value:value).replaceAll('"','""')+'"'
const numeric=(n:number):string=>{if(!Number.isFinite(n))throw new Error('報表金額無效');return String(n)}
export function monthlyReportCsv(report:MonthlyReport):string {
 const status=report.review.state?.status==='reviewed'?(report.review.state.currentMonth?'截至目前已核對':'已人工核對'):report.review.state?.status==='stale'?'需重新核對':'未核對'
 const prefix=[csvText(report.month),csvText(report.asOfDate),csvText(status),numeric(report.entries.length),...(['income','consumption','difference'] as const).map(k=>report.totals===null?'':numeric(report.totals[k])),...(['income','consumption','difference'] as const).map(k=>numeric(report.rounding[k])),csvText(report.fingerprint),csvText(monthlyReportWarnings(report).join('；'))]
 const headers=['month','as_of_date','review_status','observed_count','total_income_raw','total_consumption_raw','total_difference_raw','rounding_income','rounding_consumption','rounding_difference','fingerprint','warnings','source','source_reference','record_id','source_label','date','description','direction','classification','metric','category','exclusion_reason','basis','rule','currency','amount_raw','income_raw','consumption_raw','difference_raw','fx_key','fx_rate','fx_legs','income_twd_raw','consumption_twd_raw','difference_twd_raw','income_twd_display','consumption_twd_display','difference_twd_display']
 const rows=[headers.map(csvText).join(',')]
 for(const e of report.entries){
  const fx=report.fx.find(f=>`${f.month}:${f.currency}`===e.fxKey)!
  rows.push([...prefix,...[e.source.kind,e.source.kind==='card'?e.source.card:e.source.accountId,e.recordId,e.sourceLabel,e.date,e.description,e.direction??'',e.classification,e.metric,e.category??'',e.exclusionReason??'',e.evidence.basis,e.evidence.rule?JSON.stringify(e.evidence.rule):'',e.currency].map(csvText),...[e.amount,e.income,e.consumption,e.difference].map(numeric),csvText(e.fxKey),numeric(fx.rate),csvText(JSON.stringify(fx.legs)),...[e.incomeTwd,e.consumptionTwd,e.differenceTwd].map(numeric),...[e.incomeTwd,e.consumptionTwd,e.differenceTwd].map(n=>csvText(reportDisplay(n)))].join(','))
 }
 // Even an empty observed month retains review metadata and unknown (blank) totals.
 if(!report.entries.length)rows.push([...prefix,...Array<string>(headers.length-prefix.length).fill('')].join(','))
 return '\uFEFF'+rows.join('\r\n')+'\r\n'
}
export async function readMonthlyReportFile(file:Pick<File,'size'|'text'>):Promise<MonthlyReport>{if(file.size>REPORT_MAX_BYTES)throw new Error('報表檔案太大。');return parseMonthlyReport(JSON.parse(await file.text()))}
export function downloadMonthlyReport(report:MonthlyReport,format:'json'|'csv'):void {
 const timestamp=report.generatedAt.replace(/[^0-9TZ]/g,'')
 if(!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(report.month)||!/^\d{8}T\d{6}(?:\d{3})?Z$/.test(timestamp))throw new Error('報表檔名無效')
 const content=format==='json'?JSON.stringify(report,null,2):monthlyReportCsv(report)
 const url=URL.createObjectURL(new Blob([content],{type:format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'}))
 try{const a=document.createElement('a');a.href=url;a.download=`wealthline-monthly-${report.month}-${timestamp}.${format}`;a.click()}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
