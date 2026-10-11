import { classifyBankTransaction, type BankTransaction, type BankCategoryRule } from '../bankTransactions'
export const BANK_TEXT_NOTICE = '請勿輸入完整帳號、戶名或身分資料；只會遮蔽已識別或明確標記的識別碼。'
export function classificationLabel(row:Pick<BankTransaction,'description'|'direction'|'classification'>,rules:readonly BankCategoryRule[]) {
 const c=classifyBankTransaction(row,rules)
 return c.kind==='income'?`${c.category}${row.direction==='debit'?' · 收入沖回':''}`:c.kind==='expense'?`${c.category}${row.direction==='credit'?' · 消費退款':''}`:c.kind==='excluded'?`不計收支 · ${c.reason}`:'待確認'
}
