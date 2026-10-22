import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
let server, model, history, statements, ledgerEdits
before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;[model, history, statements, ledgerEdits] = await Promise.all(['model', 'history', 'bankStatementAssets', 'ledgerEdits'].map((n) => server.ssrLoadModule(`/src/${n}.ts`)))
})
after(() => server.close())

// Synthetic data only: a first bank import into a file with no asset accounts.
const now = '2026-10-14T12:00:00Z'
const ledger = { id: 'ledger-taishin', label: '台新銀行', bank: 'Taishin' }
const balance = (date, quantity, hash, currency = 'TWD') => ({ bank: 'Taishin', date, currency, quantity, fileHash: hash.repeat(64), ledgerAccountId: ledger.id })
const empty = () => ({ ...model.emptyData(), bankTransactionAccounts: [ledger] })

test('reproduces the bug: imported balances fill history but leave no account and a 0 total today', () => {
  const data = statements.importStatementBalances(empty(), [balance('2026-08-31', 650000, 'a'), balance('2026-09-30', 700000, 'b')], now).data
  assert.equal(data.accounts.length, 0)
  assert.equal(history.snapshotOf(data, now).total, 0)
  assert.equal(data.history.quantityDays.at(-1).entries[0].accountId, ledger.id)
})

test('the missing account is created under the id its history uses, with each currency\'s newest balance', () => {
  const imported = statements.importStatementBalances(empty(), [balance('2026-08-31', 650000, 'a'), balance('2026-09-30', 700000, 'b'), balance('2026-08-31', 1200, 'c', 'USD')], now).data
  assert.deepEqual(statements.missingStatementAssets(imported), [{ accountId: ledger.id, bank: 'Taishin', label: '台新銀行 (TW)', balances: [{ currency: 'TWD', quantity: 700000, date: '2026-09-30' }, { currency: 'USD', quantity: 1200, date: '2026-08-31' }] }])
  const data = { ...statements.createStatementAssets(imported), fxRates: { USD: 32 } }
  assert.equal(data.accounts.length, 1)
  const [account] = data.accounts
  assert.deepEqual({ ...account, positions: account.positions.map(({ id: _id, ...p }) => p) }, { id: ledger.id, name: '台新銀行', kind: 'bank', country: 'TW', category: '現金與外幣活存', positions: [{ type: 'cash', currency: 'TWD', symbol: '', quantity: 700000, price: 1 }, { type: 'cash', currency: 'USD', symbol: '', quantity: 1200, price: 1 }] })
  assert.equal(history.snapshotOf(data, now).total, 700000 + 1200 * 32)
  assert.deepEqual(statements.missingStatementAssets(data), [])
  assert.equal(statements.createStatementAssets(data), data)
  // The saved file keeps the account, and the history entries still point at it.
  const parsed = model.parseWealthData(JSON.parse(JSON.stringify(data)))
  assert.equal(parsed.accounts[0].id, parsed.history.quantityDays.at(-1).entries[0].accountId)
})

test('a later statement maps to the created account instead of failing or duplicating it', () => {
  const first = statements.createStatementAssets(statements.importStatementBalances(empty(), [balance('2026-08-31', 650000, 'a')], now).data)
  const next = statements.importStatementBalances(first, [balance('2026-09-30', 700000, 'b')], now).data
  assert.equal(next.accounts.length, 1)
  assert.deepEqual(next.history.quantityDays.map((d) => d.entries[0].accountId), [ledger.id, ledger.id])
  // The import leaves today's balance to the user; history gets the new closing balance.
  assert.equal(next.accounts[0].positions[0].quantity, 650000)
})

test('a same-named asset account under another id is not duplicated', () => {
  const imported = statements.importStatementBalances(empty(), [balance('2026-09-30', 700000, 'a')], now).data
  const manual = { ...imported, accounts: [{ id: 'mine', name: '台新銀行', kind: 'bank', country: 'TW', category: '現金與外幣活存', positions: [] }] }
  assert.deepEqual(statements.missingStatementAssets(manual), [])
  assert.equal(statements.createStatementAssets(manual), manual)
})

test('the ledger import creates accounts only when asked, and only for its own banks', () => {
  const dbs = { id: 'ledger-dbs', label: 'DBS', bank: 'DBS Singapore' }
  const start = { ...empty(), bankTransactionAccounts: [ledger, dbs] }
  const older = ledgerEdits.applyBankLedger(start, { balances: [{ bank: 'DBS Singapore', date: '2026-08-31', currency: 'SGD', quantity: 100, fileHash: 'd'.repeat(64), ledgerAccountId: dbs.id }], balanceRevision: statements.statementBalanceRevision(start) })
  assert.equal(older.accounts.length, 0)
  const patch = { balances: [balance('2026-09-30', 700000, 'b')], balanceRevision: statements.statementBalanceRevision(older) }
  assert.equal(ledgerEdits.applyBankLedger(older, patch).accounts.length, 0)
  const created = ledgerEdits.applyBankLedger(older, { ...patch, createAssets: true })
  assert.deepEqual(created.accounts.map((a) => a.id), [ledger.id])
  // Re-importing the same statement skips the balance but still creates the account.
  const once = ledgerEdits.applyBankLedger(older, patch)
  const again = ledgerEdits.applyBankLedger(once, { balances: patch.balances, balanceRevision: statements.statementBalanceRevision(once), createAssets: true })
  assert.deepEqual(again.accounts.map((a) => a.id), [ledger.id])
})

test('a newer statement can update the current balance, unless the user changed it after the statement date', () => {
  const created = statements.createStatementAssets(statements.importStatementBalances(empty(), [balance('2026-08-31', 650000, 'a')], now).data)
  // Saved on 09/05, which records when the balance was added.
  const first = { ...created, accounts: created.accounts.map((a) => ({ ...a, positions: a.positions.map((p) => ({ ...p, addedAt: '2026-09-05T03:00:00.000Z' })) })) }
  const patch = (data, ...balances) => ({ balances, balanceRevision: statements.statementBalanceRevision(data) })
  const sep = patch(first, balance('2026-09-30', 700000, 'b'), balance('2026-09-30', 300, 'b', 'USD'), balance('2026-08-31', 690000, 'e'))
  const imported = statements.importStatementBalances(first, sep.balances, now).data
  // The newest statement per currency; a currency the account lacks is added.
  assert.deepEqual(statements.statementAssetUpdates(imported, sep.balances), [
    { accountId: ledger.id, label: '台新銀行 (TW)', currency: 'TWD', date: '2026-09-30', before: 650000, after: 700000 },
    { accountId: ledger.id, label: '台新銀行 (TW)', currency: 'USD', date: '2026-09-30', before: null, after: 300 },
  ])
  assert.deepEqual(ledgerEdits.applyBankLedger(first, sep).accounts[0].positions.map((p) => p.quantity), [650000], 'not asked: today is left alone')
  const updated = ledgerEdits.applyBankLedger(first, { ...sep, updateAssets: true })
  assert.deepEqual(updated.accounts[0].positions.map((p) => [p.currency, p.quantity]), [['TWD', 700000], ['USD', 300]])
  assert.equal(updated.accounts[0].positions[0].id, first.accounts[0].positions[0].id, 'the same position, so the change log shows an edit')
  assert.deepEqual(statements.statementAssetUpdates(statements.importStatementBalances(updated, sep.balances, now).data, sep.balances), [], 'nothing left to update')

  // Edited by hand on 10/05: a September statement no longer updates it, an October one does.
  const edited = { ...first, history: { ...first.history, changes: [{ at: '2026-10-05T03:00:00.000Z', accountId: ledger.id, account: '台新銀行', type: 'cash', symbol: 'TWD', currency: 'TWD', before: { quantity: 650000, price: 1 }, after: { quantity: 640000, price: 1 } }] }, accounts: first.accounts.map((a) => ({ ...a, positions: a.positions.map((p) => ({ ...p, quantity: 640000 })) })) }
  const late = patch(edited, balance('2026-09-30', 700000, 'b'))
  assert.deepEqual(statements.statementAssetUpdates(statements.importStatementBalances(edited, late.balances, now).data, late.balances), [])
  const oct = patch(edited, balance('2026-10-10', 710000, 'c'))
  assert.deepEqual(statements.statementAssetUpdates(statements.importStatementBalances(edited, oct.balances, now).data, oct.balances).map((u) => u.after), [710000])
  // Two balances in one currency: which one is meant is the user's call.
  const split = { ...first, accounts: first.accounts.map((a) => ({ ...a, positions: [...a.positions, { ...a.positions[0], id: 'second' }] })) }
  assert.deepEqual(statements.statementAssetUpdates(statements.importStatementBalances(split, sep.balances, now).data, sep.balances).map((u) => u.currency), ['USD'])
  // Saved before added dates were kept, with no change logged: when its balances were set is unknown, so nothing is offered.
  assert.deepEqual(statements.statementAssetUpdates(statements.importStatementBalances(created, sep.balances, now).data, sep.balances), [])
  // No asset account yet: that is createAssets' job.
  const none = statements.importStatementBalances(empty(), sep.balances, now).data
  assert.deepEqual(statements.statementAssetUpdates(none, sep.balances), [])
})
