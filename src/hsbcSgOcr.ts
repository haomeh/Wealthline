import type { StatementPdf } from './statementDocument'
import type { StatementPdfRead } from './statementPdf'
import type { StatementOcr } from './statementOcr'

/** Native bitmap resolution of OpenText HSBC SG image-mask glyphs (300 DPI / 72 pt). */
export const NATIVE_GLYPH_SCALE = 300 / 72

export interface GlyphBox {
  x: number
  y: number
  w: number
  h: number
  hash: string
  pw: number
  ph: number
  data: Uint8Array
}

export interface GlyphPage {
  page: number
  width: number
  height: number
  glyphs: GlyphBox[]
}

export interface CropRegion {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  x: number
  y: number
  width: number
  height: number
  conf: number
}

export interface OcrTablePage {
  page: number
  glyphs: readonly GlyphBox[]
  words: readonly OcrWord[]
}

export interface HsbcSgOcrResult {
  lines: string[]
  transactionIndexes: number[]
  ocrError?: string
}

export interface HsbcSgGlyphProbe {
  page1: GlyphPage
  probeLines: string[]
  ocr: StatementOcr
}

type Matrix6 = [number, number, number, number, number, number]

// Standard PDF.js OPS codes (fallback if mocked pdfjs-dist omits OPS).
const DEFAULT_OPS = { save: 10, restore: 11, transform: 12, paintImageMaskXObject: 83 }

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const MIN_MASK_GLYPHS = 80
const TABLE_LEFT_X0 = 40
const TABLE_LEFT_X1 = 378
const SUMMARY_X0 = 380

function mulMatrix(m1: Matrix6, m2: readonly number[]): Matrix6 {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

/** Deterministic, synchronous bitmap hash (dual 32-bit FNV-1a + dimensions) with zero Node dependencies. */
export function hashGlyphBitmap(width: number, height: number, data: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < data.length; i++) {
    const b = data[i]
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (b + (i & 0xff)), 0x85ebca6b) >>> 0
  }
  return `${width}x${height}:${h1.toString(36)}_${h2.toString(36)}`
}

type PdfPageLike = {
  getViewport: (params: { scale: number }) => { width: number; height: number }
  getOperatorList?: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>
  objs?: { has: (name: string) => boolean; get: (name: string) => unknown }
}

/** Extracts 1-bit `paintImageMaskXObject` glyphs with exact PDF coordinates from a page's operator list. */
export async function extractPageGlyphs(page: PdfPageLike, pageNumber: number): Promise<GlyphPage> {
  const viewport = page.getViewport({ scale: 1 })
  if (typeof page.getOperatorList !== 'function') {
    return { page: pageNumber, width: viewport.width, height: viewport.height, glyphs: [] }
  }
  let opsCode = DEFAULT_OPS
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (pdfjs.OPS) opsCode = pdfjs.OPS
  } catch { /* fallback to DEFAULT_OPS */ }

  const list = await page.getOperatorList()
  const stack: Matrix6[] = []
  let ctm: Matrix6 = [1, 0, 0, 1, 0, 0]
  const glyphs: GlyphBox[] = []
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i]
    const args = list.argsArray[i]
    if (fn === opsCode.save) {
      stack.push([...ctm])
    } else if (fn === opsCode.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
    } else if (fn === opsCode.transform && Array.isArray(args) && args.length >= 6) {
      ctm = mulMatrix(ctm, args as number[])
    } else if (fn === opsCode.paintImageMaskXObject && Array.isArray(args)) {
      const arg = args[0] as { data?: unknown; width?: number; height?: number } | undefined
      if (!arg) continue
      const resolved = typeof arg.data === 'string' && page.objs?.has(arg.data)
        ? (page.objs.get(arg.data) as { data?: unknown; width?: number; height?: number } | undefined)
        : arg
      if (!resolved?.data || !(resolved.data instanceof Uint8Array)) continue
      const pw = resolved.width ?? 0
      const ph = resolved.height ?? 0
      if (pw <= 0 || ph <= 0) continue
      const w = Math.abs(ctm[0])
      const h = Math.abs(ctm[3])
      if (w <= 0 || h <= 0) continue
      glyphs.push({
        x: ctm[4],
        y: ctm[5],
        w,
        h,
        hash: hashGlyphBitmap(pw, ph, resolved.data),
        pw,
        ph,
        data: resolved.data,
      })
    }
  }
  return { page: pageNumber, width: viewport.width, height: viewport.height, glyphs }
}

/**
 * Renders a region of 1-bit PDF image-mask glyphs onto a crisp black-on-white RGBA buffer.
 * At native 300 DPI (`300 / 72`), OpenText glyphs blit 1:1 with zero antialiasing or table-border noise.
 */
export function renderGlyphRegionRgba(
  glyphs: readonly GlyphBox[],
  region: CropRegion,
  pageHeight: number,
  scale = NATIVE_GLYPH_SCALE,
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const width = Math.max(1, Math.ceil((region.x1 - region.x0) * scale))
  const height = Math.max(1, Math.ceil((region.y1 - region.y0) * scale))
  const rgba = new Uint8ClampedArray(width * height * 4)
  rgba.fill(255)
  for (const g of glyphs) {
    if (g.x + g.w < region.x0 || g.x > region.x1) continue
    const topY = pageHeight - (g.y + g.h)
    const botY = pageHeight - g.y
    if (botY < region.y0 || topY > region.y1) continue
    const gx0 = Math.round((g.x - region.x0) * scale)
    const gy0 = Math.round((topY - region.y0) * scale)
    const gw = Math.max(1, Math.round(g.w * scale))
    const gh = Math.max(1, Math.round(g.h * scale))
    const useNative = Math.abs(gw - g.pw) <= 2 && Math.abs(gh - g.ph) <= 2
    const dw = useNative ? g.pw : gw
    const dh = useNative ? g.ph : gh
    const stride = Math.ceil(g.pw / 8)
    for (let dy = 0; dy < dh; dy++) {
      const py = gy0 + dy
      if (py < 0 || py >= height) continue
      const sy = useNative ? dy : Math.min(g.ph - 1, Math.floor((dy * g.ph) / dh))
      const rowOffset = sy * stride
      for (let dx = 0; dx < dw; dx++) {
        const px = gx0 + dx
        if (px < 0 || px >= width) continue
        const sx = useNative ? dx : Math.min(g.pw - 1, Math.floor((dx * g.pw) / dw))
        const bit = (g.data[rowOffset + (sx >> 3)] >> (7 - (sx & 7))) & 1
        // PDF ImageMask bit 0 paints the fill color (black); bit 1 is transparent.
        if (bit === 0) {
          const offset = (py * width + px) * 4
          rgba[offset] = 0
          rgba[offset + 1] = 0
          rgba[offset + 2] = 0
        }
      }
    }
  }
  return { width, height, rgba }
}

async function renderGlyphRegionPng(
  glyphs: readonly GlyphBox[],
  region: CropRegion,
  pageHeight: number,
  scale = NATIVE_GLYPH_SCALE,
): Promise<Uint8Array> {
  const { width, height, rgba } = renderGlyphRegionRgba(glyphs, region, pageHeight, scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('OCR 無法建立圖片，請手動補上商家')
    const image = context.createImageData(width, height)
    image.data.set(rgba)
    context.putImageData(image, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('OCR 無法讀取圖片'))), 'image/png'),
    )
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

/** Parses Tesseract TSV level-5 word boxes back into PDF point coordinates (bottom-up y). */
export function parseOcrTsvWords(
  tsv: string,
  region: CropRegion,
  pageHeight: number,
  scale = NATIVE_GLYPH_SCALE,
): OcrWord[] {
  const words: OcrWord[] = []
  for (const line of tsv.split('\n').slice(1)) {
    const c = line.split('\t')
    if (c.length < 12 || c[0] !== '5') continue
    const text = c.slice(11).join('\t').trim()
    if (!text) continue
    const left = Number(c[6])
    const top = Number(c[7])
    const width = Number(c[8])
    const height = Number(c[9])
    const conf = Number(c[10])
    if (![left, top, width, height].every(Number.isFinite) || height <= 0) continue
    const x = left / scale + region.x0
    const yTop = top / scale + region.y0
    const h = height / scale
    words.push({
      text,
      x,
      y: pageHeight - (yTop + h),
      width: width / scale,
      height: h,
      conf: Number.isFinite(conf) ? conf : 0,
    })
  }
  return words
}

function groupByY<T extends { x: number; y: number }>(items: readonly T[], tolerance = 4): { y: number; items: T[] }[] {
  const rows: { y: number; items: T[] }[] = []
  for (const item of items) {
    let row = rows.find(r => Math.abs(r.y - item.y) <= tolerance)
    if (!row) {
      row = { y: item.y, items: [] }
      rows.push(row)
    }
    row.items.push(item)
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map(r => ({ ...r, items: r.items.sort((a, b) => a.x - b.x) }))
}

/** Normalizes OCR'd HSBC SG English dates (e.g. `21 OCT`, `30Sep`, `23 0ct`, `26 Sep ~~`) to `MM/DD`. */
export function normalizeOcrEnglishDate(text: string): string | undefined {
  const cleaned = text.normalize('NFKC').replace(/[^A-Za-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const match = cleaned.match(/^(\d{1,2})\s*([A-Z0][A-Z]{2})(?:\s|$)/i)
  if (!match) return undefined
  const day = Number(match[1])
  if (day < 1 || day > 31) return undefined
  const monthText = match[2].toUpperCase().replace(/^0/, 'O')
  const month = MONTHS.indexOf(monthText) + 1
  if (!month) return undefined
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`
}

/** True when Page 1's top banner clearly belongs to an HSBC Singapore credit card statement. */
export function isHsbcSgCardProbe(text: string): boolean {
  const normalized = text.normalize('NFKC')
  if (/綜合月對帳單|综合月对账单/.test(normalized)) return false
  if (!/\bHSBC\b/i.test(normalized)) return false
  const hasCardCue = /MINIMUM\s+PAYMENT|PAYMENT\s+DUE\s+DATE|TOTAL\s+DUE|CREDIT\s+LIMIT|AMOUNT\s*\(\s*SGD\s*\)|ACCOUNT\s+SUMMARY\s+SGD/i.test(normalized)
  const hasPeriodOrSg = /SINGAPORE|SGD|From\s+\d{1,2}\s+[A-Z]{3}\s+\d{4}\s+to\s+\d{1,2}\s+[A-Z]{3}\s+\d{4}/i.test(normalized)
  return hasCardCue && hasPeriodOrSg
}

function findTableHeader(rows: readonly { y: number; items: OcrWord[] }[]) {
  return rows.find(
    r => r.items.some(w => /^DESCRIPTION$/i.test(w.text)) && r.items.some(w => /^AMOUNT\s*\(\s*SGD\s*\)?$/i.test(w.text)),
  )
}

function parseSignedAmount(text: string): number | undefined {
  const compact = text.replace(/\s+/g, '').toUpperCase()
  const match = compact.match(/^([0-9,]+(?:\.\d{2})?)(CR|DR)?$/)
  if (!match) return undefined
  const value = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(value)) return undefined
  return match[2] === 'CR' ? -value : value
}

function formatAmount(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase().replace(/(\d)(CR|DR)$/, '$1 $2')
}

function headerGlyphSequence(page: GlyphPage, headerRow: { y: number; items: OcrWord[] }): string | undefined {
  const amtWord = headerRow.items.find(w => /^AMOUNT/i.test(w.text))
  if (!amtWord) return undefined
  const glyphs = page.glyphs
    .filter(g => Math.abs(g.y - headerRow.y) <= 4 && g.x >= amtWord.x - 3 && g.x <= amtWord.x + amtWord.width + 5)
    .sort((a, b) => a.x - b.x)
  return glyphs.length >= 6 ? glyphs.map(g => g.hash).join(',') : undefined
}

function pageHasHeaderSequence(page: GlyphPage, seq: string): boolean {
  const rows = groupByY(page.glyphs, 3)
  return rows.some(r => r.items.map(g => g.hash).join(',').includes(seq))
}

/**
 * Combines OCR'd table pages, applies document-wide glyph-hash majority voting to the `AMOUNT(SGD)` column,
 * and cross-checks `Previous Statement Balance + table rows === Total Due` when both anchors are present.
 */
export function buildHsbcSgOcrStatement(
  pages: readonly OcrTablePage[],
  probeLines: readonly string[],
  summaryLines: readonly string[],
): HsbcSgOcrResult {
  const votes = new Map<string, Map<string, number>>()
  type ExtractedRow = {
    kind: 'tx' | 'prev' | 'total'
    d1?: string
    d2?: string
    description: string
    ocrAmount: string
    glyphs: readonly GlyphBox[]
  }
  const extracted: ExtractedRow[] = []

  for (const page of pages) {
    const rows = groupByY(page.words, 4)
    const header = findTableHeader(rows)
    if (!header) continue
    const dateHeaders = header.items.filter(w => /^DATE$/i.test(w.text))
    const descHeader = header.items.find(w => /^DESCRIPTION$/i.test(w.text))!
    const amtHeader = header.items.find(w => /^AMOUNT/i.test(w.text))!
    const amtX = amtHeader.x - 5
    const amtRight = amtHeader.x + amtHeader.width + 22
    const dateSplitX = dateHeaders.length >= 2
      ? (dateHeaders[0].x + dateHeaders[1].x) / 2 + 12
      : descHeader.x / 2 + 25

    for (const row of rows) {
      if (row.y >= header.y - 2) continue
      const description = row.items
        .filter(w => w.x >= descHeader.x - 8 && w.x < amtX)
        .map(w => w.text)
        .join(' ')
        .trim()
      const amtWords = row.items.filter(w => w.x >= amtX && w.x <= amtRight)
      const isTotal = /^Total(?:\s|$)/i.test(description)
      if (!amtWords.length) {
        if (isTotal) break
        continue
      }
      const ocrAmount = amtWords.map(w => w.text).join(' ').trim()
      const avgConf = amtWords.reduce((sum, w) => sum + Math.max(1, w.conf), 0) / amtWords.length
      const amtY = Math.min(...amtWords.map(w => w.y))
      const amtGlyphs = page.glyphs
        .filter(g => Math.abs(g.y - amtY) <= 4 && g.x >= amtX && g.x <= amtRight)
        .sort((a, b) => a.x - b.x)
      const compact = ocrAmount.replace(/\s+/g, '')
      if (/^[0-9,.]+(?:CR|DR)?$/i.test(compact) && compact.length === amtGlyphs.length) {
        for (let i = 0; i < amtGlyphs.length; i++) {
          const hash = amtGlyphs[i].hash
          const ch = compact[i].toUpperCase()
          let bucket = votes.get(hash)
          if (!bucket) {
            bucket = new Map()
            votes.set(hash, bucket)
          }
          bucket.set(ch, (bucket.get(ch) ?? 0) + avgConf)
        }
      }

      if (isTotal) {
        extracted.push({ kind: 'total', description, ocrAmount, glyphs: amtGlyphs })
        break
      }
      if (/PREVIOUS\s+STATEMENT\s+BALANCE/i.test(description)) {
        extracted.push({ kind: 'prev', description, ocrAmount, glyphs: amtGlyphs })
        continue
      }
      const d1Raw = row.items.filter(w => w.x < dateSplitX).map(w => w.text).join(' ')
      const d2Raw = row.items.filter(w => w.x >= dateSplitX && w.x < descHeader.x - 8).map(w => w.text).join(' ')
      const d1 = normalizeOcrEnglishDate(d1Raw)
      const d2 = normalizeOcrEnglishDate(d2Raw)
      if (d1 && d2) {
        extracted.push({ kind: 'tx', d1, d2, description, ocrAmount, glyphs: amtGlyphs })
      }
    }
  }

  const consensus = new Map<string, string>()
  for (const [hash, bucket] of votes) {
    let bestChar = ''
    let bestScore = -1
    for (const [ch, score] of bucket) {
      if (score > bestScore) {
        bestChar = ch
        bestScore = score
      }
    }
    if (bestChar) consensus.set(hash, bestChar)
  }

  const resolveAmount = (row: ExtractedRow): string => {
    if (row.glyphs.length > 0 && row.glyphs.every(g => consensus.has(g.hash))) {
      const decoded = row.glyphs.map(g => consensus.get(g.hash)!).join('')
      if (parseSignedAmount(decoded) !== undefined) return formatAmount(decoded)
    }
    return formatAmount(row.ocrAmount)
  }

  const lines: string[] = [
    ...probeLines.map(l => l.trim()).filter(Boolean),
    ...summaryLines.map(l => l.trim()).filter(Boolean),
    'DATE DATE DESCRIPTION AMOUNT(SGD)',
  ]
  const transactionIndexes: number[] = []
  let prevBalance: number | undefined
  let statedTotal: number | undefined
  let netRows = 0
  let unparseableAmount = false

  for (const row of extracted) {
    const amountText = resolveAmount(row)
    const numeric = parseSignedAmount(amountText)
    if (row.kind === 'prev') {
      prevBalance = numeric
      lines.push(`${row.description} ${amountText}`)
    } else if (row.kind === 'total') {
      statedTotal = numeric
      lines.push(`${row.description} ${amountText}`)
    } else {
      if (numeric === undefined) unparseableAmount = true
      else netRows += numeric
      transactionIndexes.push(lines.length)
      lines.push(`${row.d1} ${row.d2} ${row.description} ${amountText}`.replace(/\s+/g, ' ').trim())
    }
  }

  let ocrError: string | undefined
  if (unparseableAmount) {
    ocrError = '本機 OCR 有部分金額無法辨識，請對照原帳單逐筆核對'
  } else if (prevBalance !== undefined && statedTotal !== undefined) {
    const computed = Math.round((prevBalance + netRows) * 100) / 100
    const expected = Math.round(statedTotal * 100) / 100
    if (Math.abs(computed - expected) >= 0.01) {
      ocrError = `本機 OCR 讀到的帳單合計（SGD ${computed.toFixed(2)}）與帳單 Total Due（SGD ${expected.toFixed(2)}）不符，請逐筆核對金額與筆數`
    }
  }

  return { lines, transactionIndexes, ...(ocrError && { ocrError }) }
}

/**
 * Fast probe for zero-text PDFs: inspects Page 1 for bitmap-glyph masks (`paintImageMaskXObject`),
 * and only runs a tiny top-banner OCR if enough glyph masks are present.
 * Returns `null` immediately (<2ms) for scanned photo PDFs that have no glyph masks.
 */
export async function probeHsbcSgGlyphPdf(
  pdf: StatementPdf,
  signal: AbortSignal,
  onProgress?: (message: string) => void,
): Promise<HsbcSgGlyphProbe | null> {
  if (signal.aborted) throw new Error('已取消解析')
  if (pdf.numPages < 1) return null
  const page = await pdf.getPage(1)
  let page1: GlyphPage
  try {
    page1 = await extractPageGlyphs(page, 1)
  } finally {
    page.cleanup()
  }
  if (page1.glyphs.length < MIN_MASK_GLYPHS) return null
  if (signal.aborted) throw new Error('已取消解析')

  onProgress?.('正在載入本機 OCR（英文）· 第 1 頁')
  const ocrModule = await import('./statementOcr')
  const ocr = await ocrModule.takeStatementOcr(signal, 'eng')
  try {
    if (signal.aborted) throw new Error('已取消解析')
    onProgress?.('正在本機辨識帳單標題 · 第 1 頁')
    const region: CropRegion = { x0: 30, y0: 30, x1: page1.width - 15, y1: Math.min(230, page1.height - 30) }
    const png = await renderGlyphRegionPng(page1.glyphs, region, page1.height)
    const recognized = await ocr.recognize(png, 'block')
    if (!isHsbcSgCardProbe(recognized.text)) {
      ocrModule.releaseStatementOcr(signal, ocr, 'eng')
      return null
    }
    const probeLines = recognized.text.split('\n').map(l => l.trim()).filter(Boolean)
    return { page1, probeLines, ocr }
  } catch (e) {
    ocr.close()
    throw e
  }
}

/** Reads an entire HSBC SG bitmap-glyph credit card PDF via crisp 300 DPI rendering, OCR, and glyph consensus. */
export async function readHsbcSgGlyphPdf(
  pdf: StatementPdf,
  signal: AbortSignal,
  onProgress?: (message: string) => void,
  existingProbe?: HsbcSgGlyphProbe,
): Promise<StatementPdfRead | null> {
  const probe = existingProbe ?? await probeHsbcSgGlyphPdf(pdf, signal, onProgress)
  if (!probe) return null
  const ocrModule = await import('./statementOcr')
  const { ocr } = probe
  let ocrFailed = false
  try {
    if (signal.aborted) throw new Error('已取消解析')
    const { page1, probeLines } = probe
    onProgress?.(`正在本機辨識帳單摘要 · 第 1／${pdf.numPages} 頁`)
    const summaryRegion: CropRegion = {
      x0: SUMMARY_X0,
      y0: 150,
      x1: Math.max(SUMMARY_X0 + 50, page1.width - 15),
      y1: Math.min(480, page1.height - 30),
    }
    const summaryPng = await renderGlyphRegionPng(page1.glyphs, summaryRegion, page1.height)
    const summaryRes = await ocr.recognize(summaryPng, 'block')
    const summaryLines = summaryRes.text.split('\n').map(l => l.trim()).filter(Boolean)

    const ocrPages: OcrTablePage[] = []
    let headerSeq: string | undefined

    for (let p = 1; p <= pdf.numPages; p++) {
      if (signal.aborted) throw new Error('已取消解析')
      const at = `第 ${p}／${pdf.numPages} 頁`
      let glyphPage: GlyphPage
      if (p === 1) {
        glyphPage = page1
      } else {
        const page = await pdf.getPage(p)
        try {
          glyphPage = await extractPageGlyphs(page, p)
        } finally {
          page.cleanup()
        }
      }
      if (glyphPage.glyphs.length < MIN_MASK_GLYPHS) continue
      if (p > 1 && headerSeq && !pageHasHeaderSequence(glyphPage, headerSeq)) continue

      // If Page 1 had no transaction table, probe only the upper strip before OCRing a dense legal page.
      if (p > 1 && !headerSeq) {
        const stripRegion: CropRegion = {
          x0: TABLE_LEFT_X0,
          y0: 100,
          x1: Math.min(TABLE_LEFT_X1, glyphPage.width - 15),
          y1: Math.min(360, glyphPage.height - 30),
        }
        const stripPng = await renderGlyphRegionPng(glyphPage.glyphs, stripRegion, glyphPage.height)
        const stripRes = await ocr.recognize(stripPng, 'block')
        if (!/DESCRIPTION[\s\S]*AMOUNT\s*\(\s*SGD/i.test(stripRes.text)) continue
      }

      onProgress?.(`正在本機辨識交易明細 · ${at}`)
      const region: CropRegion = {
        x0: TABLE_LEFT_X0,
        y0: 30,
        x1: Math.min(TABLE_LEFT_X1, glyphPage.width - 15),
        y1: glyphPage.height - 30,
      }
      const png = await renderGlyphRegionPng(glyphPage.glyphs, region, glyphPage.height)
      const res = await ocr.recognize(png, 'block')
      const words = parseOcrTsvWords(res.tsv ?? '', region, glyphPage.height)
      const header = findTableHeader(groupByY(words, 4))
      if (header && !headerSeq) {
        headerSeq = headerGlyphSequence(glyphPage, header)
      }
      if (header) {
        ocrPages.push({ page: p, glyphs: glyphPage.glyphs, words })
      }
    }

    const built = buildHsbcSgOcrStatement(ocrPages, probeLines, summaryLines)
    if (!built.transactionIndexes.length) return null
    return {
      lines: built.lines,
      title: '',
      ocrUsed: true,
      ...(built.ocrError && { ocrError: built.ocrError }),
      transactionIndexes: built.transactionIndexes,
    }
  } catch (e) {
    ocrFailed = true
    ocr.close()
    throw e
  } finally {
    if (!ocrFailed) ocrModule.releaseStatementOcr(signal, ocr, 'eng')
  }
}
