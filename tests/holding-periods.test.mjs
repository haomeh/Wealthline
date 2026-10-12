import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
let server,p,q,m,h,s,t
before(async()=>{
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;[p,q,m,h,s,t]=await Promise.all(['holdingPeriods','quantityHistory','model','history','saveState','priceHistory'].map(n=>server.ssrLoadModule(`/src/${n}.ts`)))
})
after(()=>server.close())
const now='2026-10-09T12:00:00Z'
const identity={accountId:'a',account:'合成帳戶',category:'股票',country:'TW',type:'holding',symbol:'TEST',currency:'TWD'}
const period=(over={})=>({...identity,id:'p1',updatedAt:now,start:'2026-09-01',end:'2026-10-02',quantity:10,timeZone:'Asia/Taipei',...over})
const fixture=()=>({...m.emptyData(),accounts:[{id:'a',name:'合成帳戶',kind:'investment',category:'股票',country:'TW',positions:[{id:'pos',type:'holding',symbol:'TEST',currency:'TWD',quantity:99,price:10}]}]})
const withPeriod=(over={})=>{const d=fixture();d.version=5;d.history.holdingPeriods=[period(over)];return d}
const count=(d,date)=>p.periodQuantityOn(d,identity,date)?.quantity
const explicit=(date,quantity)=>({date,updatedAt:now,entries:[{...identity,quantity}]})
const change=(at,before,after)=>({...identity,at,before,after})
const prices=()=>({symbol:'TEST',currency:'TWD',asTraded:true,splits:[],points:[{date:'2026-10-01',close:10},{date:'2026-10-02',close:10},{date:'2026-10-05',close:10},{date:'2026-10-08',close:10}]})
test('period start inclusive / end exclusive; ended means zero and later rebuy resumes',()=>{
 const d=withPeriod();assert.equal(count(d,'2026-08-31'),undefined)
 assert.equal(count(d,'2026-09-01'),10);assert.equal(count(d,'2026-10-01'),10);assert.equal(count(d,'2026-10-02'),0);assert.equal(count(d,'2026-10-08'),0)
 d.history.quantityDays=[explicit('2026-10-05',3)]
 assert.equal(count(d,'2026-10-04'),0);assert.equal(count(d,'2026-10-05'),3);assert.equal(count(d,'2026-10-08'),3)
 const rows=p.expandPeriodDays(d,now);assert.equal(rows.at(-1).date,'2026-10-08');assert.equal(d.accounts[0].positions[0].quantity,99)
 assert.equal(p.periodQuantityOn(d,{...identity,accountId:'b'},'2026-10-01'),undefined)
})
test('ongoing baseline preserves explicit daily values, unknowns and quantity logs, ignores price-only logs',()=>{
 const d=withPeriod({end:undefined});d.history.quantityDays=[explicit('2026-09-05',4),explicit('2026-10-06',null)]
 d.history.changes=[change('2026-10-01T12:00:00Z',{quantity:4,price:1},{quantity:4,price:9}),change('2026-10-03T12:00:00Z',{quantity:4,price:9},{quantity:6,price:9})]
 assert.equal(count(d,'2026-10-01'),4);assert.equal(count(d,'2026-10-03'),6);assert.equal(count(d,'2026-10-07'),null)
 d.history.quantityDays.push(explicit('2026-09-01',2));assert.equal(count(d,'2026-09-01'),2)
 d.history.holdingPeriods[0].end='2026-10-02';d.history.quantityDays.push(explicit('2026-10-02',8));assert.equal(count(d,'2026-10-02'),8)
})
test('overlap needs confirmation, later start retires old end; original records remain recoverable',()=>{
 const d=withPeriod();const nextPeriod=period({id:'p2',start:'2026-09-20',end:'2026-10-06',quantity:20})
 assert.throws(()=>p.applyHoldingPeriod(d,nextPeriod,p.periodRevision(d),false,now),/確認/)
 const next=p.applyHoldingPeriod(d,nextPeriod,p.periodRevision(d),true,now)
 assert.equal(count(next,'2026-09-19'),10);assert.equal(count(next,'2026-10-02'),20);assert.equal(count(next,'2026-10-06'),0)
 assert.equal(d.history.holdingPeriods.length,1);assert.deepEqual(next.history.holdingPeriods[0],d.history.holdingPeriods[0])
 const same=p.applyHoldingPeriod(next,period({id:'p3',start:'2026-09-20',end:undefined,quantity:30}),p.periodRevision(next),true,now)
 assert.equal(count(same,'2026-10-07'),30)
 const removed={...same,history:{...same.history,holdingPeriods:same.history.holdingPeriods.filter(x=>x.id!=='p3')}}
 assert.equal(count(removed,'2026-10-07'),0)
 assert.throws(()=>p.applyHoldingPeriod(next,period({id:'p4'}),p.periodRevision(d),true,now),/重新預覽/)
})
test('date, quantity, timezone, schema validation and resource bounds',()=>{
 for(const over of [{end:'2026-09-01'},{end:'2026-08-31'},{start:'2026-10-10',end:undefined},{end:'2026-10-10'},{quantity:-1},{quantity:NaN},{quantity:Infinity},{quantity:null},{timeZone:'Invalid/Zone'},{start:'2010-01-01'},{start:'2025-02-29'}]) assert.throws(()=>p.validatePeriodInput(period(over),now),JSON.stringify(over))
 assert.doesNotThrow(()=>p.validatePeriodInput(period({start:'2024-02-29',quantity:0.25}),now))
 assert.doesNotThrow(()=>p.validatePeriodInput(period({start:'2026-10-09',end:undefined,timeZone:'Asia/Tokyo'}),'2026-10-08T16:00:00Z'))
 assert.throws(()=>p.validatePeriodInput(period({start:'2026-10-09',end:undefined,timeZone:'America/Los_Angeles'}),'2026-10-08T16:00:00Z'))
 assert.throws(()=>p.parseHoldingPeriods([period(),period({id:'p2',timeZone:'UTC'})]),/相同日曆時區/)
 assert.throws(()=>p.parseHoldingPeriods([period(),period()]))
 const d=withPeriod({start:'2010-01-01'});assert.equal(p.expandPeriodDays(d,now).length,p.MAX_PERIOD_DAYS)
 d.accounts[0].positions=Array.from({length:15},(_,i)=>({...d.accounts[0].positions[0],id:`pos${i}`,symbol:`TEST${i}`}))
 assert.throws(()=>p.expandPeriodDays(d,now),/50,000/)
})
test('stored IANA timezone assigns trade instants consistently over DST',()=>{
 const d=withPeriod({start:'2026-03-01',end:undefined,timeZone:'America/New_York'})
 d.history.changes=[change('2026-03-08T04:30:00Z',null,{quantity:4,price:1}),change('2026-03-09T03:30:00Z',null,{quantity:7,price:1})]
 assert.equal(count(d,'2026-03-07'),4);assert.equal(count(d,'2026-03-08'),7)
 const zone=process.env.TZ
 try{for(const tz of ['UTC','Asia/Taipei','America/Los_Angeles']){process.env.TZ=tz;assert.equal(count(d,'2026-03-08'),7);assert.equal(p.shiftDate('2026-03-08',1),'2026-03-09')}}finally{if(zone===undefined)delete process.env.TZ;else process.env.TZ=zone}
})
test('split adjustment, weekends and zero agree between position chart and shared totals',async()=>{
 const d=withPeriod({start:'2026-10-01',end:'2026-10-08'})
 const quote=prices();quote.splits=[{date:'2026-10-05',ratio:2}];quote.points=quote.points.map(x=>({...x,close:x.date>='2026-10-05'?5:10}))
 const days=await q.valueDays(p.expandPeriodDays(d,now),async()=>quote)
 const timeline=t.positionTimeline(d,d.accounts[0],d.accounts[0].positions[0],quote,null,now).days
 for(const day of days){const chart=timeline.find(x=>x.date===day.date);assert.equal(q.quantityPoint(day).total,chart.value,day.date);assert.equal(day.entries[0].quantity,chart.quantity,day.date)}
 assert.equal(days.find(x=>x.date==='2026-10-04').entries[0].quantity,10)
 assert.equal(days.find(x=>x.date==='2026-10-05').entries[0].quantity,20)
 assert.equal(days.find(x=>x.date==='2026-10-08').entries[0].quantity,0)
 const totals=h.totalPoints({...d,history:{...d.history,valuedQuantityDays:days}},now)
 assert.equal(totals.find(x=>x.date==='2026-10-05').total,100)
 assert.equal(totals.find(x=>x.date==='2026-10-08').total,0)
 assert.equal(totals.at(-1).total,990)
 const missing=await q.valueDays(p.expandPeriodDays(d,now),async()=>null)
 assert.equal(q.quantityPoint(missing[0]).total,null);assert.equal(q.quantityPoint(missing.at(-1)).total,0)
 assert.equal(d.history.holdingPeriods[0].quantity,10)
})
test('uncovered accounts keep totals unknown and do not inherit a different account period',async()=>{
 const d=withPeriod({start:'2026-10-01'});d.accounts.push({...d.accounts[0],id:'b'})
 const days=await q.valueDays(p.expandPeriodDays(d,now),async()=>prices())
 assert.equal(days[0].entries.find(e=>e.accountId==='b').quantity,null)
 assert.equal(q.quantityPoint(days[0]).total,null)
 assert.equal(q.quantityPoint({...days[0],entries:[days[0].entries[0]]},{liabilityTotal:50,liabilityEstimated:true,accounts:[]}).netWorth,50)
})
test('v1–v5 round trips and save races retain raw intervals without persisting generated dates',()=>{
 for(const version of [1,2,3,4])assert.equal(m.parseWealthData({...fixture(),version}).version,version)
 const d=withPeriod();d.history.quantityDays=[explicit('2026-09-04',8)]
 assert.deepEqual(m.parseWealthData(JSON.parse(JSON.stringify(d))).history.holdingPeriods,d.history.holdingPeriods)
 const saved=h.recordSave(null,{...d,history:{...d.history,valuedQuantityDays:p.expandPeriodDays(d,now)}})
 assert.equal(saved.version,5);assert.equal(saved.history.valuedQuantityDays,undefined);assert.equal(saved.history.quantityDays.length,1)
 const current=p.applyHoldingPeriod(d,period({id:'p2',start:'2026-10-03',end:undefined}),p.periodRevision(d),true,now)
 const merged=s.finishSave(current,d,saved)
 assert.deepEqual(merged.history.holdingPeriods,current.history.holdingPeriods);assert.equal(merged.history.snapshots,saved.history.snapshots);assert.equal(merged.version,5)
 assert.deepEqual(merged.accounts.map(a=>a.positions.map(x=>x.quantity)),[[99]])
})

test('review: period projection preserves known snapshots, while explicit day overrides and removal restores',async()=>{
 const d=fixture();d.accounts.push({id:'b',name:'合成B',kind:'bank',category:'現金',country:'TW',positions:[{id:'cash',type:'cash',symbol:'',currency:'TWD',quantity:1000,price:1}]})
 d.accounts[0].positions[0].quantity=10
 d.history.snapshots=['05','06','07','08'].map(day=>h.snapshotOf(d,`2026-10-${day}T12:00:00Z`))
 d.history.holdingPeriods=[period({start:'2026-10-01',end:'2026-10-03'})]
 const values=await q.valueDays(p.expandPeriodDays(d,now),async()=>prices())
 const totals=h.totalPoints({...d,history:{...d.history,valuedQuantityDays:values}},now)
 for(const date of ['2026-10-05','2026-10-06','2026-10-07','2026-10-08']){
  const row=totals.find(x=>x.date===date);assert.equal(row.total,1100);assert.equal(row.periodDerived,undefined)
 }
 assert.equal(totals.find(x=>x.date==='2026-10-04'),undefined)
 assert.equal(values.find(x=>x.date==='2026-10-04').quantityEvidence,'incomplete')
 const original=d.history.snapshots
 const edited=q.applyQuantityDay(d,{...explicit('2026-10-05',0),sparse:true})
 assert.equal(h.totalPoints(edited,now).find(x=>x.date==='2026-10-05').manual,true)
 // The other account keeps its value from that day's original snapshot.
 const filled=h.totalPoints(edited,now).find(x=>x.date==='2026-10-05');assert.equal(filled.total,1000);assert.deepEqual(filled.filled,[{id:'b',from:'2026-10-05',reason:'no-record'}])
 const removed={...edited,history:{...edited.history,quantityDays:[]}}
 assert.equal(h.totalPoints(removed,now).find(x=>x.date==='2026-10-05').total,1100)
 assert.equal(removed.history.snapshots,original)
 // Defensive precedence even if stale query output includes a derived day.
 const stale={...d,history:{...d.history,valuedQuantityDays:[{...explicit('2026-10-05',null),periodDerived:true}]}}
 assert.equal(h.totalPoints(stale,now).find(x=>x.date==='2026-10-05').total,1100)
})

test('review: sparse single-day entries leave other intervals unchanged and preserve legacy null intent',()=>{
 const d=withPeriod({start:'2026-09-01',end:undefined})
 const other={...identity,accountId:'b',account:'合成B',quantity:3}
 d.accounts.push({...d.accounts[0],id:'b',name:'合成B'})
 const updated=q.applyQuantityDay(d,{date:'2026-09-15',updatedAt:now,sparse:true,entries:[other]})
 assert.equal(updated.version,6);assert.equal(count(updated,'2026-09-20'),10)
 assert.deepEqual(updated.history.quantityDays[0].entries,[other])
 assert.equal(p.expandPeriodDays(updated,now).find(x=>x.date==='2026-09-15').entries.find(x=>x.accountId==='a').quantity,10)
 const legacy={...d,history:{...d.history,quantityDays:[explicit('2026-09-15',null)]}}
 assert.equal(count(legacy,'2026-09-20'),null)
 assert.match(p.periodConflicts(legacy,period({start:'2026-09-01'})).join(' '),/未知會中斷期間.*舊紀錄無法判別/)
 const parsed=m.parseWealthData(JSON.parse(JSON.stringify(updated)))
 assert.equal(parsed.version,6);assert.equal(parsed.history.quantityDays[0].sparse,true)
 const persisted=h.recordSave(d,{...updated,updatedAt:now})
 assert.equal(persisted.version,6);assert.equal(s.finishSave({...updated},d,persisted).version,6)
 assert.deepEqual(m.parseWealthData(JSON.parse(JSON.stringify(legacy))).history.quantityDays,legacy.history.quantityDays)
})

test('review: sparse day without periods cannot falsely sum only its selected instrument',()=>{
 const d=fixture();d.accounts.push({...d.accounts[0],id:'b'})
 const next=q.applyQuantityDay(d,{...explicit('2026-10-01',0),sparse:true})
 const projected=p.expandPeriodDays(next,now)[0]
 assert.equal(projected.entries.length,2);assert.equal(q.quantityPoint(projected).total,null)
 assert.equal(next.history.quantityDays[0].entries.length,1)
})

test('review: scale indexes timezone events once instead of once per day and instrument',()=>{
 const d=fixture();d.accounts[0].positions=Array.from({length:15},(_,i)=>({...d.accounts[0].positions[0],id:`pos${i}`,symbol:`TEST${i}`}))
 d.history.holdingPeriods=d.accounts[0].positions.map((x,i)=>period({id:`p${i}`,symbol:x.symbol,start:'2025-10-01',end:undefined}))
 d.history.changes=d.accounts[0].positions.flatMap(x=>Array.from({length:20},(_,i)=>({...identity,symbol:x.symbol,at:`2026-09-${String(i+1).padStart(2,'0')}T12:00:00Z`,before:{quantity:i,price:10},after:{quantity:i+1,price:10}})))
 const Original=Intl.DateTimeFormat;let constructions=0
 Intl.DateTimeFormat=function(...args){constructions++;return new Original(...args)}
 const start=performance.now();let rows
 try{rows=p.expandPeriodDays(d,now)}finally{Intl.DateTimeFormat=Original}
 assert.equal(rows.length,373);assert.equal(rows[0].entries.length,15)
 assert.ok(constructions<=2,`formatter constructions: ${constructions}`)
 assert.ok(performance.now()-start<2000,'373-day projection must stay under generous 2s regression budget')
 assert.ok(rows.at(-1).entries.every(x=>x.quantity===20))
 const index=p.createPeriodIndex(d)
 for(const date of ['2026-09-20','2025-10-01','2026-09-01']) assert.equal(index({...identity,symbol:'TEST0'},date).quantity,date==='2026-09-20'?20:date==='2026-09-01'?1:10)
})

test('review: same-account other symbol and explicit unknown stay isolated across round trip',()=>{
 const d=withPeriod({start:'2026-09-01',end:undefined})
 d.accounts[0].positions.push({...d.accounts[0].positions[0],id:'other',symbol:'OTHER'})
 const x={...identity,symbol:'OTHER',quantity:3}
 const edited=q.applyQuantityDay(d,{date:'2026-09-15',updatedAt:now,sparse:true,entries:[x]})
 assert.equal(count(edited,'2026-09-20'),10)
 const existing=edited.history.quantityDays[0]
 const cleared=q.applyQuantityDay(edited,{...existing,entries:[x,{...identity,quantity:null}]},existing)
 const round=m.parseWealthData(JSON.parse(JSON.stringify(cleared)))
 assert.equal(count(round,'2026-09-20'),null)
 assert.equal(round.history.quantityDays[0].entries.find(e=>e.symbol==='OTHER').quantity,3)
 assert.equal(round.accounts[0].positions[0].quantity,99)
})

test('yellow review: omit automatic dates without inventory coverage, preserve snapshots and comparison base',async()=>{
 const d=withPeriod({start:'2026-10-01',end:'2026-10-03'})
 d.accounts[0].positions[0].quantity=10
 d.accounts.push({id:'b',name:'合成B',kind:'bank',category:'現金',country:'TW',positions:[{id:'cash',type:'cash',symbol:'',currency:'TWD',quantity:1000,price:1}]})
 d.history.snapshots=['05','06'].map(x=>h.snapshotOf(d,`2026-10-${x}T12:00:00Z`))
 d.accounts[1].positions[0].quantity=100
 const values=await q.valueDays(p.expandPeriodDays(d,now),async()=>prices())
 const points=h.totalPoints({...d,history:{...d.history,valuedQuantityDays:values}},now)
 assert.deepEqual(points.map(x=>[x.date,x.total]),[['2026-10-05',1100],['2026-10-06',1100],['2026-10-09',200]])
 assert.equal(points.at(-2).date,'2026-10-06')
 assert.ok(values.find(x=>x.date==='2026-10-08').entries.some(e=>e.quantity===null))
 assert.equal(q.isUnrecordedPartialDay(values.find(x=>x.date==='2026-10-08')),true)
 assert.equal(d.history.snapshots.length,2)
})

test('yellow review: genuine price/FX failure, explicit unknown and known zero remain in total history',async()=>{
 const d=withPeriod({start:'2026-10-01',end:undefined})
 const raw=p.expandPeriodDays(d,now)
 assert.ok(raw.every(x=>x.quantityEvidence==='complete'))
 const unavailable=await q.valueDays(raw,async()=>null)
 const points=h.totalPoints({...d,history:{...d.history,valuedQuantityDays:unavailable}},now)
 assert.equal(points.find(x=>x.date==='2026-10-08').total,null)
 assert.equal(q.isUnrecordedPartialDay(unavailable.at(-1)),false)
 const fx=withPeriod({start:'2026-10-01',end:undefined,currency:'USD'});fx.accounts[0].positions[0].currency='USD'
 const values=await q.valueDays(p.expandPeriodDays(fx,now),async symbol=>symbol==='USDTWD=X'?null:{...prices(),currency:'USD'})
 assert.equal(h.totalPoints({...fx,history:{...fx.history,valuedQuantityDays:values}},now).find(x=>x.date==='2026-10-08').total,null)
 assert.match(values.at(-1).entries[0].error,/匯率/)
 const zero=withPeriod({start:'2026-10-01',end:'2026-10-03'})
 const zeroValues=await q.valueDays(p.expandPeriodDays(zero,now),async()=>null)
 assert.equal(h.totalPoints({...zero,history:{...zero.history,valuedQuantityDays:zeroValues}},now).find(x=>x.date==='2026-10-08').total,0)
 // Explicit unknown propagates as evidence, even with another uncovered instrument.
 d.accounts.push({...d.accounts[0],id:'b'});d.history.quantityDays=[{...explicit('2026-10-06',null),sparse:true}]
 const unknownValues=await q.valueDays(p.expandPeriodDays(d,now),async()=>prices())
 const unknown=h.totalPoints({...d,history:{...d.history,valuedQuantityDays:unknownValues}},now)
 assert.equal(unknown.find(x=>x.date==='2026-10-06').manual,true)
 // With no earlier value for either account, the unknown quantities count as 0 and are listed.
 assert.equal(unknown.find(x=>x.date==='2026-10-08').total,0);assert.deepEqual(unknown.find(x=>x.date==='2026-10-08').filled.map(f=>f.from),[null,null])
 assert.equal(unknownValues.find(x=>x.date==='2026-10-08').quantityEvidence,'explicit-unknown')
 // Absent inventory already makes the total unknown; a market error on the same day
 // adds nothing, so the day stays omitted rather than reappearing as a gap.
 const mixed=withPeriod({start:'2026-10-01',end:undefined});mixed.accounts.push({...mixed.accounts[0],id:'b'})
 const mixedValues=await q.valueDays(p.expandPeriodDays(mixed,now),async()=>null)
 assert.ok(mixedValues.at(-1).entries.some(e=>e.error))
 assert.equal(q.isUnrecordedPartialDay(mixedValues.at(-1)),true)
 assert.equal(h.totalPoints({...mixed,history:{...mixed.history,valuedQuantityDays:mixedValues}},now).find(x=>x.date==='2026-10-08'),undefined)
})

test('yellow review: uncovered dates stay omitted while quotes load or fail',async()=>{
 const d=withPeriod({start:'2026-10-01',end:undefined})
 d.accounts[0].positions[0].quantity=10
 d.accounts.push({id:'b',name:'合成B',kind:'bank',category:'現金',country:'TW',positions:[{id:'cash',type:'cash',symbol:'',currency:'TWD',quantity:1000,price:1}]})
 d.history.snapshots=['05','06'].map(x=>h.snapshotOf(d,`2026-10-${x}T12:00:00Z`))
 const raw=p.expandPeriodDays(d,now)
 const expected=[['2026-10-05',1100],['2026-10-06',1100],['2026-10-09',1100]]
 const totals=values=>h.totalPoints({...d,history:{...d.history,valuedQuantityDays:values}},now).map(x=>[x.date,x.total])
 // While loading, the hook shows entries repriced without market data.
 const loading=raw.map(day=>({...day,entries:day.entries.map(e=>q.repriceEntry(e,day.date,null,null))}))
 assert.ok(loading.find(x=>x.date==='2026-10-08').entries.some(e=>e.error))
 assert.deepEqual(totals(loading),expected)
 // Offline, provider failure, or an instrument without Yahoo history.
 assert.deepEqual(totals(await q.valueDays(raw,async()=>null)),expected)
 assert.deepEqual(totals(await q.valueDays(raw,async()=>{throw new Error('offline')})),expected)
})


test('holding period edits preserve v11 category rules',()=>{
 const rules=[{keyword:'BUS/MRT',category:'交通'}]
 for(const data of [{...fixture(),version:11,expenseCategoryRules:rules},{...fixture(),expenseCategoryRules:rules}]) {
   const next=p.applyHoldingPeriod(data,period(),p.periodRevision(data),true,now)
   assert.equal(next.version,11)
   assert.deepEqual(next.expenseCategoryRules,rules)
 }
})


test('holding period edits preserve password settings version 12',()=>{
 const data={...fixture(),version:12,statementPasswords:[]}
 const next=p.applyHoldingPeriod(data,period(),p.periodRevision(data),true,now)
 assert.equal(next.version,12)
 assert.deepEqual(next.statementPasswords,[])
})
