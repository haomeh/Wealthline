import assert from 'node:assert/strict'
import {before,after,afterEach,test} from 'node:test'
import {createServer} from 'vite'
import {JSDOM} from 'jsdom'
import {act,createElement} from 'react'
let server,dom,root,createRoot,Panel,model,reports,entryModule,props,downloads,fetchCalls
before(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/cashflow?month=2026-09&panel=report'})
 for(const k of ['window','document','HTMLElement','HTMLInputElement','Event','MouseEvent'])globalThis[k]=dom.window[k]
 window.scrollTo=()=>{};globalThis.IS_REACT_ACT_ENVIRONMENT=true
 ;({createRoot}=await import('react-dom/client'))
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;({MonthlyReport:Panel}=await server.ssrLoadModule('/src/views/MonthlyReport.tsx'))
 model=await server.ssrLoadModule('/src/model.ts');reports=await server.ssrLoadModule('/src/monthlyReport.ts');entryModule=await server.ssrLoadModule('/src/cashflowEntries.ts')
 dom.window.HTMLAnchorElement.prototype.click=function(){downloads.push(this.download)}
 URL.createObjectURL=()=> 'blob:test';URL.revokeObjectURL=()=>{}
 globalThis.fetch=async()=>{fetchCalls++;throw new Error('no live service')}
})
afterEach(async()=>{if(root)await act(()=>root.unmount());root=null})
after(async()=>{await server.close();dom.window.close()})
const fixture=()=>({...model.emptyData(),expenses:[{id:'a',date:'2026-09-02',card:'Card',description:'Original',currency:'TWD',amount:-1.005,category:'餐飲'}]})
async function flush(){for(let i=0;i<8;i++)await act(()=>new Promise(resolve=>setTimeout(resolve,2)))}
async function render(overrides={}){const data=fixture();downloads=[];fetchCalls=0;props={data,month:'2026-09',today:'2026-10-13',readiness:'ready',onClose(){},captureReport:()=>({data,isCurrent:()=>true}),...overrides};root=createRoot(document.getElementById('root'));await act(()=>root.render(createElement(Panel,props)));await flush()}
async function rerender(overrides){props={...props,...overrides};await act(()=>root.render(createElement(Panel,props)));await flush()}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
async function click(text){assert.ok(button(text),text);await act(()=>button(text).click());await flush()}
async function snapshot(){const data=fixture();return reports.buildMonthlyReport({month:'2026-09',asOfDate:'2026-10-13',generatedAt:'2026-10-13T12:00:00Z',sourceDataVersion:16,entries:entryModule.cashflowEntries({expenses:data.expenses}),fx:[{month:'2026-09',currency:'TWD',targetDate:'2026-09-30',rate:1,legs:[]}],review:{record:null,state:null},bankLabels:{}})}
async function upload(report){const input=document.querySelector('input[type=file]');const text=JSON.stringify(report);Object.defineProperty(input,'files',{configurable:true,value:[{size:text.length,text:async()=>text}]});await act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));await flush()}
test('dirty preview clearly labelled and both exports disabled',async()=>{await render({dirty:true});assert.ok(button('匯出 JSON').disabled);assert.ok(button('匯出 CSV').disabled);await click('產生目前資料預覽');assert.match(document.body.textContent,/包含未儲存修改/);assert.match(document.body.textContent,/未核對/);assert.match(document.body.textContent,/Original/);assert.deepEqual(downloads,[])})
test('saved unreviewed export preserves label and creates safe month filename',async()=>{await render();await click('匯出 JSON');assert.equal(downloads.length,1);assert.match(downloads[0],/^wealthline-monthly-2026-09-/);assert.match(document.body.textContent,/未核對/)})
test('ledger failure blocks generation and FX failure never downloads',async()=>{await render({readiness:'error'});assert.ok(button('匯出 JSON').disabled);assert.ok(button('產生目前資料預覽').disabled);const data=fixture();data.expenses[0].currency='USD';await rerender({readiness:'ready',data,captureReport:()=>({data,isCurrent:()=>true})});await click('匯出 JSON');assert.deepEqual(downloads,[]);assert.ok(document.querySelector('[role=alert]'))})
test('logout or edit during hashing cancels download',async()=>{let current=true;const data=fixture();await render({data,captureReport:()=>({data,isCurrent:()=>current})});const old=crypto.subtle.digest.bind(crypto.subtle);let finish;crypto.subtle.digest=(...args)=>new Promise((resolve,reject)=>{finish=()=>old(...args).then(resolve,reject)});try{await click('匯出 JSON');current=false;await rerender({sessionIdentity:2});crypto.subtle.digest=old;await act(async()=>finish());await flush();assert.deepEqual(downloads,[]);assert.match(document.body.textContent,/已變更/)}finally{crypto.subtle.digest=old}})
test('opening JSON and later ledger changes preserve isolated snapshot without live fetch or mutation',async()=>{let changes=0;await render({onChange(){changes++},restore(){changes++}});await upload(await snapshot());assert.match(document.body.textContent,/原始 JSON 快照/);assert.equal(fetchCalls,0);const data=fixture();data.expenses[0].description='Changed';data.expenses[0].amount=999;await rerender({data});assert.match(document.body.textContent,/Original/);assert.doesNotMatch(document.body.textContent,/Changed/);assert.equal(changes,0);assert.equal(fetchCalls,0);await click('比對並離開快照，查看目前紀錄');assert.match(document.body.textContent,/與原始快照不同/);assert.match(document.body.textContent,/Original/)})
test('missing current row leaves frozen evidence intact',async()=>{await render({data:{...fixture(),expenses:[]}});await upload(await snapshot());await click('比對並離開快照，查看目前紀錄');assert.match(document.body.textContent,/找不到這筆紀錄/);assert.match(document.body.textContent,/Original/)})
test('report route itself does not mount live quote hooks',async()=>{const {Cashflow}=await server.ssrLoadModule('/src/views/Cashflow.tsx');const data=fixture();data.expenses[0].currency='USD';await render();await act(()=>root.render(createElement(Cashflow,{data,readiness:'ready',onGoExpenses(){},onGoBankTransactions(){}})));await flush();assert.match(document.body.textContent,/每月報表/);assert.equal(fetchCalls,0)})

test('slow current-record comparison cannot navigate after snapshot unmount',async()=>{
 await render();await upload(await snapshot())
 const digest=crypto.subtle.digest.bind(crypto.subtle),pending=[]
 crypto.subtle.digest=(...args)=>new Promise((resolve,reject)=>pending.push(()=>digest(...args).then(resolve,reject)))
 const location=window.location.href
 try{await click('比對並離開快照，查看目前紀錄');assert.equal(pending.length,2);await act(()=>root.unmount());root=null;crypto.subtle.digest=digest;await act(async()=>Promise.all(pending.map(finish=>finish())));await flush();assert.equal(window.location.href,location)}finally{crypto.subtle.digest=digest}
})


test('frozen report unclassified filter preserves pending and card rows without excluded rows',async()=>{
 const rows=entryModule.cashflowEntries({expenses:[{...fixture().expenses[0],category:'未分類'}],bankTransactions:[
  {id:'pending',accountId:'bank',date:'2026-09-03',description:'Pending bank',direction:'credit',amount:20,currency:'TWD'},
  {id:'excluded',accountId:'bank',date:'2026-09-03',description:'Excluded transfer',direction:'debit',amount:20,currency:'TWD',classification:{kind:'excluded',reason:'自有帳戶轉帳'}}]})
 const report=await reports.buildMonthlyReport({month:'2026-09',asOfDate:'2026-10-13',generatedAt:'2026-10-13T12:00:00Z',sourceDataVersion:16,entries:rows,fx:[{month:'2026-09',currency:'TWD',targetDate:'2026-09-30',rate:1,legs:[]}],review:{record:null,state:null},bankLabels:{}})
 await render();await upload(report)
 const select=async(label,value)=>{await act(()=>{const node=document.querySelector(`[aria-label="${label}"]`);node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}))});await flush()}
 await select('報表分類','unclassified')
 assert.match(document.body.textContent,/Pending bank/);assert.match(document.body.textContent,/Original/);assert.doesNotMatch(document.body.textContent,/Excluded transfer/)
 await select('報表來源','bank')
 assert.match(document.body.textContent,/Pending bank/);assert.doesNotMatch(document.body.textContent,/Original|Excluded transfer/)
 await select('報表指標','excluded')
 assert.match(document.body.textContent,/Excluded transfer/);assert.doesNotMatch(document.body.textContent,/Pending bank/)
})
