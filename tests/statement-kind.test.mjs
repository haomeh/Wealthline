import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { hsbc, compact, item, right, page, mast } from './fixtures/bank-statements/layouts.mjs'
import { observedSg, observedFubon, observedEsun } from './fixtures/bank-statements/fragmented.mjs'

let server, kind
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-statement-kind', configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  kind = await server.ssrLoadModule('/src/statementKind.ts')
})
after(() => server?.close())

// The same positioned pages the bank reader builds (statementDocument.ts), from a fixture PDF.
async function pdfPages(name, password = '') {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url))), password,
    cMapUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url)),
    standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)), verbosity: 0 })
  try {
    const pdf = await task.promise, pages = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const p = await pdf.getPage(n), viewport = p.getViewport({ scale: 1 }), text = await p.getTextContent()
      pages.push({ page: n, width: viewport.width, height: viewport.height, items: text.items.filter((i) => 'str' in i).map((i) => {
        const [x, y] = viewport.convertToViewportPoint(i.transform[4], i.transform[5])
        return { text: i.str, x, y: viewport.height - y, width: Math.abs(i.width), height: Math.abs(i.height) }
      }) })
    }
    return pages
  } finally { await task.destroy() }
}
// A card statement page: issuer masthead, title and a 消費日／入帳日 table, as the card fixtures print them.
const cardPage = (lines) => [page(1, lines.map((text, n) => item(text, 30, 820 - n * 20, 200)))]

test('every supported bank statement layout is a bank statement, named by its bank', () => {
  for (const [pages, bank] of [[hsbc(), 'HSBC (TW)'], [hsbc(true), 'HSBC (SG)'], [compact('taishin'), '台新銀行 (TW)'], [compact('fubon'), '富邦銀行 (TW)'], [compact('esun'), '玉山銀行 (TW)'],
    [observedSg(), 'HSBC (SG)'], [observedFubon(), '富邦銀行 (TW)'], [observedEsun(), '玉山銀行 (TW)']]) {
    assert.deepEqual(kind.classifyStatement(pages, 'statement.pdf'), { kind: 'bank', bank })
  }
})

test('the card statement fixtures are card statements, without OCR', async () => {
  for (const [name, password, bank] of [['synthetic-batch-esun-encrypted.pdf', 'fixture-esun', '玉山'], ['synthetic-batch-fubon-encrypted.pdf', 'fixture-fubon', '富邦'],
    ['synthetic-hsbc-2026-04-image-merchants.pdf', '', '匯豐'], ['synthetic-hsbc-2026-04-multipage.pdf', '', '匯豐'], ['synthetic-hsbc-sg.pdf', '', '匯豐'],
    ['synthetic-statement-cjk.pdf', '', undefined], ['synthetic-statement-encrypted.pdf', 'fixture-password', undefined], ['synthetic-statement.pdf', '', undefined]]) {
    assert.deepEqual(kind.classifyStatement(await pdfPages(name, password), name), { kind: 'card', ...(bank && { bank }) }, name)
  }
  assert.equal(kind.classifyStatement(await pdfPages('synthetic-scan.pdf'), 'scan.pdf').kind, 'unknown')
})

test('a deposit table decides bank even with card words; card words alone decide card', () => {
  // A credit card payment is an ordinary bank row.
  assert.equal(kind.classifyStatement(compact('fubon')).kind, 'bank')
  const withCardSummary = compact('esun'); withCardSummary[0].items.push(item('信用卡摘要 本期應繳總額 1,200', 35, 760, 200))
  const both = kind.classifyStatement(withCardSummary)
  assert.equal(both.kind, 'bank'); assert.match(both.reason, /也有信用卡帳單字樣.*另以「信用卡帳單」匯入/)
  assert.deepEqual(kind.classifyStatement(cardPage(['台北富邦銀行', '信用卡帳單', '本期應繳總金額 1,200', '消費日 入帳日 消費明細 臺幣金額', '115/04/06 115/04/08 SHOP 100'])), { kind: 'card', bank: '富邦' })
  for (const marker of ['最低應繳金額 120', '消費日期 入帳日期 說明 金額', 'Minimum Payment Due 30.00', 'CREDIT CARD STATEMENT', 'DATE DATE DESCRIPTION AMOUNT(SGD)', '玉山信用卡電子帳單']) {
    assert.equal(kind.classifyStatement(cardPage(['Synthetic issuer', marker, '04/01 04/02 SHOP 100'])).kind, 'card', marker)
  }
})

test('a file that is neither is unknown and says why; the bank it names is kept for the report', () => {
  // The bank's masthead but no supported table and no card phrase: not guessed either way.
  const summary = [page(1, [...mast('台北富邦銀行'), item('帳戶摘要 帳號: 8800002222 TWD', 35, 770), item('一般存款 餘額 1,000', 35, 740)])]
  assert.deepEqual(kind.classifyStatement(summary), { kind: 'unknown', bank: '富邦銀行 (TW)', reason: '看起來是 富邦銀行 (TW) 的文件，但沒有已支援的銀行交易表，也沒有信用卡帳單特徵' })
  // Card advertising and a card payment row are not card statement phrases.
  const advert = [page(1, [item('信用卡繳款 循環信用利率 信用卡優惠', 30, 820, 200), item('2031/04/08 Payment 100 900', 30, 780, 200)])]
  assert.deepEqual(kind.classifyStatement(advert), { kind: 'unknown', reason: '沒有已支援的銀行交易表，也沒有信用卡帳單特徵' })
  assert.deepEqual(kind.classifyStatement([page(1, [])]), { kind: 'unknown', reason: '沒有已支援的銀行交易表，也沒有信用卡帳單特徵' })
})

test('securities statements are unknown, by content or file name, unless a bank table was recognized', () => {
  const broker = [page(1, [item('台新證券 綜合月對帳單', 30, 820, 200), item('本期應繳總額 0', 30, 800, 200)])]
  assert.deepEqual(kind.classifyStatement(broker), { kind: 'unknown', reason: '證券對帳單不支援' })
  assert.deepEqual(kind.classifyStatement(cardPage(['本期應繳總額 1,200']), '證券月報.pdf'), { kind: 'unknown', reason: '證券對帳單不支援' })
  const traded = compact('taishin'); traded[0].items.push(item('證券帳號 成交日期 買賣別', 35, 600, 200))
  assert.equal(kind.classifyStatement(traded).kind, 'bank')
})

test('a parser failure on oversized text is not a bank statement', () => {
  const huge = [page(1, [item('本期應繳總額', 30, 820), ...Array.from({ length: 101 }, (_, i) => right('x'.repeat(5000), 600, 700 - i))])]
  assert.equal(kind.classifyStatement(huge).kind, 'card')
})
