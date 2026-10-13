import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import { statementKeyStore } from './helpers/statement-key-store.mjs'
import { createFakeDrive } from './helpers/fake-drive.mjs'

// Drive split data (version 15) in the app: a page that needs part files waits for them, and
// a backup holds every record.

let server, dom, root, App, model, auth, store, local, createRoot
const originalFetch = globalThis.fetch
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
let downloads = []
before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://wealthline.test/app' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLAnchorElement', 'Event', 'MouseEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.scrollTo = () => {}
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  App = (await server.ssrLoadModule('/src/App.tsx')).default
  model = await server.ssrLoadModule('/src/model.ts')
  auth = await server.ssrLoadModule('/src/google/auth.ts')
  store = await server.ssrLoadModule('/src/google/driveStore.ts')
  local = await server.ssrLoadModule('/src/localStore.ts')
})
beforeEach(() => {
  globalThis.confirm = () => true
  globalThis.indexedDB = statementKeyStore()
  downloads = []
  URL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:test' }
  URL.revokeObjectURL = () => {}
  HTMLAnchorElement.prototype.click = function () { downloads.at(-1).name = this.download }
})
afterEach(async () => {
  if (root) await act(() => root.unmount())
  root = null
  globalThis.fetch = originalFetch
  localStorage.clear()
  sessionStorage.clear()
  delete globalThis.indexedDB
  delete globalThis.confirm
  window.history.replaceState(null, '', '/app')
})
after(async () => { await server.close(); dom.window.close() })

const render = async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(createElement(App)) })
}
const settle = () => act(async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0)) })
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)
const click = async (element) => { assert.ok(element); await act(async () => element.click()) }
const main = () => document.querySelector('main').textContent

const snapshot = (date, total = 100) => ({ date, at: `${date}T04:00:00.000Z`, total, accounts: [], categories: {} })
const fixture = () => ({
  ...model.emptyData(),
  version: 13,
  updatedAt: new Date().toISOString(),
  fxRates: { USD: 32 },
  fxUpdatedAt: new Date().toISOString(),
  accounts: [{ id: 'bank', name: 'Bank A', category: '現金與外幣活存', country: 'TW', positions: [{ id: 'p1', type: 'cash', symbol: '', currency: 'TWD', quantity: 100, price: 1 }] }],
  expenses: [{ id: 'e1', date: '2026-01-05', description: 'Coffee shop', amount: 10, currency: 'TWD', card: 'Card' }],
  bankTransactionAccounts: [{ id: 'acct', label: 'Main ledger', bank: 'Bank' }],
  bankTransactions: [{ id: 't1', accountId: 'acct', date: '2026-07-01', description: 'Salary transfer', currency: 'TWD', direction: 'credit', amount: 5 }],
  bankCategoryRules: [],
  history: { changes: [], liabilityChanges: [], snapshots: [snapshot('2025-03-10'), snapshot('2025-03-20'), snapshot('2025-06-01')] },
})

// Puts `data` on a fake Drive split into parts, and lets the app sign in to it. Reads of the
// part files of a group wait while that group is held.
async function splitDrive(data = fixture()) {
  const drive = createFakeDrive()
  drive.seed(data)
  globalThis.fetch = drive.fetch
  const opened = await store.loadDrive(token, model.parseWealthData)
  await store.saveDrive(token, opened.data, opened.state)
  const gates = new Map()
  const reads = []
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('userinfo')) return Response.json(profile)
    const id = String(url).match(/\/drive\/v2\/files\/([^/?]+)\?alt=media/)?.[1]
    const name = id && drive.files.get(id)?.appProperties.part
    if (name) {
      reads.push(name)
      await gates.get(name.split('-')[0])?.promise
    }
    return drive.fetch(url, init)
  }
  auth.storeSession({ token, profile })
  return {
    drive,
    reads,
    hold(group) { let release; gates.set(group, { promise: new Promise((r) => { release = r }), release }) },
    async release(group) { gates.get(group).release(); gates.delete(group); await settle() },
  }
}
const open = async (path) => {
  window.history.replaceState(null, '', path)
  await render()
  await settle()
}

test('the expense page waits for the transaction parts before it shows', async () => {
  const drive = await splitDrive()
  drive.hold('ledger')
  await open('/expenses')
  assert.match(main(), /正在載入消費明細與銀行流水/)
  assert.doesNotMatch(main(), /Coffee shop/)
  assert.equal(button('匯入信用卡帳單'), undefined, 'the page itself is not shown yet')
  await drive.release('ledger')
  assert.doesNotMatch(main(), /正在載入/)
  assert.match(main(), /Coffee shop/)
})

test('the history page waits for the earlier years before it shows', async () => {
  const drive = await splitDrive()
  drive.hold('history')
  await open('/history')
  assert.match(main(), /正在載入往年歷史/)
  assert.equal(document.querySelector('[data-history-entry]'), null)
  await drive.release('history')
  assert.doesNotMatch(main(), /正在載入/)
  assert.ok(document.querySelector('[data-history-entry]'))
})

test('an account detail page waits for the earlier years before it shows', async () => {
  const drive = await splitDrive()
  drive.hold('history')
  await open('/accounts/bank')
  assert.match(main(), /正在載入往年歷史/)
  assert.doesNotMatch(main(), /Bank A/)
  await drive.release('history')
  assert.match(main(), /Bank A/)
})

test('bank records show before earlier years are loaded, and import waits for balance history', async () => {
  const drive = await splitDrive()
  drive.hold('history')
  await open('/bank-transactions')
  assert.doesNotMatch(main(), /正在載入往年歷史/)
  assert.match(main(), /Salary transfer/)
  assert.ok(!drive.reads.some(name=>name.startsWith('history-')))
  await click(button('匯入銀行帳單'))
  assert.match(main(), /正在載入往年歷史/)
  assert.equal(document.querySelector('.bank-import form'), null)
  await drive.release('history')
  assert.doesNotMatch(main(), /正在載入/)
  assert.ok(document.querySelector('.bank-import form'))
  await click(button('取消匯入'))
  assert.match(main(), /Salary transfer/)
})

test('cashflow loads summary-backed ledger details and month navigation reaches the paginated bank list without loading history', async () => {
  const data = fixture()
  data.bankTransactions = Array.from({ length: 120 }, (_, i) => ({ ...data.bankTransactions[0], id: `monthly-${i}`, description: `Salary transfer ${i}`, classification: { kind: 'income', category: '薪資' } }))
  const drive = await splitDrive(data)
  drive.hold('ledger')
  drive.hold('history')
  await open('/cashflow')
  assert.ok(drive.reads.some(name => name.startsWith('ledger-')), 'Cashflow needs real ledger rows even when monthly summaries exist')
  assert.ok(!drive.reads.some(name => name.startsWith('history-')))
  assert.match(main(), /正在載入明細/)
  assert.doesNotMatch(main(), /Salary transfer 0/)
  await drive.release('ledger')
  const month = n => [...document.querySelectorAll('.cashflow-bar')].find(b => b.querySelector('.cashflow-bar-label').textContent === `${n} 月`)
  await click(month(1))
  assert.match(main(), /Coffee shop/)
  assert.doesNotMatch(main(), /Salary transfer 0/)
  await click(month(7))
  assert.equal(document.querySelectorAll('.cashflow-bar').length, 12)
  assert.equal(document.querySelectorAll('.bank-record').length, 120)
  await click(button('前往銀行流水頁編輯 →'))
  assert.equal(window.location.pathname, '/bank-transactions')
  assert.equal(document.querySelectorAll('.bank-record').length, 100)
  await click(button('銀行流水下一頁'))
  assert.equal(document.querySelectorAll('.bank-record').length, 20)
  const filter = document.querySelector('[aria-label="流水月份篩選"]')
  await act(() => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(filter, '2026-07')
    filter.dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.equal(document.querySelectorAll('.bank-record').length, 100)
  assert.match(document.querySelector('[aria-label="銀行流水分頁"]').textContent, /第 1／2 頁/)
  assert.ok(!drive.reads.some(name => name.startsWith('history-')))
  await click(button('匯入銀行帳單'))
  assert.match(main(), /正在載入往年歷史/)
  assert.equal(document.querySelector('.bank-import form'), null)
  await drive.release('history')
  assert.ok(document.querySelector('.bank-import form'))
  await click(button('取消匯入'))
  assert.equal(document.querySelectorAll('.bank-record').length, 100)
})

test('the overview shows the archived years from the summary without reading them', async () => {
  const drive = await splitDrive()
  await open('/app')
  assert.deepEqual(drive.reads, [])
  const dates = [...document.querySelectorAll('.timeline-controls select option')].map((o) => o.value)
  assert.ok(dates.includes('2025-03-20') && dates.includes('2025-06-01'), dates.join())
  assert.ok(!dates.includes('2025-03-10'), 'one point per month')
})

test('nested cashflow selects summary-only months and all periods without loading detail parts', async () => {
  const drive = await splitDrive()
  await open('/app')
  await click(document.querySelector('.cashflow-period-trigger'))
  const currentYear=()=>Number(document.querySelector('.cashflow-picker-year strong').textContent.replace(' 年',''))
  while(currentYear()!==2026) await click(button(currentYear()>2026?'前一年':'後一年'))
  const january=document.querySelector('.cashflow-month-grid button[aria-label="1 月，有紀錄"]')
  assert.ok(january)
  await click(january)
  assert.equal(document.querySelector('[data-cashflow-metric="consumption"]').textContent,'10')
  assert.equal(document.querySelector('[data-cashflow-metric="difference"]').textContent,'-10')
  await click(button('全部期間'))
  assert.equal(document.querySelector('[data-cashflow-metric="consumption"]').textContent,'10')
  assert.match(document.querySelector('.cashflow-currency-heading').textContent,/2 筆紀錄/)
  assert.deepEqual(drive.reads,[])
})

test('the account menu downloads a full backup with every part, which local mode accepts', async () => {
  const drive = await splitDrive()
  await open('/app')
  assert.deepEqual(drive.reads, [])
  await click(button('下載完整備份'))
  await settle()
  assert.equal(downloads.length, 1)
  const text = await downloads[0].text()
  const { data: restored } = await local.readDataFile(new File([text], downloads[0].name))
  assert.deepEqual(restored.expenses.map((e) => e.id), ['e1'])
  assert.deepEqual(restored.bankTransactions.map((t) => t.id), ['t1'])
  // Opening may also have recorded today's snapshot.
  assert.deepEqual(restored.history.snapshots.map((s) => s.date).filter((d) => d < '2026').sort(), ['2025-03-10', '2025-03-20', '2025-06-01'])
})

test('failed full backup explains missing Drive part inside data management and downloads nothing', async () => {
  await splitDrive()
  await open('/app')
  const workingFetch = globalThis.fetch
  globalThis.fetch = (url, init) => String(url).includes('alt=media')
    ? Promise.reject(new Error('part unavailable')) : workingFetch(url, init)
  await click(document.querySelector('summary[aria-label="帳號選單"]'))
  await click(button('資料與隱私'))
  const dialog = document.querySelector('dialog[aria-labelledby="data-privacy-title"]')
  await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === '下載完整備份'))
  await settle()
  assert.ok(dialog.open)
  assert.match(dialog.querySelector('[role="alert"]')?.textContent ?? '', /沒有下載備份：part unavailable/)
  assert.equal(downloads.length, 0)
})

test('the Drive main file itself is refused as a backup', async () => {
  const drive = await splitDrive()
  const text = drive.drive.dataFile().text
  await assert.rejects(local.readDataFile(new File([text], 'we-wealth-data.json')), /主檔.*下載完整備份/)
})

// Harvey's case (2026-10-12): an unclassified income row in August, with a main file counted the old way.
test('the overview recounts an old summary and shows an unclassified August income without loading the parts', async () => {
  const data = fixture()
  data.bankTransactions = [{ id: 't8', accountId: 'acct', date: '2026-08-15', description: '跨行轉入', currency: 'TWD', direction: 'credit', amount: 3000 }]
  const drive = await splitDrive(data)
  const file = drive.drive.dataFile()
  const mainFile = JSON.parse(file.text)
  const old = Object.values(mainFile.summary.parts).flatMap((p) => p.cashflow ?? []).find((m) => m.month === '2026-08')
  Object.assign(old.totals, { income: 0, incomeCategories: [] })
  mainFile.summary.rules = 'counted-the-old-way'
  file.text = JSON.stringify(mainFile, null, 2)
  await open('/app')
  assert.match(document.querySelector('.cashflow-period-trigger').textContent, /2026 年 8 月/)
  assert.equal(document.querySelector('[data-cashflow-metric="income"]').textContent, '3,000')
  assert.match(document.querySelector('[data-cashflow-pending]').textContent, /1 筆銀行流水未分類/)
})
