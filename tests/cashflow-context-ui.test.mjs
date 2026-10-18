import assert from 'node:assert/strict'
import { before, beforeEach, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

let server, dom, root, createRoot, Cashflow, Summary, Overview, model, entries, reviewState, props, Component
const originalFetch = globalThis.fetch
const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/cashflow' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key]
  window.scrollTo = () => {}
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;({ Cashflow } = await server.ssrLoadModule('/src/views/Cashflow.tsx'))
  ;({ CashflowSummary: Summary } = await server.ssrLoadModule('/src/views/CashflowSummary.tsx'))
  ;({ Overview } = await server.ssrLoadModule('/src/views/Overview.tsx'))
  model = await server.ssrLoadModule('/src/model.ts')
  entries = await server.ssrLoadModule('/src/cashflowEntries.ts')
  reviewState = await server.ssrLoadModule('/src/monthlyReviewState.ts')
})
beforeEach(() => {
  window.history.replaceState({}, '', '/cashflow?range=month&month=2026-01')
  globalThis.fetch = async () => new Response(JSON.stringify({ currency: 'TWD', asTraded: true, points: [{ date: '2026-01-24', close: 32 }] }))
})
afterEach(async () => { crypto.subtle.digest = originalDigest; globalThis.fetch = originalFetch; if (root) await act(() => root.unmount()); root = null })
after(async () => { await server?.close(); dom?.window.close() })
const card = (id, date = '2026-01-12', amount = 200, category) => ({ id, date, description: `Unknown ${id}`, card: 'Card', currency: 'TWD', amount, ...(category && { category }) })
const bank = (id, date = '2026-01-12', amount = 1000, classification = { kind: 'income', category: '薪資' }) => ({ id, date, accountId: 'ledger', description: `Unknown ${id}`, currency: 'TWD', direction: 'credit', amount, classification })
const fixture = () => ({ ...model.emptyData(), expenses: [card('a')], bankTransactions: [bank('salary')], bankTransactionAccounts: [{ id: 'ledger', label: 'Main', bank: 'Bank' }] })
async function flush() { for (let i = 0; i < 5; i++) await act(() => new Promise(resolve => setTimeout(resolve, 2))) }
async function render(component, values) { Component = component; props = values; root = createRoot(document.getElementById('root')); await act(() => root.render(createElement(Component, props))); await flush() }
async function rerender(values, settle = true) { props = { ...props, ...values }; await act(() => root.render(createElement(Component, props))); if (settle) await flush() }
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text)
async function click(node) { assert.ok(node); await act(() => node.click()); await flush() }
const pageProps = data => ({ data, onChange() {}, onImport() {}, onGoExpenses() {}, onGoBankTransactions() {} })
const status = () => document.querySelector('[aria-label="收支資料狀態"]')
async function reviewed(data, month = '2026-01', exceptionNote) {
  const sources = [...new Map(entries.cashflowEntries({ expenses: data.expenses, bankTransactions: data.bankTransactions }).filter(e => e.date.startsWith(month)).map(e => [JSON.stringify(e.source), e.source])).values()]
  const review = { month, expectedSources: sources, confirmations: [] }
  for (const source of sources) review.confirmations.push({ source, decision: 'reviewed', fingerprint: await reviewState.reviewFingerprint(entries.cashflowEntries({ expenses: data.expenses, bankTransactions: data.bankTransactions }), review, source), confirmedAt: '2026-02-01T00:00:00Z', ...(exceptionNote && { exceptionNote }) })
  return { ...data, monthlyReviews: [review] }
}

test('card-only pending queue opens existing classifier and counts mixed sources only in selected period', async () => {
  const data = { ...fixture(), bankTransactions: [], expenses: [card('a'), card('feb', '2026-02-12'), card('old', '2025-01-12')] }
  await render(Cashflow, pageProps(data))
  assert.match(document.querySelector('[aria-label="未分類"]').textContent, /未分類 1 筆.*銀行 0 筆.*信用卡 1 筆/)
  await click(button('快速分類'))
  assert.match(document.querySelector('dialog[aria-label="快速分類"]').textContent, /Unknown a/)
  assert.doesNotMatch(document.querySelector('dialog').textContent, /Unknown feb|Unknown old/)
  await click(document.querySelector('[aria-label="關閉快速分類"]'))
  await rerender({ data: { ...data, bankTransactions: [bank('pending', '2026-01-15', 10, { kind: 'pending' })] } })
  assert.match(document.querySelector('[aria-label="未分類"]').textContent, /未分類 2 筆.*銀行 1 筆.*信用卡 1 筆/)
  await click(button('年度'))
  assert.match(document.querySelector('[aria-label="未分類"]').textContent, /未分類 3 筆/)
  await click(button('全部期間'))
  assert.match(document.querySelector('[aria-label="未分類"]').textContent, /未分類 4 筆/)
})

test('unloaded ledger never shows an actionable queue or a false zero', async () => {
  const { cashflowMonths } = await server.ssrLoadModule('/src/cashflow.ts')
  const data = fixture(), months = cashflowMonths({ expenses: data.expenses, bankTransactions: data.bankTransactions })
  await render(Cashflow, { ...pageProps(model.emptyData()), months, readiness: 'loading' })
  assert.match(status().textContent, /明細尚未載入.*核對狀態待確認/)
  assert.match(document.querySelector('[aria-label="未分類"]').textContent, /明細載入後確認未分類筆數/)
  assert.ok(!button('快速分類') || button('快速分類').disabled)
  assert.doesNotMatch(status().textContent, /儲蓄率\s*\d+%/)
})

test('savings requires closed reviewed current evidence, preserving explicit review exceptions', async () => {
  const data = await reviewed(fixture(), '2026-01', '保留待查')
  await render(Summary, { expenses: data.expenses, bankTransactions: data.bankTransactions, reviewData: data, readiness: 'ready', now: '2026-02-15' })
  assert.match(status().textContent, /銀行 1 筆.*信用卡 1 筆.*已人工核對/)
  assert.match(status().textContent, /儲蓄率 80%/)
  assert.match(status().textContent, /不代表完整月份/)
  const changed = { ...data, expenses: [{ ...data.expenses[0], amount: 300 }] }
  await rerender({ expenses: changed.expenses, reviewData: changed }, false)
  assert.doesNotMatch(status().textContent, /儲蓄率\s*\d+%/)
  await flush()
  assert.match(status().textContent, /需重新核對/)
  assert.ok(button('前往每月核對'))
})

test('current, future, unreviewed, aggregate and summary-only states explain savings limits', async () => {
  const data = await reviewed(fixture(), '2026-01', '保留待查')
  await render(Summary, { expenses: data.expenses, bankTransactions: data.bankTransactions, reviewData: data, now: '2026-01-25' })
  assert.match(status().textContent, /截至目前已核對.*本月尚未結束/)
  assert.doesNotMatch(status().textContent, /儲蓄率\s*\d+%/)
  await rerender({ now: '2025-12-25' })
  assert.match(status().textContent, /未來月份/)
  await rerender({ now: '2026-02-25', reviewData: { ...data, monthlyReviews: [] } })
  assert.match(status().textContent, /未核對.*尚未完成每月核對/)
  await click(button('年度'))
  assert.match(status().textContent, /有紀錄 1 個月.*已核對 0 個月/)
  assert.match(status().textContent, /切換至已核對的完整月份查看儲蓄率/)
  const { cashflowMonths } = await server.ssrLoadModule('/src/cashflow.ts')
  await rerender({ months: cashflowMonths({ expenses: data.expenses, bankTransactions: data.bankTransactions }), reviewData: data, readiness: 'loading' })
  assert.match(status().textContent, /明細尚未載入.*核對狀態待確認/)
  assert.doesNotMatch(status().textContent, /已人工核對|已核對 1 個月/)
})

test('obsolete asynchronous review responses cannot approve changed period or data; errors stay unconfirmed', async () => {
  const data = await reviewed(fixture(), '2026-01', '保留待查')
  const pending = []
  crypto.subtle.digest = (...args) => new Promise((resolve, reject) => pending.push(() => originalDigest(...args).then(resolve, reject)))
  await render(Summary, { expenses: data.expenses, bankTransactions: data.bankTransactions, reviewData: data, now: '2026-02-25' })
  assert.match(status().textContent, /正在檢查核對狀態/)
  await click(document.querySelector('[aria-label="下個月"]'))
  await act(async () => { for (const finish of pending) await finish() })
  await flush()
  assert.doesNotMatch(status().textContent, /已人工核對|儲蓄率\s*\d+%/)
  crypto.subtle.digest = async () => { throw new Error('hash failed') }
  await click(document.querySelector('[aria-label="上個月"]'))
  assert.match(status().textContent, /核對狀態無法確認/)
  assert.doesNotMatch(status().textContent, /已人工核對|儲蓄率\s*\d+%/)
})

test('expense-only chart ignores income outlier, preserves twelve buttons and drilldown, and represents negative refunds', async () => {
  const data = { ...fixture(), expenses: [card('jan', '2026-01-12', 100, '餐飲'), card('refund', '2026-02-12', -50, '餐飲'), card('zero', '2026-03-12', 0, '餐飲')], bankTransactions: [bank('outlier', '2026-01-12', 100000)] }
  await render(Cashflow, pageProps(data))
  const jan = () => document.querySelector('.cashflow-bar.on')
  assert.equal(jan().querySelector('[data-series="consumption"]').style.height, '0.1%')
  await click(button('只看消費'))
  assert.equal(document.querySelectorAll('.cashflow-bar').length, 12)
  assert.equal(jan().querySelector('[data-series="consumption"]').style.height, '100%')
  assert.equal(document.querySelectorAll('.cashflow-bar [data-series="income"]').length, 0)
  const feb = document.querySelector('.cashflow-bar[aria-label^="2026 年 2 月"]')
  assert.equal(feb.querySelector('[data-series="consumption"]').dataset.sign, '-1')
  assert.equal(feb.querySelector('[data-series="consumption"]').style.height, '50%')
  assert.match(document.querySelector('.cashflow-bar[aria-label^="2026 年 4 月"]').getAttribute('aria-label'), /無紀錄/)
  assert.doesNotMatch(document.querySelector('.cashflow-bar[aria-label^="2026 年 3 月"]').getAttribute('aria-label'), /無紀錄/)
  await click(feb)
  assert.match(window.location.search, /month=2026-02/)
  assert.match(document.querySelector('.cashflow-bar.on').getAttribute('aria-label'), /消費 -50/)
  assert.equal(button('只看消費').getAttribute('aria-pressed'), 'true')
  assert.match(document.body.textContent, /Unknown refund/)
})

test('review computation for replaced ledger data cannot publish its obsolete approval', async () => {
  const data = await reviewed(fixture(), '2026-01', '保留待查'), pending = []
  crypto.subtle.digest = (...args) => new Promise((resolve, reject) => pending.push(() => originalDigest(...args).then(resolve, reject)))
  await render(Summary, { expenses: data.expenses, bankTransactions: data.bankTransactions, reviewData: data, now: '2026-02-25' })
  const obsolete = pending.splice(0)
  const changed = { ...data, expenses: [{ ...data.expenses[0], amount: 600 }] }
  await rerender({ expenses: changed.expenses, reviewData: changed })
  await act(async () => { for (const finish of obsolete) await finish() })
  await flush()
  assert.match(status().textContent, /正在檢查核對狀態/)
  assert.doesNotMatch(status().textContent, /已人工核對|儲蓄率\s*\d+%/)
  await act(async () => { for (const finish of pending) await finish() })
  await flush()
  assert.match(status().textContent, /需重新核對/)
})

test('removed bank labels, unconfirmed exceptions and nonpositive income cannot produce savings', async () => {
  const data = await reviewed(fixture(), '2026-01', '保留待查')
  await render(Summary, { expenses: data.expenses, bankTransactions: data.bankTransactions, reviewData: { ...data, bankTransactionAccounts: [] }, now: '2026-02-25' })
  assert.match(status().textContent, /需重新核對/)
  assert.doesNotMatch(status().textContent, /儲蓄率\s*\d+%/)
  await rerender({ reviewData: await reviewed(fixture()) })
  assert.match(status().textContent, /需重新核對/)
  const zero = await reviewed({ ...fixture(), expenses: [card('a', '2026-01-12', 20, '餐飲')], bankTransactions: [bank('salary', '2026-01-12', 0)] })
  await rerender({ expenses: zero.expenses, bankTransactions: zero.bankTransactions, reviewData: zero })
  assert.match(status().textContent, /已人工核對.*收入須大於零/)
  assert.doesNotMatch(status().textContent, /儲蓄率\s*\d+%/)
  await rerender({ readiness: 'error' })
  assert.match(status().textContent, /明細載入失敗.*核對狀態待確認/)
})

test('FX loading and stale kept totals suppress actionable queue numbers and savings', async () => {
  const data = await reviewed(fixture(), '2026-01', '保留待查')
  await render(Cashflow, pageProps(data))
  assert.match(status().textContent, /儲蓄率 80%/)
  await rerender({ busy: true })
  assert.ok(button('快速分類').disabled)
  assert.doesNotMatch(status().textContent, /儲蓄率\s*\d+%/)
  const pending = []
  globalThis.fetch = url => new Promise(resolve => pending.push({ url, resolve }))
  const changed = { ...data, expenses: [{ ...data.expenses[0], currency: 'USD' }] }
  await rerender({ data: changed, busy: false })
  assert.ok(pending.length > 0)
  assert.ok(button('快速分類').disabled)
  assert.match(document.querySelector('[aria-label="未分類"]').textContent, /未分類筆數待確認/)
  assert.doesNotMatch(document.querySelector('[aria-label="未分類"]').textContent, /未分類 1 筆/)
  assert.doesNotMatch(status().textContent, /儲蓄率\s*\d+%/)
  await act(async () => { for (const item of pending) item.resolve(new Response('{}', { status: 502 })) })
  await flush()
  assert.ok(!button('快速分類') || button('快速分類').disabled)
})

test('Overview honors explicit ledger loading/error without cached summaries before certifying a reviewed closed month', async () => {
  const data = await reviewed(fixture(), '2026-01', '保留待查')
  await render(Overview, { data, cashflowReadiness: 'loading', onGoRates() {}, onNewAccount() {}, onImport() {}, onOpenAccount() {} })
  assert.match(status().textContent, /明細尚未載入.*核對狀態待確認/)
  assert.doesNotMatch(status().textContent, /已人工核對|儲蓄率\s*\d+%/)
  await rerender({ cashflowReadiness: 'error' })
  assert.match(status().textContent, /明細載入失敗.*核對狀態待確認/)
  assert.doesNotMatch(status().textContent, /已人工核對|儲蓄率\s*\d+%/)
  await rerender({ cashflowReadiness: 'ready' })
  assert.match(status().textContent, /已人工核對.*儲蓄率 80%/)
})
