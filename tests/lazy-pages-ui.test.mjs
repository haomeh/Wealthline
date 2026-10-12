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

test('the bank page also waits for the earlier years, which statement balances are checked against', async () => {
  const drive = await splitDrive()
  drive.hold('history')
  await open('/bank-transactions')
  assert.match(main(), /正在載入往年歷史/)
  assert.doesNotMatch(main(), /Salary transfer/)
  await drive.release('history')
  assert.doesNotMatch(main(), /正在載入/)
  assert.match(main(), /Salary transfer/)
})

test('the overview shows the archived years from the summary without reading them', async () => {
  const drive = await splitDrive()
  await open('/app')
  assert.deepEqual(drive.reads, [])
  const dates = [...document.querySelectorAll('.timeline-controls select option')].map((o) => o.value)
  assert.ok(dates.includes('2025-03-20') && dates.includes('2025-06-01'), dates.join())
  assert.ok(!dates.includes('2025-03-10'), 'one point per month')
})

test('the account menu downloads a full backup with every part, which local mode accepts', async () => {
  const drive = await splitDrive()
  await open('/app')
  assert.deepEqual(drive.reads, [])
  await click(button('下載完整備份'))
  await settle()
  assert.equal(downloads.length, 1)
  const text = await downloads[0].text()
  const restored = await local.readDataFile(new File([text], downloads[0].name))
  assert.deepEqual(restored.expenses.map((e) => e.id), ['e1'])
  assert.deepEqual(restored.bankTransactions.map((t) => t.id), ['t1'])
  // Opening may also have recorded today's snapshot.
  assert.deepEqual(restored.history.snapshots.map((s) => s.date).filter((d) => d < '2026').sort(), ['2025-03-10', '2025-03-20', '2025-06-01'])
})

test('the Drive main file itself is refused as a backup', async () => {
  const drive = await splitDrive()
  const text = drive.drive.dataFile().text
  await assert.rejects(local.readDataFile(new File([text], 'we-wealth-data.json')), /主檔.*下載完整備份/)
})
