import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let server, routes

before(async () => {
  server = await createServer({ configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  routes = await server.ssrLoadModule('/src/routes.ts')
})
after(() => server.close())

test('each signed-in page has its own URL that parses back to the same page', () => {
  const pages = [
    [{ tab: 'overview' }, '/app'],
    [{ tab: 'accounts', page: 'list' }, '/accounts'],
    [{ tab: 'accounts', page: 'list', importing: true }, '/accounts/import'],
    [{ tab: 'accounts', page: 'new' }, '/accounts/new'],
    [{ tab: 'accounts', page: 'detail', id: 'a b/c' }, '/accounts/a%20b%2Fc'],
    [{ tab: 'accounts', page: 'edit', id: 'abc' }, '/accounts/abc/edit'],
    [{ tab: 'liabilities' }, '/liabilities'],
    [{ tab: 'cashflow' }, '/cashflow'],
    [{ tab: 'cashflow', importing: true }, '/cashflow/import'],
    [{ tab: 'more' }, '/more'],
    [{ tab: 'expenses' }, '/expenses'],
    [{ tab: 'expenses', importing: true }, '/expenses/import'],
    [{ tab: 'bank-transactions' }, '/bank-transactions'],
    [{ tab: 'bank-transactions', importing: true }, '/bank-transactions/import'],
    [{ tab: 'rates' }, '/rates'],
    [{ tab: 'history' }, '/history'],
    [{ tab: 'history', date: '2026-09-01' }, '/history/2026-09-01'],
  ]
  for (const [route, path] of pages) {
    assert.equal(routes.routePath(route), path)
    assert.deepEqual(routes.parseRoute(path), route)
  }
  for (const t of Object.keys(routes.TABS)) assert.equal(routes.parseRoute(routes.tabPath(t)).tab, t)
  // Every page appears in the sidebar exactly once.
  assert.deepEqual(routes.NAV_GROUPS.flatMap((g) => g.tabs).sort(), Object.keys(routes.TABS).filter((t) => t !== 'more').sort())
  assert.deepEqual(routes.MOBILE_TABS.flatMap((t) => t.pages).sort(), Object.keys(routes.TABS).sort())
})

test('unknown paths fall back to the overview', () => {
  for (const path of ['/nope', '/history/x', '/history/2026-02-30', '/history/2026-09-01/x', '/accounts/abc/delete', '/accounts/abc/edit/x', '/expenses/x', '/expenses/import/x', '/bank-transactions/x', '/cashflow/import/x', '/cashflow/x']) {
    assert.deepEqual(routes.parseRoute(path), { tab: 'overview' })
  }
})

test('cashflow query roundtrip and invalid correction', async () => {
 const qmod = await server.ssrLoadModule('/src/cashflowQuery.ts')
 for (const scope of [{range:'month',month:'2026-09'},{range:'year',year:2026},{range:'all'}]) {
 const query={...scope,metric:'consumption',category:'dining',source:'all',panel:'records',page:1}
 assert.deepEqual(qmod.parseCashflowQuery(qmod.cashflowQueryString(query)),{query,corrected:false})
 assert.deepEqual(routes.parseRoute(routes.routePath({tab:'cashflow',query})),{tab:'cashflow',query})
 }
 for (const search of ['?month=2026-99&page=-1','?month=2026-09&month=2026-10','?range=all&month=2026-09','?metric=income&category=dining']) assert.equal(qmod.parseCashflowQuery(search).corrected,true)
 assert.deepEqual(routes.parseRoute('/expenses?recordId=a&returnTo=https%3A%2F%2Fevil.test'),{tab:'expenses',recordId:'a'})
})
