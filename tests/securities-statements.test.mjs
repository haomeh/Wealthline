import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { page } from './fixtures/bank-statements/layouts.mjs'
import { row, summary, positionPage, cashPage } from './fixtures/securities-layouts.mjs'

let server, parse, toCsv, kind, sheet, model
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-securities', configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  const mod = await server.ssrLoadModule('/src/securitiesStatements.ts')
  parse = mod.parseSecuritiesStatement; toCsv = mod.securitiesPositionCsv
  kind = await server.ssrLoadModule('/src/statementKind.ts')
  sheet = await server.ssrLoadModule('/src/importSheet.ts')
  model = await server.ssrLoadModule('/src/model.ts')
})
after(() => server?.close())

test('positions, cash, trades and cash movements are read and cross-checked against the printed totals', () => {
  // 60.00 USD x 1.25 = 75.00 SGD of holdings; portfolio value and cash are the page 1 figures.
  const r = parse([summary('75.00'), positionPage(), cashPage()])
  assert.ok(r)
  assert.equal(r.account, 'moomoo (1234)')
  assert.equal(r.statementDate, '2026-01-02')
  assert.deepEqual(r.positions.map(p => [p.symbol, p.name, p.currency, p.quantity, p.price, p.value]), [['EXMP', 'Example Corp', 'USD', 2, 30, 60]])
  assert.equal(r.closedCount, 1)
  assert.deepEqual(r.cash.map(c => [c.currency, c.starting, c.ending]), [['SGD', 100, 100], ['USD', 0, 8]])
  assert.deepEqual(r.trades.map(t => [t.date, t.time, t.direction, t.symbol, t.currency, t.price, t.quantity, t.amount, t.fee]), [['2026-01-02', '10:00:00', 'Sell to Close', 'CLSD', 'USD', 10, 1, 10, 0.1]])
  assert.deepEqual(r.cashflows.map(c => [c.date, c.type, c.currency, c.amount]), [['2026-01-02', 'Dividend', 'USD', 0.5]])
  assert.deepEqual(r.warnings, [])
  assert.equal(r.status, 'recognized')
})

test('a printed total that does not match the rows read makes the result partial instead of dropping rows', () => {
  const r = parse([summary('75.00'), positionPage('60.00', '61.00'), cashPage()])
  assert.equal(r.status, 'partial')
  assert.ok(r.warnings.some(w => w.code === 'position-total-mismatch'), JSON.stringify(r.warnings))
  assert.equal(r.positions.length, 1)
  const wrongPortfolio = parse([summary('99.00'), positionPage(), cashPage()])
  assert.ok(wrongPortfolio.warnings.some(w => w.code === 'portfolio-value-mismatch'), JSON.stringify(wrongPortfolio.warnings))
})

test('pages that are not a securities statement are not recognized', () => {
  assert.equal(parse([page(1, row(700, ['Statement of Account', 30, 100], ['Date', 60, 20]))]), undefined)
})

// A 台新證券 trade confirmation (invented): a plain row, a row whose name wraps over two lines, an odd lot, and a subtotal.
const bill = (subtotalNet = '11,098') => [page(1, [
  ...row(784, ['親愛的 測試 君 ( 台中分公司 - 0001234 )', 73, 130]),
  ...row(772, ['感謝您對台新證券的支持與愛護，閣下於民國 113 年 3 月 12 日的成交資料如下！', 73, 240]),
  ...row(742, ['類別', 80, 13], ['股票', 105, 13], ['數量', 136, 13], ['成交價', 199, 20], ['價金', 227, 13], ['手續費', 248, 20], ['交易稅', 275, 20]),
  ...row(721, ['現買', 80, 13], ['範例甲', 105, 20], ['1,000', 141, 25], ['0', 189, 4], ['4.00', 207, 13], ['4,000', 225, 17], ['20', 262, 8], ['0', 292, 4], ['0', 376, 4], ['-4,020', 500, 20]),
  ...row(706, ['範例乙航', 102, 25]),
  ...row(701, ['現買', 80, 13], ['16', 150, 8], ['0', 189, 4], ['27.80', 202, 17], ['444', 233, 12], ['20', 263, 8], ['0', 294, 4], ['0', 376, 4], ['-464', 505, 15]),
  ...row(695, ['空', 109, 7]),
  ...row(680, ['現賣', 80, 13], ['範例丙', 102, 20], ['1,000', 141, 25], ['0', 189, 4], ['15.65 15,650', 202, 43], ['22', 263, 8], ['46', 290, 8], ['0', 376, 4], ['15,582', 499, 21]),
  ...row(665, ['小計 :', 75, 17], ['20,094', 223, 21], ['62', 263, 8], ['46', 290, 8], [subtotalNet, 499, 21]),
  ...row(650, ['提醒您，為維護您的權益', 73, 200]),
])]

test('台新證券 trade confirmation: names that wrap, merged price and amount cells, and the subtotal are read', () => {
  const r = parse(bill())
  assert.ok(r)
  assert.equal(r.broker, '台新證券')
  assert.equal(r.statementDate, '2024-03-12')
  assert.deepEqual(r.trades.map(t => [t.direction, t.name, t.quantity, t.price, t.amount, t.fee, t.tax, t.net]), [
    ['現買', '範例甲', 1000, 4, 4000, 20, 0, -4020],
    ['現買', '範例乙航空', 16, 27.8, 444, 20, 0, -464],
    ['現賣', '範例丙', 1000, 15.65, 15650, 22, 46, 15582],
  ])
  assert.deepEqual(r.warnings, [])
  assert.equal(r.status, 'recognized')
})

test('台新證券 subtotal that does not add up is reported', () => {
  const r = parse(bill('-4,060'))
  assert.equal(r.status, 'partial')
  assert.ok(r.warnings.some(w => w.code === 'trade-subtotal-mismatch'), JSON.stringify(r.warnings))
  assert.equal(r.trades.length, 3)
})

test('the import entry sees a securities statement as its own kind; one that does not add up says so', () => {
  assert.deepEqual(kind.classifyStatement([summary('75.00'), positionPage(), cashPage()]), { kind: 'securities', bank: 'moomoo (1234)' })
  const partial = kind.classifyStatement([summary('75.00'), positionPage('60.00', '61.00'), cashPage()])
  assert.equal(partial.kind, 'securities')
  assert.match(partial.reason, /對不上/)
  assert.equal(kind.classifyStatement(bill()).kind, 'securities')
})

test('cash and holdings become a position CSV the accounts import accepts: tickers are priced later, other codes keep the statement price', () => {
  const r = parse([summary('75.00'), positionPage(), cashPage()])
  assert.equal(toCsv(r, 'moomoo (1234)'), ['type,account,kind,country,currency,symbol,quantity,price',
    'position,moomoo (1234),investment,SG,SGD,,100,', 'position,moomoo (1234),investment,SG,USD,,8,', 'position,moomoo (1234),investment,SG,USD,EXMP,2,'].join('\n'))
  const result = sheet.importPositionCsv(model.emptyData(), toCsv(r, 'moomoo (1234)', '海外股票 (新股)'))
  assert.deepEqual(result.errors, [])
  const [account] = result.data.accounts
  assert.deepEqual([account.name, account.kind, account.country, account.category], ['moomoo (1234)', 'investment', 'SG', '海外股票 (新股)'])
  assert.deepEqual(account.positions.map(p => [p.type, p.currency, p.symbol, p.quantity, p.price]), [['cash', 'SGD', '', 100, 1], ['cash', 'USD', '', 8, 1], ['holding', 'USD', 'EXMP', 2, 0]])
  // A fund code is not a ticker: it carries the statement's closing price.
  const fund = parse([summary('75.00'), positionPage(), cashPage()])
  fund.positions[0].symbol = 'SGXZ40088619'
  assert.match(toCsv(fund, 'x'), /,SGXZ40088619,2,30$/m)
  assert.equal(toCsv(parse(bill()), 'x'), '')
})
