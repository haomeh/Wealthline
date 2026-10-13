import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import { createFakeIndexedDB } from './helpers/fake-indexeddb.mjs'

let server, dom, root, App, model, auth, createRoot
const idb = createFakeIndexedDB()
const requests = []
const originalFetch = globalThis.fetch
const button = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent === name)
const click = async (element) => { assert.ok(element); await act(async () => element.click()) }
const settle = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) })
const fakeLocks = () => {
  const tails = new Map()
  return { request(name, callback) {
    const run = (tails.get(name) ?? Promise.resolve()).then(callback)
    tails.set(name, run.catch(() => {}))
    return run
  } }
}

before(async () => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLAnchorElement', 'Event', 'MouseEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.indexedDB = idb.indexedDB
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.scrollTo = () => {}
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0)
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  window.HTMLDialogElement.prototype.close = function () { this.open = false }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  App = (await server.ssrLoadModule('/src/App.tsx')).default
  model = await server.ssrLoadModule('/src/model.ts')
  auth = await server.ssrLoadModule('/src/google/auth.ts')
})
beforeEach(() => {
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: fakeLocks() })
  requests.length = 0
  globalThis.fetch = async (url) => { requests.push(String(url)); throw new Error('offline') }
  globalThis.confirm = () => true
})
afterEach(async () => {
  if (root) await act(() => root.unmount())
  root = null
  globalThis.fetch = originalFetch
  delete globalThis.confirm
  localStorage.clear()
  sessionStorage.clear()
  idb.reset()
  window.history.replaceState(null, '', '/')
})
after(async () => { await server.close(); dom.window.close() })
const render = async () => {
  root = createRoot(document.getElementById('root'))
  await act(async () => root.render(createElement(App)))
  await settle()
}
const openManagement = async (mode) => {
  const menu = document.querySelector(`summary[aria-label="${mode === 'local' ? '本機模式選單' : '帳號選單'}"]`)
  await click(menu)
  const trigger = button('資料與隱私')
  await click(trigger)
  return { menu, trigger, dialog: document.querySelector('dialog[aria-labelledby="data-privacy-title"]') }
}
const uploadFrom = async (dialog, file) => {
  const input = dialog.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
}
const backupFile = (data = model.emptyData()) => ({ name: 'backup.json', size: 100, text: async () => JSON.stringify(data) })

test('local management opens without contacting Google and Escape returns focus', async () => {
  localStorage.setItem('wealthline.local.active', '1')
  window.history.replaceState(null, '', '/app')
  await render()
  const { menu, dialog } = await openManagement('local')
  assert.ok(dialog?.open)
  assert.equal(document.activeElement?.getAttribute('aria-label'), '關閉資料與隱私')
  assert.equal(menu.parentElement.open, false)
  assert.match(dialog.textContent, /此瀏覽器/)
  assert.equal(dialog.textContent.includes('Google Drive 中的財務資料'), false)
  assert.deepEqual(requests.filter((url) => /google/.test(url)), [])
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
  assert.equal(document.querySelector('dialog[aria-labelledby="data-privacy-title"]'), null)
  assert.ok(document.activeElement === menu, 'focus returns to the stable account-menu summary')
})

test('Google management names the active account and opens only manual external controls', async () => {
  const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
  auth.storeSession({ token: { value: 'test-token', expiresAt: Date.now() + 3600_000 }, profile })
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    if (String(url).includes('userinfo')) return Response.json(profile)
    if (String(url).includes('googleapis.com/drive')) return Response.json({ files: [] })
    throw new Error('offline')
  }
  window.history.replaceState(null, '', '/app')
  await render()
  const before = requests.length
  const { dialog } = await openManagement('google')
  assert.ok(dialog?.open)
  assert.match(dialog.textContent, /a@example.com/)
  const external = [...dialog.querySelectorAll('a[target="_blank"]')]
  assert.deepEqual(external.map((a) => new URL(a.href).host).sort(), ['drive.google.com', 'myaccount.google.com'])
  assert.ok(external.every((a) => a.rel.includes('noopener')))
  assert.equal(requests.length, before)
  assert.equal(button('刪除此瀏覽器中的財務資料'), undefined)
})

test('canceling local deletion preserves saved data and keeps the session', async () => {
  const data = model.emptyData()
  idb.set('wealthline', 'files', 'core', JSON.stringify(data))
  localStorage.setItem('wealthline.local.stored', '1')
  localStorage.setItem('wealthline.local.active', '1')
  window.history.replaceState(null, '', '/app')
  await render()
  const { dialog } = await openManagement('local')
  globalThis.confirm = () => false
  await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === '刪除此瀏覽器中的財務資料'))
  await settle()
  assert.ok(idb.get('wealthline', 'files', 'core'))
  assert.equal(window.location.pathname, '/app')
  assert.ok(document.querySelector('summary[aria-label="本機模式選單"]'))
})

test('deleting from data management removes local records and the migration backup', async () => {
  const raw = JSON.stringify({ ...model.emptyData(), fxRates: { USD: 32 } })
  idb.set('wealthline', 'files', 'core', raw)
  localStorage.setItem('wealthline.local.stored', '1')
  localStorage.setItem('wealthline.local.active', '1')
  localStorage.setItem('wealthline.local.data.backup', 'legacy copy')
  localStorage.setItem('wealthline.local.data.backup-at', new Date().toISOString())
  localStorage.setItem('unrelated.browser.key', 'kept')
  window.history.replaceState(null, '', '/app')
  await render()
  assert.equal(localStorage.getItem('wealthline.local.data.backup'), 'legacy copy')
  const { dialog } = await openManagement('local')
  await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === '刪除此瀏覽器中的財務資料'))
  await settle()
  assert.equal(idb.get('wealthline', 'files', 'core'), undefined)
  assert.equal(localStorage.getItem('wealthline.local.data.backup'), null)
  assert.equal(localStorage.getItem('wealthline.local.data.backup-at'), null)
  assert.equal(localStorage.getItem('wealthline.local.stored'), null)
  assert.equal(localStorage.getItem('unrelated.browser.key'), 'kept')
  assert.equal(window.location.pathname, '/')
  assert.ok(button('不登入，直接在瀏覽器使用'))
})

test('failed deletion from data management reports failure and keeps local records', async () => {
  const raw = JSON.stringify({ ...model.emptyData(), fxRates: { USD: 32 } })
  idb.set('wealthline', 'files', 'core', raw)
  localStorage.setItem('wealthline.local.stored', '1')
  localStorage.setItem('wealthline.local.active', '1')
  localStorage.setItem('wealthline.local.data.backup', 'legacy copy')
  localStorage.setItem('wealthline.local.data.backup-at', new Date().toISOString())
  window.history.replaceState(null, '', '/app')
  await render()
  assert.equal(localStorage.getItem('wealthline.local.data.backup'), 'legacy copy')
  const { dialog } = await openManagement('local')
  idb.failNextWrite(new Error('disk denied'))
  await click([...dialog.querySelectorAll('button')].find((b) => b.textContent === '刪除此瀏覽器中的財務資料'))
  await settle()
  assert.equal(idb.get('wealthline', 'files', 'core'), raw)
  assert.equal(localStorage.getItem('wealthline.local.data.backup'), 'legacy copy')
  assert.equal(localStorage.getItem('wealthline.local.stored'), '1')
  assert.match(document.querySelector('.signin-box .error')?.textContent ?? '', /資料沒有刪除：disk denied/)
  assert.ok(button('繼續使用此瀏覽器中的資料'))
})

test('invalid upload explains failure inside the active data dialog and clears on retry', async () => {
  localStorage.setItem('wealthline.local.active', '1')
  window.history.replaceState(null, '', '/app')
  await render()
  const { dialog } = await openManagement('local')
  await uploadFrom(dialog, { name: 'bad.json', size: 1, text: async () => '{' })
  assert.match(dialog.querySelector('[role="alert"]')?.textContent ?? '', /不是有效的 JSON/)
  await uploadFrom(dialog, backupFile())
  assert.equal(dialog.querySelector('[role="alert"]'), null)
  assert.equal(document.querySelector('dialog[aria-labelledby="data-privacy-title"]'), null)
})


test('mobile More data controls return focus to their own trigger', async () => {
  localStorage.setItem('wealthline.local.active', '1')
  window.history.replaceState(null, '', '/more')
  await render()
  const trigger = [...document.querySelectorAll('main button')].find((b) => b.textContent === '資料與隱私')
  await click(trigger)
  const dialog = document.querySelector('dialog[aria-labelledby="data-privacy-title"]')
  assert.ok(dialog?.open)
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
  assert.equal(document.activeElement, trigger)
})
