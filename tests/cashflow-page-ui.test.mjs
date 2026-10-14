import assert from 'node:assert/strict'
import { before, beforeEach, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
let server, dom, root, createRoot, Cashflow
const originalFetch = globalThis.fetch
before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;({ Cashflow } = await server.ssrLoadModule('/src/views/Cashflow.tsx'))
})
// A slow exchange-rate request, as in the browser: conversions finish a moment after the click.
beforeEach(async () => {
  const { clearHistoryCache } = await server.ssrLoadModule('/src/priceHistory.ts'); clearHistoryCache()
  globalThis.fetch = async (url) => {
    const symbol = new URL(url, 'https://test').searchParams.get('symbol')
    await new Promise((r) => setTimeout(r, 30))
    return new Response(JSON.stringify({ symbol, currency: 'TWD', asTraded: true, points: [{ date: '2026-01-01', close: 20 }, { date: '2026-04-30', close: 20 }, { date: '2026-05-31', close: 20 }] }))
  }
})
afterEach(async () => { globalThis.fetch = originalFetch; if (root) await act(() => root.unmount()); root = null })
after(async () => { await server?.close(); dom?.window.close() })

const bank = (id, date, amount) => ({ id, accountId: 'hsbc', date, description: 'Synthetic', currency: 'SGD', direction: 'credit', amount, classification: { kind: 'income', category: '薪資' } })
const data = {
  expenses: [], expenseCategoryRules: [], bankCategoryRules: [],
  bankTransactionAccounts: [{ id: 'hsbc', label: 'HSBC', bank: 'HSBC' }],
  // April and May have records, March is empty.
  bankTransactions: [bank('apr', '2026-04-10', 100), bank('may', '2026-05-10', 300)],
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
async function open(props = {}) {
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(createElement(Cashflow, { data, onGoExpenses() {}, onGoBankTransactions() {}, onImport() {}, ...props })))
  await wait(300)
}
const buttons = (text) => [...document.querySelectorAll('button')].filter((b) => b.textContent === text)
const bar = (month) => [...document.querySelectorAll('.cashflow-bar')].find((el) => el.getAttribute('aria-label').includes(` ${month} 月：`))
const income = () => document.querySelector('[aria-label="收入"] strong')?.textContent
// The sections that must not blink out while a period changes.
const present = () => ({ tiles: !!document.querySelector('.cashflow-tiles'), bars: document.querySelectorAll('.cashflow-bar').length, categories: !!document.querySelector('.cashflow-categories-tile') })

test('picking a bar swaps the numbers at once, without the page emptying while rates load', async () => {
  const realNow = Date.now; Date.now = () => new Date('2026-05-20T00:00:00Z').getTime()
  try {
    await open()
    assert.equal(income(), '6,000')
    const seen = []
    const watcher = new dom.window.MutationObserver(() => seen.push(present()))
    watcher.observe(document.body, { subtree: true, childList: true })
    await act(() => bar(4).click())
    assert.equal(income(), '2,000', 'the clicked month shows right after the click')
    await wait(150)
    watcher.disconnect()
    assert.ok(seen.every((s) => s.tiles && s.bars === 12 && s.categories), 'tiles, bars and categories stay in the page')
    assert.doesNotMatch(document.body.textContent, /正在換算/)
  } finally { Date.now = realNow }
})

test('a month without records keeps the year chart and says it is empty', async () => {
  const realNow = Date.now; Date.now = () => new Date('2026-05-20T00:00:00Z').getTime()
  try {
    await open()
    await act(() => bar(3).click())
    await wait(150)
    assert.match(document.querySelector('.cashflow-no-record').textContent, /2026 年 3 月無紀錄，不代表收支為零/)
    assert.equal(document.querySelectorAll('.cashflow-bar').length, 12)
    assert.equal(bar(3).getAttribute('aria-pressed'), 'true')
    assert.equal(document.querySelector('[aria-label="收入"]'), null, 'no numbers for a month with no records')
    assert.equal(document.querySelector('.cashflow-categories-tile'), null)
    // Back to a month with records.
    await act(() => bar(5).click())
    assert.equal(income(), '6,000')
  } finally { Date.now = realNow }
})

test('the page has one statement import entry, with records and without', async () => {
  let opened = 0
  await open({ onImport: () => opened++ })
  assert.equal(buttons('匯入帳單').length, 1)
  await act(() => buttons('匯入帳單')[0].click())
  assert.equal(opened, 1)
  await act(() => root.unmount())
  await open({ data: { ...data, bankTransactions: [] }, onImport: () => opened++ })
  assert.match(document.body.textContent, /還沒有收支紀錄/)
  assert.equal(buttons('匯入帳單').length, 1)
  assert.deepEqual([...document.querySelectorAll('button')].map((b) => b.textContent).filter((t) => /匯入/.test(t)), ['匯入帳單'], 'no second, kind-specific import button')
  await act(() => buttons('匯入帳單')[0].click())
  assert.equal(opened, 2)
})
