import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { summary, positionPage, cashPage, endingPage } from './fixtures/securities-layouts.mjs'

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
const full = (options = {}) => parse([summary('75.00', { transit: '20.00' }), positionPage('60.00', options.badTotal ? '61.00' : '60.00'), endingPage(), cashPage()])
const statement = (name, date, options = {}) => {
  const result = options.plain ? parse([summary('75.00'), positionPage('60.00', options.badTotal ? '61.00' : '60.00'), cashPage()]) : full(options)
  result.statementDate = date
  if (options.account) result.account = options.account
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
const setName = async (label, value) => {
  const input = document.querySelector(`input[aria-label="${label}"]`)
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('the latest statement of an account is previewed with its cash, holdings and in-transit money, then imported into the accounts', async () => {
  const calls = {}
  const latest = await render([statement('older.pdf', '2026-01-02'), statement('newer.pdf', '2026-02-27')], model.emptyData(), calls)
  const text = document.body.textContent
  assert.match(text, /moomoo \(1234\) · 2026-02-27/)
  assert.match(text, /來源：newer\.pdf（另有 1 份較舊的對帳單不匯入）/)
  // The 20 in transit is part of the SGD cash, so the account adds up to the statement's net assets.
  assert.match(text, /在途的申購／贖回 1 筆（申購 SGD 20.*）已併入對應幣別的現金/)
  assert.match(text, /現金 · SGD 120/)
  assert.match(text, /現金 · USD 8/)
  assert.match(text, /EXMP · 數量 2/)
  await act(() => button('確認匯入').click())
  const [account] = latest().accounts
  assert.deepEqual([account.name, account.kind, account.country, account.category], ['moomoo (1234)', 'investment', 'SG', '海外股票 (新股)'])
  assert.deepEqual(account.positions.map((p) => [p.type, p.currency, p.symbol, p.quantity]), [['cash', 'SGD', '', 120], ['cash', 'USD', '', 8], ['holding', 'USD', 'EXMP', 2]])
  assert.match(calls.message, /已匯入 1 個證券帳戶（moomoo \(1234\)）.*儲存變更/)
})

test('an existing account named like the broker is updated by default instead of a second one being created', async () => {
  const existing = { id: 'a1', name: 'Moomoo', kind: 'investment', country: 'SG', category: '其他', positions: [{ id: 'p1', type: 'holding', currency: 'USD', symbol: 'EXMP', quantity: 5, price: 30 }] }
  const latest = await render([statement('ok.pdf', '2026-02-27', { plain: true })], { ...model.emptyData(), accounts: [existing] })
  assert.match(document.body.textContent, /已有投資帳戶「Moomoo」，預設匯入到它並取代其持倉/)
  assert.match(document.body.textContent, /將取代「Moomoo」，刪除以下 1 筆原持倉/)
  await act(() => button('確認匯入並取代上述資料').click())
  assert.equal(latest().accounts.length, 1)
  assert.equal(latest().accounts[0].id, 'a1')
  assert.deepEqual(latest().accounts[0].positions.map((p) => [p.symbol, p.quantity]), [['', 100], ['', 8], ['EXMP', 2]])
  // Typing another name still creates a separate account.
  await act(() => root.unmount()); root = null
  const two = await render([statement('ok.pdf', '2026-02-27', { plain: true })], { ...model.emptyData(), accounts: [existing] })
  await setName('moomoo (1234) 匯入到的帳戶名稱', 'Another')
  await act(() => button('確認匯入').click())
  assert.deepEqual(two().accounts.map((a) => a.name), ['Moomoo', 'Another'])
})

test('when the newest statement of an account does not add up, the account is not imported and an older one never replaces it', async () => {
  const existing = { id: 'a1', name: 'moomoo (1234)', kind: 'investment', country: 'SG', category: '其他', positions: [{ id: 'p1', type: 'holding', currency: 'USD', symbol: 'KEEP', quantity: 5, price: 1 }] }
  const calls = {}
  await render([statement('jan.pdf', '2026-01-02', { plain: true }), statement('mar.pdf', '2026-03-31', { badTotal: true, plain: true })], { ...model.emptyData(), accounts: [existing] }, calls)
  const text = document.body.textContent
  assert.match(text, /mar\.pdf · moomoo \(1234\) 2026-03-31：與對帳單自己印的合計對不上.*這個帳戶不匯入；較舊的 1 份也不會拿來取代/)
  assert.doesNotMatch(text, /來源：jan\.pdf/)
  assert.equal(button('確認匯入'), undefined)
  assert.match(text, /沒有可匯入的證券帳戶內容/)
  await act(() => button('關閉這個分頁').click())
  assert.match(calls.message, /未匯入任何資料/)
  assert.equal(calls.changed, undefined)
})

test('two accounts in one batch are each previewed once, and trade-only files are listed', async () => {
  await render([statement('a.pdf', '2026-02-27', { plain: true }), statement('b.pdf', '2026-02-27', { plain: true, account: 'moomoo (5678)' }),
    [{ name: 'bill.pdf' }, { kind: 'securities', result: { broker: '台新證券', account: '台新證券 (3265)', statementDate: '2024-03-12', status: 'recognized', positions: [], cash: [], inTransit: [], trades: [], cashflows: [], warnings: [] } }]], model.emptyData())
  const headings = [...document.querySelectorAll('.statement-securities h3')].map((h) => h.textContent)
  assert.deepEqual(headings, ['moomoo (1234) · 2026-02-27', 'moomoo (5678) · 2026-02-27'])
  const after = [...document.querySelectorAll('.statement-securities')].map((d) => [...d.querySelectorAll('strong')].map((x) => x.textContent))
  assert.deepEqual(after.map((x) => x.length), [1, 1])
  assert.match(document.body.textContent, /bill\.pdf · 台新證券 \(3265\) 2024-03-12：這類對帳單只有成交紀錄/)
})
