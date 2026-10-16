import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
import { page } from './fixtures/bank-statements/layouts.mjs'
import { row, summary, positionPage, cashPage, endingPage } from './fixtures/securities-layouts.mjs'

let server, parse, toCsv, cashOf, kind, sheet, model
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-securities', configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  const mod = await server.ssrLoadModule('/src/securitiesStatements.ts')
  parse = mod.parseSecuritiesStatement; toCsv = mod.securitiesPositionCsv; cashOf = mod.securitiesCash
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
  fund.positions[0].symbol = 'SGXZ40088619'; fund.positions[0].exchange = 'FD'
  assert.match(toCsv(fund, 'x'), /,SGXZ40088619,2,30$/m)
  assert.equal(toCsv(parse(bill()), 'x'), '')
})

const codes = (r) => r.warnings.map((w) => w.code)
const withTransit = () => [summary('75.00', { transit: '20.00' }), positionPage(), endingPage(), cashPage()]

test('money in transit is read, checked against the net asset value, and counted in the cash of its currency', () => {
  const r = parse(withTransit())
  assert.deepEqual(r.warnings, [])
  assert.deepEqual(r.inTransit.map((t) => [t.type, t.symbol, t.currency, t.amount, t.baseAmount]), [['Subscription', 'SGXZ00000001', 'SGD', 20, 20]])
  // 100 SGD of cash plus the 20 subscribed and not yet a holding.
  assert.deepEqual(cashOf(r), [{ currency: 'SGD', amount: 120 }, { currency: 'USD', amount: 8 }])
  assert.match(toCsv(r, 'x'), /^position,x,investment,SG,SGD,,120,$/m)
  // A redemption in transit is negative: the cash has arrived while the fund still lists its units.
  r.inTransit[0].amount = -30
  assert.deepEqual(cashOf(r), [{ currency: 'SGD', amount: 70 }, { currency: 'USD', amount: 8 }])
  // Transit the net asset value does not include is a statement that does not add up.
  const off = parse([summary('75.00', { transit: '0.00', nav: '185.00' }), positionPage(), endingPage(), cashPage()])
  assert.ok(codes(off).includes('transit-total-mismatch') || codes(off).includes('net-asset-value-mismatch'), JSON.stringify(off.warnings))
})

test('a reference figure the statement should print and the reader cannot find is a warning, never a skipped check', () => {
  // No exchange rates on page 1: nothing can be converted, so nothing can be checked.
  assert.ok(codes(parse([summary('75.00', { rates: false }), positionPage(), cashPage()])).includes('exchange-rate-missing'))
  // Cash in a currency without a rate.
  const hkd = page(5, [...row(553, ['HKD', 53, 15], ['Date/Time', 287, 36], ['Type', 418, 17], ['Amount', 548, 27], ['Comment', 679, 33]), ...row(529, ['Starting Cash', 53, 46], ['0.00', 243, 17]), ...row(505, ['Ending Cash', 53, 42], ['5,000.00', 235, 36])])
  const withHkd = parse([summary('75.00'), positionPage(), cashPage(), hkd])
  assert.deepEqual(withHkd.warnings.filter((w) => w.code === 'exchange-rate-missing').map((w) => w.detail), ['HKD'])
  assert.ok(codes(parse([summary('75.00', { nav: null }), positionPage(), cashPage()])).includes('net-asset-value-missing'))
})

test('the quantity that gets imported has to agree with the printed price and value, and with the ending positions table', () => {
  // 3 x 30 is not 60.
  const wrong = parse([summary('75.00'), positionPage('60.00', '60.00', { quantity: '3' }), cashPage()])
  assert.ok(codes(wrong).includes('position-value-mismatch'), JSON.stringify(wrong.warnings))
  // The two position tables disagree on the quantity.
  const disagree = parse([summary('75.00', { transit: '20.00' }), positionPage(), endingPage({ quantity: '3' }), cashPage()])
  assert.ok(codes(disagree).includes('ending-position-quantity-mismatch'), JSON.stringify(disagree.warnings))
  assert.equal(disagree.status, 'partial')
})

test('a holding whose name starts with a section heading is not the end of the table', () => {
  const r = parse([summary('75.00'), positionPage('60.00', '60.00', { name: 'Securities Co' }), cashPage()])
  assert.deepEqual(r.warnings, [])
  assert.equal(r.positions[0].name, 'Securities Co')
})

test('listed tickers are left to the quote update under the symbol the lookup understands; funds keep the statement price', () => {
  const r = parse([summary('75.00'), positionPage(), cashPage()])
  const base = r.positions[0]
  const csv = (p) => toCsv({ ...r, cash: [], positions: [{ ...base, ...p }] }, 'x').split('\n')[1]
  assert.equal(csv({ exchange: 'SGX', symbol: 'C6L', currency: 'SGD' }), 'position,x,investment,SG,SGD,C6L.SI,2,')
  assert.equal(csv({ exchange: 'US', symbol: 'BRK.B' }), 'position,x,investment,SG,USD,BRK-B,2,')
  assert.equal(csv({ exchange: 'HK', symbol: '700', currency: 'HKD' }), 'position,x,investment,SG,HKD,0700.HK,2,')
  assert.equal(csv({ exchange: 'FD', symbol: 'SGXZ40088619', currency: 'SGD' }), 'position,x,investment,SG,SGD,SGXZ40088619,2,30')
})

test('every figure the statement states about itself is checked: trades, cash, ending positions and money in transit', () => {
  const expect = (pages, code) => { const r = parse(pages); assert.ok(codes(r).includes(code), `${code} ${JSON.stringify(r.warnings)}`); assert.equal(r.status, 'partial') }
  expect([summary('75.00', { transit: '20.00' }), positionPage('60.00', '60.00', { count: '2' }), endingPage(), cashPage()], 'trade-count-mismatch')
  expect([summary('75.00', { transit: '20.00' }), positionPage('60.00', '60.00', { grand: '11.00' }), endingPage(), cashPage()], 'trade-total-mismatch')
  expect([summary('75.00', { transit: '20.00', cash: '111.00' }), positionPage(), endingPage(), cashPage()], 'cash-balance-mismatch')
  expect([summary('75.00', { transit: '20.00' }), positionPage(), endingPage({ total: '76.00' }), cashPage()], 'ending-positions-total-mismatch')
  expect([summary('75.00', { transit: '20.00' }), positionPage(), endingPage({ transitTotal: '21.00' }), cashPage()], 'transit-total-mismatch')
  // A statement that checks out raises none of them.
  assert.deepEqual(parse(withTransit()).warnings, [])
})
