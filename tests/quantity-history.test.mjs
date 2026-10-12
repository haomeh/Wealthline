import assert from 'node:assert/strict'
import {after,before,test} from 'node:test'
import {createServer} from 'vite'
let server,q,h,m,save,timeline,yahoo
before(async()=>{
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 q=await server.ssrLoadModule('/src/quantityHistory.ts');h=await server.ssrLoadModule('/src/history.ts');m=await server.ssrLoadModule('/src/model.ts');save=await server.ssrLoadModule('/src/saveState.ts');timeline=await server.ssrLoadModule('/src/priceHistory.ts');yahoo=await server.ssrLoadModule('/server/yahoo.ts')
})
after(()=>server.close())
const instrument=(over={})=>({accountId:'synthetic-a',account:'合成帳戶',category:'股票',country:'US',type:'holding',symbol:'TEST',currency:'USD',...over})
const entry=(over={})=>({...instrument(),quantity:2,...over})
const day=(over={})=>({date:'2025-10-04',updatedAt:'2025-10-06T12:00:00Z',entries:[entry()],...over})
const quote=(symbol,currency,close=10)=>({symbol,currency,asTraded:true,splits:[],points:[{date:'2025-10-03',close},{date:'2025-10-06',close:999}]})
const fixture=()=>({...m.emptyData(),accounts:[{id:'synthetic-a',name:'合成帳戶',kind:'investment',category:'股票',country:'US',positions:[{id:'batch1',type:'holding',symbol:'TEST',currency:'USD',quantity:3,price:900},{id:'batch2',type:'holding',symbol:'TEST',currency:'USD',quantity:4,price:800}]}],fxRates:{USD:999}})
test('group key includes account and currency; lots aggregate and old unknown quantities stay unknown',()=>{
 const data=fixture();data.accounts.push({...data.accounts[0],id:'synthetic-b'})
 assert.equal(q.historyCatalog(data).length,2)
 assert.notEqual(q.instrumentKey(entry()),q.instrumentKey(entry({accountId:'synthetic-b'})))
 assert.notEqual(q.instrumentKey(entry()),q.instrumentKey(entry({currency:'TWD'})))
 assert.ok(q.entriesForDate(data,'2025-10-04').every(e=>e.quantity===null))
 data.history.changes=[{at:'2025-10-04T12:00:00Z',accountId:'synthetic-a',account:'合成帳戶',type:'holding',symbol:'TEST',currency:'USD',before:null,after:{quantity:8,price:1}},{at:'2025-10-04T13:00:00Z',accountId:'synthetic-a',account:'合成帳戶',type:'holding',symbol:'TEST',currency:'USD',before:{quantity:8,price:1},after:{quantity:6,price:1}}]
 assert.equal(q.entriesForDate(data,'2025-10-04').find(e=>e.accountId==='synthetic-a').quantity,6)
 assert.equal(q.entriesForDate(data,'2025-10-03')[0].quantity,null)
 assert.equal(q.entriesForDate(data,'2025-10-05')[0].quantity,null)
})
test('valuation uses prior completed close and historical FX; requests contain only market identifiers/date',async()=>{
 const calls=[]
 const fetcher=async(...args)=>{calls.push(args);return args[0]==='USDTWD=X'?quote('USDTWD=X','TWD',30):quote('TEST','USD',10)}
 const rows=await q.valueEntries([entry(),entry({accountId:'synthetic-b',quantity:5})],'2025-10-04',fetcher)
 assert.equal(q.entryValue(rows[0]),600);assert.equal(q.entryValue(rows[1]),1500)
 assert.equal(rows[0].price.date,'2025-10-03');assert.equal(rows[0].fx.date,'2025-10-03')
 assert.deepEqual(calls.sort(),[['TEST','2025-10-04'],['USDTWD=X','2025-10-04']].sort())
 assert.equal(q.quoteOn(quote('TEST','USD'),'2025-10-02'),undefined)
 assert.equal(q.quoteOn(quote('TEST','USD'),'2025-10-14'),undefined)
})
test('missing, wrong-currency, future-only, unverified prices, zero and unknown never use present rates',async()=>{
 for(const source of [null,{...quote('TEST','EUR')},{...quote('TEST','USD'),asTraded:false},{...quote('TEST','USD'),points:[{date:'2025-10-06',close:3}]}]) {
  const [e]=await q.valueEntries([entry()],'2025-10-04',async()=>source)
  assert.equal(q.entryValue(e),null);assert.ok(e.error)
 }
 let calls=0
 const zero=await q.valueEntries([entry({quantity:0}),entry({quantity:null}),entry({type:'cash',symbol:'',currency:'TWD',quantity:25})],'2025-10-04',async()=>{calls++;return null})
 assert.equal(calls,0);assert.deepEqual(zero.map(q.entryValue),[0,null,25])
 const cash=(await q.valueEntries([entry({type:'cash',symbol:'',quantity:25})],'2025-10-04',async()=>quote('USDTWD=X','TWD',30)))[0]
 assert.equal(q.entryValue(cash),750)
})
test('date/quantity/identity validation rejects invalid, duplicate and future entries; date strings are stable',()=>{
 for(const date of ['2025-02-29','2025-13-01','bad','0000-01-01']) assert.throws(()=>q.validatePastDate(date,'2026-10-09T12:00:00Z'))
 assert.throws(()=>q.validatePastDate('2026-10-10','2026-10-09T12:00:00Z'),/未來/)
 assert.doesNotThrow(()=>q.validatePastDate('2024-02-29','2026-10-09T12:00:00Z'))
 for(const quantity of [-1,NaN,Infinity,'1',undefined])assert.throws(()=>q.parseQuantityDays([day({entries:[entry({quantity})]})]))
 assert.throws(()=>q.parseQuantityDays([day(),day()]),/日期不可重複/)
 assert.throws(()=>q.parseQuantityDays([day({entries:[entry(),entry()]})]),/不可重複/)
 assert.throws(()=>q.parseQuantityDays([day({entries:[entry({fx:{source:'Yahoo',symbol:'USDTWD=X',date:'2025-10-06',value:30}})]})]),/日期/)
 assert.equal(q.parseQuantityDays([day()])[0].date,'2025-10-04')
})
test('manual days override history only, preserve unknown debt, order dates and never silently replace existing edits',()=>{
 const data=fixture();data.history.snapshots=[{date:'2025-10-04',at:'2025-10-04T12:00:00Z',total:999,accounts:[{id:'synthetic-a',name:'合成帳戶',value:999}],categories:{股票:999}}]
 const manual=day({entries:[entry({type:'cash',symbol:'',currency:'TWD',quantity:100})]})
 const next=q.applyQuantityDay(data,manual)
 assert.equal(next.accounts,data.accounts);assert.equal(next.liabilities,data.liabilities);assert.equal(next.version,3)
 assert.equal(h.totalPoints(next,'2025-10-08T12:00:00Z')[0].total,100)
 assert.equal(h.totalPoints(next,'2025-10-08T12:00:00Z')[0].netWorth,100)
 assert.throws(()=>q.applyQuantityDay(next,manual),/已新增或變更/)
 const corrected=q.applyQuantityDay(next,{...manual,entries:[entry({type:'cash',symbol:'',currency:'TWD',quantity:50})]},next.history.quantityDays[0])
 assert.equal(h.totalPoints(corrected,'2025-10-08T12:00:00Z')[0].total,50)
 const original={...data.history.snapshots[0],liabilityTotal:150,netWorth:849}
 assert.equal(q.quantityPoint(manual,original).netWorth,-50)
 assert.equal(q.quantityPoint(day(),original).total,null)
 assert.equal(q.quantityPoint(day(),original).netWorth,null)
 const removed={...corrected,history:{...corrected.history,quantityDays:[]}}
 assert.equal(h.totalPoints(removed,'2025-10-08T12:00:00Z')[0].total,999)
})
test('same-day saves keep the manual records winning while recording the day and async history edit retains committed logs',()=>{
 const data=fixture();const now=new Date().toISOString(),date=h.localDate(now)
 const submitted=q.applyQuantityDay(data,day({date,entries:[entry({quantity:0})]}))
 const persisted=h.recordSave(data,{...submitted,updatedAt:now})
 assert.equal(persisted.version,3);assert.deepEqual(persisted.history.quantityDays,submitted.history.quantityDays)
 assert.equal(persisted.history.snapshots.some(s=>s.date===date),true)
 assert.equal(h.totalPoints(persisted,now).find(s=>s.date===date).manual,true)
 assert.equal(h.totalPoints(persisted,now).find(s=>s.date===date).total,0)
 const current=q.applyQuantityDay(submitted,day({date,entries:[entry({quantity:null})]}),submitted.history.quantityDays[0])
 const finished=save.finishSave(current,submitted,persisted)
 assert.equal(finished.history.quantityDays,current.history.quantityDays)
 assert.equal(finished.history.changes,persisted.history.changes)
 assert.equal(finished.accounts[0].positions[0].quantity,3)
 // The unknown quantity keeps the value of the day's own snapshot.
 const point=h.totalPoints(finished,now).find(s=>s.date===date);assert.equal(point.total,persisted.history.snapshots.find(s=>s.date===date).total);assert.deepEqual(point.filled,[{id:'synthetic-a',from:date,reason:'no-record'}])
 assert.deepEqual(m.parseWealthData(JSON.parse(JSON.stringify(persisted))).history.quantityDays,persisted.history.quantityDays)
})
test('duplicate current account/position IDs reject; old schemas remain readable without invented quantity history',()=>{
 const data=fixture();assert.equal(m.parseWealthData(data).history.quantityDays,undefined)
 const v1={...data,version:1};delete v1.liabilities;assert.equal(m.parseWealthData(v1).version,1)
 assert.throws(()=>m.parseWealthData({...data,accounts:[data.accounts[0],data.accounts[0]]}),/識別碼重複/)
 assert.throws(()=>m.parseWealthData({...data,accounts:[{...data.accounts[0],positions:[data.accounts[0].positions[0],data.accounts[0].positions[0]]}]}),/識別碼重複/)
})
test('Yahoo normalizes historical split units, uses exchange timezone, and excludes unfinished daily candles',async()=>{
 const original=globalThis.fetch;let url
 globalThis.fetch=async u=>{url=u;return Response.json({chart:{result:[{meta:{currency:'USD',symbol:'TEST',exchangeTimezoneName:'America/New_York'},timestamp:[Date.parse('2025-03-07T14:30:00Z')/1000,Date.parse('2025-03-10T13:30:00Z')/1000],indicators:{quote:[{close:[25,30]}]},events:{splits:{s:{date:Date.parse('2025-03-10T13:30:00Z')/1000,numerator:4,denominator:1}}}}]}})}
 try{const result=await yahoo.yahooHistory('TEST','2025-03-07');assert.deepEqual(result.points,[{date:'2025-03-07',close:100},{date:'2025-03-10',close:30}]);assert.equal(result.asTraded,true);assert.match(url,/events=splits/);assert.equal(q.quoteOn({...result,points:[result.points[0]]},'2025-03-10'),undefined)}finally{globalThis.fetch=original}
})
test('position timeline aggregates lots, uses explicit day and never uses current FX for the past',()=>{
 const data=fixture(),account=data.accounts[0],p=account.positions[0]
 data.history.changes=[{at:'2025-10-03T12:00:00Z',accountId:account.id,account:account.name,type:'holding',symbol:'TEST',currency:'USD',before:null,after:{quantity:7,price:123}}]
 const result=timeline.positionTimeline(data,account,p,quote('TEST','USD'),null,'2025-10-07T12:00:00Z')
 assert.ok(result.days.filter(d=>!d.live).every(d=>d.value===null))
 assert.equal(result.days.at(-1).quantity,7)
 data.history.quantityDays=[day({entries:[entry({quantity:0})]})]
 assert.equal(timeline.positionTimeline(data,account,p,null,null,'2025-10-07T12:00:00Z').days.find(d=>d.date==='2025-10-04').value,0)
})

test('explicit calendar dates survive timezone changes and saved valuations do not leak into a new day',()=>{
 const data=fixture()
 data.history.quantityDays=[day({entries:[entry({price:{source:'Yahoo',symbol:'TEST',date:'2025-10-03',value:10},fx:{source:'Yahoo',symbol:'USDTWD=X',date:'2025-10-03',value:30}})]})]
 const originalZone=process.env.TZ
 try{for(const zone of ['Pacific/Kiritimati','America/Los_Angeles','Asia/Taipei']){process.env.TZ=zone;assert.equal(m.parseWealthData(JSON.parse(JSON.stringify({...data,version:3}))).history.quantityDays[0].date,'2025-10-04')}}finally{if(originalZone===undefined)delete process.env.TZ;else process.env.TZ=originalZone}
 const next=q.entriesForDate(data,'2025-01-01')[0]
 assert.equal(next.quantity,null);assert.equal(next.price,undefined);assert.equal(next.fx,undefined)
})
test('editing quantity history during a v2 save never downgrades the v3 in-memory document',()=>{
 const before=fixture(),persisted=h.recordSave(before,{...before,updatedAt:new Date().toISOString()})
 const current=q.applyQuantityDay(before,day({entries:[entry({quantity:0})]}))
 const result=save.finishSave(current,before,persisted)
 assert.equal(persisted.version,2);assert.equal(result.version,3)
 assert.equal(result.history.quantityDays,current.history.quantityDays)
 assert.equal(result.history.snapshots,persisted.history.snapshots)
})
test('incomplete portfolios, overflow and uncovered legacy accounts cannot appear as complete totals',()=>{
 const a=entry({type:'cash',symbol:'',currency:'TWD',quantity:50}),unknown=entry({accountId:'other',quantity:null})
 assert.equal(q.quantityPoint(day({entries:[a,unknown]})).total,null)
 assert.equal(q.quantityPoint(day({entries:[a]}),{date:'2025-10-04',at:'2025-10-04',total:500,accounts:[{id:'missing',name:'舊帳戶',value:500}],categories:{}}).total,null)
 assert.equal(q.entryValue(entry({quantity:1e308,price:{value:1e308},fx:{value:30}})),null)
})
test('today incomplete candle is not returned and malformed provider responses fail closed',async()=>{
 const original=globalThis.fetch
 try{
 globalThis.fetch=async()=>Response.json({chart:{result:[{meta:{currency:'USD',symbol:'TEST',exchangeTimezoneName:'UTC'},timestamp:[Math.floor(Date.now()/1000)],indicators:{quote:[{close:[123]}]}}]}})
 assert.deepEqual((await yahoo.yahooHistory('TEST','2025-10-04')).points,[])
 globalThis.fetch=async()=>Response.json({symbol:'TEST',currency:'USD',points:[null]})
 assert.equal((await timeline.fetchHistory('TEST','2025-10-04',true)).failure,'invalid_response')
 globalThis.fetch=async()=>new Response('invalid json',{status:200})
 assert.equal((await timeline.fetchHistory('TEST','2025-10-04',true)).failure,'invalid_response')
 }finally{globalThis.fetch=original}
})
const twHolding=(over={})=>({id:'tw',type:'holding',symbol:'2330.TW',currency:'TWD',quantity:400,price:1000,...over})
const twAccount=(positions)=>({id:'tw-acc',name:'合成台股',kind:'investment',category:'台股',country:'TW',positions})
const daily=(from,to,close)=>{const out=[];for(let t=Date.parse(`${from}T00:00:00Z`);t<=Date.parse(`${to}T00:00:00Z`);t+=86400000)out.push({date:new Date(t).toISOString().slice(0,10),close:typeof close==='function'?close(new Date(t).toISOString().slice(0,10)):close});return out}
test('a holding with no change log is valued at its current quantity from the day it was added',()=>{
 const p=twHolding({addedAt:'2026-09-20T04:00:00Z'}),account=twAccount([p]),data={...m.emptyData(),accounts:[account]}
 const prices={symbol:'2330.TW',currency:'TWD',asTraded:true,splits:[],points:daily('2026-09-01','2026-10-08',900)}
 const days=timeline.positionTimeline(data,account,p,prices,null,'2026-10-09T04:00:00Z').days
 assert.equal(days[0].date,'2026-09-20')
 assert.ok(days.filter(d=>!d.live).every(d=>d.quantity===400&&d.value===360000))
})
test('quantities carried across a split are converted to the units held on each day',()=>{
 const p=twHolding({quantity:40,addedAt:'2025-03-05T04:00:00Z'}),account=twAccount([p]),data={...m.emptyData(),accounts:[account]}
 const prices={symbol:'2330.TW',currency:'TWD',asTraded:true,splits:[{date:'2025-03-10',ratio:4}],points:[{date:'2025-03-07',close:100},{date:'2025-03-11',close:25}]}
 const days=timeline.positionTimeline(data,account,p,prices,null,'2025-03-12T04:00:00Z').days
 assert.deepEqual(days.map(d=>[d.date,d.quantity,d.value]),[['2025-03-05',10,null],['2025-03-07',10,1000],['2025-03-11',40,1000],['2025-03-12',40,40000]])
})
test('entered quantities carry forward until the next logged edit, entry or recorded day',()=>{
 const p=twHolding({addedAt:'2026-10-08T04:00:00Z'}),account=twAccount([p])
 const at=(date,quantity)=>({date,updatedAt:'2026-10-09T00:00:00Z',entries:[{accountId:'tw-acc',account:'合成台股',category:'台股',country:'TW',type:'holding',symbol:'2330.TW',currency:'TWD',quantity,price:{source:'Yahoo',symbol:'2330.TW',date,value:900}}]})
 const data={...m.emptyData(),accounts:[account],history:{changes:[{at:'2026-10-08T04:00:00Z',accountId:'tw-acc',account:'合成台股',type:'holding',symbol:'2330.TW',currency:'TWD',before:null,after:{quantity:400,price:1000}}],snapshots:[],quantityDays:[at('2026-09-10',100),at('2026-09-15',400)]}}
 const prices={symbol:'2330.TW',currency:'TWD',asTraded:true,splits:[],points:daily('2026-09-01','2026-10-08',900)}
 const byDate=new Map(timeline.positionTimeline(data,account,p,prices,null,'2026-10-09T04:00:00Z').days.map(d=>[d.date,d.quantity]))
 assert.equal(byDate.has('2026-09-09'),false)
 assert.deepEqual(['2026-09-10','2026-09-14','2026-09-15','2026-10-07','2026-10-08'].map(d=>byDate.get(d)),[100,100,400,400,400])
 data.history.snapshots=[{date:'2026-09-20',at:'2026-09-20T12:00:00Z',total:0,accounts:[],categories:{}}]
 const stopped=new Map(timeline.positionTimeline(data,account,p,prices,null,'2026-10-09T04:00:00Z').days.map(d=>[d.date,d.quantity]))
 assert.deepEqual(['2026-09-19','2026-09-20','2026-10-07'].map(d=>stopped.has(d)?stopped.get(d):'none'),[400,'none','none'])
})
test('legacy typed prices remain readable but never replace market quotes',async()=>{
 const fund=entry({symbol:'基金與退休金',currency:'TWD',quantity:2,price:{source:'manual',symbol:'基金與退休金',date:'2025-10-04',value:1000}})
 assert.deepEqual(q.parseQuantityDays([day({entries:[fund]})])[0].entries[0].price,fund.price)
 assert.equal(q.entryValue(fund),null)
 let requests=0
 const [valued]=await q.valueEntries([fund],'2025-10-04',async()=>{requests++;return null})
 assert.equal(requests,0);assert.equal(q.entryValue(valued),null);assert.equal(valued.price,undefined)
 const stock=entry({currency:'TWD',price:{source:'manual',symbol:'TEST',date:'2025-10-04',value:999}})
 const [fresh]=await q.valueEntries([stock],'2025-10-04',async()=>quote('TEST','TWD',10))
 assert.equal(q.entryValue(fresh),20);assert.equal(fresh.price.source,'Yahoo')
})
test('an account that was empty in the original snapshot does not make a day incomplete',()=>{
 const cash=entry({type:'cash',symbol:'',currency:'TWD',quantity:50})
 const original={date:'2025-10-04',at:'2025-10-04',total:50,accounts:[{id:'synthetic-a',name:'合成帳戶',value:50},{id:'empty',name:'空帳戶',value:0}],categories:{}}
 assert.equal(q.quantityPoint(day({entries:[cash]}),original).total,50)
})
test('history requests older than ten years are cut to ten years instead of refused',async()=>{
 const original=globalThis.fetch;let url
 globalThis.fetch=async u=>{url=u;return Response.json({chart:{result:[{meta:{currency:'USD',symbol:'TEST',exchangeTimezoneName:'UTC'},timestamp:[],indicators:{quote:[{close:[]}]}}]}})}
 try{
  assert.ok(await yahoo.yahooHistory('TEST','2001-01-01'))
  const period1=Number(new URL(url).searchParams.get('period1'))*1000
  assert.ok(period1>Date.now()-11*365*86400000)
 }finally{globalThis.fetch=original}
})

test('R1 each lot counts from its own added date and current manual prices are never used for the past',()=>{
 const first=twHolding({quantity:10,addedAt:'2026-10-01T12:00:00Z'}),later=twHolding({id:'later-lot',quantity:20,addedAt:'2026-10-05T12:00:00Z'})
 const account=twAccount([first,later]),data={...m.emptyData(),accounts:[account]}
 const prices={symbol:'2330.TW',currency:'TWD',asTraded:true,points:daily('2026-10-01','2026-10-08',100),splits:[]}
 const dates=timeline.positionTimeline(data,account,first,prices,null,'2026-10-09T12:00:00Z').days
 assert.deepEqual([dates.find(d=>d.date==='2026-10-02').quantity,dates.find(d=>d.date==='2026-10-02').value],[10,1000])
 assert.deepEqual([dates.find(d=>d.date==='2026-10-05').quantity,dates.find(d=>d.date==='2026-10-05').value],[30,3000])
 assert.equal(dates.at(-1).quantity,30)
 first.priceManual=true;first.price=999
 assert.ok(timeline.positionTimeline(data,account,first,null,null,'2026-10-09T12:00:00Z').days.filter(d=>!d.live).every(d=>d.value===null))
 assert.equal(first.price,999)
})
test('R2 selected-day correction and next-day values agree between position and aggregate histories',async()=>{
 const p=twHolding({quantity:10,price:100,addedAt:'2026-10-01T12:00:00Z'}),account=twAccount([p]),data={...m.emptyData(),accounts:[account]}
 data.history.changes=[{at:'2026-10-01T12:00:00Z',accountId:account.id,account:account.name,type:p.type,symbol:p.symbol,currency:p.currency,before:null,after:{quantity:10,price:100}}]
 data.history.snapshots=[{date:'2026-10-03',at:'2026-10-03T12:00:00Z',total:1000,accounts:[{id:account.id,name:account.name,value:1000}],categories:{台股:1000}}]
 const prices={symbol:p.symbol,currency:'TWD',asTraded:true,points:daily('2026-10-01','2026-10-08',100),splits:[]}
 const e={accountId:account.id,account:account.name,category:account.category,country:account.country,type:p.type,symbol:p.symbol,currency:p.currency,quantity:20,price:{source:'manual',symbol:p.symbol,date:'2026-10-02',value:999}}
 data.history.quantityDays=[{date:'2026-10-02',updatedAt:'2026-10-09T12:00:00Z',entries:await q.valueEntries([e],'2026-10-02',async()=>prices)}]
 const positions=timeline.positionTimeline(data,account,p,prices,null,'2026-10-09T12:00:00Z').days
 const totals=h.totalPoints(data,'2026-10-09T12:00:00Z')
 for(const date of ['2026-10-02','2026-10-03'])assert.equal(positions.find(d=>d.date===date).value,totals.find(d=>d.date===date).total)
 assert.equal(positions.find(d=>d.date==='2026-10-03').quantity,10)
})
test('R3 zero holding intervals are explicit zero points, not skipped or interpolated away',()=>{
 const p=twHolding({quantity:10,price:100,addedAt:'2026-10-01T12:00:00Z'}),account=twAccount([p]),data={...m.emptyData(),accounts:[account]}
 data.history.changes=[['2026-10-01',10],['2026-10-03',0],['2026-10-06',10]].map(([date,quantity])=>({at:date+'T12:00:00Z',accountId:account.id,account:account.name,type:p.type,symbol:p.symbol,currency:p.currency,before:null,after:{quantity,price:100}}))
 const prices={symbol:p.symbol,currency:'TWD',asTraded:true,points:daily('2026-10-01','2026-10-08',100),splits:[{date:'2026-10-04',ratio:4}]}
 const days=timeline.positionTimeline(data,account,p,prices,null,'2026-10-09T12:00:00Z').days
 for(const date of ['2026-10-03','2026-10-04','2026-10-05'])assert.deepEqual([days.find(d=>d.date===date).quantity,days.find(d=>d.date===date).value],[0,0])
})
test('fresh market prices replace all stored prices, failed queries never fall back, and stablecoins are not pegged',async()=>{
 const stored=entry({quantity:2,price:{source:'Yahoo',symbol:'TEST',date:'2025-10-03',value:999},fx:{source:'Yahoo',symbol:'USDTWD=X',date:'2025-10-03',value:999}})
 const [fresh]=await q.valueEntries([stored],'2025-10-04',async symbol=>symbol==='USDTWD=X'?quote(symbol,'TWD',30):quote(symbol,'USD',10))
 assert.equal(q.entryValue(fresh),600)
 const [missing]=await q.valueEntries([stored],'2025-10-04',async()=>null)
 assert.equal(q.entryValue(missing),null);assert.equal(stored.price.value,999)
 const stable=entry({type:'cash',symbol:'',currency:'USDT',quantity:10})
 const [unknown]=await q.valueEntries([stable],'2025-10-04',async()=>null)
 assert.equal(q.entryValue(unknown),null)
})
test('entered days share one market query per symbol from the earliest day',async()=>{
 const calls=[]
 const fetcher=async(symbol,from)=>{calls.push([symbol,from]);return symbol==='USDTWD=X'?quote(symbol,'TWD',30):quote(symbol,'USD',10)}
 const days=[day({date:'2025-10-04'}),day({date:'2025-09-20'}),day({date:'2025-10-01',entries:[entry({accountId:'synthetic-b'})]})]
 const valued=await q.valueDays(days,fetcher)
 assert.deepEqual(calls.sort(),[['TEST','2025-09-20'],['USDTWD=X','2025-09-20']])
 assert.equal(q.entryValue(valued[0].entries[0]),600)
})
test('history queries use the browser cache unless the user asks to query again',async()=>{
 const original=globalThis.fetch,modes=[]
 globalThis.fetch=async(_url,init)=>{modes.push(init?.cache);return Response.json({symbol:'TEST',currency:'USD',asTraded:true,points:[]})}
 try{
  timeline.clearHistoryCache()
  await timeline.fetchHistory('CACHE','2025-10-04');await timeline.fetchHistory('CACHE','2025-10-04')
  await timeline.fetchHistory('CACHE','2025-10-04',true)
  assert.deepEqual(modes,['default','no-cache'])
 }finally{globalThis.fetch=original;timeline.clearHistoryCache()}
})
test('a typed price change is not a count, and a lot added later is never counted into an earlier day',()=>{
 const l1={...twHolding({id:'l1',symbol:'TEST',quantity:10,price:10,priceManual:true}),addedAt:'2025-10-01T04:00:00Z'},l2={...l1,id:'l2',addedAt:'2025-10-05T04:00:00Z'}
 const account=twAccount([l1,l2]),saved={...m.emptyData(),accounts:[account],updatedAt:'2025-10-07T04:00:00Z'}
 const prices={symbol:'TEST',currency:'TWD',asTraded:true,splits:[],points:daily('2025-10-01','2025-10-08',10)}
 const on=(data,date)=>timeline.positionTimeline(data,data.accounts[0],data.accounts[0].positions[0],prices,null,'2025-10-09T04:00:00Z').days.find(d=>d.date===date)
 const repriced=h.recordSave(saved,{...saved,updatedAt:'2025-10-08T04:00:00Z',accounts:[{...account,positions:[l1,{...l2,price:11}]}]})
 assert.equal(repriced.history.changes.length,1)
 assert.deepEqual([on(repriced,'2025-10-02').quantity,on(repriced,'2025-10-02').value],[10,100])
 assert.equal(on(repriced,'2025-10-06').quantity,20)
 const resized=h.recordSave(saved,{...saved,updatedAt:'2025-10-08T04:00:00Z',accounts:[{...account,positions:[l1,{...l2,quantity:15}]}]})
 assert.deepEqual([on(resized,'2025-10-02').quantity,on(resized,'2025-10-02').value],[null,null])
 assert.equal(on(resized,'2025-10-06').quantity,20)
 assert.equal(on(resized,'2025-10-08').quantity,25)
})
test('saving on a day with entered quantities keeps that day\'s debt for later days',()=>{
 const account={id:'cash-acc',name:'合成現金',kind:'bank',category:'現金與外幣活存',country:'TW',positions:[{id:'twd',type:'cash',symbol:'',currency:'TWD',quantity:500,price:1}]}
 const loan={id:'loan',name:'合成貸款',kind:'personal',currency:'TWD',balance:1200,annualRate:0,repaymentMethod:'annuity',remainingInstallments:12,schedule:{source:'original',baseDate:'2025-09-29',firstDueDate:'2025-09-30',monthlyDay:30,timeZone:'Asia/Taipei'}}
 const morning={date:'2025-10-04',at:'2025-10-04T01:00:00Z',total:500,accounts:[{id:'cash-acc',name:'合成現金',value:500}],categories:{現金與外幣活存:500},liabilityTotal:0,netWorth:500}
 for(const snapshots of [[morning],[]]){
  const saved={...m.emptyData(),accounts:[account],liabilities:[],updatedAt:'2025-10-04T01:00:00Z',history:{changes:[],snapshots}}
  const entered=q.applyQuantityDay(saved,{date:'2025-10-04',updatedAt:'2025-10-04T05:00:00Z',entries:[{accountId:'cash-acc',account:'合成現金',category:'現金與外幣活存',country:'TW',type:'cash',symbol:'',currency:'TWD',quantity:500}]},undefined)
  const persisted=h.recordSave(saved,{...entered,liabilities:[loan],updatedAt:'2025-10-04T06:00:00Z'})
  const reloaded=m.parseWealthData(JSON.parse(JSON.stringify(persisted)))
  for(const now of ['2025-10-04T07:00:00Z','2025-10-05T07:00:00Z']){
   const point=h.totalPoints(reloaded,now).find(s=>s.date==='2025-10-04')
   assert.deepEqual([point.manual,point.total,point.liabilityTotal,point.netWorth,point.liabilityEstimated],[true,500,1100,-600,true])
  }
 }
})
