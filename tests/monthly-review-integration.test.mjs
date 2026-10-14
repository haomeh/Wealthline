import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
import {JSDOM} from 'jsdom'
import {act,createElement} from 'react'
import {createFakeDrive} from './helpers/fake-drive.mjs'
let server,dom,root,createRoot,model,store,flow,entryModule,reviews,exports,reports,local,site,Cashflow,Expenses
const originalFetch=globalThis.fetch,now='2026-10-13T12:00:00.000Z',today='2026-10-13'
const token={value:'synthetic-test-token',expiresAt:Date.now()+3600000}
const quote=(symbol,rate=24)=>({symbol,currency:'TWD',asTraded:true,points:[{date:'2026-09-30',close:rate}]})
before(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/cashflow?month=2026-09'})
 for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent','localStorage'])globalThis[k]=dom.window[k]
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:dom.window.navigator.userAgent,locks:{request:(_name,task)=>task()}}})
 window.scrollTo=()=>{};globalThis.IS_REACT_ACT_ENVIRONMENT=true
 ;({createRoot}=await import('react-dom/client'))
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;[model,store,flow,entryModule,reviews,exports,reports,local,site]=await Promise.all(['model','google/driveStore','cashflow','cashflowEntries','monthlyReviewState','monthlyReportExport','monthlyReport','localStore','site'].map(p=>server.ssrLoadModule('/src/'+p+'.ts')))
 ;({Cashflow}=await server.ssrLoadModule('/src/views/Cashflow.tsx'));({Expenses}=await server.ssrLoadModule('/src/views/Expenses.tsx'))
})
after(async()=>{if(root)await act(()=>root.unmount());await server?.close();dom.window.close();globalThis.fetch=originalFetch})
const card=(id,amount,date='2026-09-03',currency='TWD')=>({id,date,card:'Synthetic card',description:id,currency,amount,category:'購物'})
const bank=(id,amount,direction,classification)=>({id,accountId:'bank-a',date:'2026-09-03',description:id,currency:'TWD',amount,direction,...(classification&&{classification})})
const fixture=()=>({...model.emptyData(),updatedAt:now,expenses:[card('spend',200),card('card-refund',-50),card('sgd',10,'2026-09-03','SGD'),card('october',40,'2026-10-02'),card('august',5,'2026-08-02')],bankTransactionAccounts:[{id:'bank-a',label:'Synthetic bank',bank:'Test'}],bankTransactions:[bank('salary',1000,'credit',{kind:'income',category:'薪資'}),bank('reversal',100,'debit',{kind:'income',category:'薪資'}),bank('expense',100,'debit',{kind:'expense',category:'購物'}),bank('bank-refund',20,'credit',{kind:'expense',category:'購物'}),bank('transfer',500,'debit',{kind:'excluded',reason:'自有帳戶轉帳'}),bank('pending',30,'credit')],monthlyReviews:['2026-08','2026-09','2026-10'].map(month=>({month,expectedSources:[{kind:'card',card:'Synthetic card'},...(month==='2026-09'?[{kind:'bank',accountId:'bank-a'}]:[])],confirmations:[]}))})
const input=data=>({expenses:data.expenses,bankTransactions:data.bankTransactions})
const entries=data=>entryModule.cashflowEntries(input(data))
const labels={'bank-a':'Synthetic bank'}
async function flush(){for(let i=0;i<12;i++)await act(()=>new Promise(r=>setTimeout(r,2)))}
async function render(Component,props){if(!root)root=createRoot(document.getElementById('root'));await act(()=>root.render(createElement(Component,props)));await flush()}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
async function click(node){assert.ok(node);await act(()=>node.click());await flush()}
async function navigate(url){await act(()=>site.navigate(url,{scroll:'preserve'}));await flush()}
async function certify(data,month){const record=data.monthlyReviews.find(r=>r.month===month);for(const source of record.expectedSources)record.confirmations.push({source,decision:'reviewed',confirmedAt:now,fingerprint:await reviews.reviewFingerprint(entries(data),record,source,labels),...(source.kind==='bank'?{exceptionNote:'Synthetic pending item retained'}:{})})}

test('summary-only Drive -> ready ledger -> chart/category/edit/return -> review/save/export -> stale scope/FX/restore/failure',async()=>{
 const drive=createFakeDrive();drive.seed(fixture())
 let rate=24
 globalThis.fetch=async(url,init)=>String(url).includes('www.googleapis.com')?drive.fetch(url,init):new Response(JSON.stringify(quote('SGDTWD=X',rate)))
 let opened=await store.loadDrive(token,model.parseWealthData)
 await store.saveDrive(token,opened.data,opened.state,now)
 opened=await store.loadDrive(token,model.parseWealthData)
 let data=opened.data,dirty=false,readiness='not-loaded'
 const summary=flow.cashflowMonths(input(fixture()))
 const props=()=>({data,dirty,readiness,months:readiness==='ready'?undefined:summary,onGoExpenses(){},onGoBankTransactions(){},onChange:next=>{data=next;dirty=true;root.render(createElement(Cashflow,props()))},captureReport:()=>({data,isCurrent:()=>!dirty&&readiness==='ready'})})
 assert.ok(store.missingParts(opened.state,data,'ledger').length)
 await render(Cashflow,props())
 assert.ok(document.querySelector('.cashflow-bars'),'summary chart exists without a ledger')
 assert.equal(document.querySelectorAll('[data-entry]').length,0)
 await click(button('每月核對'))
 assert.ok([...document.querySelectorAll('.review-source-row button')].every(b=>b.disabled))
 await click(button('每月報表'));assert.ok(button('匯出 JSON').disabled)
 data=store.mergeParts(data,await store.readGroup(token,opened.state,'ledger'),model.parseWealthData);readiness='ready'
 await navigate('/cashflow?month=2026-10');await render(Cashflow,props())
 await click(document.querySelector('.cashflow-bar[aria-label^="2026 年 9 月"]'))
 assert.match(window.location.search,/month=2026-09/)
 assert.match(document.querySelector('[aria-label="收入"]').textContent,/930/)
 assert.match(document.querySelector('[aria-label="實際消費"]').textContent,/470/)
 assert.match(document.querySelector('[aria-label="收支差額"]').textContent,/460/)
 await click([...document.querySelectorAll('.cashflow-category-rows button')].find(b=>b.textContent.startsWith('購物')))
 assert.match(window.location.search,/metric=consumption.*category=shopping/)
 assert.equal(document.activeElement.textContent,'收支明細')
 assert.deepEqual([...document.querySelectorAll('[data-entry]')].map(n=>n.getAttribute('data-entry')).sort(),['bank:bank-refund','bank:expense','card:card-refund','card:sgd','card:spend'].sort())
 await click(document.querySelector('[data-entry="card:spend"] button'))
 const params=new URLSearchParams(window.location.search),returnTo=params.get('returnTo')
 await render(Expenses,{data,busy:false,recordId:params.get('recordId'),returnTo,onChange:next=>{data=next;dirty=true}})
 await act(()=>{const select=document.querySelector('select');select.value='餐飲';select.dispatchEvent(new Event('change',{bubbles:true}))})
 await act(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 await click(button('返回收支明細'));assert.equal(window.location.pathname+window.location.search,returnTo)
 await render(Cashflow,props());assert.equal(document.querySelectorAll('[data-entry]').length,4)
 assert.equal(document.activeElement.textContent,'收支明細');assert.equal(window.history.state.focus,undefined)
 await click(button('每月核對'))
 await click(button('確認已核對'))
 const textarea=document.querySelector('textarea')
 await act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Synthetic pending item retained');textarea.dispatchEvent(new Event('input',{bubbles:true}))});await flush()
 await click(button('保留未分類並確認已核對'))
 assert.match(document.body.textContent,/已人工核對/);assert.match(document.body.textContent,/待儲存/)
 await click(button('每月報表'));assert.ok(button('匯出 JSON').disabled)
 await certify(data,'2026-08');await certify(data,'2026-10')
 data=await store.saveDrive(token,data,opened.state,now);dirty=false
 opened=await store.loadDrive(token,model.parseWealthData);data=store.mergeParts(opened.data,await store.readGroup(token,opened.state,'ledger'),model.parseWealthData)
 assert.equal(data.version,16);assert.equal(data.monthlyReviews.find(r=>r.month==='2026-09').confirmations.length,2)
 const generate=(data,quoteRate=24)=>exports.generateMonthlyReport({data,isCurrent:()=>true},'2026-09',today,async symbol=>quote(symbol,quoteRate))
 const frozen=await generate(data),json=JSON.stringify(frozen)
 assert.deepEqual(frozen.totals,{income:930,consumption:470,difference:460})
 assert.equal(frozen.review.state.status,'reviewed');assert.equal(frozen.entries.length,9)
 await render(Cashflow,props())
 let blob;const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL
 URL.createObjectURL=value=>{blob=value;return 'blob:synthetic'};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=()=>{}
 try{await click(button('匯出 JSON'));assert.deepEqual((await reports.parseMonthlyReport(JSON.parse(await blob.text()))).totals,frozen.totals)}finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke}
 const moved={...data,expenses:data.expenses.map(e=>e.id==='spend'?{...e,date:'2026-10-03'}:e)}
 for(const [month,status] of [['2026-08','reviewed'],['2026-09','stale'],['2026-10','stale']])assert.equal((await reviews.monthlyReviewState(entries(moved),moved.monthlyReviews.find(r=>r.month===month),today,labels)).status,status)
 const changedFx=await generate(data,25)
 assert.equal(changedFx.review.state.status,'reviewed');assert.deepEqual(changedFx.totals,{income:930,consumption:480,difference:450});assert.notEqual(changedFx.fingerprint,frozen.fingerprint)
 const backup=await local.readDataFile(new File([JSON.stringify(data)],'synthetic-full-backup.json'))
 const destination=await local.readLocalPreview();await local.replaceLocal(backup.data,destination.version,()=>true)
 const restored=(await local.loadLocal()).data
 assert.deepEqual((await generate(restored)).totals,frozen.totals)
 assert.deepEqual(await reports.parseMonthlyReport(JSON.parse(json)),frozen)
 await render(Cashflow,{...props(),data:moved})
 const upload=document.querySelector('input[type=file]');Object.defineProperty(upload,'files',{configurable:true,value:[{size:json.length,text:async()=>json}]})
 await act(()=>upload.dispatchEvent(new Event('change',{bubbles:true})));await flush()
 assert.match(document.body.textContent,/原始 JSON 快照/)
 assert.match(document.body.textContent,/spend/)
 assert.equal(JSON.stringify(await reports.parseMonthlyReport(JSON.parse(json))),json)
 // Pinned ledger reads fail at the transport. The owner exposes error, never ready.
 const failed=await store.loadDrive(token,model.parseWealthData)
 const fetchBeforeFailure=globalThis.fetch
 globalThis.fetch=async(url,init)=>String(url).includes('alt=media')?new Response('',{status:503}):fetchBeforeFailure(url,init)
 await assert.rejects(store.readGroup(token,failed.state,'ledger'),/503/)
 data=failed.data;readiness='error';await navigate('/cashflow?month=2026-09&panel=review');await render(Cashflow,props())
 assert.ok([...document.querySelectorAll('.review-source-row button')].every(b=>b.disabled))
 await click(button('每月報表'));assert.ok(button('匯出 JSON').disabled);assert.ok(button('匯出 CSV').disabled);assert.ok(button('產生目前資料預覽').disabled)
 assert.deepEqual(drive.main().monthlyReviews,restored.monthlyReviews)
})
