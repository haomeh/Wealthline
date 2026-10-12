import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
let server, model, history, periods, quantity, statements
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;[model, history, periods, quantity, statements] = await Promise.all(['model', 'history', 'holdingPeriods', 'quantityHistory', 'bankStatementAssets'].map((n) => server.ssrLoadModule(`/src/${n}.ts`)))
})
after(() => server.close())

const now = '2026-10-12T12:00:00Z'
const ledger = { id: 'ledger-dbs', label: 'DBS', bank: 'DBS Singapore' }
const accounts = () => [
  { id: 'dbs', name: 'DBS', kind: 'bank', category: '現金與外幣活存', country: 'SG', positions: [{ id: 'p1', type: 'cash', symbol: '', currency: 'SGD', quantity: 20000, price: 1 }] },
  { id: 'hsbc', name: 'HSBC', kind: 'bank', category: '現金與外幣活存', country: 'TW', positions: [{ id: 'p2', type: 'cash', symbol: '', currency: 'TWD', quantity: 300000, price: 1 }] },
  { id: 'schwab', name: '嘉信證券', kind: 'investment', category: '海外股票', country: 'US', positions: [{ id: 'p3', type: 'holding', symbol: 'VT', currency: 'USD', quantity: 10, price: 120 }] },
]
const snapshot = (date, values) => ({ date, at: `${date}T12:00:00Z`, total: Object.values(values).reduce((a, b) => a + b, 0), accounts: Object.entries(values).map(([id, value]) => ({ id, name: id, value })), categories: {} })
const sgd = { symbol: 'SGDTWD=X', currency: 'TWD', asTraded: true, splits: [], points: [{ date: '2026-09-29', close: 24 }, { date: '2026-09-30', close: 24 }, { date: '2026-10-01', close: 24 }] }
const fetcher = async (symbol) => (symbol === 'SGDTWD=X' ? sgd : null)
// The overview's data after a DBS statement balance import: one sparse day naming only DBS.
async function imported(snapshots, date = '2026-09-30') {
  const data = { ...model.emptyData(), accounts: accounts(), fxRates: { SGD: 24, USD: 32 }, bankTransactionAccounts: [ledger], history: { changes: [], snapshots } }
  const next = statements.importStatementBalances(data, [{ bank: 'DBS Singapore', date, currency: 'SGD', quantity: 22335.25, fileHash: 'a'.repeat(64), ledgerAccountId: ledger.id }], now).data
  const valued = await quantity.valueDays(periods.expandPeriodDays(next, now), fetcher)
  return { ...next, history: { ...next.history, valuedQuantityDays: valued } }
}

test('a statement day naming one account keeps the others at their last value', async () => {
  const data = await imported([snapshot('2026-09-29', { dbs: 480000, hsbc: 300000, schwab: 38000 })])
  const point = history.totalPoints(data, now).find((p) => p.date === '2026-09-30')
  assert.equal(point.total, 536046 + 300000 + 38000)
  assert.deepEqual(point.accounts.map((a) => [a.id, a.value]).sort(), [['dbs', 536046], ['hsbc', 300000], ['schwab', 38000]])
  assert.deepEqual(point.filled.map((f) => [f.id, f.from, f.reason]).sort(), [['hsbc', '2026-09-29', 'no-record'], ['schwab', '2026-09-29', 'no-record']])
  assert.deepEqual({ ...point.categories }, { 現金與外幣活存: 836046, 海外股票: 38000 })
  assert.equal(point.netWorth, point.total)
})

test('a statement on a day with its own snapshot keeps that snapshot for the other accounts', async () => {
  const data = await imported([snapshot('2026-09-29', { dbs: 1, hsbc: 1, schwab: 1 }), snapshot('2026-09-30', { dbs: 480000, hsbc: 310000, schwab: 39000 })])
  const point = history.totalPoints(data, now).find((p) => p.date === '2026-09-30')
  assert.equal(point.total, 536046 + 310000 + 39000)
  assert.deepEqual(point.filled.map((f) => [f.id, f.from, f.reason]).sort(), [['hsbc', '2026-09-30', 'no-record'], ['schwab', '2026-09-30', 'no-record']])
  // Later points carry the same-day snapshot values, not the older ones.
  assert.equal(point.accounts.find((a) => a.id === 'dbs').value, 536046)
})

test('with no earlier record, unknown accounts count as 0', async () => {
  const data = await imported([])
  const point = history.totalPoints(data, now).find((p) => p.date === '2026-09-30')
  assert.equal(point.total, 536046)
  assert.deepEqual(point.filled.map((f) => [f.id, f.from, f.reason]).sort(), [['hsbc', null, 'no-record'], ['schwab', null, 'no-record']])
  assert.ok(point.accounts.every((a) => a.value !== null))
})

test('a day with every account known is left as recorded', async () => {
  const data = await imported([snapshot('2026-09-29', { dbs: 480000, hsbc: 300000, schwab: 38000 })])
  const points = history.totalPoints(data, now)
  assert.equal(points.find((p) => p.date === '2026-09-29').filled, undefined)
  assert.equal(points.at(-1).filled, undefined)
})

test('the snapshot panel shows every account, where filled values come from, currency and country, and a back-fill link', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { SnapshotDetails } = await server.ssrLoadModule('/src/views/SnapshotDetails.tsx')
  const data = await imported([snapshot('2026-09-29', { dbs: 480000, hsbc: 300000, schwab: 38000 })])
  const point = history.totalPoints(data, now).find((p) => p.date === '2026-09-30')
  const day = data.history.valuedQuantityDays.find((d) => d.date === '2026-09-30')
  const html = renderToStaticMarkup(createElement(SnapshotDetails, { point, day, data, onBackfill: () => {} }))
  assert.doesNotMatch(html, /資料不完整|沒有完整的幣別明細|缺少歷史數量或行情/)
  assert.match(html, /沿用 2026\/09\/29/)
  assert.match(html, /補登這天的數量/)
  assert.match(html, /依帳戶目前持倉的幣別比例估計/)
  for (const label of ['SGD', 'TWD', 'USD', '新加坡', '台灣', '美國']) assert.match(html, new RegExp(label))
  // An original snapshot has no entries, yet its currency and country can still be shown.
  const original = history.totalPoints(data, now).find((p) => p.date === '2026-09-29')
  const plain = renderToStaticMarkup(createElement(SnapshotDetails, { point: original, data }))
  assert.doesNotMatch(plain, /資料不完整|資料不足/)
  assert.doesNotMatch(plain, /補登這天/)
})

test('a later statement for the same day replaces the carried value and is carried itself afterwards', async () => {
  const hsbc = { id: 'ledger-hsbc', label: 'HSBC', bank: 'HSBC Taiwan' }
  const data = { ...model.emptyData(), accounts: accounts(), fxRates: { SGD: 24, USD: 32 }, bankTransactionAccounts: [ledger, hsbc], history: { changes: [], snapshots: [snapshot('2026-09-29', { dbs: 480000, hsbc: 300000, schwab: 38000 })] } }
  const dbsOnly = statements.importStatementBalances(data, [{ bank: 'DBS Singapore', date: '2026-09-30', currency: 'SGD', quantity: 22335.25, fileHash: 'a'.repeat(64), ledgerAccountId: ledger.id }], now).data
  const both = statements.importStatementBalances(dbsOnly, [
    { bank: 'HSBC Taiwan', date: '2026-09-30', currency: 'TWD', quantity: 250000, fileHash: 'b'.repeat(64), ledgerAccountId: hsbc.id, confirmedAccountId: 'hsbc' },
    { bank: 'DBS Singapore', date: '2026-10-05', currency: 'SGD', quantity: 23000, fileHash: 'c'.repeat(64), ledgerAccountId: ledger.id },
  ], now).data
  const valued = await quantity.valueDays(periods.expandPeriodDays(both, now), fetcher)
  const points = history.totalPoints({ ...both, history: { ...both.history, valuedQuantityDays: valued } }, now)
  const day = points.find((p) => p.date === '2026-09-30')
  assert.equal(day.accounts.find((a) => a.id === 'hsbc').value, 250000)
  assert.deepEqual(day.filled, [{ id: 'schwab', from: '2026-09-29', reason: 'no-record' }])
  assert.equal(day.total, 536046 + 250000 + 38000)
  // The next statement day carries the statement value, not the older snapshot.
  const later = points.find((p) => p.date === '2026-10-05')
  assert.equal(later.accounts.find((a) => a.id === 'hsbc').value, 250000)
  assert.deepEqual(later.filled.find((f) => f.id === 'hsbc'), { id: 'hsbc', from: '2026-09-30', reason: 'no-record' })
})

// Review of PR #49: fill per entry, labels that match the source, and accounts the day does not name.
const usd = { symbol: 'USDTWD=X', currency: 'TWD', asTraded: true, splits: [], points: [{ date: '2026-09-29', close: 32 }, { date: '2026-09-30', close: 32 }, { date: '2026-10-05', close: 32 }] }
const sgdLong = { ...sgd, points: [...sgd.points, { date: '2026-10-05', close: 24 }] }
const fx = async (symbol) => (symbol === 'SGDTWD=X' ? sgdLong : symbol === 'USDTWD=X' ? usd : null)
async function pointsOf(data) {
  const valued = await quantity.valueDays(periods.expandPeriodDays(data, now), fx)
  return history.totalPoints({ ...data, history: { ...data.history, valuedQuantityDays: valued } }, now)
}
const statement = (date, quantity, hash) => ({ bank: 'DBS Singapore', date, currency: 'SGD', quantity, fileHash: hash.repeat(64), ledgerAccountId: ledger.id })
const withUsd = () => accounts().map((a) => (a.id === 'dbs' ? { ...a, positions: [...a.positions, { id: 'p5', type: 'cash', symbol: '', currency: 'USD', quantity: 1000, price: 1 }] } : a))
const base = (list, snapshots, quantityDays) => ({ ...model.emptyData(), accounts: list, fxRates: { SGD: 24, USD: 32 }, bankTransactionAccounts: [ledger], history: { changes: [], snapshots, ...(quantityDays && { quantityDays }) } })

test('a statement for one currency counts even when another currency of the account is unknown', async () => {
  const data = statements.importStatementBalances(base(withUsd(), [snapshot('2026-09-29', { dbs: 480000, hsbc: 300000, schwab: 38000 })]), [statement('2026-09-30', 22335.25, 'a')], now).data
  const point = (await pointsOf(data)).find((p) => p.date === '2026-09-30')
  assert.equal(point.accounts.find((a) => a.id === 'dbs').value, 536046)
  assert.deepEqual(point.filled.find((f) => f.id === 'dbs'), { id: 'dbs', from: null, reason: 'partial' })
  const { filledNote } = await server.ssrLoadModule('/src/views/historySeries.ts')
  assert.equal(filledNote(point, 'dbs'), '部分項目無紀錄，以 0 計')
  assert.equal(filledNote(point, 'hsbc'), '沿用 2026/09/29')
})

test('the unknown currency of a partly known account takes its own earlier value', async () => {
  const usdDay = { date: '2026-09-29', updatedAt: now, entries: [{ accountId: 'dbs', account: 'DBS', category: '現金與外幣活存', country: 'SG', type: 'cash', symbol: '', currency: 'USD', quantity: 500 }], sparse: true }
  const data = statements.importStatementBalances(base(withUsd(), [], [usdDay]), [statement('2026-09-30', 22335.25, 'a')], now).data
  const point = (await pointsOf(data)).find((p) => p.date === '2026-09-30')
  assert.equal(point.accounts.find((a) => a.id === 'dbs').value, 536046 + 16000)
  assert.equal(point.filled.find((f) => f.id === 'dbs').from, '2026-09-29')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const { SnapshotDetails } = await server.ssrLoadModule('/src/views/SnapshotDetails.tsx')
  const day = (await quantity.valueDays(periods.expandPeriodDays(data, now), fx)).find((d) => d.date === '2026-09-30')
  const html = renderToStaticMarkup(createElement(SnapshotDetails, { point, day, data }))
  // DBS is split by its known SGD and its carried USD, not by today's holdings.
  assert.match(html, /SGD<\/span><span[^>]*>536,046/)
  assert.match(html, /部分項目沿用 2026\/09\/29/)
})

test('a later point carries the value of a same-day snapshot', async () => {
  const data = statements.importStatementBalances(base(accounts(), [snapshot('2026-09-29', { dbs: 1, hsbc: 1, schwab: 1 }), snapshot('2026-09-30', { dbs: 480000, hsbc: 310000, schwab: 39000 })]), [statement('2026-09-30', 22335.25, 'a'), statement('2026-10-05', 23000, 'b')], now).data
  const later = (await pointsOf(data)).find((p) => p.date === '2026-10-05')
  assert.equal(later.accounts.find((a) => a.id === 'hsbc').value, 310000)
  assert.deepEqual(later.filled.find((f) => f.id === 'hsbc'), { id: 'hsbc', from: '2026-09-30', reason: 'no-record' })
})

test('accounts only in the same-day snapshot or the previous point stay in the total', async () => {
  const same = statements.importStatementBalances(base(accounts(), [snapshot('2026-09-30', { dbs: 480000, hsbc: 300000, schwab: 38000, old: 100000 })]), [statement('2026-09-30', 22335.25, 'a')], now).data
  const point = (await pointsOf(same)).find((p) => p.date === '2026-09-30')
  assert.equal(point.accounts.find((a) => a.id === 'old').value, 100000)
  assert.equal(point.total, 536046 + 300000 + 38000 + 100000)
  const earlier = statements.importStatementBalances(base(accounts(), [snapshot('2026-09-29', { dbs: 480000, hsbc: 300000, schwab: 38000, old: 100000 })]), [statement('2026-09-30', 22335.25, 'a')], now).data
  const next = (await pointsOf(earlier)).find((p) => p.date === '2026-09-30')
  assert.deepEqual(next.filled.find((f) => f.id === 'old'), { id: 'old', from: '2026-09-29', reason: 'no-record' })
  assert.equal(next.total, 536046 + 300000 + 38000 + 100000)
})

test('a complete inventory day does not pull in accounts from snapshots', async () => {
  const entries = accounts().map((a) => ({ accountId: a.id, account: a.name, category: a.category, country: a.country, type: 'cash', symbol: '', currency: 'TWD', quantity: a.id === 'dbs' ? 500000 : null }))
  const inventory = { date: '2026-09-30', updatedAt: now, entries, inventory: { accounts: accounts().map((a) => ({ id: a.id, name: a.name })), source: { kind: 'current', date: '2026-10-12' } } }
  const data = base(accounts(), [snapshot('2026-09-30', { dbs: 480000, hsbc: 300000, schwab: 38000, old: 100000 })], [inventory])
  const point = (await pointsOf(data)).find((p) => p.date === '2026-09-30')
  assert.equal(point.accounts.some((a) => a.id === 'old'), false)
})

test('a known quantity without a quote keeps the day unknown unless an earlier value exists, then says the quote is missing', async () => {
  const vt = { date: '2026-09-30', updatedAt: now, sparse: true, entries: [{ accountId: 'schwab', account: '嘉信證券', category: '海外股票', country: 'US', type: 'holding', symbol: 'VT', currency: 'USD', quantity: 12 }] }
  const none = (await pointsOf(base(accounts(), [], [vt]))).find((p) => p.date === '2026-09-30')
  assert.equal(none.total, null)
  const earlier = (await pointsOf(base(accounts(), [snapshot('2026-09-29', { dbs: 480000, hsbc: 300000, schwab: 38000 })], [vt]))).find((p) => p.date === '2026-09-30')
  assert.deepEqual(earlier.filled.find((f) => f.id === 'schwab'), { id: 'schwab', from: '2026-09-29', reason: 'no-quote' })
  const { filledNote } = await server.ssrLoadModule('/src/views/historySeries.ts')
  assert.equal(filledNote(earlier, 'schwab'), '缺行情，沿用 2026/09/29')
})
