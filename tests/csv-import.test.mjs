import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'

let server, csv, sheet, model, expenses, bank
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-csv-import', configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  csv = await server.ssrLoadModule('/src/csvImport.ts')
  sheet = await server.ssrLoadModule('/src/importSheet.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  expenses = await server.ssrLoadModule('/src/expenses.ts')
  bank = await server.ssrLoadModule('/src/bankTransactions.ts')
})
after(() => server?.close())

const lines = (...rows) => rows.join('\n')
const issues = (fn) => { try { fn() } catch (e) { assert.ok(e instanceof csv.CsvError, e.message); return [e.message, ...e.issues] } assert.fail('expected a CsvError') }

test('RFC 4180 fields: quotes, embedded commas, quotes and line breaks, CRLF and a BOM', () => {
  assert.deepEqual(csv.parseCsv('﻿a,"b,c","say ""hi"""\r\n"line\nbreak",,x\n'), [['a', 'b,c', 'say "hi"'], ['line\nbreak', '', 'x']])
  assert.deepEqual(csv.parseCsv('a,b'), [['a', 'b']])
  assert.throws(() => csv.parseCsv('a,"open'), /未結束的引號/)
})

test('only strict UTF-8 is read; files say their one type', () => {
  assert.equal(csv.decodeCsv(new TextEncoder().encode('﻿type\ncard')), 'type\ncard')
  // 「台」 in Big5.
  assert.throws(() => csv.decodeCsv(new Uint8Array([0xa5, 0x78])), /UTF-8/)
  assert.equal(csv.csvImportType(lines('TYPE,date', 'card,2026-01-01', '', 'card,2026-01-02')), 'card')
  assert.throws(() => csv.csvImportType(lines('type', 'card', 'bank')), /只能放一種 type/)
  assert.throws(() => csv.csvImportType(lines('type', 'stock')), /card、bank 或 position/)
  assert.throws(() => csv.csvImportType(lines('date,amount', '2026-01-01,1')), /type 欄/)
  assert.throws(() => csv.csvImportType('type'), /沒有資料列/)
  assert.ok(csv.isCsvFile({ name: 'a.CSV' }) && csv.isCsvFile({ name: 'x', type: 'text/csv' }) && !csv.isCsvFile({ name: 'a.pdf', type: 'application/pdf' }))
  assert.ok(csv.hasCsvHeader('\n"type",account\nposition,A') && !csv.hasCsvHeader('HSBC SG\t現金\t\tSGD\t100'))
})

test('card rows: categories, refunds and the stated statement total', () => {
  const { rows, checks } = csv.readCardCsv(lines(
    'type,date,description,amount,currency,card,category,statement_month,statement_total',
    'card,2026-09-03,全聯福利中心,1280,TWD,國泰 CUBE,購物,2026-09,1220',
    'card,2026-09-10,"NETFLIX.COM, INC",390,twd,國泰 CUBE,,2026-09,1220',
    'card,2026-09-12,誠品 退款,-450,TWD,國泰 cube,,2026-09,1220',
    'card,2026-09-14,STARBUCKS,5.5,USD,國泰 CUBE,,2026-09,6',
  ))
  assert.deepEqual(rows.map((r) => [r.line, r.amount, r.currency, r.category]), [[2, 1280, 'TWD', '購物'], [3, 390, 'TWD', undefined], [4, -450, 'TWD', undefined], [5, 5.5, 'USD', undefined]])
  assert.equal(rows[1].description, 'NETFLIX.COM, INC')
  assert.deepEqual(checks.map((c) => [c.currency, c.expected, c.actual, c.matches]), [['TWD', 1220, 1220, true], ['USD', 6, 5.5, false]])
})

test('one invalid card row rejects the file and names every problem by line', () => {
  const found = issues(() => csv.readCardCsv(lines(
    'type,date,description,amount,currency,card,category,statement_total',
    'card,2026-02-30,=HYPERLINK("x"),1,NT,4111111111111111,飲料,',
    'card,2026-09-01,商家未能辨識,"1,280",NT$,,,',
    'card,2026-09-01,OK,1,TWD,A,,10',
    'card,2026-09-02,OK,2,TWD,A,,11',
  )))
  assert.match(found[0], /3 個問題，整份檔案未匯入/)
  assert.match(found[1], /^第 2 列：日期必須是 YYYY-MM-DD；商家／說明不可用 = \+ - @ 開頭；幣別.*；卡片名稱不要填完整卡號；分類必須是/)
  assert.match(found[2], /^第 3 列：金額必須是不含千分位的數字；幣別.*；缺少卡片名稱；商家／說明無法辨識/)
  assert.match(found[3], /^第 5 列：同一張帳單的帳單總額不一致/)
  assert.throws(() => csv.readCardCsv(lines('type,date,description,amount,currency', 'card,2026-01-01,A,1,TWD')), /缺少欄位：card/)
  assert.throws(() => csv.readCardCsv(lines('type,account,date,description,direction,amount,currency', 'bank,A,2026-01-01,B,debit,1,TWD')), /銀行流水 CSV，不能在信用卡消費匯入/)
})

test('card rows prepare into expenses that dedupe on re-import of the same file', async () => {
  const { rows } = csv.readCardCsv(lines('type,date,description,amount,currency,card', 'card,2026-09-03,A,10,TWD,卡', 'card,2026-09-03,A,10,TWD,卡'))
  const prepare = () => expenses.prepareExpenses(rows.map(({ date, description, amount, currency }) => ({ date, description, amount, currency })), '卡', 'a'.repeat(64), rows.map((r) => r.line))
  const first = expenses.mergeExpenses([], await prepare())
  assert.equal(first.added, 2)
  const again = expenses.mergeExpenses(first.expenses, await prepare())
  assert.deepEqual([again.added, again.duplicates], [0, 2])
})

test('bank rows: directions, classifications and closing balances', () => {
  const { rows, balances } = csv.readBankCsv(lines(
    'type,account,bank,date,description,direction,amount,currency,classification,closing_balance,closing_date',
    'bank,台新 Richart,台新,2026-09-05,薪資轉入,credit,65000,TWD,income:薪資,,',
    'bank,台新 Richart,,2026-09-10,信用卡費,支出,15320,TWD,excluded:信用卡繳款,,',
    'bank,台新 Richart,台新,2026-09-30,利息,入帳,12,TWD,pending,182340,2026-09-30',
    'bank,台新 richart,台新,2026-09-30,利息,credit,1,TWD,,182340,2026-09-30',
  ))
  assert.deepEqual(rows.map((r) => [r.direction, r.bank, r.classification]), [
    ['credit', '台新', { kind: 'income', category: '薪資' }], ['debit', '台新 Richart', { kind: 'excluded', reason: '信用卡繳款' }], ['credit', '台新', undefined], ['credit', '台新', undefined]])
  // The same balance stated twice is one balance.
  assert.deepEqual(balances.map((b) => [b.account, b.date, b.quantity]), [['台新 Richart', '2026-09-30', 182340]])
  for (const row of rows) assert.ok(bank.parseBankClassification(row.classification ?? { kind: 'pending' }))
  const found = issues(() => csv.readBankCsv(lines(
    'type,account,date,description,direction,amount,currency,classification,closing_balance,closing_date',
    'bank,A,2026-09-01,B,out,-5,TWD,income:獎金,10,',
    'bank,A,2026-09-01,B,debit,5,TWD,,10,2026-09-30',
    'bank,A,2026-09-02,B,debit,5,TWD,,11,2026-09-30',
  )))
  assert.match(found[1], /^第 2 列：direction 必須是.*；金額不可為負數；分類必須是.*；期末餘額日期必須是 YYYY-MM-DD/)
  assert.match(found[2], /^第 4 列：同帳戶同日同幣別的期末餘額不一致/)
})

test('position CSV replaces a named account, keeping held positions, and adds new accounts', () => {
  const data = { ...model.emptyData(), accounts: [{ id: 'acc-1', name: 'HSBC SG', kind: 'bank', country: 'SG', category: '現金與外幣活存', positions: [
    { id: 'cash-sgd', type: 'cash', currency: 'SGD', symbol: '', quantity: 100, price: 1, addedAt: '2026-01-01' },
    { id: 'cash-jpy', type: 'cash', currency: 'JPY', symbol: '', quantity: 5, price: 1 },
  ] }, { id: 'acc-2', name: '嘉信', kind: 'investment', country: 'US', category: '海外股票', positions: [
    { id: 'voo', type: 'holding', currency: 'USD', symbol: 'VOO', quantity: 10, price: 500, name: 'Vanguard S&P 500', addedAt: '2026-02-01' },
    { id: 'fund', type: 'holding', currency: 'USD', symbol: 'MYFUND', quantity: 3, price: 12, priceManual: true },
  ] }] }
  const result = sheet.importPositionCsv(data, lines(
    'type,account,kind,country,category,currency,symbol,quantity,price',
    'position,hsbc sg,bank,,,SGD,,12500.5,',
    'position,嘉信,investment,,,USD,voo,12,',
    'position,嘉信,investment,,,USD,MYFUND,4,',
    'position,嘉信,investment,,,USD,AAPL,30,',
    'position,Bybit,investment,SG,加密貨幣資產,USDT,,50,',
    'position,Bybit,investment,SG,加密貨幣資產,USD,BTC,0.5,60000',
  ))
  assert.deepEqual(result.errors, [])
  assert.deepEqual([result.rows, result.accounts, result.replaced.map((a) => a.id)], [6, 3, ['acc-1', 'acc-2']])
  const [hsbc, schwab, bybit] = result.data.accounts
  assert.deepEqual([hsbc.id, hsbc.name, hsbc.country, hsbc.category], ['acc-1', 'hsbc sg', 'SG', '現金與外幣活存'])
  // JPY is not in the file, so it is removed; SGD keeps its id and added date.
  assert.deepEqual(hsbc.positions, [{ id: 'cash-sgd', addedAt: '2026-01-01', type: 'cash', currency: 'SGD', symbol: '', quantity: 12500.5, price: 1 }])
  assert.deepEqual(schwab.positions.map((p) => [p.id === 'voo' || p.id === 'fund' ? p.id : 'new', p.symbol, p.quantity, p.price, !!p.priceManual, p.name]),
    [['voo', 'VOO', 12, 500, false, 'Vanguard S&P 500'], ['fund', 'MYFUND', 4, 12, true, undefined], ['new', 'AAPL', 30, 0, false, undefined]])
  assert.deepEqual([bybit.kind, bybit.country, bybit.positions.map((p) => [p.type, p.currency, p.price, !!p.priceManual])], ['investment', 'SG', [['cash', 'USDT', 1, false], ['holding', 'USD', 60000, true]]])
})

test('position CSV errors leave the data unchanged', () => {
  const data = { ...model.emptyData(), accounts: [
    { id: 'a', name: 'Dup', kind: 'bank', country: 'TW', category: 'x', positions: [] },
    { id: 'b', name: 'dup', kind: 'bank', country: 'SG', category: 'x', positions: [] },
  ] }
  const header = 'type,account,kind,currency,symbol,quantity,price'
  for (const [body, message] of [
    ['position,Dup,bank,TWD,,1,', /同名帳戶有多筆/],
    ['position,A,bank,TWD,2330,1,', /銀行帳戶只記錄現金餘額/],
    ['position,A,investment,TWD,,1,5', /現金餘額不需要單價/],
    ['position,A,stock,TWD,,1,', /kind 必須是/],
    ['position,A,investment,TWD,2330,1,\nposition,A,investment,TWD,2330,2,', /「2330」在同一帳戶重複/],
    ['position,A,investment,TWD,,1,\nposition,A,bank,TWD,,2,', /kind 不一致/],
  ]) {
    const result = sheet.importPositionCsv(data, lines(header, body))
    assert.equal(result.data, data, body)
    assert.ok(result.errors.some((e) => message.test(e.message)), `${body}: ${JSON.stringify(result.errors)}`)
  }
  const wrongType = sheet.importPositionCsv(data, lines('type,date,description,amount,currency,card', 'card,2026-01-01,A,1,TWD,B'))
  assert.equal(wrongType.data, data)
  assert.match(wrongType.errors[0].message, /信用卡消費 CSV，不能在帳戶餘額與持倉匯入/)
})

test('typed bank names resolve to one statement institution, with the country when the name is shared', async () => {
  const assets = await server.ssrLoadModule('/src/bankStatementAssets.ts')
  for (const [typed, key] of [['台新', 'Taishin'], ['台新銀行', 'Taishin'], ['taishin', 'Taishin'], ['玉山銀行', 'E.SUN'], ['E.SUN', 'E.SUN'], ['台北富邦銀行', 'Fubon'],
    ['HSBC SG', 'HSBC Singapore'], ['匯豐 TW', 'HSBC Taiwan'], ['HSBC (TW)', 'HSBC Taiwan'], ['DBS Singapore', 'DBS Singapore'], ['星展 SG', 'DBS Singapore'],
    ['HSBC', undefined], ['星展', undefined], ['LINE Bank', undefined], ['', undefined]]) assert.equal(assets.statementInstitution(typed), key, typed)
})
