import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, cashflow, convert
before(async()=>{
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 cashflow=await server.ssrLoadModule('/src/cashflow.ts')
 const fx=await server.ssrLoadModule('/src/cashflowFx.ts')
 convert=async(...args)=>(await fx.cashflowWithFxEvidence(...args)).group
})
after(()=>server?.close())
const expense=(id,date,currency,amount)=>({id,date,currency,amount,description:'Test',card:'Test',category:'購物'})
const bank=(id,date,currency,direction,amount,classification)=>({id,date,currency,direction,amount,classification,description:'Test',accountId:'test'})
const history=(symbol,points,currency='TWD')=>({symbol,currency,asTraded:true,points:points.map(([date,close])=>({date,close})),splits:[]})
const summary=(input,period='all')=>cashflow.cashflowSummary(input,'2026-02',period)

test('monthly rates convert signed categories, directional review and recovery; counts and source summaries stay unchanged',async()=>{
 const input={expenses:[expense('a','2026-01-01','USD',100),expense('b','2026-02-01','USD',-20),expense('c','2026-02-01','TWD',50)],bankTransactions:[bank('salary','2026-01-01','USD','credit',200,{kind:'income',category:'薪資'}),bank('reverse','2026-02-01','USD','debit',10,{kind:'income',category:'薪資'}),bank('pending','2026-01-01','USD','debit',3,{kind:'pending'}),bank('excluded','2026-02-01','USD','credit',4,{kind:'excluded',reason:'自有帳戶轉帳'}),bank('investment','2026-02-01','USD','credit',5,{kind:'income',category:'投資回收款'})]}
 const months=cashflow.cashflowMonths(input), before=structuredClone(months)
 const calls=[]
 const result=await convert(summary({months}),'2026-03-10',async(symbol,from)=>{calls.push([symbol,from]);return history(symbol,[['2026-01-30',30],['2026-02-27',32],['2026-03-09',99]])})
 assert.deepEqual(calls,[['USDTWD=X','2026-01-31']])
 assert.equal(result.currency,'TWD');assert.equal(result.income,5840);assert.equal(result.consumption,2500);assert.equal(result.difference,3340)
 assert.equal(result.incomeCategories.find(c=>c.category==='薪資').net,5680)
 assert.equal(result.consumptionCategories[0].net,2410)
 assert.deepEqual(result.consumptionCategories.find(c=>c.category==='未分類'),{category:'未分類',count:1,net:90})
 assert.deepEqual(result.pending,{count:1,debitCount:1,creditCount:0,debitAmount:90,creditAmount:0})
 assert.equal(result.excluded.creditAmount,128);assert.equal(result.exclusions[0].creditAmount,128)
 assert.deepEqual(result.investmentRecovery,{count:1,net:160,hasRecords:true})
 assert.equal(result.coverage.recordCount,8);assert.equal(result.consumptionCategories[0].count,3)
 assert.deepEqual(months,before)
})
test('current month uses latest available completed quote and never a future quote',async()=>{
 const groups=summary({expenses:[expense('a','2026-02-01','USD',2)]},1)
 const result=await convert(groups,'2026-02-15',async()=>history('USDTWD=X',[['2026-02-13',31],['2026-02-16',99]]))
 assert.equal(result.consumption,62)
})
test('missing, stale, mismatched and invalid historical FX reject complete total after requests',async()=>{
 const groups=summary({expenses:[expense('a','2026-01-01','USD',2),expense('b','2026-02-01','TWD',50)]})
 for(const response of [null,history('USDTWD=X',[['2026-03-01',32]]),history('USDTWD=X',[['2026-01-01',32]]),history('EURTWD=X',[['2026-01-30',32]]),history('USDTWD=X',[['2026-01-30',32]],'USD')]) {
  let calls=0
  await assert.rejects(convert(groups,'2026-03-10',async()=>{calls++;return response}))
  assert.equal(calls,1)
 }
 await assert.rejects(convert(groups,'2026-03-10',async()=>{throw new Error('offline')}),/歷史/)
})
test('no records and TWD-only zero/pending records need no FX request',async()=>{
 const fetcher=async()=>assert.fail('TWD must not fetch FX')
 assert.equal(await convert([],'2026-02-15',fetcher),undefined)
 const result=await convert(summary({bankTransactions:[bank('pending','2026-02-01','TWD','credit',0,{kind:'pending'})]}),'2026-02-15',fetcher)
 assert.equal(result.difference,0);assert.equal(result.pending.count,1)
})
test('each currency fetches once and completion order cannot affect projection',async()=>{
 const groups=summary({expenses:[expense('a','2026-01-01','USD',1),expense('b','2026-02-01','USD',1),expense('c','2026-02-01','SGD',1)]})
 const calls=[]
 const result=await convert(groups,'2026-03-10',async(symbol,from)=>{calls.push([symbol,from]);return history(symbol,[['2026-01-30',symbol==='USDTWD=X'?30:20],['2026-02-27',symbol==='USDTWD=X'?32:22]])})
 assert.equal(calls.length,2);assert.equal(result.consumption,84)
})

test('crypto conversion retains monthly two-leg semantics and rejects a missing leg',async()=>{
 const groups=summary({expenses:[expense('btc','2026-01-01','BTC',0.1)]})
 const fetcher=async symbol=>symbol==='BTC-USD'?history(symbol,[['2026-01-30',50000]],'USD'):history(symbol,[['2026-01-30',30]])
 assert.equal((await convert(groups,'2026-03-10',fetcher)).consumption,150000)
 await assert.rejects(convert(groups,'2026-03-10',async symbol=>symbol==='BTC-USD'?fetcher(symbol):null),/USD\/TWD/)
})

test('foreign zero/pending months still fetch required FX and future months cannot borrow current rates',async()=>{
 let calls=0
 const groups=summary({bankTransactions:[bank('zero','2026-02-01','USD','credit',0,{kind:'pending'})]})
 const result=await convert(groups,'2026-02-15',async symbol=>{calls++;return history(symbol,[['2026-02-13',31]])})
 assert.equal(calls,1);assert.equal(result.difference,0);assert.equal(result.pending.count,1)
 await assert.rejects(convert(groups,'2026-01-15',async()=>assert.fail('No completed future month FX exists')),/尚無該月份匯率/)
})
