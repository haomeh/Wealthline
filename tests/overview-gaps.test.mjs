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
  assert.deepEqual(point.filled.map((f) => [f.id, f.from]).sort(), [['hsbc', '2026-09-29'], ['schwab', '2026-09-29']])
  assert.deepEqual({ ...point.categories }, { 現金與外幣活存: 836046, 海外股票: 38000 })
  assert.equal(point.netWorth, point.total)
})

test('a statement on a day with its own snapshot keeps that snapshot for the other accounts', async () => {
  const data = await imported([snapshot('2026-09-29', { dbs: 1, hsbc: 1, schwab: 1 }), snapshot('2026-09-30', { dbs: 480000, hsbc: 310000, schwab: 39000 })])
  const point = history.totalPoints(data, now).find((p) => p.date === '2026-09-30')
  assert.equal(point.total, 536046 + 310000 + 39000)
  assert.deepEqual(point.filled.map((f) => [f.id, f.from]).sort(), [['hsbc', '2026-09-30'], ['schwab', '2026-09-30']])
  // Later points carry the same-day snapshot values, not the older ones.
  assert.equal(point.accounts.find((a) => a.id === 'dbs').value, 536046)
})

test('with no earlier record, unknown accounts count as 0', async () => {
  const data = await imported([])
  const point = history.totalPoints(data, now).find((p) => p.date === '2026-09-30')
  assert.equal(point.total, 536046)
  assert.deepEqual(point.filled.map((f) => [f.id, f.from]).sort(), [['hsbc', null], ['schwab', null]])
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
  assert.deepEqual(day.filled, [{ id: 'schwab', from: '2026-09-29' }])
  assert.equal(day.total, 536046 + 250000 + 38000)
  // The next statement day carries the statement value, not the older snapshot.
  const later = points.find((p) => p.date === '2026-10-05')
  assert.equal(later.accounts.find((a) => a.id === 'hsbc').value, 250000)
  assert.deepEqual(later.filled.find((f) => f.id === 'hsbc'), { id: 'hsbc', from: '2026-09-30' })
})
