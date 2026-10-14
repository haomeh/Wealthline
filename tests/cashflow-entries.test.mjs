import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, entries, cashflow, expenses, bank
before(async () => {
  server = await createServer({ configFile:false, envDir:false,
    server:{middlewareMode:true,watch:null,hmr:false,ws:false} })
  entries = await server.ssrLoadModule('/src/cashflowEntries.ts')
  cashflow = await server.ssrLoadModule('/src/cashflow.ts')
  expenses = await server.ssrLoadModule('/src/expenses.ts')
  bank = await server.ssrLoadModule('/src/bankTransactions.ts')
})
after(() => server?.close())
const card = (id, amount, extra={}) => ({id,date:'2026-09-03',card:'Test card',description:'Unknown merchant',currency:'TWD',amount,...extra})
const txn = (id, amount, direction, classification, extra={}) => ({id,accountId:'bank-a',date:'2026-09-03',description:'Unknown transaction',currency:'TWD',amount,direction,...(classification && {classification}),...extra})
test('same IDs in separate sources retain signed contributions', () => {
  const rows = entries.cashflowEntries({expenses:[card('same',-50,{category:'購物'})],bankTransactions:[txn('same',1000,'credit',{kind:'income',category:'薪資'})]})
  assert.equal(rows.length,2)
  assert.equal(rows.reduce((s,r)=>s+r.income,0),1000)
  assert.equal(rows.reduce((s,r)=>s+r.consumption,0),-50)
  assert.equal(rows.reduce((s,r)=>s+r.difference,0),1050)
})
test('signed fixture reconciles raw entries and legacy summary, including visible exclusions', () => {
  const input = {expenses:[card('spend',200),card('refund',-50)],bankTransactions:[
    txn('salary',1000,'credit',{kind:'income',category:'薪資'}),txn('reversal',100,'debit',{kind:'income',category:'薪資'}),
    txn('expense',100,'debit',{kind:'expense',category:'購物'}),txn('refund',20,'credit',{kind:'expense',category:'購物'}),
    txn('transfer',500,'debit',{kind:'excluded',reason:'自有帳戶轉帳'}),txn('pending',30,'credit')]}
  const rows = entries.cashflowEntries(input), summary = cashflow.cashflowSummary(input,'2026-09',1)[0]
  for (const [key,expected] of Object.entries({income:930,consumption:230,difference:700})) {
    assert.equal(rows.reduce((s,r)=>s+r[key],0),expected)
    assert.equal(summary[key],expected)
  }
  assert.deepEqual(rows.find(r=>r.recordId==='transfer').evidence,{basis:'manual'})
  assert.equal(rows.find(r=>r.recordId==='transfer').difference,0)
  assert.equal(summary.excluded.debitAmount,500)
  assert.equal(summary.pending.creditAmount,30)
  assert.equal(summary.coverage.recordCount,8)
  assert.equal(summary.coverage.complete,false)
})
test('zero values preserve membership and card unclassified differs from bank pending', () => {
  const rows = entries.cashflowEntries({expenses:[card('card',0)],bankTransactions:[txn('income',0,'debit',{kind:'income',category:'薪資'}),txn('expense',0,'credit',{kind:'expense',category:'購物'}),txn('pending',0,'credit')]})
  assert.deepEqual(rows.map(r=>[r.classification,r.metric,r.category]),[['consumption','consumption','未分類'],['income','income','薪資'],['consumption','consumption','購物'],['pending','income','未分類']])
  assert.deepEqual(rows[0].evidence,{basis:'unclassified'})
  assert.deepEqual(rows[3].evidence,{basis:'unclassified'})
})
test('evidence shares manual, normalized first custom match, builtin, and unclassified priority', () => {
  const expenseRules=[{keyword:'ＣＯＦＦＥＥ',category:'購物'},{keyword:'coffee',category:'娛樂'}]
  const bankRules=[{keyword:'salary',direction:'debit',target:{kind:'expense',category:'購物'}},{keyword:'ＳＡＬＡＲＹ',direction:'credit',target:{kind:'income',category:'其他收入'}},{keyword:'salary',target:{kind:'pending'}}]
  const input={expenseRules,bankRules,expenses:[card('manual',1,{description:'coffee',category:'醫療'}),card('custom',1,{description:'coffee'}),card('builtin',1,{description:'UBER EATS'})],bankTransactions:[txn('manual',1,'credit',{kind:'pending'},{description:'salary'}),txn('custom',1,'credit',null,{description:'salary'}),txn('builtin',1,'credit',null,{description:'存款利息'})]}
  const rows=entries.cashflowEntries(input)
  assert.deepEqual(rows.map(r=>r.evidence.basis),['manual','custom-rule','builtin','manual','custom-rule','builtin'])
  assert.deepEqual(rows[1].evidence.rule,{keyword:'ＣＯＦＦＥＥ'})
  assert.deepEqual(rows[4].evidence.rule,{keyword:'ＳＡＬＡＲＹ',direction:'credit'})
  assert.deepEqual(rows.map(r=>r.category),['醫療','購物','餐飲','未分類','其他收入','利息'])
  assert.deepEqual(rows.map(r=>r.classification),['consumption','consumption','consumption','pending','income','income'])
  input.expenses.forEach((r,i)=>assert.equal(rows[i].category,expenses.expenseCategory(r,expenseRules)))
  input.bankTransactions.forEach((r,i)=>assert.equal(rows[i+3].classification,bank.classifyBankTransaction(r,bankRules).kind))
})
test('frozen input is unchanged, mixed currencies remain separate, and provenance is retained', () => {
  const freeze=value=>{if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
  const input=freeze({expenses:[card('one',0.1,{sourceKey:'source',importKey:'import'}),card('two',0.2),card('usd',9,{currency:'USD'})],bankTransactions:[txn('recovery',0,'debit',{kind:'income',category:'投資回收款'})]})
  const before=JSON.stringify(input),rows=entries.cashflowEntries(input)
  assert.equal(JSON.stringify(input),before)
  assert.equal(rows[0].sourceKey,'source');assert.equal(rows[0].importKey,'import')
  const summary=cashflow.cashflowSummary(input,'2026-09',1)
  for(const group of summary) assert.ok(Math.abs(group.consumption-rows.filter(r=>r.currency===group.currency).reduce((s,r)=>s+r.consumption,0))<1e-12)
  assert.equal(summary[0].investmentRecovery.hasRecords,true)
  assert.deepEqual(cashflow.cashflowSummary({months:cashflow.cashflowMonths(input)},'2026-09',1),summary)
})
