import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { createServer } from 'vite'
import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { createFakeDrive } from './helpers/fake-drive.mjs'

let server, model, parts, version
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  model = await server.ssrLoadModule('/src/model.ts')
  parts = await server.ssrLoadModule('/src/dataParts.ts')
  version = await server.ssrLoadModule('/src/dataVersion.ts')
})
after(() => server.close())
const review = () => ({ month: '2026-09', expectedSources: [{ kind: 'card', card: 'Test' }], confirmations: [] })
test('reviews promote v16 and survive parse and split without entering ledger parts', () => {
  const base = model.emptyData()
  const parsed = model.parseWealthData({ ...base, version: 16, monthlyReviews: [review()] })
  assert.deepEqual(parsed.monthlyReviews, [review()])
  const split = parts.splitData(parsed, 'test-set', '2026-10-13T12:00:00Z')
  assert.equal(split.main.version, 16)
  assert.deepEqual(split.main.monthlyReviews, [review()])
  assert.equal(version.dataVersion({ ...base, monthlyReviews: [] }), 16)
})

const confirmation = () => ({ source: { kind: 'card', card: 'Test' }, decision: 'reviewed', confirmedAt: '2026-10-13T12:00:00.000Z', fingerprint: 'a'.repeat(64) })
const parse = async (raw) => (await server.ssrLoadModule('/src/monthlyReview.ts')).parseMonthlyReviews(raw)
test('review parser uses an allowlist, preserves exact references and deleted bank history', async () => {
  const historic = { kind: 'bank', accountId: 'deleted-bank' }
  const input = [{ ...review(), secret: 'discard', expectedSources: [{ kind: 'card', card: ' Test ', secret: 'discard' }, historic], confirmations: [{ ...confirmation(), source: historic, exceptionNote: '待查證', secret: 'discard' }] }]
  const before = structuredClone(input)
  const parsed = await parse(input)
  assert.deepEqual(parsed, [{ ...review(), expectedSources: [{ kind: 'card', card: ' Test ' }, historic], confirmations: [{ ...confirmation(), source: historic, exceptionNote: '待查證' }] }])
  assert.deepEqual(input, before)
  assert.deepEqual(model.parseWealthData({ ...model.emptyData(), monthlyReviews: parsed }).monthlyReviews, parsed)
})
test('review parser rejects malformed dates, duplicates, decisions and bounded collections/text', async () => {
  const module = await server.ssrLoadModule('/src/monthlyReview.ts')
  const badReviews = [null, {}, [null], [{ ...review(), month: '0000-01' }], [{ ...review(), month: '2026-13' }], [review(), review()],
    [{ ...review(), expectedSources: [review().expectedSources[0], review().expectedSources[0]] }],
    [{ ...review(), expectedSources: [{ kind: 'bank', accountId: '../x' }] }],
    [{ ...review(), expectedSources: [{ kind: 'card', card: ' ' }] }],
    [{ ...review(), expectedSources: [{ kind: 'card', card: 'x'.repeat(101) }] }],
    [{ ...review(), expectedSources: [{ kind: 'other', card: 'Test' }] }],
    [{ ...review(), confirmations: [confirmation(), confirmation()] }],
    [{ ...review(), confirmations: [{ ...confirmation(), decision: 'complete' }] }],
    [{ ...review(), confirmations: [{ ...confirmation(), fingerprint: 'x'.repeat(64) }] }],
    [{ ...review(), confirmations: [{ ...confirmation(), confirmedAt: '2026-02-30T12:00:00.000Z' }] }],
    [{ ...review(), confirmations: [{ ...confirmation(), confirmedAt: '2026-10-13' }] }],
    [{ ...review(), confirmations: [{ ...confirmation(), exceptionNote: 'x'.repeat(501) }] }],
    [{ ...review(), confirmations: [{ ...confirmation(), exceptionNote: 1 }] }],
    Array.from({ length: 1201 }, (_, i) => ({ ...review(), month: `${String(1900 + Math.floor(i / 12))}-${String(i % 12 + 1).padStart(2, '0')}` })),
    [{ ...review(), expectedSources: Array.from({ length: 201 }, (_, i) => ({ kind: 'card', card: `Card${i}` })) }],
    [{ ...review(), confirmations: Array.from({ length: 201 }, (_, i) => ({ ...confirmation(), source: { kind: 'card', card: `Card${i}` } })) }],
  ]
  for (const raw of badReviews) assert.throws(() => module.parseMonthlyReviews(raw), /核對/)
  const max = [{ ...review(), expectedSources: Array.from({ length: 200 }, (_, i) => ({ kind: 'card', card: `Card${i}` })), confirmations: [{ ...confirmation(), source: { kind: 'card', card: 'Card0' }, exceptionNote: 'x'.repeat(500) }] }]
  assert.deepEqual(await parse(max), max)
})
test('canonical SHA-256 sorts object keys, preserves arrays and rejects non-JSON inputs', async () => {
  const { cashflowFingerprint: hash } = await server.ssrLoadModule('/src/cashflowFingerprint.ts')
  const value = { z: ['<script>text</script>', -4, null], a: { z: true, a: 2 } }
  const before = structuredClone(value)
  const expected = createHash('sha256').update(JSON.stringify({ a: { a: 2, z: true }, z: value.z })).digest('hex')
  assert.equal(await hash(value), expected)
  assert.equal(await hash({ a: { a: 2, z: true }, z: value.z }), expected)
  assert.notEqual(await hash([1, 2]), await hash([2, 1]))
  assert.deepEqual(value, before)
  const cycle = {}; cycle.self = cycle
  for (const bad of [undefined, NaN, Infinity, { a: undefined }, [undefined], new Array(2), 1n, () => 1, new Date(), cycle]) await assert.rejects(hash(bad))
})

const NOW = '2026-10-13T12:00:00.000Z'
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const originalFetch = globalThis.fetch
let drive
const setup = () => { drive = createFakeDrive(); globalThis.fetch = drive.fetch; return drive }
afterEach(() => { globalThis.fetch = originalFetch })
const fixture = () => ({ ...model.emptyData(), version: 14, updatedAt: NOW,
  expenses: [{ id: 'e1', date: '2026-01-10', description: 'Shop', amount: 10, currency: 'TWD', card: 'Test' }, { id: 'e2', date: '2026-09-10', description: 'Shop 2', amount: 20, currency: 'TWD', card: 'Test' }],
  bankTransactionAccounts: [{ id: 'bank', label: 'Bank', bank: 'Bank' }], bankTransactions: [{ id: 'b1', accountId: 'bank', date: '2026-09-01', description: 'Salary', amount: 100, currency: 'TWD', direction: 'credit' }],
  history: { snapshots: [{ date: '2025-01-01', at: '2025-01-01T12:00:00.000Z', total: 30, accounts: [], categories: {} }], changes: [], liabilityChanges: [] },
})
const store = async () => server.ssrLoadModule('/src/google/driveStore.ts')
async function openAll() {
  const storage = await store()
  const opened = await storage.loadDrive(token, model.parseWealthData)
  for (const group of ['ledger', 'history']) opened.data = storage.mergeParts(opened.data, await storage.readGroup(token, opened.state, group), model.parseWealthData)
  return opened
}
async function splitFixture() {
  setup().seed(fixture())
  const storage = await store()
  const loaded = await storage.loadDrive(token, model.parseWealthData)
  await storage.saveDrive(token, loaded.data, loaded.state, NOW)
}
const writes = (from) => drive.log.slice(from).filter(r => ['PUT', 'POST', 'PATCH'].includes(r.method))
const records = (data) => ({ expenses: data.expenses, bankTransactions: data.bankTransactions, history: data.history })
test('review-only Drive save preserves all unread parts and reload restores every record', async () => {
  await splitFixture()
  const storage = await store()
  const { data, state } = await storage.loadDrive(token, model.parseWealthData)
  assert.ok(storage.missingParts(state, data, 'ledger').length)
  const original = drive.parts().map(p => [p.id, p.text])
  const from = drive.log.length
  const saved = await storage.saveDrive(token, { ...data, monthlyReviews: [review()] }, state, NOW)
  assert.equal(saved.version, 16)
  assert.equal(drive.main().version, 16)
  assert.equal(writes(from).length, 1)
  assert.equal(drive.log.slice(from).filter(r => r.url.includes('alt=media')).length, 0)
  assert.deepEqual(drive.parts().map(p => [p.id, p.text]), original)
  const reloaded = await openAll()
  assert.deepEqual(reloaded.data.monthlyReviews, [review()])
  assert.deepEqual(records(reloaded.data), records(model.parseWealthData(fixture())))
  await storage.saveDrive(token, { ...reloaded.data, monthlyReviews: [] }, reloaded.state, NOW)
  assert.equal(drive.main().version, 16)
  assert.deepEqual((await openAll()).data.monthlyReviews, [])
})
test('full Drive backup downloads reviews and all parts and restores locally; raw v16 split main is refused', async () => {
  await splitFixture()
  const storage = await store()
  const loaded = await storage.loadDrive(token, model.parseWealthData)
  await storage.saveDrive(token, { ...loaded.data, monthlyReviews: [review()] }, loaded.state, NOW)
  const full = (await openAll()).data
  const local = await server.ssrLoadModule('/src/localStore.ts')
  const preview = await server.ssrLoadModule('/src/backupPreview.ts')
  const dom = new JSDOM('', { url: 'https://wealthline.test' })
  const savedGlobals = Object.fromEntries(['localStorage', 'navigator', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL
  let blob
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, task) => task() } } })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document })
    dom.window.HTMLAnchorElement.prototype.click = () => {}
    URL.createObjectURL = value => { blob = value; return 'blob:backup' }; URL.revokeObjectURL = () => {}
    local.downloadDataFile({ ...full, version: 15 })
    assert.equal(JSON.parse(await blob.text()).version, 16)
    const backup = new File([await blob.text()], 'backup.json')
    const parsed = await local.readDataFile(backup)
    assert.deepEqual(parsed.data.monthlyReviews, [review()])
    assert.deepEqual(records(parsed.data), records(full))
    assert.equal(preview.summarizeBackup(parsed.data, backup).counts.monthlyReviews, 1)
    const destination = await local.readLocalPreview()
    await local.replaceLocal(parsed.data, destination.version, () => true)
    assert.deepEqual((await local.loadLocal()).data, parsed.data)
    const updated = await local.saveLocal({ ...parsed.data, monthlyReviews: [] }, (await local.loadLocal()).raw)
    assert.equal(JSON.parse(updated).version, 16)
    await assert.rejects(local.saveLocal({ ...parsed.data, monthlyReviews: [{}] }, updated), /核對/)
    assert.equal((await local.loadLocal()).raw, updated)
    await assert.rejects(local.readDataFile(new File([drive.dataFile().text], 'raw-main.json')), /主檔/)
  } finally {
    URL.createObjectURL = create; URL.revokeObjectURL = revoke
    for (const [key, desc] of Object.entries(savedGlobals)) { if (desc) Object.defineProperty(globalThis, key, desc); else delete globalThis[key] }
    dom.window.close()
  }
})
test('another device review save conflicts before writes; part failure never certifies unsaved review', async () => {
  await splitFixture()
  const storage = await store()
  const first = await storage.loadDrive(token, model.parseWealthData), other = await storage.loadDrive(token, model.parseWealthData)
  await storage.saveDrive(token, { ...other.data, monthlyReviews: [review()] }, other.state, NOW)
  const from = drive.log.length
  await assert.rejects(storage.saveDrive(token, { ...first.data, monthlyReviews: [] }, first.state, NOW), /其他裝置/)
  assert.equal(writes(from).length, 0)
  const all = await openAll()
  drive.fail(file => file?.appProperties.part === 'ledger-2026-Q1', 503)
  await assert.rejects(storage.saveDrive(token, { ...all.data, monthlyReviews: [], expenses: all.data.expenses.map(e => ({ ...e, amount: 99 })) }, all.state, NOW), /503/)
  const reload = await openAll()
  assert.deepEqual(reload.data.monthlyReviews, [review()])
  assert.deepEqual(records(reload.data), records(model.parseWealthData(fixture())))
})
test('review edits made during a held Drive save survive finishSave', async () => {
  await splitFixture()
  const storage = await store(), save = await server.ssrLoadModule('/src/saveState.ts')
  const loaded = await storage.loadDrive(token, model.parseWealthData)
  const submitted = { ...loaded.data, monthlyReviews: [review()] }
  drive.hold(file => file.appProperties.weWealth === 'data')
  const saving = storage.saveDrive(token, submitted, loaded.state, NOW)
  for (let i = 0; !drive.heldCount && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1))
  assert.equal(drive.heldCount, 1)
  const current = { ...submitted, monthlyReviews: [{ ...review(), confirmations: [confirmation()] }] }
  await drive.release()
  const persisted = await saving
  const result = save.finishSave(current, submitted, persisted)
  assert.deepEqual(result.monthlyReviews, current.monthlyReviews)
  assert.equal(result.version, 16)
  assert.deepEqual(drive.main().monthlyReviews, submitted.monthlyReviews)
})
test('malformed reviews fail before Drive writes and legacy versions load without migration writes', async () => {
  const storage = await store()
  for (let v = 1; v <= 15; v++) {
    setup().seed({ ...model.emptyData(), version: v, ...(v === 10 && { expenses: [] }) })
    const loaded = await storage.loadDrive(token, model.parseWealthData)
    assert.equal(loaded.data.version, v)
    assert.equal(loaded.data.monthlyReviews, undefined)
    assert.equal(writes(0).length, 0)
  }
  await splitFixture()
  const loaded = await storage.loadDrive(token, model.parseWealthData)
  const from = drive.log.length
  await assert.rejects(storage.saveDrive(token, { ...loaded.data, monthlyReviews: [{}] }, loaded.state, NOW), /核對/)
  assert.equal(writes(from).length, 0)
  assert.throws(() => model.parseWealthData({ ...model.emptyData(), version: 18 }), /不支援的版本/)
})

test('source bound covers the union of expected and historical confirmations; sparse reviews are invalid', async () => {
  const { parseMonthlyReviews } = await server.ssrLoadModule('/src/monthlyReview.ts')
  const expectedSources = Array.from({ length: 200 }, (_, i) => ({ kind: 'card', card: `Card${i}` }))
  assert.throws(() => parseMonthlyReviews([{ ...review(), expectedSources, confirmations: [confirmation()] }]), /核對/)
  assert.throws(() => parseMonthlyReviews(new Array(1)), /核對/)
})


test('v16 final main 412 after a successful ledger write restores prior reviews and every record', async () => {
  await splitFixture()
  const storage = await store()
  let loaded = await openAll()
  await storage.saveDrive(token, { ...loaded.data, monthlyReviews: [review()] }, loaded.state, NOW)
  loaded = await openAll()
  const before = records(loaded.data), from = drive.log.length
  drive.fail(file => file?.appProperties.weWealth === 'data', 412)
  await assert.rejects(storage.saveDrive(token, { ...loaded.data, monthlyReviews: [], expenses: loaded.data.expenses.map(e => ({ ...e, amount: e.amount + 1 })) }, loaded.state, NOW), /其他裝置/)
  const partWrites = drive.log.slice(from).filter(r => r.method === 'PUT' && !r.url.includes('/' + drive.dataFile().id + '?'))
  assert.ok(partWrites.length >= 2, 'part write and rollback both occur before reload')
  const reloaded = await openAll()
  assert.equal(reloaded.data.version, 16)
  assert.deepEqual(reloaded.data.monthlyReviews, [review()])
  assert.deepEqual(records(reloaded.data), before)
})
