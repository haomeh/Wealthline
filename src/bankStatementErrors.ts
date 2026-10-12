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
  setup: '無法準備帳單解析，請回報診斷代碼〔BANK-START〕',
  result: '無法建立批次解析結果，請回報診斷代碼〔BANK-RESULT〕',
  passwordStore: '無法自動讀取已儲存密碼，改用手動密碼或嘗試免密碼開啟〔BANK-PASSWORDS〕',
  fileRead: '無法讀取所選檔案，請先下載到裝置後重新選取〔BANK-FILE〕',
  fingerprint: '無法建立檔案指紋，請重新開啟頁面後重試〔BANK-HASH〕',
  module: '無法載入 PDF 解析程式，請確認網路連線並重新整理頁面〔BANK-MODULE〕',
  openWorker: '無法啟動 PDF 背景解析程式，請重新開啟頁面並回報診斷代碼〔BANK-OPEN-WORKER〕',
  openRuntime: 'PDF 解析程式執行失敗，請回報診斷代碼〔BANK-OPEN-RUNTIME〕',
  openDocument: 'PDF 內容無法開啟，請重新下載原始檔案後重試〔BANK-OPEN-DOCUMENT〕',
  openInternal: 'PDF 開啟失敗：解析程式或檔案格式發生錯誤，請回報診斷代碼〔BANK-OPEN-INTERNAL〕',
  pageInternal: 'PDF 頁面讀取失敗：解析程式或檔案格式發生錯誤，請回報診斷代碼〔BANK-PAGE-INTERNAL〕',
  textInternal: 'PDF 文字擷取失敗：解析程式或檔案格式發生錯誤，請回報診斷代碼〔BANK-TEXT-INTERNAL〕',
  open: '無法開啟 PDF，請回報診斷代碼以確認解析環境或檔案問題〔BANK-OPEN〕',
  page: '無法讀取 PDF 頁面，請回報診斷代碼〔BANK-PAGE〕',
  text: '無法擷取 PDF 文字，請回報診斷代碼〔BANK-TEXT〕',
  parse: '無法解析銀行交易，請回報診斷代碼〔BANK-PARSE〕',
  preview: '無法建立交易預覽，請回報診斷代碼〔BANK-PREVIEW〕',
  cleanup: 'PDF 處理程序無法正常結束，請重新開啟頁面後重試〔BANK-CLEANUP〕',
  unreadable: '無法讀取此 PDF，請確認檔案完整且為支援的文字帳單。',
} as const

export type BankImportStage = 'setup' | 'result' | 'fileRead' | 'fingerprint' | 'module' | 'open' | 'page' | 'text' | 'parse' | 'preview' | 'cleanup'

const messages = new Set<string>(Object.values(BANK_PDF_ERRORS))
export function bankStatementErrorMessage(error: unknown, stage?: BankImportStage): string {
  try {
    if (error instanceof Error) {
      const message = error.message
      if (typeof message === 'string' && messages.has(message) && message !== BANK_PDF_ERRORS.unreadable) return message
      const name = error.name
      // PDF.js wraps worker runtime and format failures alike; never expose details.
      if (name === 'UnknownErrorException') {
        if (stage === 'open') return BANK_PDF_ERRORS.openInternal
        if (stage === 'page') return BANK_PDF_ERRORS.pageInternal
        if (stage === 'text') return BANK_PDF_ERRORS.textInternal
      }
      if (stage === 'open') {
        if (typeof message === 'string' && message.startsWith('Setting up fake worker failed:')) return BANK_PDF_ERRORS.openWorker
        if (name === 'TypeError' || name === 'ReferenceError') return BANK_PDF_ERRORS.openRuntime
        if (name === 'InvalidPDFException') return BANK_PDF_ERRORS.openDocument
      }
    }
  } catch {
    // Malformed error fields must not make the diagnostic handler throw again.
  }
  return stage ? BANK_PDF_ERRORS[stage] : BANK_PDF_ERRORS.unreadable
}
