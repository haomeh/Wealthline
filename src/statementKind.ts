import { parseBankStatement, type BankStatementResult } from './bankStatements'
import { spatialLines, type BankPage } from './bankStatements/common'
import { statementAccountLabel } from './bankStatementAssets'
import { statementMetadata } from './statements'

export type StatementKind = 'card' | 'bank'
export interface StatementKindResult {
  kind: StatementKind | 'unknown'
  /** Issuer or bank for the report, when one is named. */
  bank?: string
  /** Why the file is unknown, or a note on a recognized file. */
  reason?: string
}

// Phrases printed on credit card statements and not on deposit, loan or securities statements.
// A single phrase is enough; a deposit table recognized by the bank parser always wins.
const CARD_MARKERS = [
  /信用卡(?:電子)?(?:帳單|對帳單)/,
  /本期應繳總(?:金)?額/,
  /最低應繳/,
  /消費日(?:期)?入帳日(?:期)?/,
  /CREDITCARDSTATEMENT/,
  /MINIMUMPAYMENT/,
  /DATEDATEDESCRIPTIONAMOUNT\([A-Z]{3}\)/,
]
const SECURITIES = (text: string) => /綜合月對帳單|综合月对账单/.test(text) || (/成交日期/.test(text) && /買賣別|證券帳號/.test(text))

/**
 * Card or bank statement, from the text layer only (no OCR). Pure; pages stay in memory.
 * - A deposit table the bank parser recognizes decides "bank": that parser fails closed, so it does not accept card rows.
 * - Otherwise a card statement phrase decides "card".
 * - Anything else is "unknown": it is reported, never guessed.
 */
export function classifyStatement(pages: readonly BankPage[], fileName = ''): StatementKindResult {
  return classify(pages, fileName).kind
}

// The kind, and the bank parser's result it was decided on, for reuse by the bank import.
function classify(pages: readonly BankPage[], fileName: string): { kind: StatementKindResult; bank?: BankStatementResult } {
  const lines = pages.flatMap(p => spatialLines(p.items).map(l => l.text))
  const compact = lines.map(l => l.normalize('NFKC').replace(/\s+/g, '').toUpperCase())
  const card = CARD_MARKERS.some(marker => compact.some(l => marker.test(l)))
  let bank: ReturnType<typeof parseBankStatement> | undefined
  try { bank = parseBankStatement(pages) } catch { bank = undefined }
  if (bank && bank.status !== 'unsupported') return { bank, kind: {
    kind: 'bank', ...(bank.bank && { bank: statementAccountLabel(bank.bank) }),
    ...(card && { reason: '也有信用卡帳單字樣；已依銀行交易表判斷為銀行帳單，若含信用卡消費請另以「信用卡帳單」匯入此檔' }),
  } }
  // Bank statements may carry a securities section; only a file the bank parser rejected is checked.
  if (SECURITIES(compact.join('')) || /證券|证券/.test(fileName)) return { kind: { kind: 'unknown', reason: '證券對帳單不支援' } }
  if (card) {
    const issuer = statementMetadata(lines, '', fileName).bank
    return { kind: { kind: 'card', ...(issuer && { bank: issuer }) } }
  }
  const named = bank?.bank ? `看起來是 ${statementAccountLabel(bank.bank)} 的文件，但` : ''
  return { kind: { kind: 'unknown', ...(bank?.bank && { bank: statementAccountLabel(bank.bank) }), reason: `${named}沒有已支援的銀行交易表，也沒有信用卡帳單特徵` } }
}

/**
 * What the import screens would read from a detected file, kept so the file is read once: the bank parser's
 * result for a bank statement, the card lines (with OCR) or the card reader's error for a card statement.
 * Memory only, like the pages it comes from.
 */
export type PreparedStatement =
  | { kind: 'bank'; result: BankStatementResult }
  | { kind: 'card'; read: import('./statementPdf').StatementPdfRead }
  | { kind: 'card'; error: string }

/**
 * Reads one PDF once: its text layer decides the kind, and a card or bank statement is read on for its import
 * screen while the document is open, so that screen need not open and read the file again.
 */
export async function detectStatementKind(bytes: Uint8Array, password: string | readonly string[], signal: AbortSignal, fileName = '', onProgress?: (message: string) => void): Promise<StatementKindResult & { prepared?: PreparedStatement }> {
  const { readBankDocument } = await import('./statementDocument')
  // A classifier failure is not a reading error: it is thrown as it is, after the document is closed.
  let failed: { error: unknown } | undefined
  const document = await readBankDocument(bytes, password, signal, undefined, async (pdf, texts, pages) => {
    let classified: ReturnType<typeof classify>
    try { classified = classify(pages, fileName) } catch (error) { failed = { error }; return undefined }
    const { kind, bank } = classified
    if (kind.kind === 'bank' && bank) return { ...kind, prepared: { kind: 'bank', result: bank } satisfies PreparedStatement }
    if (kind.kind !== 'card') return kind
    // The card screen's own reader, on the text already read; its errors are reported there, as before.
    let reader: typeof import('./statementPdf') | undefined
    try {
      reader = await import('./statementPdf')
      return { ...kind, prepared: { kind: 'card', read: await reader.readStatementPages(pdf, signal, fileName, onProgress, texts) } satisfies PreparedStatement }
    } catch (e) {
      if (signal.aborted) throw new Error('已取消解析')
      const error = reader ? reader.statementPdfError(e) : e
      return { ...kind, prepared: { kind: 'card', error: error instanceof Error ? error.message : '無法解析帳單' } satisfies PreparedStatement }
    }
  })
  if (failed) throw failed.error
  return document.extra ?? classifyStatement(document.pages, fileName)
}

/** Loads the PDF reader and starts its worker ahead of detection. Best effort. */
export async function warmStatementReader() {
  const { warmStatementWorker } = await import('./statementDocument')
  warmStatementWorker()
}
