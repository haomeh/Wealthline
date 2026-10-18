import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

let server, history, model, DailyAssetChange, Overview
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;[history, model] = await Promise.all(['history', 'model'].map(n => server.ssrLoadModule(`/src/${n}.ts`)))
  ;({ DailyAssetChange } = await server.ssrLoadModule('/src/views/AssetChange.tsx'))
  ;({ Overview } = await server.ssrLoadModule('/src/views/Overview.tsx'))
})
after(() => server.close())
const at = '2026-10-18T12:00:00'
const current = () => ({ ...model.emptyData(), fxRates: { USD: 31 }, accounts: [{ id: 'a', name: 'Bank', kind: 'investment', category: '股票', positions: [{ id: 'vt', type: 'holding', currency: 'USD', symbol: 'VT', quantity: 12, price: 90 }] }] })
const fixture = () => {
  const d = current(), b = current()
  b.fxRates.USD = 32; b.accounts[0].positions[0].quantity = 10; b.accounts[0].positions[0].price = 100
  d.history.snapshots = [history.snapshotOf(b, '2026-10-17T12:00:00')]
  return d
}
const render = (d, now = at) => new JSDOM(renderToStaticMarkup(createElement(DailyAssetChange, { data: d, today: history.snapshotOf(d, now) })))
const visibleText = document => document.querySelector('.daily-asset-change').textContent
const segments = doc => [...doc.querySelectorAll('.donut-segment')]

test('daily card uses absolute cause slices with signed labels and no endpoint table', () => {
  const dom = render(fixture()), doc = dom.window.document
  assert.match(doc.querySelector('h3').textContent, /今日資產變動/)
  assert.match(doc.querySelector('.daily-change-delta').textContent, /\+1,480/)
  assert.doesNotMatch(visibleText(doc), /32,000|33,480|2026\/10\/17|2026\/10\/18/)
  assert.deepEqual(segments(doc).map(n => n.getAttribute('aria-label')), ['匯率影響 NT$ −1,000', '價格影響 NT$ −3,100', '餘額／持倉調整 NT$ +5,580'])
  const shares = segments(doc).map(n => Number(n.dataset.share))
  assert.ok(Math.abs(shares[0] - 1000 / 9680) < 1e-12)
  assert.ok(Math.abs(shares[1] - 3100 / 9680) < 1e-12)
  assert.ok(Math.abs(shares[2] - 5580 / 9680) < 1e-12)
  assert.equal(doc.querySelector('details, .daily-change-totals, .asset-attribution-factors'), null)
  dom.window.close()
})

test('older, future and same-day records do not substitute for yesterday', () => {
  for (const date of ['2026-10-14T12:00:00', '2026-10-18T10:00:00', '2026-10-19T12:00:00']) {
    const d = fixture(); d.history.snapshots[0] = history.snapshotOf(d, date)
    const dom = render(d), doc = dom.window.document
    assert.match(doc.querySelector('.daily-change-note').textContent, /沒有昨天的完整快照/)
    assert.match(doc.querySelector('.daily-change-delta').textContent, /尚無法比較/)
    assert.equal(segments(doc).length, 0)
    assert.doesNotMatch(visibleText(doc), /NT\$ \+0/)
    dom.window.close()
  }
})

test('legacy exact snapshot shows signed unknown residual as a neutral slice', () => {
  const d = fixture(); delete d.history.snapshots[0].valuation
  const dom = render(d), doc = dom.window.document
  assert.match(doc.querySelector('.daily-change-delta').textContent, /\+1,480/)
  assert.equal(segments(doc).length, 1)
  assert.match(segments(doc)[0].getAttribute('aria-label'), /未解釋差額.*\+1,480/)
  assert.equal(segments(doc)[0].getAttribute('stroke'), 'var(--other)')
  assert.match(doc.querySelector('.daily-change-note').textContent, /尚無法拆解/)
  dom.window.close()
})

test('sparse and derived yesterday records are unavailable and never turn missing balances into gains', () => {
  for (const patch of [{ accounts: [] }, { manual: true }, { periodDerived: true }, { filled: [{ id: 'a', from: '2026-10-14', reason: 'partial' }] }, { at: '2026-10-19T12:00:00' }]) {
    const d = fixture(); Object.assign(d.history.snapshots[0], patch)
    const dom = render(d), doc = dom.window.document
    assert.match(doc.querySelector('.daily-change-delta').textContent, /尚無法比較/)
    assert.doesNotMatch(visibleText(doc), /\+33,480/)
    dom.window.close()
  }
})

test('missing current FX with zero residual stays partial without invented cause slices', () => {
  const d = fixture()
  d.accounts[0].positions.push({ id: 'cash', type: 'cash', currency: 'TWD', symbol: '', quantity: 100, price: 1 })
  const old = structuredClone(d); delete old.fxRates.USD
  d.history.snapshots = [history.snapshotOf(old, '2026-10-17T12:00:00')]
  delete d.fxRates.USD
  const dom = render(d), doc = dom.window.document
  assert.match(doc.querySelector('.daily-change-note').textContent, /部分可拆解/)
  assert.equal(segments(doc).length, 0)
  assert.equal(doc.querySelector('.daily-change-note').getAttribute('role'), 'status')
  assert.match(doc.querySelector('.daily-change-note').textContent, /匯率/)
  dom.window.close()
})

test('yesterday follows the local calendar across a month boundary and ignores historical interpolation', () => {
  const d = fixture()
  d.history.snapshots = [history.snapshotOf(d, '2026-09-30T23:30:00')]
  d.history.valuedQuantityDays = [{ date: '2026-09-30', updatedAt: at, entries: [] }]
  const dom = render(d, '2026-10-01T00:05:00'), doc = dom.window.document
  assert.equal(segments(doc).length, 0)
  assert.match(doc.querySelector('.daily-change-note').textContent, /已知估值因素.*0/)
  assert.match(doc.querySelector('.daily-change-delta').textContent, /\+0/)
  dom.window.close()
})

test('overview preserves the total-assets and net-worth group before one daily card and lower metrics', () => {
  const d = fixture(); d.liabilities = [{ id: 'loan', name: 'Loan', kind: 'other', currency: 'TWD', balance: 1000 }]
  const noop = () => {}
  const dom = new JSDOM(renderToStaticMarkup(createElement(Overview, { data: d, onGoRates: noop, onNewAccount: noop, onImport: noop, onOpenAccount: noop }))), doc = dom.window.document
  const total = doc.querySelector('.snapshot-timeline'), daily = doc.querySelector('.daily-asset-change')
  assert.equal(total.nextElementSibling, doc.querySelector('[aria-label="淨資產"]'))
  assert.equal(total.nextElementSibling.nextElementSibling, daily)
  assert.equal(daily.nextElementSibling, doc.querySelector('[aria-label="總負債"]'))
  assert.equal(doc.querySelectorAll('.daily-asset-change').length, 1)
  assert.equal(total.querySelector('.asset-attribution'), null)
  assert.match(total.querySelector('.hero-figure').textContent, /33,480/)
  assert.equal(daily.querySelector('.daily-change-totals'), null)
  assert.match(doc.querySelector('[aria-label="淨資產"]').textContent, /32,480/)
  assert.match(doc.querySelector('[aria-label="總負債"]').textContent, /1,000/)
  dom.window.close()
})


test('offsetting effects keep two positive geometry slices when net change is zero', () => {
  const d = fixture()
  d.accounts[0].positions[0].quantity = 10
  d.accounts[0].positions[0].price = 100
  d.fxRates.USD = 32
  const old = structuredClone(d); old.fxRates.USD = 30; old.accounts[0].positions[0].price = 100 * 32 / 30
  d.history.snapshots = [history.snapshotOf(old, '2026-10-17T12:00:00')]
  const dom = render(d), doc = dom.window.document
  assert.match(doc.querySelector('.daily-change-delta').textContent, /[+−]0/)
  assert.equal(segments(doc).length, 2)
  for (const n of segments(doc)) assert.ok(Math.abs(Number(n.dataset.share) - .5) < 1e-12)
  assert.match(segments(doc)[0].getAttribute('aria-label'), /\+/)
  assert.match(segments(doc)[1].getAttribute('aria-label'), /−/)
  dom.window.close()
})

test('ring pointer, keyboard focus, Enter, Escape and mobile-style click expose the same signed cause', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/app' })
  const prior = new Map(['window', 'document', 'HTMLElement', 'SVGElement', 'IS_REACT_ACT_ENVIRONMENT'].map(k => [k, globalThis[k]]))
  for (const k of ['window', 'document', 'HTMLElement', 'SVGElement']) globalThis[k] = dom.window[k]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  try {
    const d = fixture()
    await act(() => root.render(createElement(DailyAssetChange, { data: d, today: history.snapshotOf(d, at) })))
    const [fx, price] = segments(document)
    await act(() => fx.dispatchEvent(new window.Event('pointerover', { bubbles: true })))
    assert.match(document.querySelector('[role="tooltip"]').textContent, /匯率影響NT\$ −1,000/)
    assert.doesNotMatch(document.querySelector('[role="tooltip"]').textContent, /%/)
    await act(() => price.focus())
    assert.match(document.querySelector('[role="tooltip"]').textContent, /價格影響NT\$ −3,100/, 'keyboard focus overrides a pointer left over another cause')
    assert.ok(price.getAttribute('aria-describedby'))
    await act(() => price.blur())
    assert.equal(document.querySelector('[role="tooltip"]'), null)
    await act(() => fx.dispatchEvent(new window.Event('pointerover', { bubbles: true })))
    await act(() => fx.dispatchEvent(new window.Event('pointerout', { bubbles: true })))
    assert.equal(document.querySelector('[role="tooltip"]'), null)
    await act(() => price.focus())
    assert.match(document.querySelector('[role="tooltip"]').textContent, /價格影響NT\$ −3,100/)
    assert.ok(price.getAttribute('aria-describedby'))
    await act(() => price.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('[role="tooltip"]'), null)
    await act(() => price.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    assert.match(document.querySelector('[role="tooltip"]').textContent, /價格影響NT\$ −3,100/)
    await act(() => price.blur())
    assert.equal(document.querySelector('[role="tooltip"]'), null)
    await act(() => fx.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
    assert.match(document.querySelector('[role="tooltip"]').textContent, /匯率影響NT\$ −1,000/)
    await act(() => fx.dispatchEvent(new window.MouseEvent('click', { bubbles: true })))
    assert.equal(document.querySelector('[role="tooltip"]'), null)
  } finally {
    await act(() => root.unmount()); dom.window.close()
    for (const [k, value] of prior) { if (value === undefined) delete globalThis[k]; else globalThis[k] = value }
  }
})


test('partial attribution keeps signed unknown remainder beside known effects', () => {
  const d = fixture(); d.history.snapshots[0].total += 100; d.history.snapshots[0].accounts[0].value += 100
  const dom = render(d), doc = dom.window.document
  assert.equal(segments(doc).length, 4)
  const unknown = segments(doc).find(n => n.dataset.cause === '未解釋差額')
  assert.match(unknown.getAttribute('aria-label'), /NT\$ −100/)
  assert.equal(unknown.getAttribute('stroke'), 'var(--other)')
  assert.ok(Math.abs(segments(doc).reduce((sum, n) => sum + Number(n.dataset.share), 0) - 1) < 1e-12)
  assert.match(doc.querySelector('.daily-change-note').textContent, /部分可拆解/)
  dom.window.close()
})
