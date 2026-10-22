import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { createServer } from 'vite'
import { createFakeDrive } from './helpers/fake-drive.mjs'

// The bank page loads only the recent transaction parts (driveStore.ts readGroup `only`). A save
// from data that holds some parts must keep every record of the parts it does not hold.

let server, store, model, cashflow
const token = { value: 'test-token', expiresAt: Date.now() + 3600_000 }
const originalFetch = globalThis.fetch
let drive
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  store = await server.ssrLoadModule('/src/google/driveStore.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  cashflow = await server.ssrLoadModule('/src/cashflow.ts')
})
afterEach(() => { globalThis.fetch = originalFetch })
after(() => server.close())

const NOW = '2026-10-12T04:00:00.000Z'
const LATER = '2026-10-12T05:00:00.000Z'
const tx = (id, date, amount = 5, accountId = 'acct') => ({ id, accountId, date, description: `Transfer ${id}`, currency: 'TWD', direction: 'debit', amount })
const expense = (id, date, amount = 10) => ({ id, date, description: `Shop ${id}`, amount, currency: 'TWD', card: 'Card' })
const base = (ledger) => ({
  ...model.emptyData(),
  version: 13,
  updatedAt: NOW,
  fxRates: { USD: 32 },
  bankTransactionAccounts: [{ id: 'acct', label: 'Main', bank: 'Bank' }, { id: 'old', label: 'Old', bank: 'Bank' }],
  bankCategoryRules: [],
  expenses: [],
  bankTransactions: [],
  ...ledger,
})

// Puts `data` on a fresh fake Drive as split files.
async function splitOnDrive(data) {
  drive = createFakeDrive()
  drive.seed(data)
  globalThis.fetch = drive.fetch
  const opened = await store.loadDrive(token, model.parseWealthData)
  await store.saveDrive(token, opened.data, opened.state, NOW)
}
// Opens the data and reads the transaction parts from `from` on, as the bank page does.
async function openFrom(from) {
  const { data, state } = await store.loadDrive(token, model.parseWealthData)
  const only = [...state.parts.keys()].filter((name) => name.startsWith('ledger-') && name >= from)
  return { data: store.mergeParts(data, await store.readGroup(token, state, 'ledger', only), model.parseWealthData), state }
}
async function openAll() {
  const { data, state } = await store.loadDrive(token, model.parseWealthData)
  return { data: store.mergeParts(data, await store.readGroup(token, state, 'ledger'), model.parseWealthData), state }
}
const ids = (rows) => rows.map((r) => r.id).sort()
const sorted = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
const partReads = (from = 0) => drive.log.slice(from).filter((r) => r.method === 'GET' && r.url.includes('alt=media')).map((r) => drive.files.get(r.url.match(/files\/([^?]+)/)[1]).appProperties.part ?? 'main')
const partWrites = (from = 0) => drive.log.slice(from).filter((r) => r.method === 'PUT' || (r.method === 'POST' && r.url.includes('upload'))).map((r) => r.method === 'POST' ? 'create' : drive.files.get(r.url.match(/files\/([^?]+)/)[1]).appProperties.part ?? 'main')
// Totals per month and currency, to compare the summary with the records.
const totals = (months) => Object.fromEntries(months.map((m) => [`${m.month} ${m.currency}`, [m.totals.consumption, m.totals.pending.count, m.coverage.bankCount]]).sort())

test('the bank page reads only the parts it asks for, and the scope says what is not loaded', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2025-02-01'), tx('b', '2025-05-01'), tx('c', '2026-08-01'), tx('d', '2026-10-01')], expenses: [expense('e', '2025-11-01')] }))
  assert.equal(store.recentLedgerFrom((await store.loadDrive(token, model.parseWealthData)).state, '2026-10-13'), 'ledger-2026-Q3')
  const from = drive.log.length
  const { data, state } = await openFrom('ledger-2026-Q3')
  assert.deepEqual([...new Set(partReads(from).filter((n) => n !== 'main'))].sort(), ['ledger-2026-Q3', 'ledger-2026-Q4'])
  assert.deepEqual(ids(data.bankTransactions), ['c', 'd'])
  const scope = store.ledgerScope(state, data)
  assert.deepEqual(scope, { next: 'ledger-2025-Q4', from: '2026-01', earlier: { rows: 2, pending: 2 }, months: ['2025-02', '2025-05'] })
  // The overview counts the loaded months from the records and the rest from the summary.
  assert.deepEqual(totals(store.ledgerCashflow(state, data)), totals(cashflow.cashflowMonths({ expenses: [expense('e', '2025-11-01')], bankTransactions: [tx('a', '2025-02-01'), tx('b', '2025-05-01'), tx('c', '2026-08-01'), tx('d', '2026-10-01')] })))
})

test('the first quarters read are the last three months, or the newest stored part when nothing is that recent', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2024-02-01'), tx('b', '2025-05-01')] }))
  const { state } = await store.loadDrive(token, model.parseWealthData)
  assert.equal(store.recentLedgerFrom(state, '2026-10-13'), 'ledger-2025-Q2')
  assert.equal(store.recentLedgerFrom(state, '2025-07-02'), 'ledger-2025-Q2')
  assert.equal(store.recentLedgerFrom(state, '2025-02-28'), 'ledger-2024-Q4')
  assert.equal(store.recentLedgerFrom(store.emptyDriveState(), '2026-01-31'), 'ledger-2025-Q4')
})

test('a save from partly loaded data writes only what changed and keeps every earlier record', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2025-02-01'), tx('b', '2025-05-01'), tx('c', '2026-08-01')], expenses: [expense('e', '2025-02-10')] }))
  const { data, state } = await openFrom('ledger-2026-Q3')
  const before = new Map([...drive.files.values()].map((f) => [f.appProperties.part, f.text]))
  const from = drive.log.length
  await store.saveDrive(token, { ...data, updatedAt: LATER, bankTransactions: [{ ...data.bankTransactions[0], amount: 7 }, tx('n', '2026-09-01')] }, state, LATER)
  assert.deepEqual(partWrites(from), ['ledger-2026-Q3', 'main'])
  for (const name of ['ledger-2025-Q1', 'ledger-2025-Q2']) assert.equal([...drive.files.values()].find((f) => f.appProperties.part === name).text, before.get(name))
  const all = await openAll()
  assert.deepEqual(sorted(all.data.bankTransactions), sorted([tx('a', '2025-02-01'), tx('b', '2025-05-01'), tx('c', '2026-08-01', 7), tx('n', '2026-09-01')]))
  assert.deepEqual(ids(all.data.expenses), ['e'])
})

test('a record moved into a quarter not loaded joins the records already there, once', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2025-02-01'), tx('c', '2026-08-01'), tx('d', '2026-08-02')] }))
  const { data, state } = await openFrom('ledger-2026-Q3')
  const saved = await store.saveDrive(token, { ...data, updatedAt: LATER, bankTransactions: data.bankTransactions.map((r) => r.id === 'c' ? { ...r, date: '2025-03-01' } : r) }, state, LATER)
  // The record stays with the data that moved it; the part it went to is not held yet.
  assert.deepEqual(store.missingParts(state, saved, 'ledger'), ['ledger-2025-Q1'])
  const all = await openAll()
  assert.deepEqual(sorted(all.data.bankTransactions), sorted([tx('a', '2025-02-01'), { ...tx('c', '2026-08-01'), date: '2025-03-01' }, tx('d', '2026-08-02')]))
  assert.deepEqual(totals(store.ledgerCashflow(all.state, model.emptyData())), totals(cashflow.cashflowMonths({ bankTransactions: all.data.bankTransactions })))
})

test('a changed rule recounts the summary of the quarters not loaded', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2025-02-01'), tx('c', '2026-08-01')] }))
  const { data, state } = await openFrom('ledger-2026-Q3')
  await store.saveDrive(token, { ...data, updatedAt: LATER, bankCategoryRules: [{ keyword: 'Transfer', target: { kind: 'excluded', reason: '信用卡繳款' } }] }, state, LATER)
  const reopened = await store.loadDrive(token, model.parseWealthData)
  const january = store.ledgerCashflow(reopened.state, model.emptyData()).find((m) => m.month === '2025-02')
  assert.equal(january.totals.pending.count, 0)
  assert.equal(january.totals.excluded.count, 1)
})

test('loading earlier parts keeps edits not saved yet', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2025-02-01'), tx('c', '2026-08-01')] }))
  const { data, state } = await openFrom('ledger-2026-Q3')
  // Moved into the first quarter and saved, then edited again before that quarter is loaded.
  const saved = await store.saveDrive(token, { ...data, updatedAt: LATER, bankTransactions: [{ ...data.bankTransactions[0], date: '2025-03-01' }] }, state, LATER)
  const edited = { ...saved, bankTransactions: [{ ...saved.bankTransactions[0], amount: 99 }] }
  const parts = await store.readGroup(token, state, 'ledger', store.missingParts(state, edited, 'ledger'))
  assert.deepEqual(sorted(store.mergeParts(edited, parts, model.parseWealthData, saved).bankTransactions), sorted([tx('a', '2025-02-01'), { ...tx('c', '2025-03-01', 99) }]))
  // Without edits the stored copy is used.
  assert.deepEqual(sorted(store.mergeParts(saved, parts, model.parseWealthData, saved).bankTransactions), sorted([tx('a', '2025-02-01'), tx('c', '2025-03-01')]))
})

test('a record left in two parts by an interrupted move keeps its newer copy when the older part loads later', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2025-02-01'), tx('c', '2026-08-01')] }))
  // Like a save that moved c from 2025 Q1 to 2026 Q3 and stopped before rewriting Q1.
  const q1 = [...drive.files.values()].find((f) => f.appProperties.part === 'ledger-2025-Q1')
  q1.text = q1.text.replace(/"sequence": \d+/, '"sequence": 0').replace(/("bankTransactions": \[\n)/, `$1    ${JSON.stringify(tx('c', '2025-01-15', 1))},\n`)
  q1.version++
  const { data, state } = await openFrom('ledger-2026-Q3')
  const full = store.mergeParts(data, await store.readGroup(token, state, 'ledger', ['ledger-2025-Q1']), model.parseWealthData)
  assert.deepEqual(sorted(full.bankTransactions), sorted([tx('a', '2025-02-01'), tx('c', '2026-08-01')]))
})

test('a save that adds to a quarter not loaded does not make an older copy of a record there the newest', async () => {
  await splitOnDrive(base({ bankTransactions: [tx('a', '2025-02-01'), tx('c', '2026-08-01')] }))
  const q1 = [...drive.files.values()].find((f) => f.appProperties.part === 'ledger-2025-Q1')
  q1.text = q1.text.replace(/"sequence": \d+/, '"sequence": 0').replace(/("bankTransactions": \[\n)/, `$1    ${JSON.stringify(tx('c', '2025-01-15', 1))},\n`)
  q1.version++
  const { data, state } = await openFrom('ledger-2026-Q3')
  await store.saveDrive(token, { ...data, updatedAt: LATER, bankTransactions: [...data.bankTransactions, tx('n', '2025-01-20')] }, state, LATER)
  const all = await openAll()
  assert.deepEqual(sorted(all.data.bankTransactions), sorted([tx('a', '2025-02-01'), tx('c', '2026-08-01'), tx('n', '2025-01-20')]))
})

// Random edits on partly loaded data, saved twice like the app does (a record moved into a
// quarter not loaded makes the app load that quarter), must match the same edits on all records.
test('random edits saved from partly loaded data keep every record', async () => {
  let seed = 7
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const quarters = ['2025-01', '2025-04', '2025-07', '2025-10', '2026-01', '2026-04', '2026-07', '2026-10']
  const date = () => `${pick(quarters).slice(0, 5)}${String(Number(pick(quarters).slice(5)) + Math.floor(random() * 3)).padStart(2, '0')}-${String(1 + Math.floor(random() * 28)).padStart(2, '0')}`
  let next = 0
  for (let round = 0; round < 25; round++) {
    const rows = Array.from({ length: 12 }, (_, i) => tx(`r${round}-${i}`, date(), 1 + i))
    const expenses = Array.from({ length: 6 }, (_, i) => expense(`x${round}-${i}`, date(), 1 + i))
    await splitOnDrive(base({ bankTransactions: rows, expenses }))
    let expected = { bankTransactions: rows, expenses }
    const from = `ledger-${pick(quarters).slice(0, 4)}-Q${1 + Math.floor(random() * 4)}`
    let { data, state } = await openFrom(from)
    for (let save = 0; save < 2; save++) {
      // Edits only touch records the data holds, as on the bank page.
      const edits = { bankTransactions: [...data.bankTransactions], expenses: [...data.expenses] }
      for (let i = 0; i < 4; i++) {
        const key = random() < 0.7 ? 'bankTransactions' : 'expenses'
        const list = edits[key]
        const kind = pick(['amount', 'move', 'delete', 'add'])
        if (kind === 'add' || !list.length) list.push(key === 'expenses' ? expense(`new${next++}`, date(), 3) : tx(`new${next++}`, date(), 3))
        else {
          const at = Math.floor(random() * list.length)
          if (kind === 'delete') list.splice(at, 1)
          else list[at] = kind === 'amount' ? { ...list[at], amount: list[at].amount + 100 } : { ...list[at], date: date() }
        }
      }
      for (const key of ['bankTransactions', 'expenses']) {
        const changed = new Map(edits[key].map((r) => [r.id, r]))
        const held = new Set(data[key].map((r) => r.id))
        expected[key] = [...expected[key].filter((r) => !held.has(r.id)), ...changed.values()]
      }
      const saved = await store.saveDrive(token, { ...data, ...edits, updatedAt: LATER }, state, LATER)
      // The app then loads the parts of records dated in a quarter not loaded.
      const dated = new Set([...saved.bankTransactions, ...saved.expenses].map((r) => `ledger-${r.date.slice(0, 4)}-Q${Math.floor((Number(r.date.slice(5, 7)) - 1) / 3) + 1}`))
      const stray = store.missingParts(state, saved, 'ledger').filter((name) => dated.has(name))
      data = store.mergeParts(saved, await store.readGroup(token, state, 'ledger', stray), model.parseWealthData, saved)
    }
    const all = await openAll()
    assert.deepEqual(sorted(all.data.bankTransactions), sorted(expected.bankTransactions), `round ${round} from ${from}`)
    assert.deepEqual(sorted(all.data.expenses), sorted(expected.expenses), `round ${round} from ${from}`)
    const reopened = await store.loadDrive(token, model.parseWealthData)
    assert.deepEqual(totals(store.ledgerCashflow(reopened.state, model.emptyData())), totals(cashflow.cashflowMonths({ expenses: expected.expenses, bankTransactions: expected.bankTransactions })), `round ${round} summary`)
  }
})


test('v16 monthly reviews survive a partial bank save and complete reload without rewriting older quarters', async () => {
  const monthlyReviews = [{month:'2025-02',expectedSources:[{kind:'bank',accountId:'acct'}],confirmations:[]}]
  await splitOnDrive(base({version:16,monthlyReviews,bankTransactions:[tx('old','2025-02-01'),tx('recent','2026-08-01')]}))
  const {data,state} = await openFrom('ledger-2026-Q3')
  assert.equal(data.version,16)
  assert.deepEqual(data.monthlyReviews,monthlyReviews)
  const from = drive.log.length
  const saved = await store.saveDrive(token,{...data,bankTransactions:[{...data.bankTransactions[0],amount:19}]},state,LATER)
  assert.equal(saved.version,16)
  assert.deepEqual(partWrites(from),['ledger-2026-Q3','main'])
  assert.deepEqual(store.missingParts(state,saved,'ledger'),['ledger-2025-Q1'])
  const full = await openAll()
  assert.equal(full.data.version,16)
  assert.deepEqual(full.data.monthlyReviews,monthlyReviews)
  assert.deepEqual(sorted(full.data.bankTransactions),sorted([tx('old','2025-02-01'),tx('recent','2026-08-01',19)]))
})
