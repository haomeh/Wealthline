import assert from 'node:assert/strict'
import { after, afterEach, before, test } from 'node:test'
import { createServer } from 'vite'

let server, prices, cashflow, fx, quantity, model, exporter, reports
const originalFetch = globalThis.fetch
before(async () => {
  server = await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  ;[prices,cashflow,fx,quantity,model,exporter,reports] = await Promise.all(['src/priceHistory','src/cashflow','src/cashflowFx','src/quantityHistory','src/model','src/monthlyReportExport','src/monthlyReport'].map(path=>server.ssrLoadModule(`/${path}.ts`)))
})
afterEach(() => { globalThis.fetch=originalFetch;prices.clearHistoryCache() })
after(() => server?.close())

// Public production response shape captured on 2026-10-24 for USDTWD=X/from=2026-06-30.
const usd = () => ({symbol:'TWD=X',currency:'TWD',asTraded:true,splits:[],points:[{date:'2026-06-29',close:Number('31.847000122070312')},{date:'2026-06-30',close:31.86590003967285},{date:'2026-07-01',close:31.834400177001953}]})
const jpy = () => ({symbol:'JPYTWD=X',currency:'TWD',asTraded:true,splits:[],points:[{date:'2026-01-30',close:0.20473800599575043}]})
const card = (currency,amount,date='2026-06-15') => ({id:`synthetic-${currency}`,date,currency,amount,description:'Synthetic only',card:'Synthetic',category:'購物'})
const entry = () => ({accountId:'synthetic',account:'Synthetic',category:'其他',country:'US',type:'cash',symbol:'',currency:'USD',quantity:2})
const groups = expenses => cashflow.cashflowSummary({expenses},'2026-06','all')

test('cached USD provider alias converts the complete mixed total and keeps source history untouched', async () => {
  const calls=[],body=usd(),before=structuredClone(body)
  globalThis.fetch=async url=>{
    calls.push(String(url))
    const symbol=new URL(url,'https://synthetic.invalid').searchParams.get('symbol')
    return Response.json(symbol==='JPYTWD=X'?jpy():body)
  }
  const history=await prices.fetchHistory('USDTWD=X','2026-06-30')
  const result=await fx.cashflowWithFxEvidence(groups([card('USD',2),card('TWD',50),card('JPY',100,'2026-01-15')]),'2026-10-24')
  assert.ok(Math.abs(result.group.consumption-134.20560067892075)<1e-9)
  assert.equal(result.fx.find(value=>value.currency==='USD').legs[0].symbol,'USDTWD=X')
  assert.deepEqual(result.fx.find(value=>value.currency==='JPY').legs,[{symbol:'JPYTWD=X',date:'2026-01-30',rate:0.20473800599575043}])
  assert.deepEqual(calls.sort(),['/api/history?symbol=JPYTWD%3DX&from=2026-01-31','/api/history?symbol=USDTWD%3DX&from=2026-06-30'].sort())
  assert.equal(history.symbol,'TWD=X')
  assert.deepEqual(body,before)
})

test('both quantity FX writers preserve logical symbols accepted by existing saved-data readers', async () => {
  const source=usd(),before=structuredClone(source)
  const fresh=(await quantity.valueEntries([entry()],'2026-06-30',async symbol=>{
    assert.equal(symbol,'USDTWD=X')
    return source
  }))[0]
  const repriced=quantity.repriceEntry(entry(),'2026-06-30',null,source)
  for (const value of [fresh,repriced]) {
    assert.deepEqual(value.fx,{source:'Yahoo',symbol:'USDTWD=X',date:'2026-06-30',value:31.86590003967285})
    assert.equal(quantity.entryValue(value),63.7318000793457)
    const day={date:'2026-06-30',updatedAt:'2026-10-24T00:00:00Z',entries:[value]}
    assert.deepEqual(quantity.parseQuantityDays(JSON.parse(JSON.stringify([day]))),[day])
    const saved=quantity.applyQuantityDay(model.emptyData(),day)
    assert.deepEqual(model.parseWealthData(JSON.parse(JSON.stringify(saved))).history.quantityDays,[day])
  }
  assert.deepEqual(source,before)
})

test('USD alias monthly reports retain logical FX legs and reopen through the unchanged reader', async () => {
  const data={...model.emptyData(),expenses:[card('USD',2)]}
  const report=await exporter.generateMonthlyReport({data,isCurrent:()=>true},'2026-06','2026-10-24',async()=>usd())
  assert.deepEqual(report.fx,[{month:'2026-06',currency:'USD',targetDate:'2026-06-30',rate:31.86590003967285,legs:[{symbol:'USDTWD=X',date:'2026-06-30',rate:31.86590003967285}]}])
  assert.equal(report.totals.consumption,63.7318000793457)
  assert.deepEqual(await reports.parseMonthlyReport(JSON.parse(JSON.stringify(report))),report)
})

test('wrong, inverse, unrelated and unverified FX cannot be normalized into valid saved evidence', async () => {
  const bad=[
    {...usd(),symbol:'EURTWD=X'}, {...usd(),symbol:'TWDUSD=X'}, {...usd(),symbol:'JPY=X'}, {...usd(),symbol:'2330.TW'},
    {...usd(),currency:'USD'}, {...usd(),asTraded:false}, {...usd(),asTraded:undefined},
    ...[{date:'2026-07-01',close:32},{date:'2026-06-22',close:32},{date:'2026-06-31',close:32},
      {date:'2026-06-30',close:0},{date:'2026-06-30',close:-1},{date:'2026-06-30',close:NaN},{date:'2026-06-30',close:Infinity}].map(point=>({...usd(),points:[point]})),
  ]
  for (const source of bad) {
    await assert.rejects(fx.cashflowWithFxEvidence(groups([card('USD',2),card('TWD',50)]),'2026-10-24',async()=>source))
    const fresh=(await quantity.valueEntries([entry()],'2026-06-30',async()=>source))[0]
    const repriced=quantity.repriceEntry(entry(),'2026-06-30',null,source)
    for (const value of [fresh,repriced]) {
      assert.equal(value.fx,undefined,JSON.stringify(source))
      assert.equal(quantity.entryValue(value),null)
      assert.ok(value.error)
    }
  }
})

test('the TWD=X provider alias applies only to USD and never changes another currency pair', async () => {
  for (const currency of ['JPY','SGD','EUR']) {
    await assert.rejects(fx.cashflowWithFxEvidence(groups([card(currency,2)]),'2026-10-24',async()=>usd()),/來源行情代號不符/)
  }
})
