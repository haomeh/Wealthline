// Only these application-owned messages may reach the bank import preview.
// Never show raw PDF.js errors: they can contain document text or resource URLs.
export const BANK_PDF_ERRORS = {
  size: '帳單超過 20MB，請拆分後再匯入',
  format: '檔案不是 PDF，請選擇原始銀行對帳單 PDF',
  passwordRequired: '此帳單需要密碼，請設定帳單密碼或手動輸入後重新解析',
  passwordIncorrect: '提供的密碼無法開啟此帳單，請核對密碼或新增其他密碼後重新解析',
  pages: '帳單超過 100 頁，請拆分後再匯入',
  textLimit: '帳單文字過多，請拆分後再匯入',
  noText: '此 PDF 沒有可讀取的文字。第一版暫不支援掃描／圖片帳單。',
  unreadable: '無法讀取此 PDF，請確認檔案完整且為支援的文字帳單。',
} as const

const messages = new Set<string>(Object.values(BANK_PDF_ERRORS))
export function bankStatementErrorMessage(error: unknown): string {
  return error instanceof Error && messages.has(error.message) ? error.message : BANK_PDF_ERRORS.unreadable
}
