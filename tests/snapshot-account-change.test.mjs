import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, history, compare
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  history = await server.ssrLoadModule('/src/history.ts')
  ;({ compareSnapshotAccounts: compare } = await server.ssrLoadModule('/src/snapshotAccountChange.ts'))
})
after(() => server.close())
const point = (date, total, accounts) => ({ date, at: `${date}T12:00:00+08:00`, total, accounts: accounts.map(([id, value, name = id]) => ({ id, name, value })), categories: {} })
const parsed = (before, after) => history.parseHistory({ snapshots: [before, after] }, why => { throw new Error(why) }).snapshots

test('two ordinary parsed legacy snapshots explain observed +100 and −50 account deltas totaling +50', () => {
  const [b, a] = parsed(point('2026-10-17', 3000, [['a', 1000], ['b', 2000]]), point('2026-10-18', 3050, [['a', 1100], ['b', 1950]]))
  const result = compare(b, a)
  assert.equal(result.status, 'complete'); assert.equal(result.delta, 50)
  assert.deepEqual(result.rows.map(r => [r.id, r.delta]), [['a', 100], ['b', -50]])
  assert.equal(result.residual, 0)
  assert.equal(b.valuation, undefined)
})

test('absent accounts are never inferred zero; explicit zero values remain comparable', () => {
  const b = point('2026-10-17', 100, [['keep', 0], ['removed', 100]])
  const a = point('2026-10-18', 30, [['keep', 10], ['added', 20]])
  const result = compare(b, a)
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.rows.map(r => [r.id, r.delta]), [['keep', 10]])
  assert.deepEqual(result.unknownIds, ['removed', 'added'])
  assert.equal(result.delta, -70); assert.equal(result.residual, -80)
})

test('duplicate identities and unknown values remain partial even when unknown effects cancel to zero residual', () => {
  const b = point('2026-10-17', 100, [['known', 0], ['duplicate', 50], ['duplicate', 50], ['zero', 0]])
  const a = point('2026-10-18', 110, [['known', 10], ['duplicate', 100], ['zero', null]])
  const result = compare(b, a)
  assert.equal(result.status, 'partial'); assert.equal(result.residual, 0)
  assert.deepEqual(result.rows.map(r => [r.id, r.delta]), [['known', 10]])
  assert.deepEqual(result.unknownIds, ['duplicate', 'zero'])
})

test('unreconciled endpoint totals cannot certify complete account comparison even with zero residual', () => {
  const result = compare(point('2026-10-17', 150, [['a', 100]]), point('2026-10-18', 160, [['a', 110]]))
  assert.equal(result.status, 'partial'); assert.equal(result.residual, 0)
  assert.equal(result.rows[0].delta, 10)
})

test('explicit missing captured conversion is unknown instead of a false account loss', () => {
  const b = point('2026-10-17', 420, [['known', 100], ['usd', 320]])
  const a = point('2026-10-18', 110, [['known', 110], ['usd', 0]])
  a.valuation = { version: 1, baseCurrency: 'TWD', at: a.at, entries: [
    { accountId: 'known', account: 'known', type: 'cash', symbol: '', currency: 'TWD', quantity: 110, price: 1, rate: 1 },
    { accountId: 'usd', account: 'usd', type: 'cash', symbol: '', currency: 'USD', quantity: 10, price: 1, rate: null },
  ] }
  const result = compare(b, a)
  assert.equal(result.status, 'partial')
  assert.deepEqual(result.rows.map(r => [r.id, r.delta]), [['known', 10]])
  assert.deepEqual(result.unknownIds, ['usd']); assert.equal(result.residual, -320)
})
