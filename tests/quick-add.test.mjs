import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, quick, expenses, routes

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  quick = await server.ssrLoadModule('/src/quickAdd.ts')
  expenses = await server.ssrLoadModule('/src/expenses.ts')
  routes = await server.ssrLoadModule('/src/routes.ts')
})
after(() => server.close())

test('wallet amounts parse with their currency sign', () => {
  assert.deepEqual(quick.parseAmount('NT$1,234'), { amount: '1234', currency: 'TWD' })
  assert.deepEqual(quick.parseAmount('US$12.50'), { amount: '12.50', currency: 'USD' })
  assert.deepEqual(quick.parseAmount('¥1,200 JPY'), { amount: '1200', currency: 'JPY' })
  assert.deepEqual(quick.parseAmount('€1.234,50'), { amount: '1234.50', currency: 'EUR' })
  assert.deepEqual(quick.parseAmount('-NT$300'), { amount: '-300', currency: 'TWD' })
  assert.deepEqual(quick.parseAmount('$9.99'), { amount: '9.99', currency: undefined })
  assert.equal(quick.parseAmount('abc').amount, '')
})

test('the add link prefills the form and drops invalid values', () => {
  assert.deepEqual(quick.parseQuickAdd('?amount=NT%241%2C234&merchant=%E5%85%A8%E5%AE%B6&card=%E5%9C%8B%E6%B3%B0&date=2026-11-13T12%3A30%3A00%2B08%3A00', '2026-11-14'),
    { date: '2026-11-13', description: '全家', amountText: '1234', currency: 'TWD', card: '國泰' })
  // A given currency wins over the sign; a bad date falls back to today; repeated keys are ignored.
  assert.deepEqual(quick.parseQuickAdd('?amount=%2412&currency=usd&date=2026-02-30&card=a&card=b', '2026-11-14'),
    { date: '2026-11-14', description: '', amountText: '12', currency: 'USD', card: '' })
})

test('/expenses/add keeps its query and parses back', () => {
  assert.deepEqual(routes.parseRoute('/expenses/add?amount=1&merchant=x'), { tab: 'expenses', add: '?amount=1&merchant=x' })
  assert.deepEqual(routes.parseRoute('/expenses/add'), { tab: 'expenses', add: '' })
  assert.equal(routes.routePath({ tab: 'expenses', add: '?amount=1' }), '/expenses/add?amount=1')
  assert.deepEqual(routes.parseRoute('/expenses/add/x'), { tab: 'overview' })
})

const row = (id, date, amount, extra = {}) => ({ id, date, amount, currency: 'TWD', card: '國泰', description: '店家', ...extra })
const key = (c) => c.repeat(64)

test('a statement row replaces the manual row with the same amount within 3 days', () => {
  const manual = row('m1', '2026-11-10', 120, { category: '餐飲' })
  const other = row('m2', '2026-11-01', 120)
  const imported = row('s1', '2026-11-12', 120, { description: 'FAMILYMART', sourceKey: key('a'), importKey: key('b') })
  const result = expenses.mergeStatementExpenses([manual, other], [imported])
  assert.equal(result.added, 1)
  assert.equal(result.replaced, 1)
  assert.deepEqual(result.expenses.map((e) => e.id), ['m2', 's1'])
  // The manual row's category stays on the statement row.
  assert.equal(result.expenses[1].category, '餐飲')
})

test('manual matching skips imported rows, other currencies and far dates', () => {
  const old = row('i1', '2026-11-10', 120, { sourceKey: key('c'), importKey: key('d') })
  const usd = row('m1', '2026-11-10', 120, { currency: 'USD' })
  const far = row('m2', '2026-11-01', 120)
  const imported = row('s1', '2026-11-11', 120, { sourceKey: key('a'), importKey: key('b') })
  const result = expenses.mergeStatementExpenses([old, usd, far], [imported])
  assert.equal(result.replaced, 0)
  assert.equal(result.expenses.length, 4)
})

test('each manual row is replaced at most once, by the nearest date', () => {
  const manual = row('m1', '2026-11-10', 50)
  const a = row('s1', '2026-11-12', 50, { description: 'A', sourceKey: key('a'), importKey: key('b') })
  const b = row('s2', '2026-11-10', 50, { description: 'B', sourceKey: key('c'), importKey: key('d') })
  const matched = expenses.matchManualExpenses([manual], [a, b])
  assert.deepEqual([...matched.keys()], ['s2'])
})
