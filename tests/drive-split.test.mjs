import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { createServer } from 'vite'
import { createHash } from 'node:crypto'
import { createFakeDrive } from './helpers/fake-drive.mjs'

// Version 14: the Drive data is a main file plus part files (dataParts.ts, driveStore.ts).

let server, parts, store, model, cashflow
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const originalFetch = globalThis.fetch
let drive
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  parts = await server.ssrLoadModule('/src/dataParts.ts')
  store = await server.ssrLoadModule('/src/google/driveStore.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  cashflow = await server.ssrLoadModule('/src/cashflow.ts')
})
afterEach(() => { globalThis.fetch = originalFetch })
after(() => server.close())
const installDrive = () => { drive = createFakeDrive(); globalThis.fetch = drive.fetch; return drive }

const NOW = '2026-10-12T04:00:00.000Z'
const expense = (id, date, amount = 10) => ({ id, date, description: `Shop ${id}`, amount, currency: 'TWD', card: 'Card' })
const tx = (id, date, accountId = 'acct') => ({ id, accountId, date, description: `Transfer ${id}`, currency: 'TWD', direction: 'debit', amount: 5 })
const snapshot = (date, total = 100) => ({ date, at: `${date}T04:00:00.000Z`, total, accounts: [], categories: {} })
const change = (at) => ({ at, accountId: 'a1', account: 'Bank', type: 'cash', symbol: 'TWD', currency: 'TWD', before: { quantity: 1, price: 1 }, after: { quantity: 2, price: 1 } })
const v13 = () => ({
  ...model.emptyData(),
  version: 13,
  updatedAt: NOW,
  fxRates: { USD: 32 },
  expenses: [expense('e1', '2026-01-05'), expense('e2', '2026-10-01'), expense('e3', '2025-12-31')],
  bankTransactionAccounts: [{ id: 'acct', label: 'Main', bank: 'Bank' }],
  bankTransactions: [tx('t1', '2026-07-01')],
  bankCategoryRules: [],
  history: { changes: [change('2025-03-01T00:00:00.000Z'), change('2026-03-01T00:00:00.000Z')], liabilityChanges: [], snapshots: [snapshot('2025-06-01'), snapshot('2026-06-01')] },
})
// Opens the data and reads every part, as the transaction and history pages do.
async function openAll() {
  const opened = await store.loadDrive(token, model.parseWealthData)
  if (!opened) return opened
  let data = opened.data
  for (const group of ['ledger', 'history']) data = store.mergeParts(data, await store.readGroup(token, opened.state, group), model.parseWealthData)
  return { data, state: opened.state }
}
// Transactions come back grouped by quarter; the views sort them by date.
const byId = (data) => JSON.parse(JSON.stringify({ ...data, expenses: [...data.expenses].sort((a, b) => a.id.localeCompare(b.id)), bankTransactions: [...data.bankTransactions].sort((a, b) => a.id.localeCompare(b.id)) }))
const writtenParts = (from = 0) => drive.log.slice(from).filter((r) => r.method === 'PUT' || (r.method === 'POST' && r.url.includes('upload'))).map((r) => {
  if (r.method === 'POST') return 'create'
  const id = r.url.match(/files\/([^?]+)/)[1]
  return drive.files.get(id).appProperties.part ?? 'main'
})

test('split: transactions by quarter of their date, earlier years of history to yearly parts, the rest in the main file', () => {
  const data = model.parseWealthData(v13())
  const { main, parts: split } = parts.splitData(data, 'set-1', NOW)
  assert.deepEqual([...split.keys()].sort(), ['history-2025', 'ledger-2025-Q4', 'ledger-2026-Q1', 'ledger-2026-Q3', 'ledger-2026-Q4'])
  assert.deepEqual(split.get('ledger-2026-Q1').expenses.map((e) => e.id), ['e1'])
  assert.deepEqual(split.get('ledger-2026-Q3').bankTransactions.map((t) => t.id), ['t1'])
  assert.deepEqual(split.get('history-2025').snapshots.map((s) => s.date), ['2025-06-01'])
  assert.deepEqual(split.get('history-2025').changes.map((c) => c.at), ['2025-03-01T00:00:00.000Z'])
  assert.equal(main.version, 15)
  assert.equal(main.datasetId, 'set-1')
  assert.deepEqual(main.expenses, [])
  assert.deepEqual(main.bankTransactions, [])
  assert.equal('expenses' in parts.splitData({ ...data, expenses: undefined }, 'set-1', NOW).main, false)
  assert.deepEqual(main.bankTransactionAccounts, data.bankTransactionAccounts)
  assert.deepEqual(main.history.snapshots.map((s) => s.date), ['2026-06-01'])
  assert.deepEqual(main.history.changes.map((c) => c.at), ['2026-03-01T00:00:00.000Z'])
})

test('a year that already has a part keeps going there, even on a device whose clock is still in that year', () => {
  const data = model.parseWealthData({ ...v13(), history: { changes: [], liabilityChanges: [], snapshots: [snapshot('2026-01-02')] } })
  assert.equal(parts.splitData(data, 's', NOW).parts.has('history-2026'), false)
  assert.deepEqual(parts.splitData(data, 's', NOW, ['history-2026']).parts.get('history-2026').snapshots.map((s) => s.date), ['2026-01-02'])
})

test('part files hold one record per line, read back the same, and refuse another data set', () => {
  const content = { expenses: [expense('e1', '2026-01-05'), expense('e2', '2026-02-05')] }
  const text = parts.serializePart('ledger-2026-Q1', 'set-1', content, 3)
  assert.equal(text.split('\n').filter((l) => l.startsWith('    {"id"')).length, 2)
  assert.deepEqual(parts.parsePart(text, 'set-1'), { name: 'ledger-2026-Q1', sequence: 3, content: { expenses: content.expenses, bankTransactions: [] } })
  assert.throws(() => parts.parsePart(text, 'set-2'), /不屬於這份資料/)
  assert.throws(() => parts.parsePart('{"format":"other"}', 'set-1'), /格式不正確/)
})

test('join keeps one copy of a record an interrupted move left in two parts, preferring the copy written last', () => {
  const moved = expense('e1', '2026-04-02', 20)
  const main = { version: 15, history: { snapshots: [snapshot('2026-06-01')], changes: [], liabilityChanges: [] } }
  const joined = parts.joinData(main, [
    { name: 'ledger-2026-Q1', sequence: 1, content: { expenses: [expense('e1', '2026-03-31', 10)] } },
    { name: 'ledger-2026-Q2', sequence: 2, content: { expenses: [moved] } },
    { name: 'history-2026', sequence: 0, content: { snapshots: [snapshot('2026-06-01')] } },
  ])
  assert.deepEqual(joined.expenses, [moved])
  // Written in the same save (the same sequence): the copy in the part of its date.
  const tied = parts.joinData(main, [
    { name: 'ledger-2026-Q1', sequence: 2, content: { expenses: [expense('e1', '2026-04-02', 10)] } },
    { name: 'ledger-2026-Q2', sequence: 2, content: { expenses: [moved] } },
  ])
  assert.deepEqual(tied.expenses, [moved])
  assert.deepEqual(joined.history.snapshots.map((s) => s.date), ['2026-06-01'])
})

test('a version 13 single file loads as before; its next save splits it and reloading gives the same data', async () => {
  installDrive().seed(v13())
  const loaded = await openAll()
  assert.equal(loaded.data.version, 13)
  assert.equal(loaded.state.split, false)
  const written = await store.saveDrive(token, loaded.data, loaded.state, NOW)
  assert.equal(written.version, 15)
  assert.equal(drive.main().version, 15)
  assert.deepEqual(drive.main().expenses, [])
  assert.deepEqual(drive.parts().map((f) => f.appProperties.part).sort(), ['history-2025', 'ledger-2025-Q4', 'ledger-2026-Q1', 'ledger-2026-Q3', 'ledger-2026-Q4'])
  assert.ok(drive.parts().every((f) => f.name === `wealthline-${f.appProperties.part}.json`))
  // Parts are written first; the old single file is replaced last.
  assert.equal(writtenParts().at(-1), 'main')

  const reloaded = await openAll()
  assert.deepEqual(byId(reloaded.data), byId(model.parseWealthData({ ...v13(), version: 15 })))
  assert.equal(reloaded.state.split, true)
})

test('a save uploads only the files that changed', async () => {
  installDrive().seed(v13())
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
  const { data, state } = await openAll()
  const from = drive.log.length
  const next = { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: data.expenses.map((e) => (e.id === 'e1' ? { ...e, amount: 99 } : e)) }
  await store.saveDrive(token, next, state, NOW)
  assert.deepEqual(writtenParts(from), ['ledger-2026-Q1', 'main'])
  const from2 = drive.log.length
  await store.saveDrive(token, next, state, NOW)
  assert.deepEqual(writtenParts(from2), [], 'nothing changed, nothing written')
})

test('a record moved to another quarter is written to its new part before it leaves the old one', async () => {
  installDrive().seed(v13())
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
  const { data, state } = await openAll()
  const from = drive.log.length
  const next = { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: data.expenses.map((e) => (e.id === 'e1' ? { ...e, date: '2026-07-15' } : e)) }
  await store.saveDrive(token, next, state, NOW)
  assert.deepEqual(writtenParts(from), ['ledger-2026-Q3', 'ledger-2026-Q1', 'main'])
})

test('a move that stops after the new part is written loses nothing and reads back once', async () => {
  installDrive().seed(v13())
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
  const { data, state } = await openAll()
  drive.fail((file) => file?.appProperties.part === 'ledger-2026-Q1', 503)
  const next = { ...data, expenses: data.expenses.map((e) => (e.id === 'e1' ? { ...e, date: '2026-07-15' } : e)) }
  await assert.rejects(store.saveDrive(token, next, state, NOW), /503/)
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.expenses.filter((e) => e.id === 'e1').map((e) => e.date), ['2026-07-15'])
  assert.equal(reloaded.data.expenses.length, 3)
  // The next save cleans the old copy up.
  await store.saveDrive(token, reloaded.data, reloaded.state, NOW)
  assert.equal(JSON.parse(drive.part('ledger-2026-Q1').text).expenses.length, 0)
})

test('when the split stops before the main file is replaced, the old single file still holds everything', async () => {
  installDrive().seed(v13())
  const loaded = await openAll()
  drive.fail((file) => file?.appProperties.weWealth === 'data', 412)
  await assert.rejects(store.saveDrive(token, loaded.data, loaded.state, NOW), /其他裝置/)
  assert.ok(drive.parts().length > 0)
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data, loaded.data)
  assert.equal(reloaded.state.split, false)
})

test('a new bank account reaches the main file before transactions that use it reach a part', async () => {
  installDrive().seed(v13())
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
  const { data, state } = await openAll()
  const from = drive.log.length
  drive.fail((file) => file === null, 503) // creating the new quarter's part fails
  const next = { ...data, bankTransactionAccounts: [...data.bankTransactionAccounts, { id: 'acct2', label: 'Second', bank: 'Bank' }], bankTransactions: [...data.bankTransactions, tx('t2', '2026-04-01', 'acct2')] }
  await assert.rejects(store.saveDrive(token, next, state, NOW), /503/)
  assert.equal(writtenParts(from)[0], 'main')
  // Readable after the failure: the account exists, the transaction was never written.
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.bankTransactionAccounts.map((a) => a.id), ['acct', 'acct2'])
  assert.deepEqual(reloaded.data.bankTransactions.map((t) => t.id), ['t1'])
  await store.saveDrive(token, next, state, NOW)
  assert.deepEqual((await openAll()).data.bankTransactions.map((t) => t.id).sort(), ['t1', 't2'])
})

test('parts of another data set are ignored', async () => {
  installDrive().seed(v13())
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
  const stray = drive.part('ledger-2026-Q1')
  drive.files.set('stray', { ...stray, id: 'stray', appProperties: { ...stray.appProperties, dataset: 'other' }, text: stray.text.replace(first.state.datasetId, 'other'), created: 99 })
  const reloaded = await openAll()
  assert.equal(reloaded.data.expenses.length, 3)
})

test('an oversized part is refused before any request', async () => {
  installDrive().seed(v13())
  const loaded = await openAll()
  const description = 'X'.repeat(480)
  const many = Array.from({ length: 9000 }, (_, i) => ({ ...expense(`big-${i}`, '2026-08-01'), description }))
  const from = drive.log.length
  await assert.rejects(store.saveDrive(token, { ...loaded.data, expenses: [...loaded.data.expenses, ...many] }, loaded.state, NOW), /超過單一檔案 4\.5 MB 的上限/)
  // Smaller parts may already be written; the oversized one and the main file are not.
  assert.equal(writtenParts(from).includes('main'), false)
  assert.equal(drive.main().version, 13)
})

test("when a year ends, its history moves out of the main file into that year's part", async () => {
  installDrive().seed({ ...v13(), expenses: [], bankTransactions: [] })
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
  assert.deepEqual(drive.main().history.snapshots.map((s) => s.date), ['2026-06-01'])
  const { data, state } = await openAll()
  const from = drive.log.length
  await store.saveDrive(token, { ...data, updatedAt: '2027-01-02T04:00:00.000Z' }, state, '2027-01-02T04:00:00.000Z')
  assert.deepEqual(writtenParts(from), ['create', 'main'])
  assert.deepEqual(drive.main().history.snapshots, [])
  assert.deepEqual(JSON.parse(drive.part('history-2026').text).snapshots.map((s) => s.date), ['2026-06-01'])
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.history.snapshots.map((s) => s.date), ['2025-06-01', '2026-06-01'])
})

// Opening reads only the main file; the parts are read when a page needs them.
async function splitOnDrive() {
  installDrive().seed(v13())
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
  return first.data
}
const partReads = (from = 0) => drive.log.slice(from).filter((r) => r.url.includes('alt=media')).map((r) => drive.files.get(r.url.match(/files\/([^?]+)/)[1]).appProperties.part ?? 'main')

test('opening reads only the main file; its summaries stand for the parts the overview would need', async () => {
  const full = await splitOnDrive()
  const from = drive.log.length
  const { data, state } = await store.loadDrive(token, model.parseWealthData)
  assert.deepEqual(partReads(from), ['main'])
  assert.deepEqual(data.expenses, [])
  assert.deepEqual(data.bankTransactions, [])
  assert.deepEqual(data.history.snapshots.map((s) => s.date), ['2026-06-01'])
  assert.deepEqual(store.missingParts(state, data, 'ledger').sort(), ['ledger-2025-Q4', 'ledger-2026-Q1', 'ledger-2026-Q3', 'ledger-2026-Q4'])
  assert.deepEqual(cashflow.cashflowSummary({ months: store.ledgerCashflow(state, model.emptyData()) }, '2026-10', 12), cashflow.cashflowSummary({ expenses: full.expenses, expenseRules: full.expenseCategoryRules, bankTransactions: full.bankTransactions, bankRules: full.bankCategoryRules }, '2026-10', 12))
  const archive = store.archiveSummary(state)
  assert.deepEqual(archive.points.map((s) => s.date), ['2025-06-01'])
  assert.deepEqual(archive.carried.map((c) => c.at), ['2025-03-01T00:00:00.000Z'])
  assert.equal(archive.from, '2026-01-01')
  // Reading a group adds its records once.
  const parts = await store.readGroup(token, state, 'ledger')
  const merged = store.mergeParts(data, parts, model.parseWealthData)
  assert.deepEqual(merged.expenses.map((e) => e.id).sort(), ['e1', 'e2', 'e3'])
  assert.equal(store.mergeParts(merged, parts, model.parseWealthData), merged)
  assert.deepEqual(store.missingParts(state, merged, 'ledger'), [])
})

test('a save from data that has not read the parts writes only the main file and keeps every record', async () => {
  const full = await splitOnDrive()
  const { data, state } = await store.loadDrive(token, model.parseWealthData)
  const from = drive.log.length
  await store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', fxRates: { USD: 33 } }, state, NOW)
  assert.deepEqual(writtenParts(from), ['main'])
  assert.deepEqual(partReads(from), [])
  const reloaded = await openAll()
  assert.equal(reloaded.data.fxRates.USD, 33)
  assert.deepEqual(byId(reloaded.data).expenses, byId(full).expenses)
  assert.deepEqual(reloaded.data.history.snapshots.map((s) => s.date), ['2025-06-01', '2026-06-01'])
})

test('a new rule recounts the summary from the transaction parts without rewriting them', async () => {
  await splitOnDrive()
  const { data, state } = await store.loadDrive(token, model.parseWealthData)
  const from = drive.log.length
  await store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenseCategoryRules: [{ keyword: 'Shop e1', category: '交通' }] }, state, NOW)
  assert.deepEqual(writtenParts(from), ['main'])
  const january = drive.main().summary.parts['ledger-2026-Q1'].cashflow.find((m) => m.month === '2026-01')
  assert.deepEqual(january.totals.consumptionCategories.map((c) => c.category), ['交通'])
})

test('records dated in a part this session has not read are added to it, keeping the records already there', async () => {
  await splitOnDrive()
  const { data, state } = await store.loadDrive(token, model.parseWealthData)
  const from = drive.log.length
  await store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: [expense('e9', '2026-01-10')] }, state, NOW)
  assert.deepEqual(writtenParts(from), ['ledger-2026-Q1', 'main'])
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.expenses.map((e) => e.id).sort(), ['e1', 'e2', 'e3', 'e9'])
  assert.equal(drive.main().summary.parts['ledger-2026-Q1'].cashflow.find((m) => m.month === '2026-01').coverage.cardCount, 2)
})

test('the records hash ignores the header and key order, and changes with any record', async () => {
  const a = { expenses: [expense('e1', '2026-01-05')] }
  const reordered = { bankTransactions: [], expenses: [Object.fromEntries(Object.entries(a.expenses[0]).reverse())] }
  assert.equal(parts.recordsHash('ledger-2026-Q1', a), parts.recordsHash('ledger-2026-Q1', reordered))
  assert.notEqual(parts.recordsHash('ledger-2026-Q1', a), parts.recordsHash('ledger-2026-Q1', { expenses: [expense('e1', '2026-01-05', 11)] }))
  assert.match(parts.recordsHash('ledger-2026-Q1', a), /^[0-9a-f]{64}$/)
  // The same digest as a standard SHA-256.
  for (const text of ['', 'abc', '中文 · ✓', 'x'.repeat(1000)]) assert.equal(parts.sha256(text), createHash('sha256').update(text).digest('hex'))
})

test('an edit uploads only its part and updates only that part of the summary', async () => {
  await splitOnDrive()
  const before = drive.main().summary.parts
  const { data, state } = await store.loadDrive(token, model.parseWealthData)
  const from = drive.log.length
  await store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: [expense('e9', '2026-01-10')] }, state, NOW)
  assert.deepEqual(partReads(from), ['ledger-2026-Q1'])
  assert.deepEqual(writtenParts(from), ['ledger-2026-Q1', 'main'])
  const after = drive.main().summary.parts
  for (const name of Object.keys(before)) if (name !== 'ledger-2026-Q1') assert.deepEqual(after[name], before[name], name)
  assert.notEqual(after['ledger-2026-Q1'].hash, before['ledger-2026-Q1'].hash)
  assert.equal(after['ledger-2026-Q1'].md5, createHash('md5').update(drive.part('ledger-2026-Q1').text).digest('hex'))
})

test('saving the same records in another key order uploads nothing', async () => {
  await splitOnDrive()
  const { data, state } = await openAll()
  const from = drive.log.length
  await store.saveDrive(token, { ...data, expenses: data.expenses.map((e) => Object.fromEntries(Object.entries(e).reverse())) }, state, NOW)
  assert.deepEqual(writtenParts(from), [])
})

test('a part written after its summary (a save that stopped before the main file) is found by its checksum and counted again', async () => {
  await splitOnDrive()
  const { data, state } = await openAll()
  // The connection is lost before the main file is written.
  drive.fail((file) => file?.appProperties.weWealth === 'data', 503)
  await assert.rejects(store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: data.expenses.map((e) => (e.id === 'e1' ? { ...e, amount: 99 } : e)) }, state, NOW), /503/)
  const from = drive.log.length
  const opened = await store.loadDrive(token, model.parseWealthData)
  assert.deepEqual(partReads(from).filter((p) => p !== 'main').sort(), ['ledger-2025-Q4', 'ledger-2026-Q1', 'ledger-2026-Q3', 'ledger-2026-Q4'])
  const january = store.ledgerCashflow(opened.state, model.emptyData()).find((m) => m.month === '2026-01')
  assert.equal(january.totals.consumption, 99)
})

test('another change to an archived year is counted again from that year alone', async () => {
  await splitOnDrive()
  const file = drive.part('history-2025')
  const content = JSON.parse(file.text)
  file.text = parts.serializePart('history-2025', content.datasetId, { ...content, snapshots: [...content.snapshots, snapshot('2025-07-01')] }, 50)
  file.version++
  const from = drive.log.length
  const { state } = await store.loadDrive(token, model.parseWealthData)
  assert.deepEqual(partReads(from), ['main', 'history-2025'])
  assert.deepEqual(store.archiveSummary(state).points.map((s) => s.date), ['2025-06-01', '2025-07-01'])
})

// Summaries counted before unclassified bank records counted by direction (2026-10-12) are counted again.
test('summaries counted the old way are counted again when the data is opened, and saved with the next save', async () => {
  await splitOnDrive()
  const file = drive.dataFile()
  const main = JSON.parse(file.text)
  main.summary.rules = parts.canonicalHash([main.expenseCategoryRules ?? null, main.bankCategoryRules ?? null])
  const july = main.summary.parts['ledger-2026-Q3'].cashflow.find((m) => m.month === '2026-07')
  assert.equal(july.totals.consumption, 5)
  // The old counting left the unclassified debit out of consumption.
  july.totals.consumption = 0
  july.totals.consumptionCategories = []
  file.text = JSON.stringify(main, null, 2)
  const from = drive.log.length
  const opened = await store.loadDrive(token, model.parseWealthData)
  assert.ok(partReads(from).includes('ledger-2026-Q3'))
  const counted = store.ledgerCashflow(opened.state, model.emptyData()).find((m) => m.month === '2026-07')
  assert.equal(counted.totals.consumption, 5)
  assert.deepEqual(counted.totals.consumptionCategories, [{ category: '未分類', count: 1, net: 5 }])
  await store.saveDrive(token, { ...opened.data, updatedAt: '2026-10-12T05:00:00.000Z' }, opened.state, NOW)
  const again = drive.log.length
  await store.loadDrive(token, model.parseWealthData)
  assert.deepEqual(partReads(again), ['main'])
})
