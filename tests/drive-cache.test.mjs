import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { createHash } from 'node:crypto'
import { createFakeDrive } from './helpers/fake-drive.mjs'
import { createFakeIndexedDB } from './helpers/fake-indexeddb.mjs'

let server, cache, store, model
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const originalFetch = globalThis.fetch

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  cache = await server.ssrLoadModule('/src/google/driveCache.ts')
  store = await server.ssrLoadModule('/src/google/driveStore.ts')
  model = await server.ssrLoadModule('/src/model.ts')
})

beforeEach(() => {
  globalThis.indexedDB = createFakeIndexedDB().indexedDB
})

afterEach(() => {
  globalThis.fetch = originalFetch
  delete globalThis.indexedDB
})

after(() => server.close())

test('encrypted drive cache stores ciphertext only, checks md5, and expires after 30 days', async () => {
  const scope = 'google:sub-1'
  const now = 1_700_000_000_000
  const secretText = '{"secretAccount":"12345"}'
  await cache.putCachedFile(scope, 'f1', 'md5-a', '"e1"', secretText, now)

  const hit = await cache.getCachedFile(scope, 'f1', 'md5-a', now + 1000)
  assert.deepEqual(hit, { etag: '"e1"', text: secretText })

  // Different md5 or different scope misses.
  assert.equal(await cache.getCachedFile(scope, 'f1', 'md5-b', now + 1000), null)
  assert.equal(await cache.getCachedFile('google:sub-2', 'f1', 'md5-a', now + 1000), null)

  // Expired after 30 days.
  assert.equal(await cache.getCachedFile(scope, 'f1', 'md5-a', now + cache.CACHE_TTL_MS), null)

  // Prune removes expired entries while keeping fresh ones.
  await cache.putCachedFile(scope, 'f-old', 'md5-old', '"e-old"', 'old', now)
  await cache.putCachedFile(scope, 'f-fresh', 'md5-fresh', '"e-fresh"', 'fresh', now + cache.CACHE_TTL_MS - 1000)
  await cache.pruneDriveCache(scope, now + cache.CACHE_TTL_MS)
  assert.equal(await cache.getCachedFile(scope, 'f-old', 'md5-old', now + cache.CACHE_TTL_MS), null)
  assert.deepEqual(await cache.getCachedFile(scope, 'f-fresh', 'md5-fresh', now + cache.CACHE_TTL_MS), { etag: '"e-fresh"', text: 'fresh' })
})

test('loadDrive and readGroup skip alt=media downloads when md5 matches encrypted cache, and re-download on md5 change', async () => {
  const drive = createFakeDrive()
  globalThis.fetch = drive.fetch
  const scope = 'google:user-1'
  const NOW = '2026-10-12T04:00:00.000Z'
  const data = model.parseWealthData({
    ...model.emptyData(),
    version: 13,
    updatedAt: NOW,
    expenses: [{ id: 'e1', date: '2026-01-05', description: 'Shop', amount: 10, currency: 'TWD', card: 'Card' }],
    history: { changes: [], liabilityChanges: [], snapshots: [{ date: '2025-06-01', at: '2025-06-01T04:00:00.000Z', total: 100, accounts: [], categories: {} }] },
  })
  await store.saveDrive(token, data, { ...store.emptyDriveState(), cacheScope: scope }, NOW)

  // First open with cache populated from saveDrive -> 0 alt=media downloads!
  const before = drive.log.length
  const opened = await store.loadDrive(token, model.parseWealthData, [], scope)
  await store.readGroup(token, opened.state, 'ledger')
  await store.readGroup(token, opened.state, 'history')
  const mediaReads = drive.log.slice(before).filter((r) => r.method === 'GET' && r.url.includes('alt=media'))
  assert.equal(mediaReads.length, 0)

  // Simulate another device modifying the ledger part on Drive (new md5).
  const part = drive.part('ledger-2026-Q1')
  part.text = part.text.replace('"amount":10', '"amount":25')
  part.version += 1
  part.md5Checksum = createHash('md5').update(part.text).digest('hex')

  const afterChange = drive.log.length
  const reopened = await store.loadDrive(token, model.parseWealthData, [], scope)
  const ledgerParts = await store.readGroup(token, reopened.state, 'ledger')
  assert.equal(ledgerParts[0].content.expenses[0].amount, 25)
  const mediaReadsAfter = drive.log.slice(afterChange).filter((r) => r.method === 'GET' && r.url.includes('alt=media'))
  assert.equal(mediaReadsAfter.length, 1)
})
