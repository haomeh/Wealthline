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

// The bank page reads the last three months first (driveStore.ts recentLedgerFrom); dates are
// relative to today, which the app reads from the clock.
const monthsAgo = (n, day = 15) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` }
const partOf = (date) => `ledger-${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
const bankRow = (id, date, accountId = 'acct') => ({ id, accountId, date, description: `Row ${id}`, currency: 'TWD', direction: 'debit', amount: 5 })
const quarterly = () => {
  const data = fixture()
  data.expenses = []
  data.bankTransactionAccounts = [{ id: 'acct', label: 'Main ledger', bank: 'Bank' }, { id: 'old', label: 'Old ledger', bank: 'Bank' }, { id: 'unused', label: 'Unused ledger', bank: 'Bank' }]
  data.bankTransactions = [bankRow('now', monthsAgo(0)), bankRow('recent', monthsAgo(1)), bankRow('half', monthsAgo(6)), bankRow('older', monthsAgo(15), 'old')]
  return data
}
const startsWith = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith(text))
const ledgerReads = (drive) => [...new Set(drive.reads.filter((name) => name.startsWith('ledger-')))].sort()

// IntersectionObserver for the end of the bank list: `reachEnd` scrolls to it; with `endVisible`
// a new observer reports at once that the end is on screen (a short list), like a browser does.
const observers = new Set()
let endVisible = false
class FakeIntersectionObserver {
  constructor(callback) { this.callback = callback }
  observe(target) { this.target = target; observers.add(this); if (endVisible) setTimeout(() => observers.has(this) && this.callback([{ isIntersecting: true, target }]), 0) }
  unobserve() {}
  disconnect() { observers.delete(this) }
}
const reachEnd = () => act(async () => { for (const o of [...observers]) o.callback([{ isIntersecting: true, target: o.target }]) })
const withObserver = async (run) => {
  globalThis.IntersectionObserver = FakeIntersectionObserver
  endVisible = false
  observers.clear()
  try { await run() } finally { delete globalThis.IntersectionObserver; observers.clear() }
}
const partReads = (drive, name) => drive.reads.filter((n) => n === name).length

test('the bank page shows the last three months first and loads an earlier quarter when the list end is reached', () => withObserver(async () => {
  const drive = await splitDrive(quarterly())
  await open('/bank-transactions')
  const recent = [partOf(monthsAgo(0)), partOf(monthsAgo(1))]
  assert.ok(ledgerReads(drive).every((name) => name >= partOf(monthsAgo(2))), ledgerReads(drive).join())
  assert.ok(recent.every((name) => ledgerReads(drive).includes(name)))
  assert.match(main(), /Row now/)
  assert.match(main(), /Row recent/)
  assert.doesNotMatch(main(), /Row half|Row older/)
  const notice = () => document.querySelector('.bank-scope')?.textContent ?? ''
  assert.match(notice(), /捲到底會載入更早的 2 筆/)
  assert.match(notice(), /只涵蓋已載入的月份/)
  assert.equal(startsWith('載入更早的流水'), undefined, 'no load button')
  assert.equal(button('全部載入'), undefined)
  // The sidebar badge counts the quarters not loaded from the summary.
  assert.equal(document.querySelector('.nav-badge')?.textContent, '4')
  // Reaching the end twice before the load ends reads the next quarter once, and no further.
  const half = partOf(monthsAgo(6))
  for (let i = 0; !main().includes('Row half'); i++) {
    assert.ok(i < 5, 'the next quarter loads')
    await act(async () => { for (const o of [...observers]) { o.callback([{ isIntersecting: true, target: o.target }]); o.callback([{ isIntersecting: true, target: o.target }]) } })
    await settle()
  }
  assert.equal(partReads(drive, half), 1)
  assert.ok(!ledgerReads(drive).includes(partOf(monthsAgo(15))))
  assert.match(notice(), /捲到底會載入更早的 1 筆/)
}))

test('a filter that leaves the list end on screen keeps loading earlier quarters until it fills or none are left', () => withObserver(async () => {
  const drive = await splitDrive(quarterly())
  await open('/bank-transactions')
  const filter = document.querySelector('[aria-label="流水帳戶篩選"]')
  await act(() => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(filter, 'old')
    filter.dispatchEvent(new Event('change', { bubbles: true }))
  })
  assert.match(main(), /沒有符合篩選的流水/)
  endVisible = true
  await reachEnd()
  await settle()
  assert.match(main(), /Row older/)
  assert.equal(document.querySelector('.bank-scope'), null, 'every quarter is loaded')
  assert.equal(document.querySelector('[data-load-earlier]'), null)
  assert.equal(partReads(drive, partOf(monthsAgo(15))), 1)
}))

test('choosing a month not loaded yet reads only that month\'s quarter', () => withObserver(async () => {
  const drive = await splitDrive(quarterly())
  await open('/bank-transactions')
  const older = monthsAgo(15).slice(0, 7)
  const select = document.querySelector('[aria-label="流水月份篩選"]')
  assert.ok([...select.options].some((o) => o.value === older), 'the month list includes months not loaded')
  drive.hold('ledger')
  await act(() => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(select, older)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
  assert.match(main(), /正在載入 .* 月的流水/)
  assert.doesNotMatch(main(), /沒有符合篩選的流水/)
  await drive.release('ledger')
  assert.match(main(), /Row older/)
  assert.equal(document.querySelector('[data-load-earlier]'), null, 'a month filter does not load earlier quarters')
  assert.equal(partReads(drive, partOf(monthsAgo(15))), 1)
  assert.equal(partReads(drive, partOf(monthsAgo(6))), 0, 'quarters in between are not read')
}))

test('a failed load of an earlier quarter shows why and loads again only on 重試', () => withObserver(async () => {
  const drive = await splitDrive(quarterly())
  await open('/bank-transactions')
  const half = partOf(monthsAgo(6))
  const working = globalThis.fetch
  let failing = true
  globalThis.fetch = (url, init) => {
    const id = String(url).match(/\/drive\/v2\/files\/([^/?]+)\?alt=media/)?.[1]
    return failing && id && drive.drive.files.get(id)?.appProperties.part === half ? Promise.reject(new Error('offline')) : working(url, init)
  }
  for (let i = 0; !document.querySelector('.bank-load-more[role="alert"]'); i++) {
    assert.ok(i < 5, 'the failure is shown')
    assert.ok(observers.size, 'the list end is observed')
    await reachEnd()
    await settle()
  }
  assert.match(document.querySelector('.bank-load-more[role="alert"]').textContent, /offline/)
  assert.equal(observers.size, 0, 'no automatic retry')
  failing = false
  await click(button('重試'))
  await settle()
  assert.match(main(), /Row half/)
  assert.equal(document.querySelector('.bank-load-more[role="alert"]'), null)
}))

test('importing a bank statement first loads every quarter, to find duplicates among all records', async () => {
  const drive = await splitDrive(quarterly())
  await open('/bank-transactions')
  drive.hold('ledger')
  drive.hold('history')
  await click(button('匯入銀行帳單'))
  assert.match(main(), /正在載入全部銀行流水/)
  assert.equal(document.querySelector('.bank-import form'), null)
  await drive.release('history')
  assert.equal(document.querySelector('.bank-import form'), null, 'history alone is not enough')
  await drive.release('ledger')
  assert.ok(document.querySelector('.bank-import form'))
  assert.ok(ledgerReads(drive).includes(partOf(monthsAgo(15))))
  await click(button('取消匯入'))
  assert.match(main(), /Row older/)
})

test('deleting an account loads every quarter first, and keeps an account an earlier record uses', async () => {
  const drive = await splitDrive(quarterly())
  await open('/bank-transactions')
  assert.match(main(), /已載入的期間沒有流水/)
  drive.hold('ledger')
  await click(button('刪除帳戶 Old ledger'))
  assert.match(main(), /正在載入全部流水，確認沒有流水使用這個帳戶後就會刪除/)
  await drive.release('ledger')
  assert.match(main(), /帳戶仍被流水引用/)
  assert.ok(button('刪除帳戶 Old ledger'))
  assert.equal(button('刪除帳戶 Old ledger').disabled, true)
  await click(button('刪除帳戶 Unused ledger'))
  assert.equal(button('刪除帳戶 Unused ledger'), undefined)
  assert.match(document.querySelector('.save-bar')?.textContent ?? '', /未儲存/)
})
