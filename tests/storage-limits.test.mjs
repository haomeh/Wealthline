import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { createServer } from 'vite'

// The size limit for one stored data file: Drive's simple and multipart uploads are
// documented for files of 5 MB or less, so oversized writes stop before any request.

let server, limits, drive, model
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const originalFetch = globalThis.fetch
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  limits = await server.ssrLoadModule('/src/storageLimits.ts')
  drive = await server.ssrLoadModule('/src/google/drive.ts')
  model = await server.ssrLoadModule('/src/model.ts')
})
afterEach(() => { globalThis.fetch = originalFetch })
after(() => server.close())

// Data whose Drive file (indented JSON) is about `bytes` long.
const dataOfSize = (bytes) => {
  const description = 'X'.repeat(400)
  const one = limits.byteSize(limits.serializeData({ id: 'e-0000000', date: '2026-10-01', description, amount: 1, currency: 'TWD', card: 'Card' })) + 4
  const expenses = Array.from({ length: Math.ceil(bytes / one) }, (_, i) => ({ id: `e-${String(i).padStart(7, '0')}`, date: '2026-10-01', description, amount: 1, currency: 'TWD', card: 'Card' }))
  return { ...model.emptyData(), version: 10, expenses }
}

test('levels: ok up to 3 MB, warn up to 4.5 MB, block above', () => {
  const { MB } = limits
  assert.equal(limits.storageLevel(0), 'ok')
  assert.equal(limits.storageLevel(3 * MB), 'ok')
  assert.equal(limits.storageLevel(3 * MB + 1), 'warn')
  assert.equal(limits.storageLevel(4.5 * MB), 'warn')
  assert.equal(limits.storageLevel(4.5 * MB + 1), 'block')
})

test('sizes are UTF-8 bytes and read as KB or MB', () => {
  assert.equal(limits.byteSize('台新'), 6)
  assert.equal(limits.formatBytes(500), '500 B')
  assert.equal(limits.formatBytes(1536), '2 KB')
  assert.equal(limits.formatBytes(3.25 * limits.MB), '3.3 MB')
})

test('an oversized save is refused before any Drive request, on update and on first creation', async () => {
  const requests = []
  globalThis.fetch = async (url) => { requests.push(String(url)); throw new Error('no request expected') }
  const data = dataOfSize(limits.BLOCK_BYTES + 1024)
  await assert.rejects(() => drive.saveData(token, data, { fileId: 'f', etag: '"v1"' }), (e) => {
    assert.ok(e instanceof limits.DataTooLargeError)
    assert.match(e.message, /超過單一檔案 4\.5 MB 的上限/)
    assert.match(e.message, /原本的資料沒有變動/)
    return true
  })
  await assert.rejects(() => drive.saveData(token, data), limits.DataTooLargeError)
  assert.deepEqual(requests, [])
})

test('a file in the warning range still saves', async () => {
  let body = ''
  globalThis.fetch = async (url, init = {}) => {
    if (new URL(url).searchParams.has('q')) return Response.json({ files: [{ id: 'f' }] })
    assert.equal(init.method, 'PUT')
    body = init.body
    return Response.json({ id: 'f', etag: '"v2"' })
  }
  const data = dataOfSize(limits.WARN_BYTES + 64 * 1024)
  assert.deepEqual(await drive.saveData(token, data, { fileId: 'f', etag: '"v1"' }), { fileId: 'f', etag: '"v2"' })
  assert.equal(limits.storageLevel(limits.byteSize(body)), 'warn')
})
