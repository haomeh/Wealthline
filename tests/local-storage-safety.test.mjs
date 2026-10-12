import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { createFakeIndexedDB } from './helpers/fake-indexeddb.mjs'

// Local mode when IndexedDB misbehaves. localStore.ts decides its storage once per page load,
// so each test loads a fresh copy of the module, as a new page load would.

const DATA_KEY = 'wealthline.local.data'
const STORED_KEY = 'wealthline.local.stored'
let server, model, idb
const shim = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }
}
const fakeLocks = () => {
  let tail = Promise.resolve()
  return { request(_name, callback) { const run = tail.then(() => callback()); tail = run.catch(() => {}); return run } }
}
// IndexedDB that fails to open, as a browser can on one page load.
const failingIndexedDB = { open() { const r = { onsuccess: null, onerror: null, error: new Error('UnknownError') }; setTimeout(() => r.onerror?.()); return r } }
const freshStore = async () => {
  server.moduleGraph.invalidateAll()
  return server.ssrLoadModule('/src/localStore.ts')
}
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  model = await server.ssrLoadModule('/src/model.ts')
})
beforeEach(() => {
  globalThis.localStorage = shim()
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: fakeLocks() })
  idb = createFakeIndexedDB()
  globalThis.indexedDB = idb.indexedDB
})
after(async () => {
  delete globalThis.indexedDB
  delete globalThis.localStorage
  await server.close()
})

const saved = () => JSON.stringify({ ...model.emptyData(), accounts: [{ id: 'a', name: 'Bank', category: '現金與外幣活存', country: 'TW', positions: [] }] })

test('data already moved to IndexedDB: when IndexedDB fails to open, nothing shows as empty and nothing is written elsewhere', async () => {
  const raw = saved()
  idb.set('wealthline', 'files', 'core', raw)
  localStorage.setItem(STORED_KEY, '1')
  globalThis.indexedDB = failingIndexedDB
  const local = await freshStore()
  assert.equal(local.hasLocalData(), true)
  await assert.rejects(local.loadLocal(), /無法開啟.*重新載入/)
  await assert.rejects(local.saveLocal(model.emptyData(), null), /無法開啟/)
  await assert.rejects(local.replaceLocal(model.emptyData(), () => true), /無法開啟/)
  await assert.rejects(local.clearLocal(), /無法開啟/)
  assert.equal(localStorage.getItem(DATA_KEY), null, 'nothing saved to localStorage')
  assert.equal(localStorage.getItem(STORED_KEY), '1')
  assert.equal(idb.get('wealthline', 'files', 'core'), raw)

  // Once IndexedDB opens again (same page load), the data is there.
  globalThis.indexedDB = idb.indexedDB
  assert.equal((await local.loadLocal()).raw, raw)
})

test('without data in IndexedDB, a browser where it fails to open still uses localStorage', async () => {
  const raw = saved()
  localStorage.setItem(DATA_KEY, raw)
  globalThis.indexedDB = failingIndexedDB
  const local = await freshStore()
  assert.equal((await local.loadLocal()).raw, raw)
  const next = await local.saveLocal(model.emptyData(), raw)
  assert.equal(localStorage.getItem(DATA_KEY), next)
})

test('a copy to IndexedDB that does not read back keeps the data in localStorage', async () => {
  const raw = saved()
  localStorage.setItem(DATA_KEY, raw)
  idb.replaceNextWrite('{"broken":true}')
  const local = await freshStore()
  const file = await local.loadLocal()
  assert.equal(file.raw, raw)
  assert.equal(localStorage.getItem(DATA_KEY), raw)
  assert.equal(idb.get('wealthline', 'files', 'core'), undefined, 'the bad copy is removed')
  assert.equal(localStorage.getItem(STORED_KEY), null)
})
