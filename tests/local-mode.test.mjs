import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import { createFakeIndexedDB } from './helpers/fake-indexeddb.mjs'

// Local mode: the app without Google sign-in, with the data file kept in IndexedDB
// (localStorage in earlier versions, moved over on open).

let server, dom, root, App, model, auth, store, createRoot
const DATA_KEY = 'wealthline.local.data'
const ACTIVE_KEY = 'wealthline.local.active'
const STORED_KEY = 'wealthline.local.stored'
const BACKUP_KEY = 'wealthline.local.data.backup'
const idb = createFakeIndexedDB()
// The data file text in IndexedDB, as this or another tab stored it.
const idbRaw = () => idb.get('wealthline', 'files', 'core') ?? null
const seed = (raw) => { idb.set('wealthline', 'files', 'core', raw); localStorage.setItem(STORED_KEY, '1') }
const originalFetch = globalThis.fetch
let requests = []
let downloads = []

before(async () => {
  // File and Blob stay Node's own, which have text() like a browser's (jsdom's do not).
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLAnchorElement', 'Event', 'MouseEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.indexedDB = idb.indexedDB
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.scrollTo = () => {}
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  App = (await server.ssrLoadModule('/src/App.tsx')).default
  model = await server.ssrLoadModule('/src/model.ts')
  auth = await server.ssrLoadModule('/src/google/auth.ts')
  store = await server.ssrLoadModule('/src/localStore.ts')
})
// Web Locks as a browser provides them: one holder per name, the others wait in order.
const fakeLocks = () => {
  const tails = new Map()
  return {
    request(name, callback) {
      const run = (tails.get(name) ?? Promise.resolve()).then(() => callback())
      tails.set(name, run.catch(() => {}))
      return run
    },
  }
}
const setLocks = (locks) => Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: locks })

beforeEach(() => {
  setLocks(fakeLocks())
  requests = []
  downloads = []
  // Market lookups fail offline; nothing else may be requested.
  globalThis.fetch = async (url) => { requests.push(String(url)); throw new Error('offline') }
  globalThis.confirm = () => true
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
  idb.reset()
  delete globalThis.confirm
  window.history.replaceState(null, '', '/')
})
after(async () => { await server.close(); dom.window.close() })

const render = async () => {
  if (root) await act(() => root.unmount())
  root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(createElement(App)) })
}
const button = (text) => [...document.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text)
const click = async (element) => { assert.ok(element); await act(async () => element.click()) }
// IndexedDB answers through several timer turns, so wait out a few rounds of them.
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) })
const fixture = () => ({ ...model.emptyData(), fxRates: { USD: 32, SGD: 24 }, fxUpdatedAt: new Date().toISOString() })
const stored = () => JSON.parse(idbRaw())
const editRate = async (currency, value) => {
  const input = document.querySelector(`[aria-label="${currency} 匯率"]`)
  assert.ok(input, `${currency} rate input`)
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.blur()
  })
}
const uploadFile = async (text) => {
  const input = document.querySelector('input[type="file"]')
  assert.ok(input)
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([text], 'wealthline-data.json', { type: 'application/json' })] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
}
const noGoogle = () => assert.deepEqual(requests.filter((u) => /google/.test(u)), [])

test('v13 local save roundtrip and stale lock conflict preserve bank collections',async()=>{
  const data={...fixture(),version:13,bankTransactionAccounts:[{id:'ledger-1',label:'Independent',bank:'Test'}],bankTransactions:[],bankCategoryRules:[]}
  const raw=await store.saveLocal(data,null)
  const loaded=(await store.loadLocal()).data
  assert.equal(loaded.version,13)
  assert.deepEqual(loaded.bankTransactionAccounts,data.bankTransactionAccounts)
  const updated={...loaded,bankTransactionAccounts:[{...data.bankTransactionAccounts[0],label:'Renamed'}]}
  await store.saveLocal(updated,raw)
  await assert.rejects(store.saveLocal(data,raw),store.LocalConflictError)
  assert.deepEqual(stored().bankTransactionAccounts,updated.bankTransactionAccounts)
  assert.equal(stored().version,13)
  noGoogle()
})

test('starting without sign-in opens the app and never contacts Google', async () => {
  await render()
  await click(button('不登入，直接在瀏覽器使用'))
  await settle()
  assert.equal(window.location.pathname, '/app')
  assert.ok(document.querySelector('.topbar'))
  assert.ok(document.querySelector('summary[aria-label="本機模式選單"]'))
  assert.equal(localStorage.getItem(ACTIVE_KEY), '1')
  noGoogle()
})

test('saves go to IndexedDB and a reload reopens local mode with them', async () => {
  seed(JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  await editRate('USD', '33')
  await click(button('儲存變更'))
  await settle()
  assert.equal(stored().fxRates.USD, 33)
  assert.ok(document.querySelector('.synced'))

  await render()
  await settle()
  assert.equal(window.location.pathname, '/rates')
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '33')
  noGoogle()
})

test('the home page goes to the app while local mode is on', async () => {
  localStorage.setItem(ACTIVE_KEY, '1')
  await render()
  await settle()
  assert.equal(window.location.pathname, '/app')
})

test('a save stops when another tab changed the stored data, keeping the edit and offering a backup', async () => {
  seed(JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  const other = { ...fixture(), fxRates: { USD: 40, SGD: 24 } }
  seed(JSON.stringify(other))
  await editRate('USD', '34')
  await click(button('儲存變更'))
  await settle()
  assert.match(document.querySelector('[role="alert"]').textContent, /其他分頁/)
  assert.equal(stored().fxRates.USD, 40)
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '34')
  assert.ok(button('儲存變更'))
  assert.ok(button('下載本機資料備份'))
})

test('download saves the last saved data file; it is disabled while edits are unsaved', async () => {
  const data = fixture()
  seed(JSON.stringify(data))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  await click(button('下載資料檔'))
  assert.equal(downloads.length, 1)
  assert.match(downloads[0].name, /^wealthline-data-\d{4}-\d{2}-\d{2}\.json$/)
  assert.deepEqual(JSON.parse(await downloads[0].text()), model.parseWealthData(data))
  await editRate('USD', '35')
  assert.equal(button('下載資料檔').disabled, true)
})

test('uploading a data file from the home page restores it into local mode', async () => {
  const data = { ...fixture(), fxRates: { USD: 31, SGD: 23 } }
  await render()
  await uploadFile(JSON.stringify(data))
  assert.equal(window.location.pathname, '/app')
  assert.deepEqual(stored(), model.parseWealthData(data))
  assert.equal(localStorage.getItem(ACTIVE_KEY), '1')
  noGoogle()
})

test('an invalid upload shows why and changes nothing', async () => {
  seed(JSON.stringify(fixture()))
  const before = idbRaw()
  await render()
  await uploadFile('not json')
  assert.match(document.querySelector('.signin-box .error').textContent, /不是有效的 JSON/)
  await uploadFile(JSON.stringify({ version: 1 }))
  assert.match(document.querySelector('.signin-box .error').textContent, /上傳的資料檔格式不正確/)
  assert.equal(idbRaw(), before)
  assert.equal(window.location.pathname, '/')
})

test('the Drive main file of split data is refused as an upload, since it lacks the transactions and earlier years', async () => {
  seed(JSON.stringify(fixture()))
  const before = idbRaw()
  await render()
  await uploadFile(JSON.stringify({ ...fixture(), version: 15, datasetId: 'set-1', expenses: [], summary: { parts: {} } }))
  assert.match(document.querySelector('.signin-box .error').textContent, /Google Drive 中的主檔.*下載完整備份/)
  assert.equal(idbRaw(), before)
  assert.equal(window.location.pathname, '/')
})

test('declining the replace prompt keeps the stored data', async () => {
  seed(JSON.stringify(fixture()))
  const before = idbRaw()
  globalThis.confirm = () => false
  await render()
  await uploadFile(JSON.stringify({ ...fixture(), fxRates: { USD: 1 } }))
  assert.equal(idbRaw(), before)
  assert.equal(window.location.pathname, '/')
})

test('leaving local mode keeps the data for next time; deleting removes it', async () => {
  seed(JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  await click(button('離開本機模式'))
  assert.equal(window.location.pathname, '/')
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.ok(idbRaw())
  await click(button('繼續使用此瀏覽器中的資料'))
  await settle()
  assert.equal(window.location.pathname, '/app')
  await click(button('刪除此瀏覽器中的資料'))
  await settle()
  assert.equal(idbRaw(), null)
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.ok(button('不登入，直接在瀏覽器使用'))
})

test('unreadable stored data returns to the home page with the reason', async () => {
  seed('{"version":99,"accounts":[]}')
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  assert.equal(document.querySelector('.topbar'), null)
  assert.match(document.querySelector('.signin-box .error').textContent, /此瀏覽器保存的資料格式不正確/)
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
})

test('public pages stay readable in local mode and link back to the app', async () => {
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/privacy')
  await render()
  assert.ok(document.querySelector('.legal article'))
  assert.match(document.querySelector('.legal article').textContent, /本機模式/)
  assert.equal(document.querySelector('.legal-back').getAttribute('href'), '/app')
  assert.deepEqual(requests, [])
})

test('a tab signed in to Google keeps its Drive session on reload when another tab turned local mode on', async () => {
  const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
  auth.storeSession({ token: { value: 'test-token', expiresAt: Date.now() + 3600_000 }, profile })
  seed(JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    if (String(url).includes('userinfo')) return Response.json(profile)
    if (String(url).includes('googleapis.com/drive')) return Response.json({ files: [] })
    throw new Error('offline')
  }
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  assert.ok(document.querySelector('summary[aria-label="帳號選單"]'))
  assert.equal(document.querySelector('summary[aria-label="本機模式選單"]'), null)
  assert.ok(requests.some((u) => u.includes('googleapis.com/drive')))
})

// A file whose contents arrive only when the test says so.
const delayedUpload = async (text) => {
  let release
  const contents = new Promise((resolve) => { release = () => resolve(text) })
  const input = document.querySelector('input[type="file"]')
  assert.ok(input)
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'wealthline-data.json', size: text.length, text: () => contents }] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  return async () => { release(); await settle() }
}

test('deleting the data while an upload is being read cancels the upload', async () => {
  seed(JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  const finish = await delayedUpload(JSON.stringify({ ...fixture(), fxRates: { USD: 1 } }))
  await click(button('刪除此瀏覽器中的資料'))
  await settle()
  assert.equal(idbRaw(), null)
  await finish()
  assert.equal(idbRaw(), null)
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.equal(window.location.pathname, '/')
  assert.equal(document.querySelector('.topbar'), null)
})

test('leaving local mode while an upload is being read cancels the upload', async () => {
  const data = JSON.stringify(fixture())
  seed(data)
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  const finish = await delayedUpload(JSON.stringify({ ...fixture(), fxRates: { USD: 1 } }))
  await click(button('離開本機模式'))
  await finish()
  assert.equal(JSON.stringify(stored()), JSON.stringify(JSON.parse(data)))
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.equal(window.location.pathname, '/')
  assert.ok(button('繼續使用此瀏覽器中的資料'))
})

test('the version check and the write happen under one lock, so another tab cannot write in between', async () => {
  const before = JSON.stringify(fixture())
  seed(before)
  // Another tab holds the lock and writes its own version before releasing it.
  let release
  const otherTab = navigator.locks.request('wealthline.local', () => new Promise((resolve) => { release = resolve }))
  const saving = store.saveLocal({ ...fixture(), fxRates: { USD: 33 } }, before)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(idbRaw(), before, 'nothing is written while another tab holds the lock')
  const theirs = JSON.stringify({ ...fixture(), fxRates: { USD: 40 } })
  seed(theirs)
  release()
  await otherTab
  await assert.rejects(saving, /其他分頁/)
  assert.equal(idbRaw(), theirs)
})

test('two writers racing on the same version: exactly one wins and the other gets a conflict', async () => {
  const before = JSON.stringify(fixture())
  seed(before)
  const a = { ...fixture(), fxRates: { USD: 33 } }
  const b = { ...fixture(), fxRates: { USD: 34 } }
  const results = await Promise.allSettled([store.saveLocal(a, before), store.saveLocal(b, before)])
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
  const winner = results.findIndex((r) => r.status === 'fulfilled')
  assert.match(results[1 - winner].reason.message, /其他分頁/)
  assert.equal(idbRaw(), results[winner].value)
  assert.deepEqual(stored().fxRates, [a, b][winner].fxRates)
})

test('without Web Locks local mode refuses to write instead of saving unlocked', async () => {
  setLocks(undefined)
  seed(JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  const before = idbRaw()
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  await editRate('USD', '36')
  await click(button('儲存變更'))
  await settle()
  assert.match(document.querySelector('[role="alert"]').textContent, /Web Locks/)
  assert.equal(idbRaw(), before)
  assert.ok(button('儲存變更'))
  await assert.rejects(store.replaceLocal(fixture(), () => true), /Web Locks/)
  await assert.rejects(store.clearLocal(), /Web Locks/)
  assert.equal(idbRaw(), before)
})

test('after Google fails to load, choosing local mode in that tab survives a reload despite the leftover token', async () => {
  const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
  auth.storeSession({ token: { value: 'test-token', expiresAt: Date.now() + 3600_000 }, profile })
  seed(JSON.stringify(fixture()))
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  // Loading Drive failed (fetch is offline): back on the home page, with the token still stored.
  assert.equal(document.querySelector('.topbar'), null)
  assert.ok(auth.loadSession()?.token)
  await click(button('繼續使用此瀏覽器中的資料'))
  await settle()
  assert.ok(document.querySelector('summary[aria-label="本機模式選單"]'))

  requests = []
  await render()
  await settle()
  assert.ok(document.querySelector('summary[aria-label="本機模式選單"]'))
  assert.equal(window.location.pathname, '/app')
  noGoogle()
})

test('a tab that chose local mode keeps it on reload after another tab left local mode', async () => {
  const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
  auth.storeSession({ token: { value: 'test-token', expiresAt: Date.now() + 3600_000 }, profile })
  seed(JSON.stringify(fixture()))
  window.history.replaceState(null, '', '/app')
  // Tab A chooses local mode (after its Google load failed, so its token is still stored).
  await render()
  await settle()
  await click(button('繼續使用此瀏覽器中的資料'))
  await settle()
  // Tab B leaves local mode, which clears the flag all tabs share.
  localStorage.removeItem(ACTIVE_KEY)

  requests = []
  await render()
  await settle()
  assert.ok(document.querySelector('summary[aria-label="本機模式選單"]'))
  assert.equal(window.location.pathname, '/app')
  assert.equal(localStorage.getItem(ACTIVE_KEY), '1')
  noGoogle()
})

const setStorage = (storage) => Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: storage })

test('the menu shows the data size and browser storage use; a notice appears when the browser is nearly full', async () => {
  let estimate = { usage: 2 * 1024 * 1024, quota: 100 * 1024 * 1024 }
  setStorage({ estimate: async () => estimate, persist: async () => true })
  try {
    seed(JSON.stringify(fixture()))
    localStorage.setItem(ACTIVE_KEY, '1')
    window.history.replaceState(null, '', '/app')
    await render()
    await settle()
    const meter = document.querySelector('.menu .storage-meter')
    assert.match(meter.textContent, /資料大小：\d+ B/)
    assert.match(meter.textContent, /此瀏覽器已使用 2\.0 MB \/ 可用 100\.0 MB/)
    assert.equal(document.querySelector('.storage-notice'), null)

    estimate = { usage: 85 * 1024 * 1024, quota: 100 * 1024 * 1024 }
    await render()
    await settle()
    assert.ok(document.querySelector('.storage-meter.warn'))
    assert.match(document.querySelector('.storage-notice.warn').textContent, /儲存空間已使用 85\.0 MB.*請下載資料檔備份/)
    noGoogle()
  } finally {
    setStorage(undefined)
  }
})

test('data saved in localStorage by an earlier version opens as before and moves to IndexedDB', async () => {
  const data = { ...fixture(), fxRates: { USD: 31, SGD: 23 } }
  const legacy = JSON.stringify(data)
  localStorage.setItem(DATA_KEY, legacy)
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '31')
  assert.equal(idbRaw(), legacy)
  // Gone from the old place, so a tab still on the earlier version cannot save over it.
  assert.equal(localStorage.getItem(DATA_KEY), null)
  assert.equal(localStorage.getItem(BACKUP_KEY), legacy)
  assert.equal(localStorage.getItem(STORED_KEY), '1')

  await editRate('USD', '33')
  await click(button('儲存變更'))
  await settle()
  assert.equal(stored().fxRates.USD, 33)
  assert.equal(localStorage.getItem(DATA_KEY), null)
  await render()
  await settle()
  assert.equal(document.querySelector('[aria-label="USD 匯率"]').value, '33')
  noGoogle()
})

test('the home page offers data moved to IndexedDB, and deleting it also removes the moved backup', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  assert.equal(await store.loadLocal().then((f) => f.data.fxRates.USD), 32)
  assert.equal(localStorage.getItem(DATA_KEY), null)
  await render()
  assert.ok(button('繼續使用此瀏覽器中的資料'))
  await click(button('繼續使用此瀏覽器中的資料'))
  await settle()
  await click(button('刪除此瀏覽器中的資料'))
  await settle()
  assert.equal(idbRaw(), null)
  assert.equal(localStorage.getItem(BACKUP_KEY), null)
  assert.equal(localStorage.getItem(STORED_KEY), null)
  assert.ok(button('不登入，直接在瀏覽器使用'))
})

test('when IndexedDB already holds data, it wins and the localStorage text is only kept as a backup', async () => {
  const current = JSON.stringify({ ...fixture(), fxRates: { USD: 35, SGD: 24 } })
  const stale = JSON.stringify({ ...fixture(), fxRates: { USD: 30, SGD: 24 } })
  seed(current)
  localStorage.setItem(DATA_KEY, stale)
  const file = await store.loadLocal()
  assert.equal(file.raw, current)
  assert.equal(idbRaw(), current)
  assert.equal(localStorage.getItem(DATA_KEY), null)
  assert.equal(localStorage.getItem(BACKUP_KEY), stale)
})

test('a save stops when localStorage data reappears after the move, instead of hiding it', async () => {
  seed(JSON.stringify(fixture()))
  const { raw } = await store.loadLocal()
  localStorage.setItem(DATA_KEY, JSON.stringify({ ...fixture(), fxRates: { USD: 50 } }))
  await assert.rejects(store.saveLocal({ ...fixture(), fxRates: { USD: 33 } }, raw), store.LocalConflictError)
  assert.equal(idbRaw(), raw)
})

test('a full browser on save keeps the stored data and says why', async () => {
  seed(JSON.stringify(fixture()))
  const { raw } = await store.loadLocal()
  idb.failNextWrite(new Error('QuotaExceededError'))
  await assert.rejects(store.saveLocal({ ...fixture(), fxRates: { USD: 33 } }, raw), /儲存空間不足/)
  assert.equal(idbRaw(), raw)
})

test('the backup of moved localStorage data is dropped after 30 days', async () => {
  seed(JSON.stringify(fixture()))
  localStorage.setItem(BACKUP_KEY, 'old')
  localStorage.setItem('wealthline.local.data.backup-at', new Date(Date.now() - 31 * 86400_000).toISOString())
  await store.loadLocal()
  assert.equal(localStorage.getItem(BACKUP_KEY), null)
  localStorage.setItem(BACKUP_KEY, 'recent')
  localStorage.setItem('wealthline.local.data.backup-at', new Date().toISOString())
  await store.loadLocal()
  assert.equal(localStorage.getItem(BACKUP_KEY), 'recent')
})

// Last: after this, the module keeps using localStorage for the rest of its page load.
test('if IndexedDB cannot take the data, it stays in localStorage and local mode keeps working there', async () => {
  const legacy = JSON.stringify(fixture())
  localStorage.setItem(DATA_KEY, legacy)
  idb.failNextWrite(new Error('QuotaExceededError'))
  const file = await store.loadLocal()
  assert.equal(file.raw, legacy)
  assert.equal(idbRaw(), null)
  assert.equal(localStorage.getItem(DATA_KEY), legacy)
  const raw = await store.saveLocal({ ...fixture(), fxRates: { USD: 33 } }, legacy)
  assert.equal(localStorage.getItem(DATA_KEY), raw)
  assert.equal(idbRaw(), null)
})
