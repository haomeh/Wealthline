import type { BankStatementResult } from '../bankStatements'
import { classifyBankTransaction, type BankTransaction, type BankCategoryRule } from '../bankTransactions'
export const BANK_TEXT_NOTICE = '請勿輸入完整帳號、戶名或身分資料；只會遮蔽已識別或明確標記的識別碼。'
export function classificationLabel(row:Pick<BankTransaction,'description'|'direction'|'classification'>,rules:readonly BankCategoryRule[]) {
 const c=classifyBankTransaction(row,rules)
 return c.kind==='income'?`${c.category}${row.direction==='debit'?' · 收入沖回':''}`:c.kind==='expense'?`${c.category}${row.direction==='credit'?' · 消費退款':''}`:c.kind==='excluded'?`不計收支 · ${c.reason}`:`未分類 · ${row.direction==='credit'?'計入收入':'計入消費'}`
}
/** Short category for a ledger row's second line; the full wording stays in classificationLabel. */
export function classificationTag(row:Pick<BankTransaction,'description'|'direction'|'classification'>,rules:readonly BankCategoryRule[]):{text:string;tone?:'good'|'warn'} {
 const c=classifyBankTransaction(row,rules)
 return c.kind==='income'?{text:c.category,tone:'good'}:c.kind==='expense'?{text:c.category}:c.kind==='excluded'?{text:'不計收支'}:{text:'未分類',tone:'warn'}
}
/**
 * Identity placeholder for a parsed row whose every narration line is unowned (empty parser
 * summary). It only feeds the original-content import key; changing it changes that key. The
 * stored description is always the summary the user confirms in preview.
 */
export const BANK_SUMMARY_PENDING = '[摘要待確認]'
type WarningKind = 'summary'|'amount'|'scope'
// summary: imported rows may have incomplete summaries. amount: an amount-bearing line was NOT imported.
const BANK_WARNINGS: Record<string,[WarningKind,string]> = {
 'ambiguous-trailing-narration':['summary','摘要可能不完整：有敘述行無法判定屬於前一筆或後一筆交易，未併入任何摘要；已列為相鄰交易的候選內容，請逐筆核對，可依需要補充摘要'],
 'invalid-description':['amount','有金額的交易列沒有可用摘要（空白或超過長度），該列未匯入；請對照原帳單手動補登'],
 'activity-below-table-boundary':['amount','表格下方頁尾區域出現疑似交易的金額列，該列未匯入；請對照原帳單，確有交易時手動補登'],
 'ambiguous-transaction':['amount','有金額的交易列無法唯一判定日期、幣別、帳戶或入出帳欄位，該列未匯入；請對照原帳單手動補登'],
 'partial-outgoing-transfer-coverage':['scope','此版型僅涵蓋局部轉出明細，不是完整月流水'],
 'unproven-page-continuity':['scope','無法確認交易區段完整結束或續頁屬於同一帳戶，可能有未匯入的內容；請核對原帳單及續頁，必要時手動補登'],
 'unsupported-dbs-sg-account':['scope','新加坡星展區段缺少相符的 My Account 帳戶、完整收支表頭或 SGD 幣別標示，該區段未匯入；請核對原帳單'],
 'unsupported-dbs-activity-layout':['scope','未辨識到支援的星展收支交易表；若文件只有帳戶摘要，請另下載交易明細。未匯入任何交易'],
}
/**
 * One report line per parsed file. rejectedCount counts diagnostic events, not missing rows,
 * so name it as places to check and say nothing about it when it is zero.
 */
export function bankFileSummary(file:string,result:Pick<BankStatementResult,'bank'|'status'|'sections'|'recognizedCount'|'rejectedCount'>) {
 const head=`${file} · ${result.bank??'未辨識銀行'}`
 if(result.status==='unsupported')return `${head} · 不支援／未辨識 · 未匯入任何交易`
 const scope=result.sections.some(s=>s.partial)?' · 僅部分明細':''
 const issues=result.rejectedCount?` · ${result.rejectedCount} 處需核對（處數不等於漏列筆數）`:''
 return `${head} · 已辨識 ${result.recognizedCount} 筆${scope}${issues}`
}
/** Actionable text that always keeps the diagnostic code recognizable, including unknown codes. */
export const bankWarningText = (code:string) => `${BANK_WARNINGS[code]?.[1] ?? '尚無中文說明的解析問題，請對照原帳單核對'}〔${code}〕`
/** One line per code. Counts are diagnostic events, not numbers of missing transactions. */
export function summarizeBankWarnings(warnings:readonly {code:string;count:number}[]) {
 const counts=new Map<string,number>()
 for(const w of warnings)counts.set(w.code,(counts.get(w.code)??0)+w.count)
 return [...counts].map(([code,count])=>({code,count,kind:BANK_WARNINGS[code]?.[0],text:bankWarningText(code)}))
}
