import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, history, model, parts, summary
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;[history, model, parts, summary] = await Promise.all(['history', 'model', 'dataParts', 'dataSummary'].map(n => server.ssrLoadModule(`/src/${n}.ts`)))
})
after(() => server.close())
const at = date => `${date}T04:00:00.000Z`
const cash = (currency, quantity, extra = {}) => ({ id: currency, type: 'cash', currency, symbol: '', price: 1, quantity, ...extra })
const holding = (quantity, price, extra = {}) => ({ id: 'lot', type: 'holding', currency: 'USD', symbol: 'VT', quantity, price, ...extra })
const data = (positions, fxRates = {}, extra = {}) => ({ ...model.emptyData(), updatedAt: at('2026-10-18'), fxRates, fxUpdatedAt: at('2026-10-18'), accounts: [{ id: 'a', name: 'Bank', country: 'SG', kind: 'investment', category: '其他', positions }], ...extra })
const pair = (before, after) => [history.snapshotOf(before, at('2026-10-16')), history.snapshotOf(after, at('2026-10-18'))]
const attribute = async (...args) => (await server.ssrLoadModule('/src/assetChangeAttribution.ts')).attributeAssetChange(...args)
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)

test('snapshots capture optional allowlisted evidence and keep unknown FX unknown', () => {
  const d = data([holding(2, 100, { priceManual: true, priceUpdatedAt: at('2026-10-17'), secret: 'omit' }), cash('SGD', 10)], { USD: 31 })
  d.fxManual = ['USD']
  const s = history.snapshotOf(d, d.updatedAt)
  assert.equal(s.valuation?.version, 1)
  assert.equal(s.valuation.baseCurrency, 'TWD')
  assert.equal(s.valuation.at, d.updatedAt)
  assert.equal(s.valuation.entries[0].priceManual, true)
  assert.equal(s.valuation.entries[0].rateManual, true)
  assert.equal(s.valuation.entries[0].priceUpdatedAt, at('2026-10-17'))
  assert.equal(s.valuation.entries[1].rate, null)
  assert.equal('id' in s.valuation.entries[0], false)
  assert.equal('secret' in s.valuation.entries[0], false)
  assert.equal('positions' in s, false)
})

test('pure FX explains SGD and USD +12,600 with stable quantities', async () => {
  const [b, c] = pair(data([cash('SGD', 100000), cash('USD', 20000)], { SGD: 23.9, USD: 31.3 }), data([cash('SGD', 100000), cash('USD', 20000)], { SGD: 24, USD: 31.43 }))
  const r = await attribute(b, c)
  assert.equal(r.status, 'complete')
  near(r.delta, 12600); near(r.effects.fx, 12600)
  near(r.effects.price, 0); near(r.effects.quantity, 0); near(r.residual, 0)
  near(r.rows.find(x => x.currency === 'SGD').effects.fx, 10000)
  near(r.rows.find(x => x.currency === 'USD').effects.fx, 2600)
})

test('mixed negative effects use FX then price then quantity and ignore transient IDs', async () => {
  const r = await attribute(...pair(data([holding(10, 100)], { USD: 32 }), data([holding(12, 90, { id: 'new-import-id' })], { USD: 31 })))
  assert.equal(r.status, 'complete')
  assert.deepEqual(r.effects, { fx: -1000, price: -3100, quantity: 5580 })
  assert.equal(r.delta, 1480); assert.equal(r.residual, 0)
  assert.equal(r.rows.length, 1)
})

test('added and removed instruments use known endpoint holding adjustment', async () => {
  const r = await attribute(...pair(data([holding(2, 100)], { USD: 32 }), data([cash('SGD', 100)], { SGD: 24 })))
  assert.equal(r.status, 'complete')
  assert.deepEqual(r.effects, { fx: 0, price: 0, quantity: -4000 })
  assert.deepEqual(r.rows.map(x => x.change).sort(), ['added', 'removed'])
})

test('legacy, incompatible, manual, filled and period points never borrow raw valuation', async () => {
  const [b, c] = pair(data([cash('USD', 10)], { USD: 32 }), data([cash('USD', 10)], { USD: 33 }))
  for (const patch of [{ valuation: undefined }, { manual: true }, { periodDerived: true }, { filled: [{ id: 'a', from: b.date, reason: 'partial' }] }, { valuation: { ...b.valuation, at: 'wrong' } }, { valuation: { ...b.valuation, baseCurrency: 'USD' } }]) {
    const r = await attribute({ ...b, ...patch }, c)
    assert.equal(r.status, 'unknown')
    assert.deepEqual(r.effects, { fx: null, price: null, quantity: null })
    assert.equal(r.residual, 10)
  }
})

test('missing current rate is unknown, never a realized loss or complete explanation', async () => {
  const r = await attribute(...pair(data([cash('USD', 10)], { USD: 32 }), data([cash('USD', 10)])))
  assert.equal(r.status, 'unknown')
  assert.equal(r.effects.fx, null)
  assert.equal(r.residual, -320)
  assert.match(r.rows[0].reason, /匯率/)
})

test('known factors remain partial when unknown entries offset to a zero residual', async () => {
  const [b, c] = pair(data([cash('TWD', 100), cash('USD', 10)]), data([cash('TWD', 110), cash('USD', 10)]))
  const r = await attribute(b, c)
  assert.equal(r.status, 'partial'); assert.equal(r.residual, 0)
  assert.equal(r.effects.quantity, 10)
  assert.equal(r.unknownCount, 1)
})

test('conflicting duplicate identities are not guessed or silently combined', async () => {
  const r = await attribute(...pair(data([holding(2, 100), holding(3, 120, { id: 'lot-2' })], { USD: 32 }), data([holding(5, 110)], { USD: 32 })))
  assert.equal(r.status, 'unknown'); assert.equal(r.effects.price, null)
  assert.match(r.rows[0].reason, /重複/)
})

test('endpoint mismatch cannot claim complete attribution even if residual is zero', async () => {
  const [b, c] = pair(data([cash('TWD', 100)]), data([cash('TWD', 110)]))
  b.total += 50; c.total += 50
  const r = await attribute(b, c)
  assert.equal(r.status, 'partial'); assert.equal(r.residual, 0)
})

test('capture, save, parse, history archive and monthly summary preserve evidence', () => {
  const d = data([holding(2, 100)], { USD: 32 })
  d.updatedAt = at('2025-12-15')
  const saved = history.recordSave(null, d)
  const raw = JSON.parse(JSON.stringify(saved))
  raw.history.snapshots[0].valuation.extra = 'omit'
  raw.history.snapshots[0].valuation.entries[0].extra = 'omit'
  const parsed = model.parseWealthData(raw)
  assert.deepEqual(parsed.history.snapshots[0].valuation, saved.history.snapshots[0].valuation)
  const split = parts.splitData(parsed, 'dataset', at('2026-10-18'))
  const content = split.parts.get('history-2025')
  const part = parts.parsePart(parts.serializePart('history-2025', 'dataset', content, 1), 'dataset')
  const joined = model.parseWealthData(parts.joinData(split.main, [part]), 'part')
  assert.deepEqual(joined.history.snapshots[0].valuation, saved.history.snapshots[0].valuation)
  const summaryPart = { ...summary.partSummary('history-2025', content, {}), hash: 'hash', md5: null, sequence: 1 }
  assert.deepEqual(summary.parseSummary({ parts: { 'history-2025': summaryPart } }).parts['history-2025'].points[0].valuation, saved.history.snapshots[0].valuation)
})

test('legacy snapshot parse preserves total and invalid optional numeric evidence stays unknown', () => {
  const [b] = pair(data([cash('TWD', 100)]), data([]))
  const raw = JSON.parse(JSON.stringify(b)); delete raw.valuation
  assert.equal(history.parseHistory({ snapshots: [raw] }, why => { throw Error(why) }).snapshots[0].valuation, undefined)
  b.valuation.entries[0].rate = -1
  b.valuation.entries[0].price = 0
  const parsed = history.parseHistory({ snapshots: [b] }, why => { throw Error(why) }).snapshots[0]
  assert.equal(parsed.total, 100)
  assert.equal(parsed.valuation.entries[0].rate, null)
  assert.equal(parsed.valuation.entries[0].price, null)
})

test('retrospective legacy bootstrap does not manufacture valuation evidence', () => {
  const saved = data([cash('USD', 10)], { USD: 32 }, { updatedAt: at('2026-10-16') })
  const next = history.recordSave(saved, { ...saved, updatedAt: at('2026-10-18'), fxRates: { USD: 33 } })
  assert.deepEqual(next.history.snapshots.map(s => [s.date, s.total]), [['2026-10-16', 320], ['2026-10-18', 330]])
  assert.equal(next.history.snapshots[0].valuation, undefined)
  assert.equal(next.history.snapshots[1].valuation.entries[0].rate, 33)
})

test('totalPoints replacement of an equal-value raw snapshot owns no raw evidence', async () => {
  const d = data([cash('USD', 10)], { USD: 32 })
  const raw = history.snapshotOf(d, at('2026-10-16'))
  d.history.snapshots = [raw]
  d.history.valuedQuantityDays = [{ date: raw.date, updatedAt: raw.at, entries: [{ accountId: 'a', account: 'Bank', country: 'SG', category: '其他', type: 'cash', symbol: '', currency: 'USD', quantity: 10, fx: { source: 'Yahoo', symbol: 'USDTWD=X', date: raw.date, value: 32 } }] }]
  const points = history.totalPoints(d, at('2026-10-18'))
  const shown = points.find(p => p.date === raw.date)
  assert.equal(shown.total, raw.total)
  assert.equal(shown.valuation, undefined)
  assert.equal((await attribute(shown, history.snapshotOf(d, at('2026-10-18')))).status, 'unknown')
})
