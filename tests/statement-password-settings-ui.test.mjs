import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { act, createElement } from 'react'
import { statementKeyStore } from './helpers/statement-key-store.mjs'

let dom, server, root, createRoot, Settings, Expenses, BankTransactions, model
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const saved = [
  { id: 'one', label: 'Card A', keyId: 'key', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA' },
  { id: 'two', label: 'Bank B', keyId: 'key', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAA' },
]

before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'localStorage']) globalThis[key] = dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;({ StatementPasswordSettings: Settings } = await server.ssrLoadModule('/src/views/StatementPasswordSettings.tsx'))
  ;({ Expenses } = await server.ssrLoadModule('/src/views/Expenses.tsx'))
  ;({ BankTransactions } = await server.ssrLoadModule('/src/views/BankTransactions.tsx'))
  model = await server.ssrLoadModule('/src/model.ts')
})
afterEach(async () => { if (root) await act(() => root.unmount()); root = null; document.getElementById('root').replaceChildren(); localStorage.clear(); delete globalThis.indexedDB; if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto); if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator) })
after(async () => { await server.close(); dom.window.close() })
const mount = async (Component, props) => { root = createRoot(document.getElementById('root')); await act(() => root.render(createElement(Component, props))) }
const button = label => [...document.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)
const click = async label => { const b = button(label); assert.ok(b, `missing ${label}`); await act(() => b.click()) }
const setInput = async (field, value) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })) })

test('remove-all cancellation keeps entries and edit draft; confirmation clears both', async () => {
  let passwords = saved, changes = 0, decision = false
  window.confirm = () => decision
  const props = () => ({ scope: 'test', passwords, busy: false, onSave() {}, onRemove() {}, onRemoveAll() { passwords = []; changes++; root.render(createElement(Settings, props())) }, onClose() {} })
  await mount(Settings, props())
  await click('重新設定 Card A 密碼')
  assert.ok(button('取消修改'))
  await setInput(document.querySelector('dialog input[type="password"]'), 'draft-secret')
  await click('移除全部密碼設定')
  assert.equal(changes, 0)
  assert.equal(passwords.length, 2)
  assert.equal(document.querySelector('dialog input[type="password"]').value, 'draft-secret')
  assert.ok(button('取消修改'))
  decision = true
  await click('移除全部密碼設定')
  assert.equal(changes, 1)
  assert.equal(document.querySelector('dialog input[type="password"]').value, '')
  assert.deepEqual(passwords, [])
  assert.equal(button('移除全部密碼設定'), undefined)
  assert.equal(button('取消修改'), undefined)
})

test('remove one keeps the other entry and clears its active edit', async () => {
  let passwords = saved
  const props = () => ({ scope: 'test', passwords, busy: false, onSave() {}, onRemove(id) { passwords = passwords.filter(p => p.id !== id); root.render(createElement(Settings, props())) }, onRemoveAll() {}, onClose() {} })
  await mount(Settings, props())
  await click('重新設定 Card A 密碼')
  await click('移除 Card A 密碼')
  assert.deepEqual(passwords.map(p => p.id), ['two'])
  assert.equal(button('取消修改'), undefined)
})

test('remove-all is unavailable for empty or busy settings', async () => {
  await mount(Settings, { scope: 'test', passwords: [], busy: false, onSave() {}, onRemove() {}, onRemoveAll() {}, onClose() {} })
  assert.equal(button('移除全部密碼設定'), undefined)
  await act(() => root.render(createElement(Settings, { scope: 'test', passwords: saved, busy: true, onSave() {}, onRemove() {}, onRemoveAll() {}, onClose() {} })))
  assert.equal(button('移除全部密碼設定').disabled, true)
})

for (const [name, Component] of [['card', () => Expenses], ['bank', () => BankTransactions]]) {
  test(`${name} remove-all updates only password settings through pending data`, async () => {
    const data = { ...model.emptyData(), statementPasswords: saved, expenses: [], bankTransactions: [] }
    let next
    await mount(Component(), { data, onChange: value => { next = value }, busy: false, passwordScope: 'test' })
    window.confirm = () => true
    await click('管理帳單密碼')
    await click('移除全部密碼設定')
    assert.ok(next)
    assert.deepEqual(next.statementPasswords, [])
    assert.deepEqual(next.expenses, data.expenses)
    assert.deepEqual(next.bankTransactions, data.bankTransactions)
    assert.deepEqual(data.statementPasswords, saved)
  })
}

test('pending remove-all survives a local save and reload without changing financial records', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, task) => task() }, storage: { persist: async () => true } } })
  const local = await server.ssrLoadModule('/src/localStore.ts')
  const expense = { id: 'expense-1', date: '2026-01-05', description: 'Coffee', amount: 10, currency: 'TWD', card: 'Card A' }
  const data = { ...model.emptyData(), version: 12, statementPasswords: saved, expenses: [expense] }
  const firstRaw = await local.saveLocal(data, null)
  let pending
  await mount(Expenses, { data, onChange: next => { pending = next }, busy: false, passwordScope: 'test' })
  window.confirm = () => true
  await click('管理帳單密碼')
  await click('移除全部密碼設定')
  assert.deepEqual((await local.loadLocal()).data.statementPasswords, saved, 'removal remains pending before global save')
  await local.saveLocal(pending, firstRaw)
  const reloaded = (await local.loadLocal()).data
  assert.deepEqual(reloaded.statementPasswords, [])
  assert.deepEqual(reloaded.expenses, [expense])
  assert.deepEqual(data.statementPasswords, saved)
})

test('remove-all stays disabled while a password update is encrypting', async () => {
  const realCrypto = globalThis.crypto
  let release, started
  const began = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    randomUUID: realCrypto.randomUUID.bind(realCrypto),
    getRandomValues: realCrypto.getRandomValues.bind(realCrypto),
    subtle: {
      generateKey: realCrypto.subtle.generateKey.bind(realCrypto.subtle),
      encrypt: async (...args) => { started(); await gate; return realCrypto.subtle.encrypt(...args) },
    },
  } })
  globalThis.indexedDB = statementKeyStore()
  let savedCount = 0, removedCount = 0
  await mount(Settings, { scope: 'test', passwords: saved, busy: false, onSave() { savedCount++ }, onRemove() {}, onRemoveAll() { removedCount++ }, onClose() {} })
  await click('重新設定 Card A 密碼')
  await setInput(document.querySelector('dialog input[type="password"]'), 'new-secret')
  await act(() => document.querySelector('dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await began
  assert.equal(button('移除全部密碼設定').disabled, true)
  await click('移除全部密碼設定')
  assert.equal(removedCount, 0)
  release()
  for (let i = 0; i < 20 && button('移除全部密碼設定').disabled; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  assert.equal(button('移除全部密碼設定').disabled, false)
  assert.equal(savedCount, 1)
})


test('remove-all controls preserve no-name comma-separated password creation', async () => {
  globalThis.indexedDB = statementKeyStore()
  let rows
  await mount(Settings, { scope: 'batch-test', passwords: [], busy: false, onSave(value) { rows = value }, onRemove() {}, onRemoveAll() {}, onClose() {} })
  assert.equal(document.querySelectorAll('dialog input').length, 1)
  await setInput(document.querySelector('dialog input[type="password"]'), ' first-secret , second-secret ')
  await act(() => document.querySelector('dialog form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  for (let i = 0; i < 30 && !rows; i++) await act(async () => new Promise(resolve => setTimeout(resolve, 0)))
  assert.ok(rows)
  assert.deepEqual(rows.map(row => row.label), ['密碼 1', '密碼 2'])
  assert.equal(JSON.stringify(rows).includes('first-secret'), false)
  assert.equal(JSON.stringify(rows).includes('second-secret'), false)
  assert.equal(document.querySelector('dialog input[type="password"]').value, '')
})
