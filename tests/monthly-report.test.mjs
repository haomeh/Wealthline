import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
let server,reports,entries,exporter
before(async()=>{server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}});reports=await server.ssrLoadModule('/src/monthlyReport.ts');entries=await server.ssrLoadModule('/src/cashflowEntries.ts');exporter=await server.ssrLoadModule('/src/monthlyReportExport.ts')})
after(async()=>server?.close())
const args=()=>({month:'2026-09',asOfDate:'2026-10-13',generatedAt:'2026-10-13T12:00:00Z',sourceDataVersion:16,entries:[],fx:[],review:{record:null,state:null},bankLabels:{}})
const row=(amount=1.005)=>entries.cashflowEntries({expenses:[{id:'a',date:'2026-09-02',card:'Card',description:'Meal',amount,currency:'TWD',category:'餐飲'}]})[0]
const rate={month:'2026-09',currency:'TWD',targetDate:'2026-09-30',rate:1,legs:[]}
test('empty month retains unknown totals and strict version validation',async()=>{const report=await reports.buildMonthlyReport(args());assert.equal(report.totals,null);assert.deepEqual(await reports.parseMonthlyReport(JSON.parse(JSON.stringify(report))),report);await assert.rejects(()=>reports.parseMonthlyReport({...report,policyVersion:99}))})
test('signed raw precision and negative display ties reconcile without mutation',async()=>{const input={...args(),entries:[row(-1.005),{...row(-1.005),recordId:'b'}],fx:[rate]};const report=await reports.buildMonthlyReport(input);assert.equal(report.totals.consumption,-2.01);assert.equal(report.entries[0].consumptionTwd,-1.005);assert.ok(Math.abs(report.rounding.consumption-0.01)<1e-9);input.entries[0].description='changed';assert.equal(report.entries[0].description,'Meal');assert.deepEqual(await reports.parseMonthlyReport(report),report)})
test('requires FX even for zero rows; ignores other months',async()=>{await assert.rejects(()=>reports.buildMonthlyReport({...args(),entries:[{...row(0),currency:'USD'}]}));const report=await reports.buildMonthlyReport({...args(),entries:[{...row(),date:'2026-08-01'}]});assert.equal(report.totals,null)})
test('rejects hash tampering, duplicate IDs, totals and unknown fields',async()=>{const report=await reports.buildMonthlyReport({...args(),entries:[row()],fx:[rate]});for(const patch of [{fingerprint:'a'.repeat(64)},{entries:[...report.entries,...report.entries]},{totals:{income:0,consumption:99,difference:-99}},{extra:'bad'}])await assert.rejects(()=>reports.parseMonthlyReport({...report,...patch}))})
test('CSV escapes dangerous text but preserves negative numeric refunds',async()=>{const report=await reports.buildMonthlyReport({...args(),entries:[{...row(-2.5),description:' =SUM("A")\nnext'}],fx:[rate]});const csv=exporter.monthlyReportCsv(report);assert.ok(csv.includes(`"' =SUM(""A"")\nnext"`));assert.ok(csv.includes(',-2.5,'))})
test('oversized upload rejected before reading',async()=>{let read=false;await assert.rejects(()=>exporter.readMonthlyReportFile({size:100*1024*1024+1,text(){read=true}}));assert.equal(read,false)})

test('all excluded observed zero stays distinct from null and identity is collection plus ID',async()=>{const bank=entries.cashflowEntries({bankTransactions:[{id:'a',accountId:'bank',date:'2026-09-01',direction:'debit',description:'Transfer',amount:50,currency:'TWD',classification:{kind:'excluded',reason:'自有帳戶轉帳'}}]})[0];const report=await reports.buildMonthlyReport({...args(),entries:[bank],fx:[rate]});assert.deepEqual(report.totals,{income:0,consumption:0,difference:0});assert.deepEqual(report.categories,[]);assert.equal((await reports.buildMonthlyReport({...args(),entries:[bank,row()],fx:[rate]})).entries.length,2)})
test('two-leg FX roundtrip and invalid leg references fail',async()=>{const fx={...rate,currency:'BTC',rate:600000,legs:[{symbol:'BTC-USD',date:'2026-09-30',rate:20000},{symbol:'TWD=X',date:'2026-09-29',rate:30}]};const report=await reports.buildMonthlyReport({...args(),entries:[{...row(0.000123456789),currency:'BTC'}],fx:[fx]});assert.deepEqual(await reports.parseMonthlyReport(report),report);for(const patch of [{rate:5},{legs:[{symbol:'evil',date:'2026-09-30',rate:600000}]},{legs:[{...fx.legs[0],date:'2026-10-01'},fx.legs[1]]}])await assert.rejects(()=>reports.buildMonthlyReport({...args(),entries:[{...row(),currency:'BTC'}],fx:[{...fx,...patch}]}))})
test('canonical sorted content identity excludes generation time only',async()=>{const a={...args(),entries:[row(),{...row(2),recordId:'b'}],fx:[rate]};const one=await reports.buildMonthlyReport(a),two=await reports.buildMonthlyReport({...a,entries:[...a.entries].reverse(),generatedAt:'2026-10-14T12:00:00Z'});assert.equal(one.fingerprint,two.fingerprint);assert.equal(one.entries[0].recordId,'a')})
test('strict nested allowlists, invalid dates and identifiers never render',async()=>{const report=await reports.buildMonthlyReport({...args(),entries:[row()],fx:[rate]});for(const patch of [{source:{kind:'card',card:'Card',html:'bad'}},{recordId:''},{date:'2026-09-31'},{evidence:{basis:'manual',html:'bad'}},{sourceLabel:4},{incomeTwd:Infinity}])await assert.rejects(()=>reports.parseMonthlyReport({...report,entries:[{...report.entries[0],...patch}]}));await assert.rejects(()=>reports.parseMonthlyReport({...report,generatedAt:'2026-02-30T12:00:00Z'}))})
test('all formula prefixes sanitized independently of raw numeric values',()=>{for(const s of ['=A1','+A1','-A1','@A1','  =A1','\ttext','\rtext','\ntext'])assert.ok(exporter.csvText(s).startsWith(`"'`));assert.equal(exporter.csvText('normal'),'"normal"')})
test('generation refuses incomplete capture and FX errors, and cancels after session/revision change',async()=>{const model=await server.ssrLoadModule('/src/model.ts');const data={...model.emptyData(),expenses:[{id:'a',date:'2026-09-02',card:'Card',description:'Meal',amount:1,currency:'USD',category:'餐飲'}]};await assert.rejects(()=>exporter.generateMonthlyReport({data,isCurrent:()=>false},'2026-09','2026-10-13'));await assert.rejects(()=>exporter.generateMonthlyReport({data,isCurrent:()=>true},'2026-09','2026-10-13',async()=>null));let current=true,finish;const task=exporter.generateMonthlyReport({data,isCurrent:()=>current},'2026-09','2026-10-13',()=>new Promise(resolve=>finish=resolve));await new Promise(resolve=>setTimeout(resolve,0));current=false;finish({symbol:'USDTWD=X',currency:'TWD',points:[{date:'2026-09-30',close:30}],splits:[]});await assert.rejects(()=>task)})

test('reopened mixed evidence reconciles each total and category from frozen rows',async()=>{
 const bank=entries.cashflowEntries({bankTransactions:[{id:'salary',accountId:'bank',date:'2026-09-01',description:'Salary',currency:'TWD',amount:300,direction:'credit',classification:{kind:'income',category:'薪資'}},{id:'reverse',accountId:'bank',date:'2026-09-02',description:'Reverse',currency:'TWD',amount:5,direction:'debit',classification:{kind:'income',category:'薪資'}},{id:'pending',accountId:'bank',date:'2026-09-03',description:'Unknown',currency:'TWD',amount:0,direction:'credit'}]})
 const report=await reports.buildMonthlyReport({...args(),entries:[...bank,row(-1.005)],fx:[rate],bankLabels:{bank:'Frozen bank'}})
 const reopened=await reports.parseMonthlyReport(JSON.parse(JSON.stringify(report)))
 for(const metric of ['income','consumption','difference']){assert.equal(reopened.totals[metric],reopened.entries.reduce((n,e)=>n+e[metric+'Twd'],0));assert.ok(Math.abs(reports.reportDisplayedNumber(reopened.totals[metric])-(reopened.entries.reduce((n,e)=>n+reports.reportDisplayedNumber(e[metric+'Twd']),0)+reopened.rounding[metric]))<1e-9)}
 for(const c of reopened.categories)assert.equal(c.total,reopened.entries.filter(e=>e.metric===c.metric&&e.category===c.category).reduce((n,e)=>n+e[c.metric+'Twd'],0))
 assert.equal(reopened.categories.find(c=>c.category==='未分類').total,0);assert.ok(reports.monthlyReportWarnings(reopened).some(w=>w.includes('1 筆銀行流水')))
})
test('manual no activity remains reviewed with null observed totals',async()=>{
 const reviewModule=await server.ssrLoadModule('/src/monthlyReviewState.ts'),source={kind:'card',card:'Inactive'},record={month:'2026-09',expectedSources:[source],confirmations:[]}
 record.confirmations.push({source,decision:'no-activity',confirmedAt:'2026-10-13T00:00:00Z',fingerprint:await reviewModule.reviewFingerprint([],record,source,{})})
 const state=await reviewModule.monthlyReviewState([],record,'2026-10-13',{})
 const report=await reports.buildMonthlyReport({...args(),review:{record,state}});assert.equal(report.totals,null);assert.equal(report.review.state.status,'reviewed');assert.deepEqual(await reports.parseMonthlyReport(report),report)
 record.confirmations[0].decision='reviewed';assert.equal(report.review.record.confirmations[0].decision,'no-activity')
})
test('numeric tolerance validates signed machine totals while fingerprint still binds supplied values',async()=>{
 const {cashflowFingerprint}=await server.ssrLoadModule('/src/cashflowFingerprint.ts')
 const report=await reports.buildMonthlyReport({...args(),entries:[row()],fx:[rate]});report.totals.consumption+=1e-10
 const {fingerprint,generatedAt,...content}=report;void fingerprint;void generatedAt;report.fingerprint=await cashflowFingerprint(content)
 const reopened=await reports.parseMonthlyReport(report);assert.equal(reopened.totals.consumption,report.totals.consumption)
})

test('CSV preserves unreviewed metadata for empty unknown months',async()=>{const report=await reports.buildMonthlyReport(args());const csv=exporter.monthlyReportCsv(report);assert.match(csv,/review_status/);assert.match(csv,/"2026-09","2026-10-13","未核對",0,,,,0,0,0/);assert.match(csv,/warnings/)})

async function rehash(report){const {cashflowFingerprint}=await server.ssrLoadModule('/src/cashflowFingerprint.ts');const {fingerprint,generatedAt,...payload}=report;void fingerprint;void generatedAt;return {...report,fingerprint:await cashflowFingerprint(payload)}}
test('large positive and negative totals and categories reconcile at displayed cents independently of tolerance',async()=>{
 for(const amount of [100000000,-100000000]){
  const report=await reports.buildMonthlyReport({...args(),entries:[row(amount)],fx:[rate]})
  for(const metric of ['consumption','difference']){const bad=structuredClone(report);bad.totals[metric]+=0.05;await assert.rejects(()=>rehash(bad).then(reports.parseMonthlyReport))}
  const bad=structuredClone(report);bad.categories[0].total+=0.05;await assert.rejects(()=>rehash(bad).then(reports.parseMonthlyReport))
 }
})
test('frozen local asOfDate controls exact FX target date and is hash bound',async()=>{
 await assert.rejects(()=>reports.buildMonthlyReport({...args(),entries:[row()],fx:[{...rate,targetDate:'2026-09-01'}]}))
 const current=await reports.buildMonthlyReport({...args(),asOfDate:'2026-09-13',entries:[row()],fx:[{...rate,targetDate:'2026-09-13'}]})
 assert.equal(current.asOfDate,'2026-09-13');assert.deepEqual(await reports.parseMonthlyReport(current),current)
 await assert.rejects(()=>reports.parseMonthlyReport({...current,asOfDate:'2026-09-14'}))
 await assert.rejects(()=>reports.buildMonthlyReport({...args(),asOfDate:'2026-09-13',entries:[row()],fx:[rate]}))
})
test('copied reviewed state cannot certify changed evidence even with a new report hash',async()=>{
 const reviewModule=await server.ssrLoadModule('/src/monthlyReviewState.ts'),source={kind:'card',card:'Card'},record={month:'2026-09',expectedSources:[source],confirmations:[]},rows=[row()]
 record.confirmations.push({source,decision:'reviewed',confirmedAt:'2026-10-13T00:00:00Z',fingerprint:await reviewModule.reviewFingerprint(rows,record,source,{})})
 const state=await reviewModule.monthlyReviewState(rows,record,'2026-10-13',{})
 const report=await reports.buildMonthlyReport({...args(),entries:rows,fx:[rate],review:{record,state}})
 await assert.rejects(()=>reports.buildMonthlyReport({...args(),entries:[{...row(),description:'Changed'}],fx:[rate],review:{record,state}}))
 const bad=structuredClone(report);bad.entries[0].description='Changed';await assert.rejects(()=>rehash(bad).then(reports.parseMonthlyReport))
})
test('zero-row bank review stores only referenced labels and removal remains missing',async()=>{
 const reviewModule=await server.ssrLoadModule('/src/monthlyReviewState.ts'),source={kind:'bank',accountId:'bank'},record={month:'2026-09',expectedSources:[source],confirmations:[]},labels={bank:'Frozen bank',unrelated:'Private unrelated'}
 record.confirmations.push({source,decision:'no-activity',confirmedAt:'2026-10-13T00:00:00Z',fingerprint:await reviewModule.reviewFingerprint([],record,source,labels)})
 const state=await reviewModule.monthlyReviewState([],record,'2026-10-13',labels)
 const report=await reports.buildMonthlyReport({...args(),bankLabels:labels,review:{record,state}})
 assert.deepEqual(report.bankLabels,{bank:'Frozen bank'});assert.deepEqual(await reports.parseMonthlyReport(report),report)
 // A renamed account is the same reviewed source: the label is not part of the review evidence.
 const renamed=await rehash({...report,bankLabels:{bank:'Renamed'}});assert.deepEqual(await reports.parseMonthlyReport(renamed),renamed)
 const removed=await reports.buildMonthlyReport({...args(),bankLabels:{},review:{record,state:await reviewModule.monthlyReviewState([],record,'2026-10-13',{})}})
 assert.deepEqual(removed.bankLabels,{});assert.equal(removed.review.state.status,'stale')
 await assert.rejects(()=>rehash({...report,bankLabels:labels}).then(reports.parseMonthlyReport))
})

test('parser rejects rehashed foreign FX anchored to an early day of a completed month',async()=>{
 const quote={...rate,currency:'USD',rate:30,legs:[{symbol:'USDTWD=X',date:'2026-09-30',rate:30}]}
 const report=await reports.buildMonthlyReport({...args(),entries:[{...row(),currency:'USD'}],fx:[quote]})
 report.fx[0].targetDate='2026-09-01';report.fx[0].legs[0].date='2026-09-01'
 await assert.rejects(()=>rehash(report).then(reports.parseMonthlyReport))
 await assert.rejects(()=>reports.buildMonthlyReport({...args(),asOfDate:'2026-08-30',entries:[{...row(),currency:'USD'}],fx:[quote]}))
})


test('original signed contributions reject rehashed display changes with consistent FX and totals',async()=>{
 for(const amount of [100000000,-100000000]){
  const report=await reports.buildMonthlyReport({...args(),entries:[row(amount)],fx:[rate]})
  for(const delta of [Math.sign(amount)*0.05,Math.sign(amount)*1e-6]){
   const changed=structuredClone(report),value=amount+delta
   Object.assign(changed.entries[0],{consumption:value,difference:-value,consumptionTwd:value,differenceTwd:-value})
   Object.assign(changed.totals,{consumption:value,difference:-value});changed.categories[0].total=value
   const rehashed=await rehash(changed)
   if(Math.abs(delta)>0.01)await assert.rejects(()=>reports.parseMonthlyReport(rehashed))
   else assert.equal((await reports.parseMonthlyReport(rehashed)).entries[0].consumption,value)
  }
 }
})
test('original bank income display is independently validated after rehash',async()=>{
 for(const direction of ['credit','debit']){
  const bank=entries.cashflowEntries({bankTransactions:[{id:'income',accountId:'bank',date:'2026-09-01',description:'Salary',currency:'TWD',amount:100000000,direction,classification:{kind:'income',category:'薪資'}}]})[0]
  const report=await reports.buildMonthlyReport({...args(),entries:[bank],fx:[rate]})
  const value=bank.income+Math.sign(bank.income)*0.05
  Object.assign(report.entries[0],{income:value,difference:value,incomeTwd:value,differenceTwd:value})
  Object.assign(report.totals,{income:value,difference:value});report.categories[0].total=value
  await assert.rejects(()=>rehash(report).then(reports.parseMonthlyReport))
 }
})
