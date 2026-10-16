import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, entries, cashflow, expenses, model, versions, reports, format
before(async () => {
  server = await createServer({ configFile:false, envDir:false, server:{middlewareMode:true,watch:null,hmr:false,ws:false} })
  entries = await server.ssrLoadModule('/src/cashflowEntries.ts')
  cashflow = await server.ssrLoadModule('/src/cashflow.ts')
  expenses = await server.ssrLoadModule('/src/expenses.ts')
  model = await server.ssrLoadModule('/src/model.ts')
  versions = await server.ssrLoadModule('/src/dataVersion.ts')
  reports = await server.ssrLoadModule('/src/monthlyReport.ts')
  format = await server.ssrLoadModule('/src/format.ts')
})
after(() => server?.close())
const card = (id, amount, extra={}) => ({id,date:'2026-09-03',card:'Card',description:'PAYMENT RECEIVED',currency:'SGD',amount,...extra})

test('帳戶移轉 card rows count in neither consumption nor income and are listed as excluded', () => {
  const input = {expenses:[card('spend',20),card('refund',-5),card('pay-in',-300,{category:'帳戶移轉'}),card('moved',100,{category:'帳戶移轉'})]}
  const rows = entries.cashflowEntries(input)
  const pay = rows.find(r=>r.recordId==='pay-in')
  assert.deepEqual({c:pay.classification,m:pay.metric,r:pay.exclusionReason,cat:pay.category,i:pay.income,s:pay.consumption,d:pay.difference},{c:'excluded',m:'excluded',r:'帳戶移轉',cat:undefined,i:0,s:0,d:0})
  const [summary] = cashflow.cashflowSummary(input,'2026-09',1)
  assert.equal(summary.consumption,15)
  assert.equal(summary.income,0)
  assert.deepEqual(summary.consumptionCategories.map(c=>c.category),['未分類'])
  // Review totals are nonnegative magnitudes: a credited card row is a credit, a charged one a debit.
  assert.deepEqual(summary.exclusions,[{reason:'帳戶移轉',count:2,debitCount:1,creditCount:1,debitAmount:100,creditAmount:300}])
  assert.deepEqual(summary.excluded,{count:2,debitCount:1,creditCount:1,debitAmount:100,creditAmount:300})
})

test('a card rule can mark a merchant as 帳戶移轉; the spending dashboard leaves those rows out', () => {
  const rules = expenses.parseExpenseCategoryRules([{keyword:'PAYMENT',category:'帳戶移轉'}])
  const rows = [card('pay',-300),{...card('bus',2.5),description:'BUS/MRT'}]
  assert.equal(expenses.expenseCategory(rows[0],rules),'帳戶移轉')
  const [month] = expenses.expenseMonthSummary(rows,'2026-09',rules)
  assert.deepEqual({count:month.count,net:month.net,refunds:month.refunds},{count:1,net:2.5,refunds:0})
  assert.equal(expenses.expenseTrend(rows,'2026-09',1,rules)[0].total,2.5)
  assert.equal(entries.cashflowEntries({expenses:rows,expenseRules:rules})[0].metric,'excluded')
})

test('bank rows cannot use the card-only 帳戶移轉 category', () => {
  assert.equal(expenses.parseExpense(card('x',1,{category:'帳戶移轉'})).category,'帳戶移轉')
  assert.throws(()=>entries.cashflowEntries({bankTransactions:[{id:'b',accountId:'a',date:'2026-09-03',description:'x',currency:'TWD',amount:1,direction:'debit',classification:{kind:'expense',category:'帳戶移轉'}}]}))
})

test('data using 帳戶移轉 is saved as version 17, which older readers refuse instead of misreading', () => {
  const data = {...model.emptyData(),version:16,expenses:[card('pay',-300,{category:'帳戶移轉'})]}
  assert.equal(versions.dataVersion(data),17)
  assert.equal(versions.dataVersion({...data,expenses:[card('pay',-300)]}),16)
  assert.equal(versions.dataVersion({...model.emptyData(),version:16,expenseCategoryRules:[{keyword:'PAY',category:'帳戶移轉'}]}),17)
  assert.equal(versions.supportedSplitVersion(17),true)
  const parsed = model.parseWealthData({...data,version:17})
  assert.equal(parsed.version,17)
  assert.equal(parsed.expenses[0].category,'帳戶移轉')
})

test('monthly reports accept card 帳戶移轉 rows as excluded and reject other card exclusions', async () => {
  const rows = entries.cashflowEntries({expenses:[card('pay',-300,{category:'帳戶移轉',currency:'TWD'}),card('meal',12,{category:'餐飲',currency:'TWD'})]})
  const report = await reports.buildMonthlyReport({month:'2026-09',asOfDate:'2026-10-13',generatedAt:'2026-10-13T12:00:00Z',sourceDataVersion:17,entries:rows,fx:[{month:'2026-09',currency:'TWD',targetDate:'2026-09-30',rate:1,legs:[]}],review:{record:null,state:null},bankLabels:{}})
  const reopened = await reports.parseMonthlyReport(JSON.parse(JSON.stringify(report)))
  assert.equal(reopened.totals.consumption,12)
  assert.equal(reopened.entries.find(e=>e.recordId==='pay').metric,'excluded')
  const bad = JSON.parse(JSON.stringify(report)); bad.entries.find(e=>e.recordId==='pay').exclusionReason = '自有帳戶轉帳'
  await assert.rejects(()=>reports.parseMonthlyReport(bad))
})

test('list amounts keep cents to two places and split at the decimal point', () => {
  assert.deepEqual(format.amountParts(16.1),{whole:'16',fraction:'.10'})
  assert.deepEqual(format.amountParts(-5),{whole:'5',fraction:''})
  assert.deepEqual(format.amountParts(1234.5),{whole:'1,234',fraction:'.50'})
  assert.deepEqual(format.amountParts(85000),{whole:'85,000',fraction:''})
  assert.deepEqual(format.amountParts(2.004),{whole:'2',fraction:''})
  assert.deepEqual(format.amountParts(NaN),{whole:'—',fraction:''})
})

test('green marks only money counted as coming in: not 不計收支 bank credits or 帳戶移轉 card rows', async () => {
  const { createElement: h } = await import('react')
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { ExpenseRecords } = await server.ssrLoadModule('/src/views/ExpenseRecords.tsx')
  const { BankRecord } = await server.ssrLoadModule('/src/views/BankTransactions.tsx')
  const tone = (html) => [...html.matchAll(/class="record-money"( data-tone="credit")?/g)].map(m=>!!m[1])
  assert.deepEqual(tone(renderToStaticMarkup(h(ExpenseRecords,{expenses:[card('refund',-5,{category:'購物'}),card('pay',-300,{date:'2026-09-02',category:'帳戶移轉'})],rules:[],showCategory:true}))),[true,false])
  const row = (id, classification) => ({id,accountId:'a',date:'2026-09-03',description:'Transfer in',currency:'TWD',amount:12000,direction:'credit',...(classification&&{classification})})
  const bank = (r) => tone(renderToStaticMarkup(h(BankRecord,{row:r,account:'Bank',rules:[]})))[0]
  assert.equal(bank(row('salary',{kind:'income',category:'薪資'})),true)
  assert.equal(bank(row('pending')),true)
  assert.equal(bank(row('own',{kind:'excluded',reason:'自有帳戶轉帳'})),false)
  const html = renderToStaticMarkup(h(BankRecord,{row:{...row('cents'),amount:3.2},account:'Bank',rules:[]}))
  assert.match(html,/<span>\+3<\/span><span class="record-money-fraction">\.20<\/span>/)
})
