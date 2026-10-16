import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { summary, positionPage, cashPage } from './fixtures/securities-layouts.mjs'

let server, dom, root, createRoot, SecuritiesImport, parse, model
before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const k of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[k] = dom.window[k]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ cacheDir: 'node_modules/.vite-securities-ui', configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;({ SecuritiesImport } = await server.ssrLoadModule('/src/views/SecuritiesImport.tsx'))
  parse = (await server.ssrLoadModule('/src/securitiesStatements.ts')).parseSecuritiesStatement
  model = await server.ssrLoadModule('/src/model.ts')
})
afterEach(async () => { if (root) await act(() => root.unmount()); root = null })
after(async () => { await server?.close(); dom?.window.close() })

const button = (t) => [...document.querySelectorAll('button')].find((x) => x.textContent.startsWith(t))
const statement = (name, date, options = {}) => {
  const result = parse([summary('75.00'), positionPage('60.00', options.badTotal ? '61.00' : '60.00'), cashPage()])
  result.statementDate = date
  return [{ name }, { kind: 'securities', result }]
}
async function render(entries, data, calls = {}) {
  const files = entries.map(([f]) => f), prepared = new Map(entries)
  let latest = data
  root = createRoot(document.getElementById('root'))
  const element = () => createElement(SecuritiesImport, { files, prepared, data: latest, busy: false, onChange: (next) => { latest = next; calls.changed = true; root.render(element()) }, onImported: (m) => { calls.message = m }, onCancel: () => { calls.cancelled = true } })
  await act(() => root.render(element()))
  return () => latest
}

test('the latest statement of an account is previewed with its cash and holdings, then imported into the accounts', async () => {
  const calls = {}
  const latest = await render([statement('older.pdf', '2026-01-02'), statement('newer.pdf', '2026-02-27')], model.emptyData(), calls)
  const text = document.body.textContent
  assert.match(text, /moomoo \(1234\) · 2026-02-27/)
  assert.match(text, /來源：newer\.pdf（另有 1 份較舊的對帳單不匯入）/)
  assert.match(text, /現金 · SGD 100/)
  assert.match(text, /現金 · USD 8/)
  assert.match(text, /EXMP · 數量 2/)
  await act(() => button('確認匯入').click())
  const [account] = latest().accounts
  assert.deepEqual([account.name, account.kind, account.country, account.category], ['moomoo (1234)', 'investment', 'SG', '海外股票 (新股)'])
  assert.deepEqual(account.positions.map((p) => [p.type, p.currency, p.symbol, p.quantity]), [['cash', 'SGD', '', 100], ['cash', 'USD', '', 8], ['holding', 'USD', 'EXMP', 2]])
  assert.match(calls.message, /已匯入 1 個證券帳戶（moomoo \(1234\)）.*儲存變更/)
})

test('renaming to an existing account previews what it replaces; a statement that does not add up is not imported', async () => {
  const existing = { id: 'a1', name: 'My Broker', kind: 'investment', country: 'SG', category: '其他', positions: [{ id: 'p1', type: 'holding', currency: 'USD', symbol: 'OLD', quantity: 5, price: 1 }] }
  const calls = {}
  const latest = await render([statement('ok.pdf', '2026-02-27'), statement('bad.pdf', '2026-03-31', { badTotal: true })], { ...model.emptyData(), accounts: [existing] }, calls)
  assert.match(document.body.textContent, /bad\.pdf · moomoo \(1234\) 的部分內容與對帳單自己印的合計對不上，未匯入/)
  const input = document.querySelector('input[aria-label="moomoo (1234) 匯入到的帳戶名稱"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'My Broker')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.match(document.body.textContent, /將取代「My Broker」，刪除以下 1 筆原持倉/)
  await act(() => button('確認匯入並取代上述資料').click())
  assert.equal(latest().accounts.length, 1)
  assert.deepEqual(latest().accounts[0].positions.map((p) => p.symbol), ['', '', 'EXMP'])
  assert.equal(latest().accounts[0].id, 'a1')
})

test('cancel reports and nothing is imported when no file has cash or holdings', async () => {
  const calls = {}
  const result = parse([summary('75.00'), positionPage(), cashPage()])
  result.cash = []; result.positions = []
  await render([[{ name: 'empty.pdf' }, { kind: 'securities', result }]], model.emptyData(), calls)
  assert.match(document.body.textContent, /empty\.pdf · moomoo \(1234\).*不匯入帳戶/)
  assert.equal(button('確認匯入').disabled, true)
  await act(() => button('取消匯入').click())
  assert.ok(calls.cancelled)
  assert.equal(calls.changed, undefined)
})
