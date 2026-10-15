import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement, useEffect, useState } from 'react'
let server, dom, root, createRoot, Cashflow, model, edits
before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;({ Cashflow } = await server.ssrLoadModule('/src/views/Cashflow.tsx'))
  model = await server.ssrLoadModule('/src/model.ts')
  edits = await server.ssrLoadModule('/src/ledgerEdits.ts')
})
afterEach(async () => { if (root) await act(() => root.unmount()); root = null })
after(async () => { await server?.close(); dom?.window.close() })

const today = new Date(), month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
const bank = (id, direction, amount, description, classification) => ({ id, accountId: 'main', date: `${month}-05`, description, currency: 'TWD', direction, amount, ...(classification && { classification }) })
const card = { id: 'card1', date: `${month}-03`, description: 'ZZZ商店', card: 'Card', currency: 'TWD', amount: 300 }
const older = bank('old', 'debit', 77, 'Older', undefined)
const baseData = () => ({
  ...model.emptyData(),
  bankTransactionAccounts: [{ id: 'main', label: 'Main', bank: 'Bank' }],
  bankTransactions: [bank('pay', 'credit', 1000, '薪資入帳', { kind: 'income', category: '薪資' }), bank('move', 'debit', 400, '轉帳 王小明'), { ...older, date: `${today.getFullYear() - 1}-02-03` }],
  bankCategoryRules: [], expenseCategoryRules: [], expenses: [card],
})
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
const click = (el) => { assert.ok(el, 'element to click'); return act(() => el.click()) }
const buttonLabelled = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') ?? ''))
async function choose(select, value) {
  assert.ok(select, 'select')
  await act(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(select, value); select.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
}
// The page with its own data state, as the app keeps it, and a log of every change handed to it.
async function open(initial, props = {}) {
  const changes = []
  let current = initial
  function Host() {
    const [data, setData] = useState(initial)
    useEffect(() => { current = data }, [data])
    return createElement(Cashflow, { data, onChange: (next) => { changes.push(next); setData(next) }, busy: false, onGoExpenses() {}, onGoBankTransactions() {}, ...props })
  }
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(createElement(Host)))
  await wait(60)
  for (const d of document.querySelectorAll('.cashflow-records')) d.open = true
  return { changes, data: () => current }
}
const consumption = () => document.querySelector('[aria-label="實際消費"] strong').textContent
const pending = () => document.querySelector('.cashflow-pending-tile')?.textContent ?? ''

test('a bank row\'s tag button edits its category rule, and the summary follows at once', async () => {
  const { changes, data } = await open(baseData())
  assert.equal(consumption(), '700')
  assert.match(pending(), /1 筆銀行流水未分類/)
  await click(buttonLabelled(/分類規則：未分類/))
  assert.ok(document.querySelector('dialog[open]'), 'the same rule dialog as the bank page')
  assert.equal(document.querySelector('dialog [aria-label="規則關鍵字"]').value, '轉帳 王小明')
  await choose(document.querySelector('dialog [aria-label="規則分類"]'), 'excluded:自有帳戶轉帳')
  await click([...document.querySelectorAll('dialog button')].find((b) => b.textContent === '儲存規則'))
  await wait(60)
  assert.equal(changes.length, 1)
  assert.deepEqual(data().bankCategoryRules, [{ keyword: '轉帳 王小明', direction: 'debit', target: { kind: 'excluded', reason: '自有帳戶轉帳' } }])
  assert.equal(data().bankTransactions.length, 3, 'every record stays, including the ones outside the month')
  assert.ok(data().version >= 13)
  assert.equal(document.querySelector('dialog[open]'), null)
  assert.equal(consumption(), '300', 'the excluded transfer leaves the consumption')
  assert.equal(pending(), '', 'nothing is unclassified any more')
})

test('a card row\'s tag button adds a rule, and its category shows under the description', async () => {
  const { data } = await open(baseData())
  assert.match(document.querySelector('.expense-record').textContent, /未分類/)
  await click(buttonLabelled(/^新增分類規則 .*ZZZ商店/))
  await choose(document.querySelector('dialog select'), '購物')
  await click([...document.querySelectorAll('dialog button')].find((b) => b.textContent === '新增規則'))
  await wait(60)
  assert.deepEqual(data().expenseCategoryRules, [{ keyword: 'ZZZ商店', category: '購物' }])
  assert.equal(data().expenses.length, 1)
  assert.ok(data().version >= 11)
  assert.match(document.querySelector('.expense-record .tag').textContent, /購物/)
  assert.equal(consumption(), '700', 'a category change does not move the total')
  assert.match(document.querySelector('.cashflow-categories-tile').textContent, /購物/)
})

test('a long account label the user chose does not block edits once the bank name is shown before it', async () => {
  const label = '帳'.repeat(90)
  const { data } = await open({ ...baseData(), bankTransactionAccounts: [...baseData().bankTransactionAccounts, { id: 'tw', label, bank: 'Taishin' }] })
  await click(buttonLabelled(/^編輯流水 move$/))
  assert.ok([...document.querySelectorAll('[aria-label="流水帳戶"] option')].some((o) => o.textContent.length > 100), 'the shown label carries the bank name')
  await choose(document.querySelector('[aria-label="流水分類"]'), 'expense:購物')
  await click([...document.querySelectorAll('.bank-editor button')].find((b) => b.textContent === '套用修改'))
  await wait(60)
  assert.equal(document.querySelector('.bank-editor'), null)
  assert.deepEqual(data().bankTransactions.find((r) => r.id === 'move').classification, { kind: 'expense', category: '購物' })
  assert.equal(data().bankTransactionAccounts.find((a) => a.id === 'tw').label, label, 'the stored label is unchanged')
})

test('the row editors open over the page and bring it back unchanged', async () => {
  const { changes, data } = await open(baseData())
  await click(buttonLabelled(/^編輯流水 move$/))
  assert.ok(document.querySelector('.bank-editor'))
  assert.ok(document.querySelector('.cashflow-body').hidden, 'the page is hidden, not unmounted')
  await choose(document.querySelector('[aria-label="流水分類"]'), 'expense:購物')
  await click([...document.querySelectorAll('.bank-editor button')].find((b) => b.textContent === '套用修改'))
  await wait(60)
  assert.equal(document.querySelector('.bank-editor'), null)
  assert.equal(document.querySelector('.cashflow-body').hidden, false)
  assert.deepEqual(data().bankTransactions.find((r) => r.id === 'move').classification, { kind: 'expense', category: '購物' })
  assert.equal(changes.length, 1)
  assert.equal(document.querySelectorAll('.cashflow-records[open]').length, 2, 'the open sections stay open')
  assert.match(pending(), /^$/)
  // The card editor.
  await click(buttonLabelled(/^編輯消費 .*ZZZ商店/))
  assert.match(document.querySelector('form.panel h2').textContent, /編輯消費明細/)
  await choose(document.querySelector('form.panel select'), '娛樂')
  await click([...document.querySelectorAll('form.panel button')].find((b) => b.textContent === '套用修改'))
  await wait(60)
  assert.equal(data().expenses[0].category, '娛樂')
  assert.match(document.querySelector('.expense-record .tag').textContent, /娛樂/)
})

test('cancelling an editor changes nothing', async () => {
  const { changes } = await open(baseData())
  await click(buttonLabelled(/^編輯流水 move$/))
  await click([...document.querySelectorAll('.bank-editor button')].find((b) => b.textContent === '取消'))
  assert.equal(changes.length, 0)
  await click(buttonLabelled(/分類規則：未分類/))
  await click([...document.querySelectorAll('dialog button')].find((b) => b.textContent === '取消規則'))
  assert.equal(changes.length, 0)
})

test('records stay read-only without onChange and while earlier parts are still loading', async () => {
  await open(baseData(), { onChange: undefined })
  assert.equal(document.querySelectorAll('.detail-record-actions button').length, 0)
  assert.equal(document.querySelector('.expense-record .tag'), null)
  await act(() => root.unmount()); root = null
  const { cashflowMonths } = await server.ssrLoadModule('/src/cashflow.ts')
  const data = baseData()
  // Months given: the records are the part loaded so far, and editing waits for the rest.
  await open(data, { months: cashflowMonths({ expenses: data.expenses, bankTransactions: data.bankTransactions }) })
  assert.match(document.body.textContent, /正在載入明細…/)
  assert.equal(document.querySelectorAll('.detail-record-actions button').length, 0)
})

test('a swipe-revealed bank row keeps one open row at a time', async () => {
  const { data } = await open(baseData())
  const rows = [...document.querySelectorAll('.bank-record')]
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.hasAttribute('data-swipe')), 'same swipe markup as the bank page')
  await act(() => rows[0].querySelector('.detail-record-actions button').focus())
  assert.equal(document.querySelectorAll('.bank-record[data-revealed]').length, 1)
  assert.equal(data().bankTransactions.length, 3)
})

// The pure edits behind the pages.
test('ledger edits keep every record, validate, and raise the data version', () => {
  const data = { ...baseData(), version: 2 }
  const rule = { keyword: '轉帳', target: { kind: 'excluded', reason: '自有帳戶轉帳' } }
  const withRule = edits.saveBankRule(data, rule)
  assert.equal(withRule.bankTransactions.length, 3)
  assert.equal(withRule.bankCategoryRules.length, 1)
  assert.ok(withRule.version >= 13)
  assert.deepEqual(edits.saveBankRule(withRule, { ...rule, keyword: '轉出' }, 0).bankCategoryRules.map((r) => r.keyword), ['轉出'])
  assert.throws(() => edits.saveBankTransaction(data, { ...data.bankTransactions[0], accountId: 'missing' }))
  assert.equal(edits.removeBankTransaction(data, 'move').bankTransactions.length, 2)
  const cardRule = edits.saveExpenseRule(data, { keyword: 'ZZZ', category: '購物' })
  assert.deepEqual(cardRule.expenseCategoryRules, [{ keyword: 'ZZZ', category: '購物' }])
  assert.ok(cardRule.version >= 11)
  assert.equal(edits.saveExpense(data, { ...card, category: '交通' }).expenses[0].category, '交通')
  assert.equal(edits.removeExpense(data, 'card1').expenses.length, 0)
})


test('inline category editing preserves v16 evidence and query, updates filtered rows, and makes its review stale', async () => {
  const {cashflowEntries} = await server.ssrLoadModule('/src/cashflowEntries.ts')
  const {reviewFingerprint,monthlyReviewState} = await server.ssrLoadModule('/src/monthlyReviewState.ts')
  const data = baseData()
  data.version = 16
  data.expenses = [{...card,sourceKey:'a'.repeat(64),importKey:'b'.repeat(64)}]
  const source = {kind:'card',card:'Card'}
  const review = {month,expectedSources:[source,{kind:'bank',accountId:'main'}],confirmations:[]}
  const entries = d=>cashflowEntries({expenses:d.expenses,bankTransactions:d.bankTransactions,expenseRules:d.expenseCategoryRules,bankRules:d.bankCategoryRules})
  review.confirmations.push({source,decision:'reviewed',confirmedAt:new Date().toISOString(),fingerprint:await reviewFingerprint(entries(data),review,source,{main:'Main'}),exceptionNote:'Synthetic unclassified purchase reviewed'})
  data.monthlyReviews = [review]
  window.history.replaceState({},'',`/cashflow?month=${month}&metric=consumption&category=unclassified&source=card`)
  const location = window.location.search
  const host = await open(data)
  assert.equal(document.querySelectorAll('[data-entry]').length,1)
  assert.ok(document.querySelector('[data-entry="card:card1"] button'), 'source navigation remains available beside inline editing')
  await click(buttonLabelled(/^編輯消費 .*ZZZ商店/))
  await choose(document.querySelector('form.panel select'),'購物')
  await click([...document.querySelectorAll('form.panel button')].find(b=>b.textContent==='套用修改'))
  await wait(60)
  const next = host.data()
  assert.equal(window.location.search,location)
  assert.equal(document.querySelectorAll('[data-entry]').length,0, 'edited row no longer matches unclassified filter')
  assert.equal(next.version,16)
  assert.equal(next.expenses[0].sourceKey,'a'.repeat(64))
  assert.equal(next.expenses[0].importKey,'b'.repeat(64))
  assert.deepEqual(next.monthlyReviews,data.monthlyReviews,'keep old confirmation for stale-state evidence')
  const state = await monthlyReviewState(entries(next),review,`${month}-28`,{main:'Main'})
  assert.equal(state.status,'stale')
  assert.equal(state.sources.find(r=>r.source.kind==='card').current,false)
})

test('a recognized bank ledger shows the bank name, followed by the label the user chose', () => {
  const shown = edits.bankDisplayAccounts([
    { id: 'csv', label: '台新 Richart', bank: 'Taishin' },
    { id: 'pdf', label: 'DBS Singapore', bank: 'DBS Singapore' },
    { id: 'same', label: '台新銀行 (TW)', bank: 'Taishin' },
    { id: 'other', label: 'Wallet', bank: 'Unknown bank' },
  ]).map((a) => a.label)
  assert.deepEqual(shown, ['台新銀行 (TW) · 台新 Richart', 'DBS (SG)', '台新銀行 (TW)', 'Wallet'])
})
