import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'

let server, dom, root, createRoot, Expenses, BankTransactions, Entry, Accounts, model
before(async () => {
  dom = new JSDOM('<div id="root"></div>', { url: 'https://wealthline.test/' })
  for (const k of ['window', 'document', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'PopStateEvent', 'localStorage', 'sessionStorage']) globalThis[k] = dom.window[k]
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.ResizeObserver = class { observe() {} disconnect() {} }
  window.scrollTo = () => {}
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ cacheDir: 'node_modules/.vite-csv-import-ui', configFile: false, envDir: false, server: { middlewareMode: true, watch: null, hmr: false, ws: false } })
  ;({ Expenses } = await server.ssrLoadModule('/src/views/Expenses.tsx'))
  ;({ BankTransactions } = await server.ssrLoadModule('/src/views/BankTransactions.tsx'))
  ;({ StatementImportEntry: Entry } = await server.ssrLoadModule('/src/views/StatementImportEntry.tsx'))
  ;({ Accounts } = await server.ssrLoadModule('/src/views/Accounts.tsx'))
  model = await server.ssrLoadModule('/src/model.ts')
})
afterEach(async () => { if (root) await act(() => root.unmount()); root = null })
after(async () => { await server?.close(); dom?.window.close() })

const csvFile = (name, text) => ({ name, type: 'text/csv', size: new TextEncoder().encode(text).length, arrayBuffer: async () => new TextEncoder().encode(text).buffer })
const button = (t) => [...document.querySelectorAll('button')].find((x) => x.textContent === t || x.textContent.startsWith(t))
async function settle(predicate) { for (let i = 0; i < 200 && !predicate(); i++) await act(() => new Promise((r) => setTimeout(r, 5))); assert.ok(predicate(), 'async operation settled') }
async function click(t) { assert.ok(button(t), t); await act(() => button(t).click()) }
async function choose(input, files) {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  await act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
}
async function submit(form) { await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
async function render(Component, props, data) {
  let latest = data
  root = createRoot(document.getElementById('root'))
  const element = () => createElement(Component, { ...props, data: latest, onChange: (next) => { latest = next; root.render(element()) } })
  await act(() => root.render(element()))
  return () => latest
}

const CARD = ['type,date,description,amount,currency,card,category,statement_month,statement_total',
  'card,2026-09-03,全聯福利中心,1280,TWD,國泰 CUBE,購物,2026-09,1220',
  'card,2026-09-10,NETFLIX.COM,390,TWD,國泰 CUBE,,2026-09,1220',
  'card,2026-09-12,誠品 退款,-450,TWD,國泰 CUBE,,2026-09,1220',
  'card,2026-09-14,STARBUCKS,5.5,USD,國泰 CUBE,,2026-09,6'].join('\n')
const BANK = ['type,account,bank,date,description,direction,amount,currency,classification,closing_balance,closing_date',
  'bank,台新 Richart,台新,2026-09-05,薪資轉入 帳號 12345678,credit,65000,TWD,income:薪資,,',
  'bank,台新 Richart,台新,2026-09-10,信用卡費,debit,15320,TWD,excluded:信用卡繳款,,',
  'bank,台新 Richart,台新,2026-09-30,利息,credit,12,TWD,,182340,2026-09-30',
  'bank,台新 Richart,台新,2026-09-30,USD 利息,credit,1,USD,,,'].join('\n')

test('a card CSV previews with its categories, flags a statement whose total does not add up, and imports once', async () => {
  const latest = await render(Expenses, { busy: false }, { ...model.emptyData(), version: 13 })
  await click('匯入信用卡帳單')
  await choose(document.querySelector('.statement-import input[type=file]'), [csvFile('cathay-2026-09.csv', CARD)])
  await submit(document.querySelector('.statement-import form'))
  await settle(() => !!document.querySelector('.statement-preview-row'))
  const report = document.querySelector('[aria-label="各帳單解析結果"]').textContent
  assert.match(report, /cathay-2026-09\.csv：國泰 CUBE · 2026-09（CSV）· 4 筆待核對/)
  assert.match(report, /帳單總額不符：國泰 CUBE 2026-09 應為 6，明細合計 5\.5，/)
  // Only the USD statement's row is marked for checking.
  assert.equal(document.querySelectorAll('.statement-preview-row .tag').length, 1)
  assert.match(document.body.textContent, /1 筆標示「核對」的交易已勾選/)
  await click('確認匯入 4 筆')
  const expenses = latest().expenses
  assert.deepEqual(expenses.map((e) => [e.date, e.description, e.amount, e.currency, e.card, e.category]), [
    ['2026-09-03', '全聯福利中心', 1280, 'TWD', '國泰 CUBE', '購物'], ['2026-09-10', 'NETFLIX.COM', 390, 'TWD', '國泰 CUBE', undefined],
    ['2026-09-12', '誠品 退款', -450, 'TWD', '國泰 CUBE', undefined], ['2026-09-14', 'STARBUCKS', 5.5, 'USD', '國泰 CUBE', undefined]])
  assert.ok(expenses.every((e) => /^[a-f0-9]{64}$/.test(e.sourceKey) && /^[a-f0-9]{64}$/.test(e.importKey)))
  // The same file again adds nothing.
  await click('匯入信用卡帳單')
  await choose(document.querySelector('.statement-import input[type=file]'), [csvFile('cathay-2026-09.csv', CARD)])
  await submit(document.querySelector('.statement-import form'))
  await settle(() => !!document.querySelector('.statement-preview-row'))
  assert.match(document.body.textContent, /可新增 0 筆 · 略過重複 4 筆/)
})

test('an invalid card CSV is reported by line and nothing is previewed', async () => {
  await render(Expenses, { busy: false }, { ...model.emptyData(), version: 13 })
  await click('匯入信用卡帳單')
  await choose(document.querySelector('.statement-import input[type=file]'), [csvFile('bad.csv', 'type,date,description,amount,currency,card\ncard,2026-09-31,A,"1,000",TWD,X')])
  await submit(document.querySelector('.statement-import form'))
  await settle(() => !!document.querySelector('[role="alert"]'))
  assert.match(document.body.textContent, /bad\.csv：CSV 有 1 個問題，整份檔案未匯入。第 2 列：日期必須是 YYYY-MM-DD；金額必須是不含千分位的數字。/)
  assert.equal(document.querySelector('.statement-preview-row'), null)
})

test('a bank CSV maps sections by account label, masks identifiers, and adds a supported closing balance', async () => {
  const data = { ...model.emptyData(), version: 13, bankTransactionAccounts: [{ id: 'ledger', label: '台新 RICHART', bank: 'Taishin' }], bankTransactions: [], bankCategoryRules: [] }
  const latest = await render(BankTransactions, { busy: false }, data)
  await click('匯入銀行帳單')
  await choose(document.querySelector('[aria-label="銀行帳單 PDF"]'), [csvFile('richart.csv', BANK)])
  await submit(document.querySelector('.bank-import form'))
  await settle(() => !!document.querySelector('.bank-preview-row') && !!button('解析銀行帳單'))
  assert.match(document.body.textContent, /richart\.csv · CSV · 4 筆 · 2 個帳戶區段/)
  assert.match(document.body.textContent, /依 CSV 的 account 記入「台新 Richart」（既有流水帳戶）/)
  assert.match(document.querySelector('.bank-closing-balances').textContent, /2026-09-30 · NT\$ 182,340/)
  await click('檢查匯入')
  await settle(() => !!document.querySelector('[aria-label="銀行重複核對"]') || !!document.querySelector('[role="alert"]'))
  assert.equal(document.querySelector('[role="alert"]')?.textContent, undefined)
  assert.match(document.querySelector('[aria-label="銀行重複核對"]').textContent, /可新增 4 筆/)
  await click('確認銀行匯入')
  const saved = latest()
  assert.deepEqual(saved.bankTransactionAccounts.map((a) => a.id), ['ledger'])
  assert.deepEqual(saved.bankTransactions.map((t) => [t.accountId, t.description, t.direction, t.amount, t.currency, t.classification]), [
    ['ledger', '薪資轉入 帳號 [帳號已遮蔽]', 'credit', 65000, 'TWD', { kind: 'income', category: '薪資' }],
    ['ledger', '信用卡費', 'debit', 15320, 'TWD', { kind: 'excluded', reason: '信用卡繳款' }],
    ['ledger', '利息', 'credit', 12, 'TWD', undefined],
    ['ledger', 'USD 利息', 'credit', 1, 'USD', undefined]])
  assert.deepEqual(saved.bankStatementBalances.map((b) => [b.bank, b.ledgerAccountId, b.date, b.currency, b.quantity]), [['Taishin', 'ledger', '2026-09-30', 'TWD', 182340]])
  assert.equal(JSON.stringify(saved).includes('12345678'), false)
})

test('a bank CSV for an unknown bank creates its ledger account and skips the closing balance with a note', async () => {
  const data = { version: 13, accounts: [], history: [], bankTransactionAccounts: [], bankTransactions: [], bankCategoryRules: [] }
  const latest = await render(BankTransactions, { busy: false }, data)
  await click('匯入銀行帳單')
  await choose(document.querySelector('[aria-label="銀行帳單 PDF"]'), [csvFile('line-bank.csv', ['type,account,date,description,direction,amount,currency,closing_balance,closing_date',
    'bank,LINE Bank,2026-09-01,轉入,credit,100,TWD,100,2026-09-30', 'bank,LINE Bank,2026-09-02,轉出,debit,10,USD,,'].join('\n'))])
  await submit(document.querySelector('.bank-import form'))
  await settle(() => !!document.querySelector('.bank-preview-row') && !!button('解析銀行帳單'))
  assert.match(document.body.textContent, /LINE Bank 2026-09-30 的期末餘額未補入資產歷史/)
  assert.equal(document.querySelector('.bank-closing-balances'), null)
  await click('檢查匯入')
  await settle(() => !!document.querySelector('[aria-label="銀行重複核對"]') || !!document.querySelector('[role="alert"]'))
  await click('確認銀行匯入')
  const saved = latest()
  // Both currencies go to one new ledger account named by the account column.
  assert.deepEqual(saved.bankTransactionAccounts.map((a) => [a.label, a.bank]), [['LINE Bank', 'LINE Bank']])
  assert.deepEqual(saved.bankTransactions.map((t) => [t.accountId, t.currency]), [[saved.bankTransactionAccounts[0].id, 'TWD'], [saved.bankTransactionAccounts[0].id, 'USD']])
  assert.equal(saved.bankStatementBalances?.length ?? 0, 0)
})

test('a closing balance is left out when the matched ledger account belongs to another bank', async () => {
  const data = { ...model.emptyData(), version: 13, bankTransactionAccounts: [{ id: 'ledger', label: 'Main', bank: '自行輸入' }], bankTransactions: [], bankCategoryRules: [] }
  await render(BankTransactions, { busy: false }, data)
  await click('匯入銀行帳單')
  await choose(document.querySelector('[aria-label="銀行帳單 PDF"]'), [csvFile('main.csv', 'type,account,bank,date,description,direction,amount,currency,closing_balance,closing_date\nbank,main,富邦,2026-09-01,A,credit,1,TWD,1,2026-09-30')])
  await submit(document.querySelector('.bank-import form'))
  await settle(() => !!document.querySelector('.bank-preview-row') && !!button('解析銀行帳單'))
  assert.match(document.body.textContent, /2026-09-30 的期末餘額未補入資產歷史：流水帳戶「Main」的銀行不是 富邦銀行 \(TW\)/)
  assert.equal(document.querySelector('.bank-closing-balances'), null)
})

test('the import entry sorts CSV files by their type column and keeps position files out', async () => {
  let plan
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(createElement(Entry, { passwords: [], busy: false, onCancel() {}, onSelectKind() {}, onContinue: (p) => { plan = p } })))
  const files = [csvFile('card.csv', CARD), csvFile('bank.csv', BANK), csvFile('positions.csv', 'type,account,kind,currency,quantity\nposition,A,bank,TWD,1'), csvFile('broken.csv', 'type\ncard\nbank')]
  await choose(document.querySelector('[aria-label="帳單 PDF"]'), files)
  await submit(document.querySelector('.statement-entry form'))
  await settle(() => !!document.querySelector('.statement-entry-report'))
  const report = document.querySelector('.statement-entry-report').textContent
  assert.match(report, /card\.csv · 信用卡帳單 · CSV 檔/)
  assert.match(report, /bank\.csv · 銀行帳單 · CSV 檔/)
  assert.match(report, /positions\.csv · 無法讀取：這是帳戶餘額與持倉 CSV，請到「帳戶」頁的「從試算表或 CSV 匯入」/)
  assert.match(report, /broken\.csv · 無法讀取：同一個 CSV 只能放一種 type/)
  await click('繼續匯入 · 信用卡 1 份 · 銀行 1 份')
  assert.deepEqual([plan.card.map((f) => f.name), plan.bank.map((f) => f.name)], [['card.csv'], ['bank.csv']])
})

test('the accounts page reads a position CSV file and previews before replacing', async () => {
  const data = { ...model.emptyData(), accounts: [{ id: 'acc', name: 'HSBC SG', kind: 'bank', country: 'SG', category: '現金與外幣活存', positions: [{ id: 'sgd', type: 'cash', currency: 'SGD', symbol: '', quantity: 1, price: 1 }] }] }
  const latest = await render(Accounts, { view: { page: 'list', importing: true }, setView() {}, onBack() {}, onRefreshPrices: async () => {}, priceError: '' }, data)
  await choose(document.querySelector('[aria-label="帳戶 CSV"]'), [csvFile('positions.csv', 'type,account,kind,currency,symbol,quantity\nposition,HSBC SG,bank,SGD,,2500\nposition,嘉信,investment,USD,VOO,3')])
  await settle(() => document.querySelector('[aria-label="匯入資料"]').value.startsWith('type,'))
  await click('預覽 CSV 匯入')
  assert.match(document.body.textContent, /匯入預覽：2 列、2 個帳戶/)
  assert.match(document.body.textContent, /將取代「HSBC SG」，刪除以下 1 筆原持倉/)
  assert.match(document.body.textContent, /1 個標的還沒有價格/)
  await click('確認匯入並取代上述資料')
  assert.deepEqual(latest().accounts.map((a) => [a.id === 'acc' ? 'acc' : 'new', a.name, a.positions.map((p) => [p.id === 'sgd' ? 'sgd' : 'new', p.symbol, p.quantity])]),
    [['acc', 'HSBC SG', [['sgd', '', 2500]]], ['new', '嘉信', [['new', 'VOO', 3]]]])
})

test('a non-UTF-8 position CSV is refused before anything is previewed', async () => {
  await render(Accounts, { view: { page: 'list', importing: true }, setView() {}, onBack() {}, onRefreshPrices: async () => {}, priceError: '' }, model.emptyData())
  const big5 = { name: 'big5.csv', type: 'text/csv', size: 2, arrayBuffer: async () => new Uint8Array([0xa5, 0x78]).buffer }
  await choose(document.querySelector('[aria-label="帳戶 CSV"]'), [big5])
  await settle(() => !!document.querySelector('[role="alert"]'))
  assert.match(document.querySelector('[role="alert"]').textContent, /不是 UTF-8 編碼/)
  assert.equal(document.querySelector('[aria-label="匯入資料"]').value, '')
})

test('the import screens carry a collapsed CSV guide whose prompt and example copy as written', async () => {
  const copied = []
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { copied.push(text) } } })
  root = createRoot(document.getElementById('root'))
  await act(() => root.render(createElement(Entry, { passwords: [], busy: false, onCancel() {}, onSelectKind() {}, onContinue() {} })))
  const guide = document.querySelector('details.csv-guide')
  assert.ok(guide && !guide.open)
  assert.match(guide.textContent, /準備資料.*整理成 CSV.*存成 \.csv.*上傳並核對/)
  assert.match(guide.textContent, /傳送到該工具的供應商、依其條款處理，不經過 Wealthline/)
  assert.match(guide.textContent, /第 N 列：原因/)
  await click('複製提示詞')
  assert.match(copied[0], /^請讀取我提供的信用卡帳單/)
  assert.match(copied[0], /type,date,description,amount,currency,card,category,statement_month,statement_total/)
  assert.ok(button('已複製'))
  await act(() => [...document.querySelectorAll('[aria-label="CSV 類型"] button')].find((t) => t.textContent === '銀行流水').click())
  await click('複製範例')
  assert.ok(copied[1].startsWith('type,account,bank,date,description,direction,amount,currency'))
  // The examples in the guide are files the importer accepts.
  const csv = await server.ssrLoadModule('/src/csvImport.ts')
  assert.equal(csv.readBankCsv(copied[1]).rows.length, 3)
  delete globalThis.navigator.clipboard
})

test('the guide examples are valid imports of their own type', async () => {
  const csv = await server.ssrLoadModule('/src/csvImport.ts')
  const sheet = await server.ssrLoadModule('/src/importSheet.ts')
  await render(Accounts, { view: { page: 'list', importing: true }, setView() {}, onBack() {}, onRefreshPrices: async () => {}, priceError: '' }, model.emptyData())
  const example = document.querySelector('[aria-label="帳戶餘額與持倉範例"]').textContent
  assert.deepEqual(sheet.importPositionCsv(model.emptyData(), example).errors, [])
  if (root) await act(() => root.unmount()); root = null
  await render(Expenses, { busy: false }, { ...model.emptyData(), version: 13 })
  await click('匯入信用卡帳單')
  const card = csv.readCardCsv(document.querySelector('[aria-label="信用卡消費範例"]').textContent)
  assert.deepEqual(card.checks.map((c) => c.matches), [true])
})
