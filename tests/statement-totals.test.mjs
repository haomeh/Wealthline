import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'

let server, totals
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  totals = await server.ssrLoadModule('/src/statementTotals.ts')
})
after(async () => { await server?.close() })

const row = (amount, currency = 'TWD') => ({ date: '2031-01-05', description: 'SYNTHETIC', amount, currency })

test('E.SUN reads 本期合計 (full-width colon) or the 本期新增款項 column under the summary header', () => {
  const check = totals.statementTotalCheck(['玉山銀行', '本期合計：TWD 1,250'], '玉山', 'TWD', [row(1000), row(300), row(-50)])
  assert.deepEqual(check, { label: '本期合計', currency: 'TWD', stated: 1250, parsed: 1250, matches: true })
  const summary = ['上期未繳餘額 本期新增款項 本期應繳總金額', '0 2,000 2,000']
  assert.equal(totals.statementTotalCheck(summary, '玉山', 'TWD', [row(2000)]).matches, true)
  const missing = totals.statementTotalCheck(summary, '玉山', 'TWD', [row(1500)])
  assert.deepEqual([missing.stated, missing.parsed, missing.matches], [2000, 1500, false])
})

test('Fubon reads 本期新增, the fourth number of the row under its summary header', () => {
  const lines = ['前期應繳總額 繳(退)金額 本期調整金額 本期新增 本期應繳總額', '5,000 -5,000 0 3,210 3,210']
  assert.equal(totals.statementTotalCheck(lines, '富邦', 'TWD', [row(3000), row(210)]).matches, true)
  assert.equal(totals.statementTotalCheck(lines, '富邦', 'TWD', [row(3000)]).matches, false)
  assert.equal(totals.statementTotalCheck(['前期應繳總額 本期新增 本期應繳總額', '1 2'], '富邦', 'TWD', [row(1)]), undefined)
})

test('Taishin accepts all rows, or only the positive rows when a reward row is left out of 本期新增款項', () => {
  assert.equal(totals.statementTotalCheck(['+本期新增款項 851'], '台新', 'TWD', [row(1000), row(-149)]).matches, true)
  const reward = totals.statementTotalCheck(['+本期新增款項 1,000'], '台新', 'TWD', [row(1000), row(-149)])
  assert.deepEqual([reward.parsed, reward.matches], [1000, true])
  const wrong = totals.statementTotalCheck(['+本期新增款項 1,200'], '台新', 'TWD', [row(1000), row(-149)])
  assert.deepEqual([wrong.parsed, wrong.matches], [851, false])
})

test('HSBC SG compares Purchases & Debits with the positive rows in the statement currency', () => {
  const lines = ['Previous Balance 100.00', 'Payments & Credits 102.00', 'Purchases & Debits 30.84']
  const rows = [row(10.34, 'SGD'), row(20.5, 'SGD'), row(-2, 'SGD'), row(99, 'TWD')]
  assert.deepEqual(totals.statementTotalCheck(lines, '匯豐', 'SGD', rows), { label: 'Purchases & Debits', currency: 'SGD', stated: 30.84, parsed: 30.84, matches: true })
  assert.equal(totals.statementTotalCheck(lines, '匯豐', 'SGD', rows.slice(1)).matches, false)
})

test('no check when the issuer prints no total this can read', () => {
  assert.equal(totals.statementTotalCheck(['匯豐銀行', '本期應繳總金額 1,000'], '匯豐', 'TWD', [row(1000)]), undefined)
  assert.equal(totals.statementTotalCheck(['本期應繳總金額 1,000'], '玉山', 'TWD', [row(1000)]), undefined)
  assert.equal(totals.statementTotalCheck(['本期合計 1,000'], undefined, 'TWD', [row(1000)]), undefined)
})
