import assert from 'node:assert/strict'
import { after, before, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { loadData, saveData } from './helpers/drive-data.mjs'

let server, drive, model, importer, saveState, history
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const originalFetch = globalThis.fetch
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  drive = await server.ssrLoadModule('/src/google/drive.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  importer = await server.ssrLoadModule('/src/importSheet.ts')
  saveState = await server.ssrLoadModule('/src/saveState.ts')
  history = await server.ssrLoadModule('/src/history.ts')
})
afterEach(() => { globalThis.fetch = originalFetch })
after(() => server.close())
const position = { id: 'p1', type: 'holding', symbol: 'AAPL', currency: 'USD', quantity: 10, price: 100, priceManual: true }
const fixture = () => ({ ...model.emptyData(), fxRates: { USD: 32 }, accounts: [
  { id: 'a1', name: 'Broker', kind: 'investment', country: 'US', category: '股票', positions: [{ ...position }] },
] })
const row = (currency = 'USD', quantity = '10', price = '1', rate = '32', name = 'Broker') => [name, '現金', '', currency, quantity, price, '', rate].join('\t')

test('two devices using the same loaded ETag: only one conditional write succeeds', async () => {
  let etag = '"v1"', content = fixture(), writes = 0
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'PUT') {
      assert.match(url, /upload\/drive\/v2\/files\/file-a/)
      assert.equal(init.headers.Authorization, 'Bearer test-token')
      if (init.headers['If-Match'] !== etag) return new Response('', { status: 412 })
      content = JSON.parse(init.body)
      etag = `"v${++writes + 1}"`
      return Response.json({ id: 'file-a', etag, headRevisionId: 'r1' })
    }
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'file-a' }] })
    if (new URL(url).searchParams.has('alt')) return Response.json(content)
    return Response.json({ id: 'file-a', etag, headRevisionId: 'r1' })
  }
  const a = await loadData(drive, token, model.parseWealthData)
  const b = await loadData(drive, token, model.parseWealthData)
  const result = await Promise.allSettled([
    saveData(drive, token, { ...a.data, fxRates: { USD: 33 } }, a),
    saveData(drive, token, { ...b.data, fxRates: { USD: 34 } }, b),
  ])
  assert.equal(result[0].status, 'fulfilled')
  assert.equal(result[1].status, 'rejected')
  assert.ok(result[1].reason instanceof drive.DriveConflictError)
  assert.equal(content.fxRates.USD, 33)
  assert.equal(writes, 1)
  const next = await saveData(drive, token, content, result[0].value)
  assert.equal(next.etag, '"v3"')
})

test('a write between metadata and media reads rejects an inconsistent snapshot', async () => {
  let reads = 0
  globalThis.fetch = async (url) => {
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'f' }] })
    if (new URL(url).searchParams.has('alt')) return Response.json(fixture())
    return Response.json({ id: 'f', etag: `"v${++reads}"`, headRevisionId: 'r1' })
  }
  await assert.rejects(() => loadData(drive, token, model.parseWealthData), drive.DriveConflictError)
})

test('missing or weak versions never fall back to unconditional writes', async () => {
  globalThis.fetch = async () => assert.fail('must fail before any request')
  for (const etag of [undefined, '', '*', 'W/"v1"']) {
    await assert.rejects(() => saveData(drive, token, fixture(), { fileId: 'f', etag }), /版本/)
  }
})

test('a lost write response cannot authorize a retry with a newer version', async () => {
  const original = { fileId: 'f', etag: '"v1"' }
  let committed = false
  globalThis.fetch = async (url, init) => {
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'f' }] })
    assert.equal(init.headers['If-Match'], '"v1"')
    if (committed) return new Response('', { status: 412 })
    committed = true
    throw new TypeError('connection lost after commit')
  }
  await assert.rejects(() => saveData(drive, token, fixture(), original), /connection lost/)
  await assert.rejects(() => saveData(drive, token, fixture(), original), drive.DriveConflictError)
})

test('first save refuses a newly discovered file and ambiguous files are not silently selected', async () => {
  globalThis.fetch = async (_url, init) => {
    assert.ok(!init.method)
    return Response.json({ files: [{ id: 'existing' }] })
  }
  await assert.rejects(() => saveData(drive, token, fixture()), drive.DriveConflictError)
  globalThis.fetch = async () => Response.json({ files: [{ id: 'a' }, { id: 'b' }] })
  await assert.rejects(() => loadData(drive, token, model.parseWealthData), /多個資料檔/)
})

test('concurrent first creation retains both files and refuses to pick a winner', async () => {
  let created = false
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      assert.match(init.body, /"visibility":"PRIVATE"/)
      assert.match(init.body, /"title":"wealthline-data.json"/)
      created = true
      return Response.json({ id: 'a', etag: '"v1"' })
    }
    const q = new URL(url).searchParams.get('q')
    if (q.includes("value='folder'")) return Response.json({ files: [{ id: 'folder' }] })
    return Response.json({ files: created ? [{ id: 'a' }, { id: 'b' }] : [] })
  }
  await assert.rejects(() => saveData(drive, token, fixture()), /多個資料檔/)
  assert.equal(created, true)
})

test('USDT and USDC import with their rates; existing IDs and unrelated accounts survive', () => {
  const before = fixture()
  before.accounts.push({ ...before.accounts[0], id: 'other', name: 'Other' })
  const result = importer.importSheet(before, [row('USDT'), row('USDC')].join('\n'))
  assert.equal(result.errors.length, 0)
  assert.deepEqual(result.data.accounts[0].positions.map((p) => p.currency), ['USDT', 'USDC'])
  assert.equal(result.data.fxRates.USDC, 32)
  assert.equal(result.data.accounts[0].id, 'a1')
  assert.equal(result.data.accounts[1], before.accounts[1])
  assert.equal(result.replaced[0], before.accounts[0])
  assert.equal(before.accounts[0].positions[0].symbol, 'AAPL')
  assert.doesNotThrow(() => model.parseWealthData(JSON.parse(JSON.stringify(result.data))))
})

test('any invalid row rejects the whole batch, preserving positions and rates', () => {
  for (const bad of [row('UNKNOWN'), row('USD', ''), row('USD', 'NaN'), row('USD', '10', '-2'), row('USD', '10', '1', 'Infinity'), row('USD', '10', '1', '0'), row('USD', '1e309'), row('USD', '1', '1', '33')]) {
    const before = fixture()
    const result = importer.importSheet(before, `${row()}\n${bad}`)
    assert.equal(result.data, before)
    assert.equal(result.errors[0].line, 2)
    assert.equal(before.accounts[0].positions[0].symbol, 'AAPL')
  }
})

test('duplicate existing account names block replacement; empty input is a no-op', () => {
  const before = fixture()
  before.accounts.push({ ...before.accounts[0], id: 'a2' })
  const result = importer.importSheet(before, row())
  assert.equal(result.data, before)
  assert.match(result.errors[0].message, /表格未提供國家/)
  assert.equal(importer.importSheet(before, '\n ').data, before)
})

test('mixed cash and holdings form an investment account regardless of row order', () => {
  const cash = row()
  const holding = row().replace('現金', '股票')
  for (const rows of [[cash, holding], [holding, cash]]) {
    assert.equal(importer.importSheet(fixture(), rows.join('\n')).data.accounts[0].kind, 'investment')
  }
})

test('save completion keeps new rates, holdings and history deletions while adding persisted stamps', () => {
  const submitted = fixture()
  const persisted = history.recordSave(null, submitted)
  assert.equal(saveState.finishSave(submitted, submitted, persisted), persisted)
  const current = { ...submitted, fxRates: { USD: 35 }, history: { changes: [], snapshots: [] },
    accounts: [{ ...submitted.accounts[0], positions: [{ ...position, quantity: 99 }] }] }
  const result = saveState.finishSave(current, submitted, persisted)
  assert.equal(result.fxRates.USD, 35)
  assert.equal(result.accounts[0].positions[0].quantity, 99)
  assert.equal(result.accounts[0].positions[0].addedAt, persisted.accounts[0].positions[0].addedAt)
  assert.equal(result.history, current.history)
  assert.equal(saveState.finishSave({ ...current, history: submitted.history }, submitted, persisted).history, persisted.history)
  const deleted = saveState.finishSave({ ...current, accounts: [] }, submitted, persisted)
  assert.deepEqual(deleted.accounts, [])
})

test('first save returns its own version without rereading and adopting another writer version', async () => {
  let created = false
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      created = true
      return Response.json({ id: 'new', etag: '"created"' })
    }
    const q = new URL(url).searchParams.get('q')
    assert.ok(q, 'no post-write metadata read allowed')
    return Response.json({ files: q.includes("value='folder'") ? [{ id: 'folder' }] : created ? [{ id: 'new' }] : [] })
  }
  assert.deepEqual(await saveData(drive, token, fixture()), { fileId: 'new', etag: '"created"' })
})

test('a successful write without an ETag fails closed; authorization errors remain errors', async () => {
  const version = { fileId: 'f', etag: '"v1"' }
  globalThis.fetch = async (url) => new URL(url).searchParams.has('q') ? Response.json({ files: [{ id: 'f' }] }) : Response.json({ id: 'f' })
  await assert.rejects(() => saveData(drive, token, fixture(), version), /版本/)
  globalThis.fetch = async () => new Response('unauthorized', { status: 401 })
  await assert.rejects(() => saveData(drive, token, fixture(), version), /401/)
})

test('content download is pinned to the revision from the same metadata response as the ETag', async () => {
  const data = fixture()
  globalThis.fetch = async (url) => {
    const query = new URL(url).searchParams
    if (query.has('q')) return Response.json({ files: [{ id: 'f' }] })
    if (query.has('alt')) {
      assert.equal(query.get('revisionId'), 'revision/with+characters')
      return Response.json(data)
    }
    assert.equal(query.get('fields'), 'id,etag,headRevisionId')
    return Response.json({ id: 'f', etag: '"v1"', headRevisionId: 'revision/with+characters' })
  }
  assert.deepEqual(await loadData(drive, token, (raw) => raw), { fileId: 'f', etag: '"v1"', data })
})

test('missing revision or failure of the final metadata read never returns mismatched data', async () => {
  let calls = 0
  globalThis.fetch = async (url) => {
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'f' }] })
    calls++
    return Response.json({ id: 'f', etag: '"v1"' })
  }
  await assert.rejects(() => loadData(drive, token, (raw) => raw), /資料內容的版本/)
  assert.equal(calls, 1)
  let reads = 0
  globalThis.fetch = async (url) => {
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'f' }] })
    if (new URL(url).searchParams.has('alt')) return Response.json(fixture())
    if (++reads === 2) throw new TypeError('metadata unavailable')
    return Response.json({ id: 'f', etag: '"v1"', headRevisionId: 'r1' })
  }
  await assert.rejects(() => loadData(drive, token, (raw) => raw), /metadata unavailable/)
})

test('an already-open session refuses writes when a duplicate data file appears', async () => {
  globalThis.fetch = async (_url, init) => {
    assert.ok(!init.method, 'no media write is permitted')
    return Response.json({ files: [{ id: 'f' }, { id: 'duplicate' }] })
  }
  await assert.rejects(() => saveData(drive, token, fixture(), { fileId: 'f', etag: '"v1"' }), /多個資料檔/)
})

test('truncated successful upload response does not trigger metadata adoption or unconditional retry', async () => {
  let uploads = 0
  globalThis.fetch = async (url, init = {}) => {
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'f' }] })
    assert.equal(init.method, 'PUT')
    assert.equal(init.headers['If-Match'], '"v1"')
    uploads++
    return uploads === 1 ? new Response('{"id":"f",') : new Response('', { status: 412 })
  }
  const loaded = { fileId: 'f', etag: '"v1"' }
  await assert.rejects(() => saveData(drive, token, fixture(), loaded), SyntaxError)
  assert.equal(uploads, 1)
  assert.equal(loaded.etag, '"v1"')
  await assert.rejects(() => saveData(drive, token, fixture(), loaded), drive.DriveConflictError)
})

test('creation followed by discovery failure retains remote file and refuses blind recreation', async () => {
  let created = false, failedDiscovery = false, uploads = 0
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST') {
      uploads++
      created = true
      return Response.json({ id: 'f', etag: '"v1"' })
    }
    const q = new URL(url).searchParams.get('q')
    if (q.includes("value='folder'")) return Response.json({ files: [{ id: 'folder' }] })
    if (created && !failedDiscovery) {
      failedDiscovery = true
      throw new TypeError('discovery failed after create')
    }
    return Response.json({ files: created ? [{ id: 'f' }] : [] })
  }
  await assert.rejects(() => saveData(drive, token, fixture()), /discovery failed after create/)
  await assert.rejects(() => saveData(drive, token, fixture()), drive.DriveConflictError)
  assert.equal(uploads, 1)
  assert.equal(created, true)
})


test('sheet account matching ignores case and whitespace and rejects ambiguous countries',()=>{
 const data=fixture()
 const imported=importer.importSheet(data,[row('USD','10','1','32',' broker '),row('USD','20','1','32','BROKER')].join('\n'))
 assert.equal(imported.errors.length,0);assert.equal(imported.data.accounts.length,1);assert.equal(imported.data.accounts[0].id,'a1');assert.equal(imported.data.accounts[0].positions.length,2)
 data.accounts.push({...data.accounts[0],id:'a2',country:'TW'})
 const blocked=importer.importSheet(data,row('USD','10','1','32','broker'))
 assert.equal(blocked.data,data);assert.match(blocked.errors[0].message,/表格未提供國家/)
})
