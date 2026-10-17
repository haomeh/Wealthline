import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement, useState } from 'react'
let server, dom, root, createRoot, quick, format, model, QuickClassify, BankTransactions, Cashflow, DetailRecord
before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  quick = await server.ssrLoadModule('/src/quickClassify.ts')
  format = await server.ssrLoadModule('/src/format.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  ;({ QuickClassify } = await server.ssrLoadModule('/src/views/QuickClassify.tsx'))
  ;({ BankTransactions } = await server.ssrLoadModule('/src/views/BankTransactions.tsx'))
  ;({ Cashflow } = await server.ssrLoadModule('/src/views/Cashflow.tsx'))
  ;({ DetailRecord } = await server.ssrLoadModule('/src/views/DetailRecord.tsx'))
})
afterEach(async () => { if (root) await act(() => root.unmount()); root = null })
after(async () => { await server?.close(); dom?.window.close() })

const bank = (id, date, description, direction = 'debit', extra = {}) => ({ id, accountId: 'dbs', date, description, currency: 'SGD', direction, amount: 2.11, ...extra })
const card = (id, date, description, amount = 120, extra = {}) => ({ id, date, description, card: 'HSBC Card', currency: 'TWD', amount, ...extra })
const data = (extra = {}) => ({
  ...model.emptyData(),
  bankTransactionAccounts: [{ id: 'dbs', label: 'DBS', bank: 'DBS' }],
  bankTransactions: [
    bank('paylah1', '2026-09-28', 'Advice Funds Transfer TOP-UP TO PAYLAH! : ZHAO HUI CHEN'),
    bank('paylah2', '2026-09-26', 'Advice Funds Transfer TOP-UP TO PAYLAH! : ZHAO HUI CHEN'),
    bank('interest', '2026-09-30', 'Interest Earned', 'credit'),
    bank('done', '2026-09-29', 'Salary', 'credit', { classification: { kind: 'income', category: '薪資' } }),
    bank('august', '2026-08-20', 'Quick Cheque Deposit', 'credit'),
  ],
  bankCategoryRules: [],
  expenses: [card('shop', '2026-09-27', 'ZZZ 商店'), card('meal', '2026-09-25', 'STARBUCKS')],
  expenseCategoryRules: [],
  ...extra,
})

test('list amounts keep one number of decimals per currency, so a column lines up at the right edge', () => {
  assert.deepEqual(format.amountParts(238, 'SGD'), { whole: '238', fraction: '.00' })
  assert.deepEqual(format.amountParts(0.9, 'SGD'), { whole: '0', fraction: '.90' })
  assert.deepEqual(format.amountParts(13936, 'TWD'), { whole: '13,936', fraction: '' })
  assert.deepEqual(format.amountParts(85000, 'NT$'), { whole: '85,000', fraction: '' })
  assert.deepEqual(format.amountParts(1200, 'JPY'), { whole: '1,200', fraction: '' })
  // A TWD amount with cents still shows them rather than rounding money away.
  assert.deepEqual(format.amountParts(2.5, 'TWD'), { whole: '2', fraction: '.50' })
  assert.equal(format.listAmount(1838.9, 'SGD'), '1,838.90')
  assert.equal(format.listAmount(20199, 'TWD'), '20,199')
})

test('a long row title is marked for the full-title bubble, with no second native tooltip', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const title = '17SEP26 HIBA882 10:03:21 TW F019 FISC 081081F019 HIB TO 012 REF A882'
  const html = renderToStaticMarkup(createElement(DetailRecord, { title, value: '1', label: 'row' }, createElement('p', null, title)))
  assert.match(html, new RegExp(`class="detail-record-heading" data-full="${title}"`))
  assert.doesNotMatch(html, /<summary[^>]*title=/)
})

test('the queue holds bank rows left pending and card rows left 未分類, newest first, within the range', () => {
  const d = data()
  assert.deepEqual(quick.quickQueue(d, ['bank', 'card']).map((r) => r.id), ['interest', 'paylah1', 'shop', 'paylah2', 'august'])
  assert.deepEqual(quick.quickQueue(d, ['bank'], (date) => date.startsWith('2026-09')).map((r) => r.id), ['interest', 'paylah1', 'paylah2'])
  assert.deepEqual(quick.quickQueue(d, ['card']).map((r) => r.id), ['shop'])
  // A rule already covering a row takes it out of the queue.
  const ruled = data({ bankCategoryRules: [{ keyword: 'PAYLAH', direction: 'debit', target: { kind: 'excluded', reason: '自有帳戶轉帳' } }] })
  assert.deepEqual(quick.quickQueue(ruled, ['bank']).map((r) => r.id), ['interest', 'august'])
})

test('one choice classifies the row, optionally its same-description rows, and can add a rule', () => {
  const d = data()
  const item = quick.quickItem(d, { source: 'bank', id: 'paylah1' })
  assert.deepEqual(quick.similarPending(d, item).map((r) => r.id), ['paylah2'])
  const choice = { source: 'bank', classification: { kind: 'excluded', reason: '自有帳戶轉帳' } }
  const alone = quick.applyQuickChoice(d, item, choice)
  assert.deepEqual(alone.bankTransactions.find((r) => r.id === 'paylah1').classification, choice.classification)
  assert.equal(alone.bankTransactions.find((r) => r.id === 'paylah2').classification, undefined)
  const both = quick.applyQuickChoice(d, item, choice, { alsoIds: ['paylah2'], ruleKeyword: ' TOP-UP TO PAYLAH! ' })
  assert.deepEqual(both.bankTransactions.find((r) => r.id === 'paylah2').classification, choice.classification)
  assert.deepEqual(both.bankCategoryRules, [{ keyword: 'TOP-UP TO PAYLAH!', direction: 'debit', target: choice.classification }])
  const shop = quick.quickItem(d, { source: 'card', id: 'shop' })
  const cardDone = quick.applyQuickChoice(d, shop, { source: 'card', category: '帳戶移轉' }, { ruleKeyword: 'ZZZ' })
  assert.equal(cardDone.expenses.find((e) => e.id === 'shop').category, '帳戶移轉')
  assert.deepEqual(cardDone.expenseCategoryRules, [{ keyword: 'ZZZ', category: '帳戶移轉' }])
  assert.equal(cardDone.version, 17)
  assert.throws(() => quick.applyQuickChoice(d, shop, choice))
})

test('options follow the direction, and rule keywords stop before references, dates and names', () => {
  const debit = quick.quickOptions(quick.quickItem(data(), { source: 'bank', id: 'paylah1' }))
  assert.deepEqual(debit.map((g) => g.label), ['消費', '不計收支', '收入沖回'])
  assert.equal(debit[0].options[0].label, '餐飲')
  const credit = quick.quickOptions(quick.quickItem(data(), { source: 'bank', id: 'interest' }))
  assert.deepEqual(credit.map((g) => g.label), ['收入', '不計收支', '消費退款'])
  assert.ok(!credit[0].options.some((o) => o.label === '未分類'))
  assert.equal(quick.suggestKeyword('Advice Funds Transfer TOP-UP TO PAYLAH! : ZHAO HUI CHEN'), 'Advice Funds Transfer TOP-UP TO PAYLAH!')
  assert.equal(quick.suggestKeyword('存入利息 REF ZDD4-00088'), '存入利息')
  assert.equal(quick.suggestKeyword('/CCP/450307XXXXXX3278 REF B502-04559'), '')
  assert.equal(quick.suggestKeyword('Debit Card Transaction SINGTEL PREPAID HI!ACC SI SGP 21SEP'), 'Debit Card Transaction SINGTEL PREPAID HI!ACC')
})

const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const click = (el) => { assert.ok(el, 'element to click'); return act(() => el.click()) }
const button = (text) => [...document.querySelectorAll('dialog.quick-classify button')].find((b) => b.textContent.replace(/^\d/, '') === text)
const cardTitle = () => document.querySelector('.quick-card-title')?.textContent
async function host(Component, initial, props) {
  const changes = []
  function Host() {
    const [d, setD] = useState(initial)
    return createElement(Component, { data: d, onChange: (next) => { changes.push(next); setD(next) }, busy: false, ...props })
  }
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(createElement(Host)))
  await wait(30)
  return changes
}

test('the dialog shows one card at a time: a category classifies it and its twins, skip and back move between cards', async () => {
  let closed = 0
  const changes = await host(QuickClassify, data(), { sources: ['bank'], onClose: () => closed++ })
  assert.equal(cardTitle(), 'Interest Earned')
  assert.match(document.querySelector('.quick-classify-head').textContent, /還有 4 筆未分類/)
  await click(button('利息'))
  assert.deepEqual(changes.at(-1).bankTransactions.find((r) => r.id === 'interest').classification, { kind: 'income', category: '利息' })
  assert.equal(cardTitle(), 'Advice Funds Transfer TOP-UP TO PAYLAH! : ZHAO HUI CHEN')
  assert.match(document.querySelector('.quick-extras').textContent, /摘要相同的另外 1 筆一起套用/)
  await click(button('自有帳戶轉帳'))
  // The twin was classified with it, so the next card is August's deposit.
  assert.equal(changes.at(-1).bankTransactions.find((r) => r.id === 'paylah2').classification.reason, '自有帳戶轉帳')
  assert.equal(cardTitle(), 'Quick Cheque Deposit')
  await click(button('上一筆'))
  assert.equal(cardTitle(), 'Advice Funds Transfer TOP-UP TO PAYLAH! : ZHAO HUI CHEN')
  assert.equal(document.querySelector('.quick-options .chip.on')?.textContent, '自有帳戶轉帳')
  await click(button('略過'))
  await click(button('略過'))
  assert.match(document.querySelector('.quick-classify-done').textContent, /還有 1 筆略過未分類/)
  await click(button('再看略過的 1 筆'))
  assert.equal(cardTitle(), 'Quick Cheque Deposit')
  // Digits pick from the first group.
  await act(() => document.querySelector('dialog.quick-classify').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '5', bubbles: true })))
  assert.deepEqual(changes.at(-1).bankTransactions.find((r) => r.id === 'august').classification, { kind: 'income', category: '其他收入' })
  assert.match(document.querySelector('.quick-classify-done').textContent, /全部分類完成/)
  await click(button('完成'))
  assert.equal(closed, 1)
})

test('a rule with no keyword is refused on the card without changing anything', async () => {
  const changes = await host(QuickClassify, data(), { sources: ['bank'], onClose() {} })
  const ruleBox = [...document.querySelectorAll('.quick-check input')].at(-1)
  await click(ruleBox)
  const input = document.querySelector('input[aria-label="快速分類規則關鍵字"]')
  assert.equal(input.value, 'Interest Earned')
  await act(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })) })
  await click(button('利息'))
  assert.equal(changes.length, 0)
  assert.match(document.querySelector('.quick-error').textContent, /請填寫規則關鍵字/)
  assert.equal(cardTitle(), 'Interest Earned')
})

test('the bank ledger and the cashflow 未分類 tile open the cards', async () => {
  await host(BankTransactions, data(), {})
  const callout = document.querySelector('.quick-classify-callout')
  assert.match(callout.textContent, /4 筆流水未分類/)
  await click(callout.querySelector('button'))
  assert.equal(cardTitle(), 'Interest Earned')
  await act(() => root.unmount()); root = null
  const now = new Date(), month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const current = data({
    bankTransactions: [bank('now', `${month}-02`, 'Transfer out', 'debit', { currency: 'TWD' }), bank('old', '2020-01-02', 'Old row', 'debit', { currency: 'TWD' })],
    expenses: [card('cardnow', `${month}-03`, 'ZZZ 商店')],
  })
  await host(Cashflow, current, { onGoExpenses() {}, onGoBankTransactions() {}, onImport() {} })
  const tile = document.querySelector('.cashflow-pending-tile')
  await click([...tile.querySelectorAll('button')].find((b) => b.textContent === '快速分類'))
  // The shown month only: this month's bank row and card row, not 2020's.
  assert.match(document.querySelector('.quick-classify-head').textContent, /還有 2 筆未分類/)
})
