import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { createFakeIndexedDB } from './helpers/fake-indexeddb.mjs'

let server, local, model, preview, dom
const idb = createFakeIndexedDB()
const raw = () => idb.get('wealthline', 'files', 'core') ?? null
const locks = { request: (_name, task) => Promise.resolve().then(task) }
const data = () => ({ ...model.emptyData(), updatedAt: '2026-10-10T12:00:00.000Z' })

before(async () => {
  dom = new JSDOM('', { url: 'https://wealthline.test/' })
  globalThis.localStorage = dom.window.localStorage
  globalThis.sessionStorage = dom.window.sessionStorage
  globalThis.indexedDB = idb.indexedDB
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks, storage: { persist: async () => true } } })
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  local = await server.ssrLoadModule('/src/localStore.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  preview = await server.ssrLoadModule('/src/backupPreview.ts')
})
beforeEach(() => { idb.reset(); localStorage.clear(); sessionStorage.clear(); globalThis.navigator.locks = locks })
after(async () => { await server?.close(); dom.window.close() })

test('summary uses validated records and shows unavailable history without guessing', () => {
  const source = { ...data(), accounts: [{ id: 'a', name: 'Test', kind: 'bank', country: 'TW', category: '現金與外幣活存', positions: [{ id: 'p', type: 'cash', currency: 'TWD', symbol: '', quantity: 1, price: 1 }] }], liabilities: [], expenses: [], bankTransactions: [], history: { changes: [], snapshots: [] } }
  const result = preview.summarizeBackup(source, { name: 'backup.json', size: 42 })
  assert.equal(result.name, 'backup.json')
  assert.equal(result.bytes, 42)
  assert.equal(result.updatedAt, source.updatedAt)
  assert.deepEqual(result.counts, { accounts: 1, positions: 1, liabilities: 0, expenses: 0, bankTransactions: 0 })
  assert.equal(result.historyRange, null)
  assert.equal(preview.summarizeBackup({ ...source, history: { changes: [], snapshots: [{ date: '2024-01-03' }, { date: '2025-05-02' }] } }, { name: 'x', size: 1 }).historyRange.from, '2024-01-03')
})

test('preview reads IndexedDB and legacy storage without migration or cleanup', async () => {
  localStorage.setItem('wealthline.local.data', JSON.stringify(data()))
  const before = [...Object.entries(localStorage)]
  const open = idb.indexedDB.open
  idb.indexedDB.open = () => { throw new Error('preview opened IndexedDB') }
  const shot = await local.readLocalPreview()
  idb.indexedDB.open = open
  assert.ok(shot.data)
  assert.equal(raw(), null)
  assert.deepEqual([...Object.entries(localStorage)], before)
})

test('replacement rejects another tab write and deletion after preview', async () => {
  const old = JSON.stringify(data())
  idb.set('wealthline', 'files', 'core', old)
  localStorage.setItem('wealthline.local.stored', '1')
  const shot = await local.readLocalPreview()
  const other = JSON.stringify({ ...data(), updatedAt: '2026-10-11' })
  idb.set('wealthline', 'files', 'core', other)
  await assert.rejects(local.replaceLocal(data(), shot.version, () => true), local.LocalConflictError)
  assert.equal(raw(), other)
  idb.set('wealthline', 'files', 'core', old)
  const deleted = await local.readLocalPreview()
  idb.set('wealthline', 'files', 'core', undefined)
  await assert.rejects(local.replaceLocal(data(), deleted.version, () => true), local.LocalConflictError)
  assert.equal(raw(), null)
})

test('replacement rejects an empty destination becoming populated and keeps old data on failed write', async () => {
  const empty = await local.readLocalPreview()
  const other = JSON.stringify(data())
  idb.set('wealthline', 'files', 'core', other)
  await assert.rejects(local.replaceLocal(data(), empty.version, () => true), local.LocalConflictError)
  assert.equal(raw(), other)
  localStorage.setItem('wealthline.local.stored', '1')
  const shot = await local.readLocalPreview()
  idb.failNextWrite(new Error('full'))
  await assert.rejects(local.replaceLocal(data(), shot.version, () => true), /儲存空間不足/)
  assert.equal(raw(), other)
})

test('missing source timestamp stays unavailable after parser fills a storage timestamp', async () => {
  const source = { ...data() }
  delete source.updatedAt
  const parsed = await local.readDataFile(new File([JSON.stringify(source)], 'old.json'))
  assert.ok(parsed.data.updatedAt)
  assert.equal(parsed.sourceUpdatedAt, null)
  assert.equal(preview.summarizeBackup(parsed.data, { name: 'old.json', size: 1 }, parsed.sourceUpdatedAt).updatedAt, null)
})

test('replacement refuses no Web Locks and canceled session', async () => {
  const shot = await local.readLocalPreview()
  assert.equal(await local.replaceLocal(data(), shot.version, () => false), null)
  assert.equal(raw(), null)
  let checks = 0
  assert.equal(await local.replaceLocal(data(), shot.version, () => ++checks === 1), null)
  assert.equal(raw(), null)
  globalThis.navigator.locks = undefined
  await assert.rejects(local.replaceLocal(data(), shot.version, () => true), /Web Locks/)
  assert.equal(raw(), null)
})
