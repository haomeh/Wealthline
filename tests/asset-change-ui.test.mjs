import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

let server, history, model, ChangeSinceLast
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;[history, model] = await Promise.all(['history', 'model'].map(n => server.ssrLoadModule(`/src/${n}.ts`)))
  ;({ ChangeSinceLast } = await server.ssrLoadModule('/src/views/AssetChange.tsx'))
})
after(() => server.close())
const current = () => ({ ...model.emptyData(), fxRates: { SGD: 24, USD: 31.43 }, accounts: [{ id: 'a', name: 'DBS', kind: 'bank', country: 'SG', category: '現金與外幣活存', positions: [
  { id: 'sgd', type: 'cash', currency: 'SGD', symbol: '', quantity: 100000, price: 1 }, { id: 'usd', type: 'cash', currency: 'USD', symbol: '', quantity: 20000, price: 1 },
] }] })
const earlier = days => new Date(Date.now() - days * 86400000).toISOString()
const fixture = (days = 1) => {
  const d = current()
  d.history.snapshots = [history.snapshotOf({ ...d, fxRates: { SGD: 23.9, USD: 31.3 } }, earlier(days))]
  return d
}
const render = d => {
  const dom = new JSDOM(renderToStaticMarkup(createElement(ChangeSinceLast, { data: d })))
  return { dom, document: dom.window.document, text: dom.window.document.body.textContent }
}

test('near-total explanation opens native factor cards with account and rate evidence', () => {
  const { dom, document, text } = render(fixture())
  assert.match(text, /12,600/)
  assert.match(text, /主要為匯率影響/)
  assert.match(text, /匯率影響/); assert.match(text, /價格影響/); assert.match(text, /餘額／持倉調整/)
  const details = document.querySelector('details.asset-attribution')
  assert.ok(details)
  assert.equal(details.open, false)
  details.querySelector('summary').click()
  assert.equal(details.open, true)
  const factors = details.querySelectorAll('.asset-attribution-factor')
  assert.equal(factors.length, 3)
  factors[0].querySelector('summary').click()
  assert.equal(factors[0].open, true)
  assert.match(factors[0].textContent, /DBS/)
  assert.match(factors[0].textContent, /SGD/)
  assert.match(factors[0].textContent, /23\.9.*24/)
  assert.match(text, /先匯率，再價格，最後數量/)
  assert.doesNotMatch(text, /市場報酬|收入|已實現/)
  dom.window.close()
})

test('gapped comparison retains the real baseline date and skips same-day saves', () => {
  const d = fixture(4)
  d.history.snapshots.push(history.snapshotOf({ ...d, fxRates: { SGD: 1, USD: 1 } }, new Date().toISOString()))
  const { dom, text } = render(d)
  assert.match(text, /12,600/)
  assert.match(text, /的紀錄/)
  assert.ok(text.includes(d.history.snapshots[0].date.replace(/-/g, '/')))
  assert.doesNotMatch(text, /較昨天/)
  dom.window.close()
})

test('legacy evidence shows unknown factors and residual rather than invented zeros', () => {
  const d = fixture(); delete d.history.snapshots[0].valuation
  const { dom, document, text } = render(d)
  assert.match(text, /尚無法拆解/); assert.match(text, /未解釋差額/)
  assert.match(document.querySelector('.asset-attribution-residual').textContent, /12,600/)
  for (const factor of document.querySelectorAll('.asset-attribution-factor')) assert.match(factor.querySelector('summary').textContent, /尚無法拆解/)
  dom.window.close()
})

test('partial zero residual explicitly remains partial when current FX is missing', () => {
  const d = fixture(); delete d.fxRates.USD; delete d.history.snapshots[0].valuation.entries.find(e => e.currency === 'USD').rate
  // The legacy total for the unknown currency is also omitted, making its residual zero.
  d.history.snapshots[0].total = 2390000; d.history.snapshots[0].accounts[0].value = 2390000
  const { dom, text } = render(d)
  assert.match(text, /部分可拆解/); assert.match(text, /匯率/)
  assert.match(text, /差額為 0 仍不代表完整/)
  assert.doesNotMatch(text, /主要為匯率影響/)
  dom.window.close()
})

test('no history and uncovered sparse prior accounts never show whole balance as gain', () => {
  const d = current()
  assert.equal(renderToStaticMarkup(createElement(ChangeSinceLast, { data: d })), '')
  d.history.snapshots = [{ date: history.localDate(earlier(1)), at: earlier(1), total: 10, accounts: [{ id: 'different', name: 'Sparse', value: 10 }], categories: {} }]
  assert.equal(renderToStaticMarkup(createElement(ChangeSinceLast, { data: d })), '')
})
