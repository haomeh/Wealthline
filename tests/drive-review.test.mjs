import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { createServer } from 'vite'
import { createHash } from 'node:crypto'
import { createFakeDrive } from './helpers/fake-drive.mjs'

// Regression tests for the independent review of the Drive split (data version 15): duplicate
// part files, saves refused part way, parts newer than the main file and the size limit.

let server, parts, store, model, driveApi
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const originalFetch = globalThis.fetch
let drive
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  parts = await server.ssrLoadModule('/src/dataParts.ts')
  store = await server.ssrLoadModule('/src/google/driveStore.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  driveApi = await server.ssrLoadModule('/src/google/drive.ts')
})
afterEach(() => { globalThis.fetch = originalFetch })
after(() => server.close())

const NOW = '2026-10-12T04:00:00.000Z'
const expense = (id, date, amount = 10) => ({ id, date, description: `Shop ${id}`, amount, currency: 'TWD', card: 'Card' })
const tx = (id, date, accountId = 'acct') => ({ id, accountId, date, description: `T ${id}`, currency: 'TWD', direction: 'debit', amount: 5 })
const base = (extra = {}) => ({ ...model.emptyData(), version: 13, updatedAt: NOW, expenses: [expense('e1', '2026-01-05')], history: { changes: [], liabilityChanges: [], snapshots: [] }, ...extra })
async function openAll() {
  const opened = await store.loadDrive(token, model.parseWealthData)
  let data = opened.data
  for (const group of ['ledger', 'history']) data = store.mergeParts(data, await store.readGroup(token, opened.state, group), model.parseWealthData)
  return { data, state: opened.state }
}
async function splitOnDrive(seed = base()) {
  drive = createFakeDrive()
  globalThis.fetch = drive.fetch
  drive.seed(seed)
  const first = await openAll()
  await store.saveDrive(token, first.data, first.state, NOW)
}
const writes = (from = 0) => drive.log.slice(from).filter((r) => r.method === 'PUT' || r.method === 'POST')
const filesOf = (name) => drive.parts().filter((f) => f.appProperties.part === name)
const amounts = (data, id) => data.expenses.filter((e) => e.id === id).map((e) => e.amount)
// Edits the stored main file as another program would.
const editMain = (change) => {
  const file = drive.dataFile()
  const main = JSON.parse(file.text)
  change(main)
  file.text = JSON.stringify(main, null, 2)
  file.version++
}
// Adds a file to the fake Drive directly; `created` orders it among the others.
const addPartFile = (name, content, sequence, created = 1e6) => {
  const datasetId = drive.main().datasetId
  const id = `extra-${name}-${created}`
  drive.files.set(id, { id, name: parts.partFileName(name), appProperties: { weWealth: 'part', dataset: datasetId, part: name }, parents: [], text: parts.serializePart(name, datasetId, content, sequence), version: 1, trashed: false, created })
  return id
}

test('a part create whose reply was lost is found by the next save, which writes to that file', async () => {
  await splitOnDrive()
  const { data, state } = await openAll()
  // The create reaches Drive, but its reply is lost.
  let lose = true
  globalThis.fetch = async (url, init = {}) => {
    const res = await drive.fetch(url, init)
    if (lose && init.method === 'POST' && String(url).includes('/upload/drive/v2/files')) { lose = false; return new Response('', { status: 503 }) }
    return res
  }
  const first = { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: [...data.expenses, expense('eA', '2026-10-01')] }
  await assert.rejects(store.saveDrive(token, first, state, NOW), /503/)
  const second = { ...first, updatedAt: '2026-10-12T06:00:00.000Z', expenses: [...first.expenses, expense('eB', '2026-10-02')] }
  await store.saveDrive(token, second, state, NOW)
  assert.equal(filesOf('ledger-2026-Q4').length, 1, 'no second file for the same part')
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.expenses.map((e) => e.id).sort(), ['e1', 'eA', 'eB'])
})

test('retrying the first split of a single file after a lost create reply overwrites the file left behind', async () => {
  drive = createFakeDrive()
  globalThis.fetch = drive.fetch
  drive.seed(base())
  const { data, state } = await openAll()
  let lose = true
  globalThis.fetch = async (url, init = {}) => {
    const res = await drive.fetch(url, init)
    if (lose && init.method === 'POST' && String(url).includes('/upload/drive/v2/files')) { lose = false; return new Response('', { status: 503 }) }
    return res
  }
  await assert.rejects(store.saveDrive(token, data, state, NOW), /503/)
  // The record is deleted before the retry; the file the lost create left must not bring it back.
  await store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: [expense('e2', '2026-01-06')] }, state, NOW)
  assert.equal(filesOf('ledger-2026-Q1').length, 1)
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.expenses.map((e) => e.id), ['e2'])
})

test('two files of one part without a recorded file are both read; the next save writes them into one recorded file', async () => {
  await splitOnDrive()
  // A main file written before file ids were recorded, and a second Q1 file with another record.
  editMain((main) => { delete main.summary.parts['ledger-2026-Q1'].fileId })
  const extra = addPartFile('ledger-2026-Q1', { expenses: [expense('e2', '2026-02-01', 20)] }, 0)
  const opened = await openAll()
  assert.deepEqual(opened.data.expenses.map((e) => e.id).sort(), ['e1', 'e2'], 'records of both files are shown')
  assert.equal(store.ledgerCashflow(opened.state, model.emptyData()).find((m) => m.month === '2026-02').totals.consumption, 20)

  await store.saveDrive(token, { ...opened.data, updatedAt: '2026-10-12T05:00:00.000Z' }, opened.state, NOW)
  const recorded = drive.main().summary.parts['ledger-2026-Q1'].fileId
  assert.ok(recorded && recorded !== extra)
  assert.deepEqual(JSON.parse(drive.files.get(recorded).text).expenses.map((e) => e.id).sort(), ['e1', 'e2'])
  const from = drive.log.length
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.expenses.map((e) => e.id).sort(), ['e1', 'e2'])
  assert.ok(!drive.log.slice(from).some((r) => r.url.includes(`/files/${extra}?alt=media`)), 'the other file is no longer read')
})

test('when a part has two files, the one recorded in the main file is used, not the one created first', async () => {
  await splitOnDrive()
  // An earlier file of the same part, from a save that never reached the main file.
  addPartFile('ledger-2026-Q1', { expenses: [expense('e1', '2026-01-05', 999)] }, 50, -1)
  const reloaded = await openAll()
  assert.deepEqual(amounts(reloaded.data, 'e1'), [10])
})

test('a part the main file records but Drive no longer lists stops loading instead of being made again', async () => {
  await splitOnDrive()
  filesOf('ledger-2026-Q1')[0].trashed = true
  await assert.rejects(store.loadDrive(token, model.parseWealthData), /找不到分檔 wealthline-ledger-2026-Q1\.json.*垃圾桶/)
})

test('the user may open without a part Drive no longer lists; nothing is removed and the part comes back once restored', async () => {
  await splitOnDrive(base({ expenses: [expense('e1', '2026-01-05'), expense('e2', '2026-07-05')] }))
  const lost = filesOf('ledger-2026-Q1')[0]
  lost.trashed = true
  const error = await store.loadDrive(token, model.parseWealthData).catch((e) => e)
  assert.ok(error instanceof store.MissingPartError)
  assert.deepEqual(error.names, ['ledger-2026-Q1'])

  const opened = await store.loadDrive(token, model.parseWealthData, error.names)
  assert.deepEqual(opened.state.skipped, ['ledger-2026-Q1'])
  assert.match(store.skippedNotice(opened.state.skipped), /wealthline-ledger-2026-Q1\.json.*垃圾桶還原/)
  let data = opened.data
  for (const group of ['ledger', 'history']) data = store.mergeParts(data, await store.readGroup(token, opened.state, group), model.parseWealthData)
  assert.deepEqual(data.expenses.map((e) => e.id), ['e2'])

  // A save of other edits keeps the main file's record of the missing part, with its sequence.
  const sequence = drive.main().summary.parts['ledger-2026-Q1'].sequence
  await store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: [...data.expenses, expense('e3', '2026-07-06')] }, opened.state, NOW)
  assert.equal(drive.main().summary.parts['ledger-2026-Q1'].sequence, sequence)
  assert.equal(drive.main().summary.parts['ledger-2026-Q1'].fileId, lost.id)
  // An edit dated in the missing part stops before writing anything, so its records are not overwritten.
  const from = drive.log.length
  await assert.rejects(store.saveDrive(token, { ...data, updatedAt: '2026-10-12T06:00:00.000Z', expenses: [...data.expenses, expense('e4', '2026-02-01')] }, opened.state, NOW), /找不到的分檔 wealthline-ledger-2026-Q1\.json/)
  assert.deepEqual(writes(from), [])

  // Restored from the trash: it loads as before, with every record.
  lost.trashed = false
  const restored = await openAll()
  assert.equal(restored.state.skipped, undefined)
  assert.deepEqual(restored.data.expenses.map((e) => e.id).sort(), ['e1', 'e2', 'e3'])
})

for (const field of ['expenseCategoryRules', 'bankCategoryRules']) test(`missing ledger parts block ${field} changes before any write`, async () => {
  await splitOnDrive(base({ expenses: [expense('e1', '2026-01-05'), expense('e2', '2026-07-05')] }))
  const lost = filesOf('ledger-2026-Q1')[0]
  lost.trashed = true
  const { data, state } = await store.loadDrive(token, model.parseWealthData, ['ledger-2026-Q1'])
  const summary = structuredClone(drive.main().summary)
  const from = drive.log.length
  await assert.rejects(store.saveDrive(token, { ...data, [field]: [{ keyword: 'Shop', category: '交通' }] }, state, NOW), /分類規則.*分檔/)
  assert.deepEqual(writes(from), [])
  assert.deepEqual(drive.main().summary, summary)
  assert.deepEqual(state.summary, summary)
  lost.trashed = false
  const restored = await openAll()
  await store.saveDrive(token, { ...restored.data, [field]: [{ keyword: 'Shop', category: '交通' }] }, restored.state, NOW)
  assert.notEqual(drive.main().summary.rules, summary.rules)
})

test('a file tagged as a part but with an unknown part name is left out', async () => {
  await splitOnDrive()
  const datasetId = drive.main().datasetId
  drive.files.set('junk', { id: 'junk', name: 'junk.json', appProperties: { weWealth: 'part', dataset: datasetId, part: 'notes' }, parents: [], text: '{}', version: 1, trashed: false, created: 1e6 })
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.expenses.map((e) => e.id), ['e1'])
})

test("a save started after another device's save stops before writing anything", async () => {
  await splitOnDrive(base({ expenses: [expense('e1', '2026-07-05')] }))
  const a = await openAll()
  const b = await openAll()
  await store.saveDrive(token, { ...b.data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: b.data.expenses.map((e) => ({ ...e, amount: 77 })) }, b.state, NOW)
  const from = drive.log.length
  await assert.rejects(store.saveDrive(token, { ...a.data, updatedAt: '2026-10-12T05:01:00.000Z', expenses: a.data.expenses.map((e) => ({ ...e, date: '2026-01-15' })) }, a.state, NOW), /其他裝置/)
  assert.deepEqual(writes(from), [])
  const reloaded = await openAll()
  assert.deepEqual(amounts(reloaded.data, 'e1'), [77])
})

// Device B saves its edit while device A's save is between its first part write and its main file.
async function raceWithB(afterB = () => {}) {
  await splitOnDrive(base({ expenses: [expense('e1', '2026-07-05')] }))
  const a = await openAll()
  const b = await openAll()
  let raced = false
  globalThis.fetch = async (url, init = {}) => {
    const res = await drive.fetch(url, init)
    if (!raced && init.method === 'POST' && String(url).includes('/upload/drive/v2/files')) {
      raced = true
      await store.saveDrive(token, { ...b.data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: b.data.expenses.map((e) => ({ ...e, amount: 77 })) }, b.state, NOW)
      afterB()
    }
    return res
  }
  // A moves the expense to an earlier quarter: the new Q1 part is written, then Q3 is refused.
  const error = await store.saveDrive(token, { ...a.data, updatedAt: '2026-10-12T05:01:00.000Z', expenses: a.data.expenses.map((e) => ({ ...e, date: '2026-01-15' })) }, a.state, NOW).then(() => null, (e) => e)
  assert.ok(raced)
  globalThis.fetch = drive.fetch
  return error
}

test("a save refused part way puts back what it wrote, so another device's saved edit stays", async () => {
  const error = await raceWithB()
  assert.ok(error instanceof driveApi.DriveConflictError)
  assert.doesNotMatch(error.message, /部分修改可能已寫入/)
  assert.deepEqual(JSON.parse(filesOf('ledger-2026-Q1')[0].text).expenses, [], 'the part A created holds no records')
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.expenses.map((e) => [e.date, e.amount]), [['2026-07-05', 77]])
})

test('when the files written by a refused save cannot all be put back, the message says so', async () => {
  const error = await raceWithB(() => drive.fail((file, init) => file?.appProperties.part === 'ledger-2026-Q1' && init.method === 'PUT', 503))
  assert.ok(error instanceof driveApi.DriveConflictError)
  assert.match(error.message, /部分修改可能已寫入 Drive/)
})

test('parts read after another device saved stop with a reload message instead of failing as a broken file', async () => {
  await splitOnDrive(base({ expenses: [], bankTransactionAccounts: [{ id: 'acct', label: 'Main', bank: 'Bank' }], bankTransactions: [tx('t1', '2026-07-01')], bankCategoryRules: [] }))
  const a = await store.loadDrive(token, model.parseWealthData)
  const b = await openAll()
  await store.saveDrive(token, { ...b.data, updatedAt: '2026-10-12T05:00:00.000Z', bankTransactionAccounts: [...b.data.bankTransactionAccounts, { id: 'acct2', label: 'Second', bank: 'Bank' }], bankTransactions: [...b.data.bankTransactions, tx('t2', '2026-08-01', 'acct2')] }, b.state, NOW)
  const error = await store.readGroup(token, a.state, 'ledger').then(() => null, (e) => e)
  assert.ok(error)
  assert.match(error.message, /重新載入頁面/)
  assert.doesNotMatch(error.message, /刪除/)
  // Trying again, or another page, still asks for a reload instead of showing the newer parts.
  await assert.rejects(store.readGroup(token, a.state, 'ledger'), /重新載入頁面/)
  await assert.rejects(store.readGroup(token, a.state, 'history'), /重新載入頁面/)
})

test('a part that does not join with the main file is reported without asking to delete Drive files', () => {
  const data = model.parseWealthData({ ...model.emptyData(), version: 15, bankTransactionAccounts: [], bankTransactions: [] })
  assert.throws(() => store.mergeParts(data, [{ name: 'ledger-2026-Q3', sequence: 1, content: { bankTransactions: [tx('t1', '2026-07-01', 'unknown')] } }], model.parseWealthData), (e) => /重新載入頁面/.test(e.message) && !/刪除該檔案/.test(e.message))
})

test('a save with any file over the size limit writes nothing', async () => {
  await splitOnDrive()
  const { data, state } = await openAll()
  const from = drive.log.length
  const description = 'x'.repeat(1024)
  // A small change to Q1, which is written first, and a quarter that grows over the limit.
  const big = Array.from({ length: 5000 }, (_, i) => ({ ...expense(`big${i}`, '2026-10-01'), description }))
  await assert.rejects(store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: [{ ...data.expenses[0], amount: 11 }, ...big] }, state, NOW), /原本的資料沒有變動/)
  assert.deepEqual(writes(from), [])
})

test('an oversized update of a part file is refused before any request', async () => {
  drive = createFakeDrive()
  globalThis.fetch = drive.fetch
  await assert.rejects(driveApi.updatePart(token, { fileId: 'f', etag: '"v1"' }, 'x'.repeat(5 * 1024 * 1024)), /超過單一檔案/)
  assert.deepEqual(drive.log, [])
})

test('the summary counts once a record an interrupted move left in two parts', async () => {
  await splitOnDrive()
  const { data, state } = await openAll()
  // The new part is written; the connection is lost before the old one loses the record.
  drive.fail((file) => file?.appProperties.part === 'ledger-2026-Q1', 503)
  await assert.rejects(store.saveDrive(token, { ...data, updatedAt: '2026-10-12T05:00:00.000Z', expenses: data.expenses.map((e) => ({ ...e, date: '2026-07-15' })) }, state, NOW), /503/)
  assert.equal(JSON.parse(filesOf('ledger-2026-Q1')[0].text).expenses.length, 1)
  const opened = await store.loadDrive(token, model.parseWealthData)
  const months = store.ledgerCashflow(opened.state, model.emptyData())
  assert.deepEqual(months.filter((m) => m.totals.consumption).map((m) => [m.month, m.totals.consumption]), [['2026-07', 10]])
})

test('copies of a part keep each record once, a snapshot once per date, from the copy written last', () => {
  const snap = (date, total) => ({ date, at: `${date}T04:00:00.000Z`, total, accounts: [], categories: {} })
  const merged = parts.mergeCopies([
    { name: 'history-2025', sequence: 1, content: { snapshots: [snap('2025-06-01', 1), snap('2025-07-01', 1)] } },
    { name: 'history-2025', sequence: 2, content: { snapshots: [snap('2025-06-01', 2)] } },
  ])
  assert.deepEqual(merged.content.snapshots.map((s) => [s.date, s.total]), [['2025-06-01', 2], ['2025-07-01', 1]])
  assert.equal(merged.sequence, 2)
})

test('the summary records the file of each part with its checksum', async () => {
  await splitOnDrive()
  const entry = drive.main().summary.parts['ledger-2026-Q1']
  const file = filesOf('ledger-2026-Q1')[0]
  assert.equal(entry.fileId, file.id)
  assert.equal(entry.md5, createHash('md5').update(file.text).digest('hex'))
})
