import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

let server, dom, root, createRoot, model, coverage, statements, Accounts

before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/accounts' })
  for (const key of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;[model, coverage, statements, { Accounts }] = await Promise.all([
    server.ssrLoadModule('/src/model.ts'),
    server.ssrLoadModule('/src/accountCoverage.ts'),
    server.ssrLoadModule('/src/bankStatementAssets.ts'),
    server.ssrLoadModule('/src/views/Accounts.tsx'),
  ])
})

afterEach(async () => {
  if (root) await act(() => root.unmount())
  root = null
})

after(async () => {
  await server?.close()
  dom?.window.close()
})

const now = '2026-10-12T12:00:00Z'
const ledgerDbs = { id: 'ledger-dbs', label: 'DBS', bank: 'DBS Singapore' }
const ledgerHsbc = { id: 'ledger-hsbc', label: 'HSBC', bank: 'HSBC Taiwan' }

const baseAccounts = () => [
  { id: 'schwab', name: '嘉信證券', kind: 'investment', category: '海外股票 (美股)', country: 'US', positions: [{ id: 'p1', type: 'holding', symbol: 'VT', currency: 'USD', quantity: 1000, price: 100 }] },
  { id: 'fubon', name: '富邦證券', kind: 'investment', category: '國內股票 (台股)', country: 'TW', positions: [{ id: 'p2', type: 'holding', symbol: '0050', currency: 'TWD', quantity: 10000, price: 180 }] },
  { id: 'dbs', name: 'DBS', kind: 'bank', category: '現金與外幣活存', country: 'SG', positions: [{ id: 'p3', type: 'cash', symbol: '', currency: 'SGD', quantity: 20000, price: 1 }] },
  { id: 'hsbc', name: 'HSBC', kind: 'bank', category: '現金與外幣活存', country: 'TW', positions: [{ id: 'p4', type: 'cash', symbol: '', currency: 'TWD', quantity: 300000, price: 1 }] },
]

const snapshot = (date, values, valuation) => ({
  date,
  at: `${date}T12:00:00Z`,
  total: Object.values(values).reduce((a, b) => a + b, 0),
  accounts: Object.entries(values).map(([id, value]) => ({ id, name: id, value })),
  categories: {},
  ...(valuation && { valuation }),
})

test('2026-09 complete snapshot vs 2026-08 sparse bank statements pinpoints exact missing accounts sorted by value', () => {
  const initial = {
    ...model.emptyData(),
    accounts: baseAccounts(),
    fxRates: { USD: 32, SGD: 24 },
    bankTransactionAccounts: [ledgerDbs, ledgerHsbc],
    history: {
      changes: [],
      snapshots: [snapshot('2026-09-30', { schwab: 3200000, fubon: 1800000, dbs: 480000, hsbc: 300000 })],
    },
  }
  const data = statements.importStatementBalances(
    initial,
    [
      { bank: 'HSBC Taiwan', date: '2026-08-25', currency: 'TWD', quantity: 280000, fileHash: 'a'.repeat(64), ledgerAccountId: ledgerHsbc.id, confirmedAccountId: 'hsbc' },
      { bank: 'DBS Singapore', date: '2026-08-31', currency: 'SGD', quantity: 21000, fileHash: 'b'.repeat(64), ledgerAccountId: ledgerDbs.id },
    ],
    now,
  ).data

  const report = coverage.accountCoverage(data, now)
  assert.equal(report.months.length, 2)
  assert.equal(report.gapMonthCount, 1)

  const sep = report.months.find((m) => m.month === '2026-09')
  assert.equal(sep.hasMonthGaps, false)
  assert.equal(sep.recordedCount, 4)
  assert.equal(sep.expectedCount, 4)

  const aug = report.months.find((m) => m.month === '2026-08')
  assert.equal(aug.hasMonthGaps, true)
  assert.equal(aug.recordedCount, 2)
  assert.deepEqual(
    aug.missingZero.map((c) => c.account.id),
    ['schwab', 'fubon'],
  )
  assert.equal(aug.estimatedMissingTotal, 3200000 + 1800000)

  // Node 2026-08-31 carries HSBC from 2026-08-25, while schwab & fubon are counted as 0.
  const aug31 = aug.nodes.find((n) => n.date === '2026-08-31')
  assert.equal(aug31.source, 'statement')
  assert.deepEqual(
    aug31.missingZero.map((c) => c.account.id),
    ['schwab', 'fubon'],
  )
  assert.deepEqual(
    aug31.carried.map((c) => [c.account.id, c.carriedFrom]),
    [['hsbc', '2026-08-25']],
  )
})

test('detects missing accounts inside original snapshots and partial currencies inside a multi-currency account', () => {
  const multiCurrencyAccounts = baseAccounts().map((a) =>
    a.id === 'dbs' ? { ...a, positions: [...a.positions, { id: 'p5', type: 'cash', symbol: '', currency: 'USD', quantity: 1000, price: 1 }] } : a,
  )
  const initial = {
    ...model.emptyData(),
    accounts: multiCurrencyAccounts,
    fxRates: { USD: 32, SGD: 24 },
    bankTransactionAccounts: [ledgerDbs],
    history: {
      changes: [],
      snapshots: [
        snapshot('2026-08-15', { dbs: 512000, hsbc: 300000 }),
        snapshot('2026-09-30', { schwab: 3200000, fubon: 1800000, dbs: 512000, hsbc: 300000 }),
      ],
    },
  }
  const data = statements.importStatementBalances(
    initial,
    [{ bank: 'DBS Singapore', date: '2026-08-31', currency: 'SGD', quantity: 21000, fileHash: 'c'.repeat(64), ledgerAccountId: ledgerDbs.id }],
    now,
  ).data

  const report = coverage.accountCoverage(data, now)
  const aug15 = report.nodes.find((n) => n.date === '2026-08-15')
  assert.equal(aug15.source, 'snapshot')
  assert.deepEqual(
    aug15.missingZero.map((c) => c.account.id),
    ['schwab', 'fubon'],
  )

  const aug31 = report.nodes.find((n) => n.date === '2026-08-31')
  assert.deepEqual(
    aug31.partial.map((c) => [c.account.id, c.missingItems]),
    [['dbs', ['USD 現金']]],
  )
  assert.deepEqual(
    aug31.carried.map((c) => [c.account.id, c.carriedFrom]),
    [['hsbc', '2026-08-15']],
  )
  assert.deepEqual(
    aug31.missingZero.map((c) => c.account.id),
    ['schwab', 'fubon'],
  )
})

test('respects confirmed-absent inventory, same-day snapshots, deleted historical accounts, and snapshot valuation errors', () => {
  const data = {
    ...model.emptyData(),
    accounts: baseAccounts().slice(0, 2), // schwab, fubon
    fxRates: { USD: 32 },
    history: {
      changes: [],
      snapshots: [
        snapshot('2026-07-31', { schwab: 3000000, fubon: 1700000, old: 500000 }),
        snapshot(
          '2026-09-30',
          { schwab: 0, fubon: 1800000 },
          {
            version: 1,
            baseCurrency: 'TWD',
            at: '2026-09-30T12:00:00Z',
            entries: [
              { accountId: 'schwab', account: '嘉信證券', type: 'holding', symbol: 'VT', currency: 'USD', quantity: 1000, price: 100, rate: null },
              { accountId: 'fubon', account: '富邦證券', type: 'holding', symbol: '0050', currency: 'TWD', quantity: 10000, price: 180, rate: 1 },
            ],
          },
        ),
      ],
      quantityDays: [
        {
          date: '2026-08-31',
          updatedAt: now,
          entries: [{ accountId: 'fubon', account: '富邦證券', category: '國內股票 (台股)', country: 'TW', type: 'holding', symbol: '0050', currency: 'TWD', quantity: 10000 }],
          inventory: { accounts: [{ id: 'fubon', name: '富邦證券' }], source: { kind: 'current', date: '2026-10-12' } },
        },
      ],
    },
  }

  const report = coverage.accountCoverage(data, now)
  // On 2026-08-31, inventory explicitly excludes schwab -> confirmed-absent, NOT missing.
  // And `old` last appeared on 2026-07-31, so it is NOT expected in Aug or Sep.
  const aug31 = report.nodes.find((n) => n.date === '2026-08-31')
  assert.equal(aug31.hasGaps, false)
  assert.equal(aug31.cells.find((c) => c.account.id === 'schwab').status, 'confirmed-absent')
  assert.equal(aug31.cells.some((c) => c.account.id === 'old'), false)

  // On 2026-09-30, schwab had rate: null in valuation -> flagged as no-quote.
  const sep30 = report.nodes.find((n) => n.date === '2026-09-30')
  assert.deepEqual(
    sep30.noQuote.map((c) => [c.account.id, c.missingItems]),
    [['schwab', ['VT (USD)']]],
  )
})

test('Accounts view opens backfill modal prefilled for the missing account and date instead of navigating to account detail', async () => {
  const accountsWithMulti = baseAccounts().map((a) =>
    a.id === 'fubon'
      ? { ...a, positions: [...a.positions, { id: 'p2b', type: 'cash', symbol: '', currency: 'TWD', quantity: 50000, price: 1 }] }
      : a.id === 'dbs'
        ? { ...a, positions: [...a.positions, { id: 'p3b', type: 'cash', symbol: '', currency: 'USD', quantity: 1000, price: 1 }] }
        : a,
  )
  const initial = {
    ...model.emptyData(),
    accounts: accountsWithMulti,
    fxRates: { USD: 32, SGD: 24 },
    bankTransactionAccounts: [ledgerDbs],
    history: {
      changes: [],
      snapshots: [snapshot('2026-09-30', { schwab: 3200000, fubon: 1850000, dbs: 512000, hsbc: 300000 })],
    },
  }
  const data = statements.importStatementBalances(
    initial,
    [{ bank: 'DBS Singapore', date: '2026-08-31', currency: 'SGD', quantity: 21000, fileHash: 'd'.repeat(64), ledgerAccountId: ledgerDbs.id }],
    now,
  ).data

  const openedAccounts = []
  const openedHistory = []
  root = createRoot(document.getElementById('root'))
  await act(() =>
    root.render(
      createElement(Accounts, {
        data,
        onChange() {},
        onSaveHistory() {},
        view: { page: 'list' },
        setView(v) {
          if (v.page === 'detail') openedAccounts.push(v.id)
        },
        onBack() {},
        onRefreshPrices: async () => {},
        priceError: '',
        onGoHistory(date) {
          openedHistory.push(date)
        },
      }),
    ),
  )

  const panel = document.querySelector('#account-coverage')
  assert.ok(panel, 'expected #account-coverage panel on /accounts')
  assert.match(panel.textContent, /2026\/09/)
  assert.match(panel.textContent, /齊全 · 4\/4 個帳戶/)
  assert.match(panel.textContent, /2026\/08/)
  assert.match(panel.textContent, /缺 3 個帳戶（以 0 計）/)
  assert.match(panel.textContent, /嘉信證券 \(US\)/)
  assert.match(panel.textContent, /富邦證券 \(TW\)/)
  assert.match(panel.textContent, /HSBC \(TW\)/)
  assert.match(panel.textContent, /5,350,000/)

  // Clicking single-holding missing account opens QuantityEditor directly at Step 2 (日期與數量), NOT AccountDetail.
  const schwabLink = [...panel.querySelectorAll('button.coverage-account-link')].find((b) => b.textContent === '嘉信證券 (US)')
  assert.ok(schwabLink)
  await act(() => schwabLink.click())
  assert.deepEqual(openedAccounts, [])
  let dialog = document.querySelector('dialog[aria-label="編輯歷史數量"]')
  assert.ok(dialog && dialog.open, 'expected backfill dialog to open')
  assert.match(dialog.textContent, /日期與數量/)
  assert.match(dialog.textContent, /嘉信證券/)
  assert.match(dialog.textContent, /VT · USD/)
  assert.equal(dialog.querySelector('input[type="date"]').value, '2026-08-31')
  await act(() => [...dialog.querySelectorAll('button')].find((b) => b.textContent === '取消歷史編輯').click())
  assert.equal(document.querySelector('dialog[aria-label="編輯歷史數量"]'), null)

  // Clicking multi-position missing account opens QuantityEditor directly at Step 1 (選標的) with account preselected.
  const fubonLink = [...panel.querySelectorAll('button.coverage-account-link')].find((b) => b.textContent === '富邦證券 (TW)')
  await act(() => fubonLink.click())
  dialog = document.querySelector('dialog[aria-label="編輯歷史數量"]')
  assert.ok(dialog && dialog.open)
  assert.match(dialog.textContent, /選標的/)
  assert.match(dialog.textContent, /富邦證券/)
  await act(() => [...dialog.querySelectorAll('button')].find((b) => b.textContent === '取消歷史編輯').click())

  // Clicking partial account missing a single item (USD cash) jumps directly to Step 2 for that missing item.
  const dbsLink = [...panel.querySelectorAll('button.coverage-account-link')].find((b) => b.textContent === 'DBS (SG)')
  await act(() => dbsLink.click())
  dialog = document.querySelector('dialog[aria-label="編輯歷史數量"]')
  assert.ok(dialog && dialog.open)
  assert.match(dialog.textContent, /日期與數量/)
  assert.match(dialog.textContent, /DBS/)
  assert.match(dialog.textContent, /現金餘額 · USD/)
  assert.equal(dialog.querySelector('input[type="date"]').value, '2026-08-31')
  await act(() => [...dialog.querySelectorAll('button')].find((b) => b.textContent === '取消歷史編輯').click())

  // Switching to per-date node view shows 2026/08/31 and clicking 前往歷史頁 opens /history/2026-08-31.
  const nodeTab = [...panel.querySelectorAll('button')].find((b) => b.textContent === '依時間節點')
  await act(() => nodeTab.click())
  assert.match(panel.textContent, /2026\/08\/31/)
  const historyBtn = [...panel.querySelectorAll('button')].find((b) => b.textContent === '前往歷史頁 →')
  assert.ok(historyBtn)
  await act(() => historyBtn.click())
  assert.deepEqual(openedHistory, ['2026-08-31'])
})
