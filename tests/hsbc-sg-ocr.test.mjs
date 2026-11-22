import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'

let server, hsbcSgOcr, statements, totals

before(async () => {
  server = await createServer({
    cacheDir: 'node_modules/.vite-hsbc-sg-ocr',
    configFile: false,
    envDir: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  })
  hsbcSgOcr = await server.ssrLoadModule('/src/hsbcSgOcr.ts')
  statements = await server.ssrLoadModule('/src/statements.ts')
  totals = await server.ssrLoadModule('/src/statementTotals.ts')
})

after(async () => { await server?.close() })

// Helper: build a synthetic 1-bit glyph box with a distinct bitmap per label.
function syntheticGlyph(label, x, y, w = 4, h = 6) {
  const bytes = new Uint8Array(8)
  for (let i = 0; i < label.length && i < bytes.length; i++) bytes[i] = label.charCodeAt(i)
  return {
    x,
    y,
    w,
    h,
    pw: 8,
    ph: 8,
    data: bytes,
    hash: hsbcSgOcr.hashGlyphBitmap(8, 8, bytes),
  }
}

// Helper: create a sequence of glyphs for an amount string placed right-to-left or left-to-right at (startX, y).
function amountGlyphs(text, startX, y) {
  const chars = text.replace(/\s+/g, '')
  return [...chars].map((ch, idx) => syntheticGlyph(`digit:${ch}`, startX + idx * 4.5, y))
}

test('hashGlyphBitmap is deterministic and distinguishes both pixels and dimensions', () => {
  const a = new Uint8Array([0b10101010, 0b01010101])
  const b = new Uint8Array([0b10101010, 0b01010100])
  assert.equal(hsbcSgOcr.hashGlyphBitmap(8, 2, a), hsbcSgOcr.hashGlyphBitmap(8, 2, new Uint8Array(a)))
  assert.notEqual(hsbcSgOcr.hashGlyphBitmap(8, 2, a), hsbcSgOcr.hashGlyphBitmap(8, 2, b))
  assert.notEqual(hsbcSgOcr.hashGlyphBitmap(8, 2, a), hsbcSgOcr.hashGlyphBitmap(4, 4, a))
})

test('extractPageGlyphs tracks CTM save/restore/transform, resolves page.objs, and handles missing operator list', async () => {
  const noOps = await hsbcSgOcr.extractPageGlyphs({ getViewport: () => ({ width: 595, height: 842 }) }, 1)
  assert.deepEqual(noOps, { page: 1, width: 595, height: 842, glyphs: [] })

  const bitmap = new Uint8Array([0x00, 0xff])
  const objs = new Map([['mask_p0_1', { width: 8, height: 2, data: bitmap }]])
  const mockPage = {
    getViewport: () => ({ width: 595, height: 842 }),
    objs: { has: k => objs.has(k), get: k => objs.get(k) },
    getOperatorList: async () => ({
      fnArray: [10, 12, 83, 11, 10, 12, 83, 11],
      argsArray: [
        [],
        [4.1, 0, 0, 6.0, 320.5, 500.2],
        [{ data: 'mask_p0_1', width: 8, height: 2 }],
        [],
        [],
        [4.1, 0, 0, 6.0, 325.0, 500.2],
        [{ data: bitmap, width: 8, height: 2 }],
        [],
      ],
    }),
  }
  const page = await hsbcSgOcr.extractPageGlyphs(mockPage, 1)
  assert.equal(page.glyphs.length, 2)
  assert.equal(page.glyphs[0].x, 320.5)
  assert.equal(page.glyphs[1].x, 325.0)
  assert.equal(page.glyphs[0].hash, page.glyphs[1].hash)
})

test('renderGlyphRegionRgba draws 1-bit black pixels on white background and parseOcrTsvWords inverts coordinates', () => {
  // Single 8x1 bitmap where leftmost bit is 0 (black) and remaining bits are 1 (transparent/white).
  const data = new Uint8Array([0b01111111])
  const glyph = { x: 50, y: 700, w: 8 / hsbcSgOcr.NATIVE_GLYPH_SCALE, h: 1 / hsbcSgOcr.NATIVE_GLYPH_SCALE, hash: 'h', pw: 8, ph: 1, data }
  const region = { x0: 40, y0: 100, x1: 70, y1: 150 }
  const rendered = hsbcSgOcr.renderGlyphRegionRgba([glyph], region, 842, hsbcSgOcr.NATIVE_GLYPH_SCALE)
  assert.ok(rendered.width > 0 && rendered.height > 0)
  // Top-left corner (0,0) is white
  assert.deepEqual([...rendered.rgba.slice(0, 4)], [255, 255, 255, 255])
  // At least one black pixel was painted for the glyph
  let blackPixels = 0
  for (let i = 0; i < rendered.rgba.length; i += 4) {
    if (rendered.rgba[i] === 0 && rendered.rgba[i + 1] === 0 && rendered.rgba[i + 2] === 0) blackPixels++
  }
  assert.equal(blackPixels, 1)

  const scale = 4
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    `5\t1\t1\t1\t1\t1\t${40 * scale}\t${20 * scale}\t${30 * scale}\t${10 * scale}\t95\tAMOUNT(SGD)`,
  ].join('\n')
  const words = hsbcSgOcr.parseOcrTsvWords(tsv, { x0: 40, y0: 30, x1: 378, y1: 800 }, 842, scale)
  assert.equal(words.length, 1)
  assert.equal(words[0].text, 'AMOUNT(SGD)')
  assert.equal(words[0].x, 80)
  assert.equal(words[0].y, 842 - (30 + 20 + 10))
})

test('normalizeOcrEnglishDate handles OCR spacing/zero/noise quirks and rejects invalid dates', () => {
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('21 OCT'), '10/21')
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('30Sep'), '09/30')
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('23 0ct'), '10/23')
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('26 Sep ~~'), '09/26')
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('5 NOV'), '11/05')
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('32 OCT'), undefined)
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('15 XXX'), undefined)
  assert.equal(hsbcSgOcr.normalizeOcrEnglishDate('Total Due'), undefined)
})

test('isHsbcSgCardProbe matches HSBC SG credit card banners and rejects non-HSBC or securities text', () => {
  assert.equal(hsbcSgOcr.isHsbcSgCardProbe('HSBC VISA REVOLUTION\nStatement period\nFrom 21 OCT 2026 to 20 NOV 2026\nMinimum Payment 50.00'), true)
  assert.equal(hsbcSgOcr.isHsbcSgCardProbe('HSBC Bank (Singapore) Limited\nACCOUNT SUMMARY SGD\nTotal Due 123.45'), true)
  assert.equal(hsbcSgOcr.isHsbcSgCardProbe('Other Bank Singapore\nMinimum Payment 50.00'), false)
  assert.equal(hsbcSgOcr.isHsbcSgCardProbe('HSBC 綜合月對帳單 Minimum Payment SGD'), false)
  assert.equal(hsbcSgOcr.isHsbcSgCardProbe('Random scanned photo text'), false)
})

test('buildHsbcSgOcrStatement applies glyph-hash consensus to fix OCR digit misreads and reconciles totals', () => {
  const word = (text, x, y, width = 20, conf = 95) => ({ text, x, y, width, height: 8, conf })
  const headerWords = [
    word('DATE', 58, 660, 20),
    word('DATE', 103, 660, 20),
    word('DESCRIPTION', 141, 660, 50),
    word('AMOUNT(SGD)', 280, 660, 74),
  ]

  // Build synthetic table where digit '5' appears cleanly on 6 rows,
  // and is deliberately misread by OCR on 2 rows: '10.75' -> '10.76' and '15.34 CR' -> '16.34 CR',
  // plus '9.75' -> '9.756' (wrong character count).
  // All of them share the EXACT same glyph hash for '5'!
  const tableRows = [
    { y: 630, d1: null, d2: null, desc: 'PREVIOUS STATEMENT BALANCE', trueAmt: '15.34', ocrAmt: '15.34', conf: 96 },
    { y: 610, d1: '22 OCT', d2: '22 OCT', desc: 'PAYMENT - THANK YOU', trueAmt: '15.34CR', ocrAmt: '16.34 CR', conf: 62 },
    { y: 590, d1: '23 0ct', d2: '24 OCT', desc: 'SYNTHETIC CAFE A', trueAmt: '9.50', ocrAmt: '9.50', conf: 95 },
    { y: 570, d1: '25 OCT', d2: '26 OCT', desc: 'SYNTHETIC SHOP B', trueAmt: '5.55', ocrAmt: '5.55', conf: 96 },
    { y: 550, d1: '27 OCT', d2: '28 OCT', desc: 'SYNTHETIC MART C', trueAmt: '15.00', ocrAmt: '15.00', conf: 94 },
    { y: 530, d1: '29 OCT', d2: '30Oct', desc: 'SYNTHETIC DINER D', trueAmt: '10.75', ocrAmt: '10.76', conf: 65 },
    { y: 510, d1: '01 NOV', d2: '02 NOV', desc: 'SYNTHETIC STORE E', trueAmt: '9.75', ocrAmt: '9.756', conf: 58 },
    { y: 490, d1: '03 NOV', d2: '04 NOV', desc: 'SYNTHETIC REFUND F', trueAmt: '2.00CR', ocrAmt: '2.00 CR', conf: 95 },
    { y: 460, d1: null, d2: null, desc: 'Total Due', trueAmt: '48.55', ocrAmt: '48.55', conf: 96 },
    // Ad row below Total Due must be ignored
    { y: 430, d1: '05 NOV', d2: '06 NOV', desc: 'IGNORED PROMO ROW', trueAmt: '999.00', ocrAmt: '999.00', conf: 96 },
  ]

  const words = [...headerWords]
  const glyphs = []
  for (const r of tableRows) {
    if (r.d1) {
      const parts = r.d1.split(' ')
      parts.forEach((p, idx) => words.push(word(p, 58 + idx * 12, r.y, 10, 95)))
    }
    if (r.d2) {
      const parts = r.d2.split(' ')
      parts.forEach((p, idx) => words.push(word(p, 103 + idx * 12, r.y, 10, 95)))
    }
    r.desc.split(' ').forEach((p, idx) => words.push(word(p, 141 + idx * 25, r.y, 20, 95)))
    r.ocrAmt.split(' ').forEach((p, idx) => words.push(word(p, 325 + idx * 24, r.y, 20, r.conf)))
    glyphs.push(...amountGlyphs(r.trueAmt, 325, r.y))
  }

  const probeLines = ['HSBC VISA REVOLUTION', 'Statement period', 'From 21 OCT 2026 to 20 NOV 2026 48.55 50.00 15 DEC 2026']
  const summaryLines = ['Purchases & Debits 50.55', 'Payments & Credits 17.34']

  const built = hsbcSgOcr.buildHsbcSgOcrStatement([{ page: 1, glyphs, words }], probeLines, summaryLines)
  assert.equal(built.ocrError, undefined)

  // Verify statementMetadata reads the Page 1 "From ... to ..." period + HSBC + SGD
  const meta = statements.statementMetadata(built.lines, '', 'synthetic-hsbc-sg.pdf')
  assert.deepEqual(meta, { bank: '匯豐', currency: 'SGD', month: '2026-11', monthSource: '帳單結帳日' })

  // Verify parseStatement excludes PAYMENT - THANK YOU & keeps all 6 genuine transactions with consensus-corrected amounts
  const parsed = statements.parseStatement(built.lines, meta.month, meta.currency, meta.bank, built.transactionIndexes)
  assert.deepEqual(
    parsed.rows.map(r => [r.date, r.description, r.amount, r.currency]),
    [
      ['2026-10-23', 'SYNTHETIC CAFE A', 9.5, 'SGD'],
      ['2026-10-25', 'SYNTHETIC SHOP B', 5.55, 'SGD'],
      ['2026-10-27', 'SYNTHETIC MART C', 15, 'SGD'],
      ['2026-10-29', 'SYNTHETIC DINER D', 10.75, 'SGD'],
      ['2026-11-01', 'SYNTHETIC STORE E', 9.75, 'SGD'],
      ['2026-11-03', 'SYNTHETIC REFUND F', -2, 'SGD'],
    ],
  )

  // Verify statementTotalCheck matches Purchases & Debits (50.55) to the cent
  const check = totals.statementTotalCheck(built.lines, meta.bank, meta.currency, parsed.rows)
  assert.deepEqual(check, { label: 'Purchases & Debits', currency: 'SGD', stated: 50.55, parsed: 50.55, matches: true })
})

test('buildHsbcSgOcrStatement surfaces explicit warnings on Total Due mismatch or unparseable amount', () => {
  const word = (text, x, y, width = 20, conf = 95) => ({ text, x, y, width, height: 8, conf })
  const words = [
    word('DATE', 58, 660, 20), word('DATE', 103, 660, 20), word('DESCRIPTION', 141, 660, 50), word('AMOUNT(SGD)', 280, 660, 74),
    word('PREVIOUS', 141, 630), word('STATEMENT', 180, 630), word('BALANCE', 230, 630), word('10.00', 330, 630),
    word('25', 58, 600), word('OCT', 70, 600), word('26', 103, 600), word('OCT', 115, 600), word('SHOP', 141, 600), word('20.00', 330, 600),
    word('Total', 141, 560), word('Due', 175, 560), word('50.00', 330, 560),
  ]
  const mismatch = hsbcSgOcr.buildHsbcSgOcrStatement([{ page: 1, glyphs: [], words }], ['HSBC'], [])
  assert.match(mismatch.ocrError ?? '', /Total Due.*不符/)

  const badAmountWords = [
    word('DATE', 58, 660, 20), word('DATE', 103, 660, 20), word('DESCRIPTION', 141, 660, 50), word('AMOUNT(SGD)', 280, 660, 74),
    word('25', 58, 600), word('OCT', 70, 600), word('26', 103, 600), word('OCT', 115, 600), word('SHOP', 141, 600), word('9.756', 330, 600),
  ]
  const bad = hsbcSgOcr.buildHsbcSgOcrStatement([{ page: 1, glyphs: [], words: badAmountWords }], ['HSBC'], [])
  assert.match(bad.ocrError ?? '', /無法辨識/)
})

test('probeHsbcSgGlyphPdf returns null without touching OCR for scanned PDFs with zero mask glyphs', async () => {
  const { readFile } = await import('node:fs/promises')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(await readFile(new URL('./fixtures/synthetic-scan.pdf', import.meta.url))), verbosity: 0 })
  try {
    const pdf = await task.promise
    const probe = await hsbcSgOcr.probeHsbcSgGlyphPdf(pdf, new AbortController().signal)
    assert.equal(probe, null)
  } finally {
    await task.destroy()
  }
})
