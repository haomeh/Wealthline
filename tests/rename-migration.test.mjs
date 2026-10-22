import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { createFakeDrive } from './helpers/fake-drive.mjs'
import { saveData } from './helpers/drive-data.mjs'

// The rename from "We Wealth" to Wealthline: data, sign-in and the reload script made before it
// keep working, and the Drive names move over on the next save.

let server, store, model, auth
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const profile = { sub: 'account-a', email: 'a@example.com', name: 'Alice' }
const originalFetch = globalThis.fetch
const storage = new Map()
const tabStorage = new Map()
let drive

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    define: { 'import.meta.env.VITE_GOOGLE_CLIENT_ID': JSON.stringify('test-client') } })
  store = await server.ssrLoadModule('/src/google/driveStore.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  auth = await server.ssrLoadModule('/src/google/auth.ts')
})
beforeEach(() => {
  storage.clear()
  tabStorage.clear()
  const fake = (map) => ({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) })
  globalThis.localStorage = fake(storage)
  globalThis.sessionStorage = fake(tabStorage)
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { delete globalThis.localStorage; delete globalThis.sessionStorage; await server?.close() })

const NOW = '2026-10-13T04:00:00.000Z'
const installDrive = () => { drive = createFakeDrive(); globalThis.fetch = drive.fetch; return drive }
const data = () => ({ ...model.emptyData(), updatedAt: NOW, fxRates: { USD: 32 }, expenses: [{ id: 'e1', date: '2026-01-05', description: 'Shop', amount: 10, currency: 'TWD', card: 'Card' }] })
const edited = (d, amount) => ({ ...d, updatedAt: NOW, expenses: d.expenses.map((e) => ({ ...e, amount })) })
const mainWrites = (from = 0) => drive.log.slice(from).filter((r) => r.method === 'PUT' && drive.files.get(r.url.match(/files\/([^?]+)/)[1]).appProperties.weWealth === 'data')

test('Drive data under the old names loads, and the next save renames the folder and the main file', async () => {
  const file = installDrive().seed(data(), { legacy: true })
  const opened = await store.loadDrive(token, model.parseWealthData)
  assert.equal(opened.data.expenses[0].amount, 10)
  assert.equal(drive.folder().name, 'We Wealth', 'loading alone renames nothing')
  assert.equal(file.name, 'we-wealth-data.json')

  const from = drive.log.length
  await store.saveDrive(token, edited(opened.data, 20), opened.state, NOW)
  assert.equal(file.name, 'wealthline-data.json')
  assert.equal(drive.folder().name, 'Wealthline')
  // The rename rides on the conditional content write: one write, guarded by the loaded ETag.
  const writes = mainWrites(from)
  assert.equal(writes.length, 1)
  assert.match(writes[0].url, /uploadType=multipart/)
  assert.equal(writes[0].headers['If-Match'], '"v1"')
  assert.equal(drive.files.get(file.id), file, 'the same file, not a copy')
  assert.ok(drive.parts().length > 0)

  // The ETag kept after the rename is the file's own: the next save is not a conflict, and is a
  // plain content write.
  const from2 = drive.log.length
  await store.saveDrive(token, edited(opened.data, 30), opened.state, NOW)
  assert.match(mainWrites(from2)[0].url, /uploadType=media/)
  const reloaded = await store.loadDrive(token, model.parseWealthData)
  const merged = store.mergeParts(reloaded.data, await store.readGroup(token, reloaded.state, 'ledger'), model.parseWealthData)
  assert.equal(merged.expenses[0].amount, 30)
})

test('names the user chose are kept', async () => {
  const file = installDrive().seed(data(), { legacy: true })
  file.name = '我的資產.json'
  drive.folder().name = '理財'
  const opened = await store.loadDrive(token, model.parseWealthData)
  const from = drive.log.length
  await store.saveDrive(token, edited(opened.data, 20), opened.state, NOW)
  assert.equal(file.name, '我的資產.json')
  assert.equal(drive.folder().name, '理財')
  assert.match(mainWrites(from)[0].url, /uploadType=media/)
  assert.ok(!drive.log.slice(from).some((r) => r.method === 'PATCH'))
})

test('a refused save renames nothing', async () => {
  const file = installDrive().seed(data(), { legacy: true })
  const opened = await store.loadDrive(token, model.parseWealthData)
  file.version++ // another device saved meanwhile
  await assert.rejects(() => store.saveDrive(token, edited(opened.data, 20), opened.state, NOW), /其他裝置/)
  assert.equal(file.name, 'we-wealth-data.json')
  assert.equal(drive.folder().name, 'We Wealth')
})

test('a folder rename that fails does not fail the save', async () => {
  const file = installDrive().seed(data(), { legacy: true })
  drive.fail((_f, init) => init.method === 'PATCH', 503)
  const opened = await store.loadDrive(token, model.parseWealthData)
  await store.saveDrive(token, edited(opened.data, 20), opened.state, NOW)
  assert.equal(file.name, 'wealthline-data.json')
  assert.equal(drive.folder().name, 'We Wealth')
  await store.saveDrive(token, edited(opened.data, 30), opened.state, NOW)
})

test('a first save creates the folder and the main file under the new names', async () => {
  installDrive()
  await saveData(await server.ssrLoadModule('/src/google/drive.ts'), token, data())
  assert.equal(drive.folder().name, 'Wealthline')
  assert.equal(drive.dataFile().name, 'wealthline-data.json')
})

test('a sign-in stored under the old keys survives the update and moves to the new keys', () => {
  storage.set('we-wealth.session', JSON.stringify({ profile }))
  tabStorage.set('we-wealth.token', JSON.stringify({ sub: profile.sub, token }))
  const session = auth.loadSession()
  assert.equal(session?.profile.email, 'a@example.com')
  assert.equal(session?.token?.value, 'test-token')
  assert.deepEqual([...storage.keys()], ['wealthline.session'])
  assert.deepEqual([...tabStorage.keys()], ['wealthline.token'])
  assert.equal(auth.loadSession()?.token?.value, 'test-token', 'and loads again from the new keys')
})

test('an old-key token of another account or past its expiry is dropped, and signing out clears old keys', () => {
  storage.set('we-wealth.session', JSON.stringify({ profile }))
  tabStorage.set('we-wealth.token', JSON.stringify({ sub: 'account-b', token }))
  assert.equal(auth.loadSession()?.token, undefined)
  assert.equal(tabStorage.size, 0)
  tabStorage.set('we-wealth.token', JSON.stringify({ sub: profile.sub, token: { value: 'old', expiresAt: Date.now() + 1000 } }))
  assert.equal(auth.loadSession()?.token, undefined)
  assert.equal(tabStorage.size, 0)
  storage.set('we-wealth.session', JSON.stringify({ profile }))
  tabStorage.set('we-wealth.token', JSON.stringify({ sub: profile.sub, token }))
  auth.clearSession()
  assert.equal(storage.size, 0)
  assert.equal(tabStorage.size, 0)
})

test('the reload script shows the restoring screen for a token under the new or the old key', () => {
  const script = readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<script>(.*?)<\/script>/s)[1]
  const run = (tab, hash = '') => {
    const classes = new Set()
    const get = (map) => ({ getItem: (k) => map[k] ?? null })
    runInNewContext(script, { location: { hash }, sessionStorage: get(tab), localStorage: get({}), document: { documentElement: { classList: { add: (c) => classes.add(c) } } } })
    return classes.has('restoring')
  }
  assert.equal(run({ 'wealthline.token': '{}' }), true)
  assert.equal(run({ 'we-wealth.token': '{}' }), true)
  assert.equal(run({}), false)
  assert.equal(run({}, '#access_token=x'), true, 'the return from Google sign-in')
})
