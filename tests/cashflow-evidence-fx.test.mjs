import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, cashflow, fx, entries
before(async () => {
  server = await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  cashflow = await server.ssrLoadModule('/src/cashflow.ts')
  fx = await server.ssrLoadModule('/src/cashflowFx.ts')
  entries = await server.ssrLoadModule('/src/cashflowEntries.ts')
})
after(() => server?.close())
const card = (id, amount, currency='TWD', date='2026-09-03') => ({id,date,card:'Test',description:'Unknown merchant',currency,amount,category:'購物'})
const history = (symbol, date, close, currency='TWD') => ({symbol,currency,asTraded:true,splits:[],points:[{date,close}]})
const groups = input => cashflow.cashflowSummary(input,'2026-09',1)
test('signed refund exposes the exact quote used by conversion', async () => {
  const input = {expenses:[card('fx',-2,'USD')]}
  const result = await fx.cashflowWithFxEvidence(groups(input),'2026-10-13',async symbol => history(symbol,'2026-09-30',30))
  assert.equal(result.group.consumption,-60)
  assert.deepEqual(result.fx,[{month:'2026-09',currency:'USD',targetDate:'2026-09-30',rate:30,legs:[{symbol:'USDTWD=X',date:'2026-09-30',rate:30}]}])
})
test('TWD gets rate one without quotes, while empty input has no evidence', async () => {
  const fetcher = async () => assert.fail('TWD must not fetch')
  assert.deepEqual(await fx.cashflowWithFxEvidence([],'2026-10-13',fetcher),{group:undefined,fx:[]})
  const result = await fx.cashflowWithFxEvidence(groups({expenses:[card('zero',0)]}),'2026-09-13',fetcher)
  assert.equal(result.group.consumption,0)
  assert.deepEqual(result.fx,[{month:'2026-09',currency:'TWD',targetDate:'2026-09-13',rate:1,legs:[]}])
})
test('weekend fallback records quote date separately from target and both crypto legs retain their dates', async () => {
  const calls = []
  const result = await fx.cashflowWithFxEvidence(groups({expenses:[card('usd',2,'USD'),card('btc',0.1,'BTC')]}),'2026-09-13',async symbol => {
    calls.push(symbol)
    return symbol==='BTC-USD' ? history(symbol,'2026-09-12',50000,'USD') : history(symbol,'2026-09-11',30)
  })
  assert.equal(calls.length,3)
  assert.deepEqual(result.fx.find(x=>x.currency==='USD'),{month:'2026-09',currency:'USD',targetDate:'2026-09-13',rate:30,legs:[{symbol:'USDTWD=X',date:'2026-09-11',rate:30}]})
  assert.deepEqual(result.fx.find(x=>x.currency==='BTC'),{month:'2026-09',currency:'BTC',targetDate:'2026-09-13',rate:1500000,legs:[{symbol:'BTC-USD',date:'2026-09-12',rate:50000},{symbol:'TWD=X',date:'2026-09-11',rate:30}]})
  assert.equal(result.group.consumption,150060)
})
test('missing, wrong-symbol, stale and future foreign quotes cannot produce evidence', async () => {
  const input=groups({expenses:[card('fx',1,'USD')]})
  for(const response of [null,history('EURTWD=X','2026-09-30',30),history('USDTWD=X','2026-09-01',30)]) {
    await assert.rejects(fx.cashflowWithFxEvidence(input,'2026-10-13',async()=>response))
  }
  await assert.rejects(fx.cashflowWithFxEvidence(input,'2026-08-31',async()=>assert.fail('future FX request')),/尚無該月份匯率/)
})
test('signed mixed fixture reconciles entries and summary-only inputs with shared evidence', async () => {
  const txn=(id,amount,direction,classification)=>({id,accountId:'bank-a',date:'2026-09-03',description:'Unknown transaction',currency:'TWD',amount,direction,...(classification && {classification})})
  const input={expenses:[card('spend',200),card('refund',-50),card('sgd',10,'SGD')],bankTransactions:[
    txn('salary',1000,'credit',{kind:'income',category:'薪資'}),txn('reversal',100,'debit',{kind:'income',category:'薪資'}),
    txn('expense',100,'debit',{kind:'expense',category:'購物'}),txn('refund',20,'credit',{kind:'expense',category:'購物'}),
    txn('transfer',500,'debit',{kind:'excluded',reason:'自有帳戶轉帳'}),txn('pending',30,'credit')]}
  const fetcher=async symbol=>history(symbol,'2026-09-30',24)
  const result=await fx.cashflowWithFxEvidence(groups(input),'2026-10-13',fetcher)
  assert.deepEqual(await fx.cashflowWithFxEvidence(groups({months:cashflow.cashflowMonths(input)}),'2026-10-13',fetcher),result)
  for(const [key,expected] of Object.entries({income:930,consumption:470,difference:460})) {
    assert.equal(result.group[key],expected)
    assert.equal(entries.cashflowEntries(input).reduce((sum,row)=>sum+row[key]*result.fx.find(x=>x.currency===row.currency).rate,0),expected)
  }
})

test('hook clears evidence on selection, date and retry changes and ignores canceled results', async () => {
  const {JSDOM}=await import('jsdom')
  const {act,createElement,useLayoutEffect}=await import('react')
  const dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/'})
  const originalFetch=globalThis.fetch
  for(const key of ['window','document','HTMLElement']) globalThis[key]=dom.window[key]
  globalThis.IS_REACT_ACT_ENVIRONMENT=true
  const {createRoot}=await import('react-dom/client')
  const {useTwdCashflow}=await server.ssrLoadModule('/src/cashflowPeriod.ts')
  const {clearHistoryCache}=await server.ssrLoadModule('/src/priceHistory.ts')
  clearHistoryCache()
  const pending=[],seen=[]
  globalThis.fetch=url=>new Promise(resolve=>pending.push({url,resolve}))
  let state
  function Probe({input,today,endMonth='2026-09'}) {
    const value=useTwdCashflow(input,endMonth,1,today)
    useLayoutEffect(()=>{state=value;seen.push(value)})
    return null
  }
  const root=createRoot(document.getElementById('root'))
  const usd={expenses:[card('usd',1,'USD')]},sgd={expenses:[card('sgd',2,'SGD')]}
  const render=(input,today='2026-10-13',endMonth='2026-09')=>act(()=>root.render(createElement(Probe,{input,today,endMonth})))
  const resolve=(i,symbol)=>act(()=>pending[i].resolve(new Response(JSON.stringify(history(symbol,'2026-09-30',24)))))
  try {
    await render(usd)
    assert.deepEqual(state.fx,[]);assert.equal(state.loading,true)
    await render(sgd)
    assert.deepEqual(state.fx,[]);assert.equal(pending.length,2)
    await resolve(1,'SGDTWD=X')
    assert.equal(state.fx[0].currency,'SGD');assert.equal(state.groups[0].consumption,48)
    await resolve(0,'USDTWD=X')
    assert.equal(state.fx[0].currency,'SGD')
    seen.length=0
    await render(sgd,'2026-10-14')
    assert.deepEqual(seen[0].fx,[])
    assert.equal(state.fx[0].currency,'SGD')
    await act(()=>state.retry())
    assert.deepEqual(state.fx,[]);assert.equal(state.loading,true);assert.equal(pending.length,3)
    await resolve(2,'SGDTWD=X')
    assert.equal(state.fx[0].rate,24)
    await render(sgd,'2026-10-14','2026-08')
    assert.deepEqual(state.fx,[]);assert.deepEqual(state.groups,[])
    await render({expenses:[card('twd',3)]})
    assert.deepEqual(state.fx,[{month:'2026-09',currency:'TWD',targetDate:'2026-09-30',rate:1,legs:[]}])
    assert.equal(pending.length,3)
  } finally {
    await act(()=>root.unmount())
    globalThis.fetch=originalFetch
    dom.window.close()
    for(const key of ['window','document','HTMLElement','IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key]
  }
})
