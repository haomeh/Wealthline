import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'

// Local mode: the app without Google sign-in, with the data file kept in localStorage.

let server, dom, root, App, model, auth, store, createRoot
const DATA_KEY = 'wealthline.local.data'
const ACTIVE_KEY = 'wealthline.local.active'
const originalFetch = globalThis.fetch
let requests = []
let downloads = []

before(async () => {
  // File and Blob stay Node's own, which have text() like a browser's (jsdom's do not).
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLAnchorElement', 'Event', 'MouseEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
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
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
const fixture = () => ({ ...model.emptyData(), fxRates: { USD: 32, SGD: 24 }, fxUpdatedAt: new Date().toISOString() })
const stored = () => JSON.parse(localStorage.getItem(DATA_KEY))
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
  const loaded=store.loadLocal().data
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

test('saves go to localStorage and a reload reopens local mode with them', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
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
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  const other = { ...fixture(), fxRates: { USD: 40, SGD: 24 } }
  localStorage.setItem(DATA_KEY, JSON.stringify(other))
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
  localStorage.setItem(DATA_KEY, JSON.stringify(data))
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
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  const before = localStorage.getItem(DATA_KEY)
  await render()
  await uploadFile('not json')
  assert.match(document.querySelector('.signin-box .error').textContent, /不是有效的 JSON/)
  await uploadFile(JSON.stringify({ version: 1 }))
  assert.match(document.querySelector('.signin-box .error').textContent, /上傳的資料檔格式不正確/)
  assert.equal(localStorage.getItem(DATA_KEY), before)
  assert.equal(window.location.pathname, '/')
})

test('declining the replace prompt keeps the stored data', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  const before = localStorage.getItem(DATA_KEY)
  globalThis.confirm = () => false
  await render()
  await uploadFile(JSON.stringify({ ...fixture(), fxRates: { USD: 1 } }))
  assert.equal(localStorage.getItem(DATA_KEY), before)
  assert.equal(window.location.pathname, '/')
})

test('leaving local mode keeps the data for next time; deleting removes it', async () => {
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  await click(button('離開本機模式'))
  assert.equal(window.location.pathname, '/')
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.ok(localStorage.getItem(DATA_KEY))
  await click(button('繼續使用此瀏覽器中的資料'))
  await settle()
  assert.equal(window.location.pathname, '/app')
  await click(button('刪除此瀏覽器中的資料'))
  await settle()
  assert.equal(localStorage.getItem(DATA_KEY), null)
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.ok(button('不登入，直接在瀏覽器使用'))
})

test('unreadable stored data returns to the home page with the reason', async () => {
  localStorage.setItem(DATA_KEY, '{"version":99,"accounts":[]}')
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
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
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
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  window.history.replaceState(null, '', '/app')
  await render()
  await settle()
  const finish = await delayedUpload(JSON.stringify({ ...fixture(), fxRates: { USD: 1 } }))
  await click(button('刪除此瀏覽器中的資料'))
  await settle()
  assert.equal(localStorage.getItem(DATA_KEY), null)
  await finish()
  assert.equal(localStorage.getItem(DATA_KEY), null)
  assert.equal(localStorage.getItem(ACTIVE_KEY), null)
  assert.equal(window.location.pathname, '/')
  assert.equal(document.querySelector('.topbar'), null)
})

test('leaving local mode while an upload is being read cancels the upload', async () => {
  const data = JSON.stringify(fixture())
  localStorage.setItem(DATA_KEY, data)
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
  localStorage.setItem(DATA_KEY, before)
  // Another tab holds the lock and writes its own version before releasing it.
  let release
  const otherTab = navigator.locks.request('wealthline.local', () => new Promise((resolve) => { release = resolve }))
  const saving = store.saveLocal({ ...fixture(), fxRates: { USD: 33 } }, before)
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(localStorage.getItem(DATA_KEY), before, 'nothing is written while another tab holds the lock')
  const theirs = JSON.stringify({ ...fixture(), fxRates: { USD: 40 } })
  localStorage.setItem(DATA_KEY, theirs)
  release()
  await otherTab
  await assert.rejects(saving, /其他分頁/)
  assert.equal(localStorage.getItem(DATA_KEY), theirs)
})

test('two writers racing on the same version: exactly one wins and the other gets a conflict', async () => {
  const before = JSON.stringify(fixture())
  localStorage.setItem(DATA_KEY, before)
  const a = { ...fixture(), fxRates: { USD: 33 } }
  const b = { ...fixture(), fxRates: { USD: 34 } }
  const results = await Promise.allSettled([store.saveLocal(a, before), store.saveLocal(b, before)])
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
  const winner = results.findIndex((r) => r.status === 'fulfilled')
  assert.match(results[1 - winner].reason.message, /其他分頁/)
  assert.equal(localStorage.getItem(DATA_KEY), results[winner].value)
  assert.deepEqual(stored().fxRates, [a, b][winner].fxRates)
})

test('without Web Locks local mode refuses to write instead of saving unlocked', async () => {
  setLocks(undefined)
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
  localStorage.setItem(ACTIVE_KEY, '1')
  const before = localStorage.getItem(DATA_KEY)
  window.history.replaceState(null, '', '/rates')
  await render()
  await settle()
  await editRate('USD', '36')
  await click(button('儲存變更'))
  await settle()
  assert.match(document.querySelector('[role="alert"]').textContent, /Web Locks/)
  assert.equal(localStorage.getItem(DATA_KEY), before)
  assert.ok(button('儲存變更'))
  await assert.rejects(store.replaceLocal(fixture(), () => true), /Web Locks/)
  await assert.rejects(store.clearLocal(), /Web Locks/)
  assert.equal(localStorage.getItem(DATA_KEY), before)
})

test('after Google fails to load, choosing local mode in that tab survives a reload despite the leftover token', async () => {
  const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
  auth.storeSession({ token: { value: 'test-token', expiresAt: Date.now() + 3600_000 }, profile })
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
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
  localStorage.setItem(DATA_KEY, JSON.stringify(fixture()))
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
