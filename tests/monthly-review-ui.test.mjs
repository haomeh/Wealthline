import assert from 'node:assert/strict'
import {before,after,afterEach,test} from 'node:test'
import {createServer} from 'vite'
import {JSDOM} from 'jsdom'
import {act,createElement} from 'react'
let server,dom,root,createRoot,Panel,model,cashflow
before(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/cashflow?month=2026-09&panel=review'})
 for(const k of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Event','MouseEvent'])globalThis[k]=dom.window[k]
 window.scrollTo=()=>{};globalThis.IS_REACT_ACT_ENVIRONMENT=true
 ;({createRoot}=await import('react-dom/client'))
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;({MonthlyReviewPanel:Panel}=await server.ssrLoadModule('/src/views/MonthlyReviewPanel.tsx'))
 model=await server.ssrLoadModule('/src/model.ts');cashflow=await server.ssrLoadModule('/src/cashflow.ts')
})
afterEach(async()=>{if(root)await act(()=>root.unmount());root=null})
after(async()=>{await server.close();dom.window.close()})
const source={kind:'card',card:'Card'}
const fixture=()=>({...model.emptyData(),expenses:[{id:'a',date:'2026-09-02',card:'Card',description:'Meal',currency:'TWD',amount:20,category:'餐飲'}],monthlyReviews:[{month:'2026-09',expectedSources:[source],confirmations:[]}]})
let current,changed,base
async function flush(){for(let i=0;i<6;i++)await act(()=>new Promise(resolve=>setTimeout(resolve,2)))}
async function render(data=fixture(),overrides={}){current=data;changed=[];base={data,month:'2026-09',today:'2026-10-13',readiness:'ready',sessionIdentity:1,onUnclassified(){},onChange(next){current=next;changed.push(next);root.render(createElement(Panel,{...base,data:next,dirty:true}))},...overrides};root=createRoot(document.getElementById('root'));await act(()=>root.render(createElement(Panel,base)));await flush()}
async function rerender(overrides){base={...base,...overrides};await act(()=>root.render(createElement(Panel,base)));await flush()}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
async function click(text){assert.ok(button(text),text);await act(()=>button(text).click());await flush()}
function deferDigest(){const old=crypto.subtle.digest.bind(crypto.subtle),pending=[];crypto.subtle.digest=(...args)=>new Promise((resolve,reject)=>pending.push(()=>old(...args).then(resolve,reject)));return {pending,async finish(){crypto.subtle.digest=old;await act(async()=>{for(const finish of pending)await finish()});await flush()}}}
test('not loaded/loading/error/future/busy barriers never certify saved fingerprints',async()=>{await render();for(const overrides of [{readiness:'not-loaded'},{readiness:'loading'},{readiness:'error'},{readiness:'ready',busy:true},{busy:false,month:'2026-11'}]){await rerender(overrides);assert.ok([...document.querySelectorAll('.review-source-row button')].every(b=>b.disabled));}assert.equal(changed.length,0)})
test('explicit confirmation uses dirty metadata only and current-month wording',async()=>{const data=fixture();await render(data,{today:'2026-09-13'});await click('確認已核對');assert.equal(changed.length,1);assert.deepEqual(current.expenses,data.expenses);assert.match(document.body.textContent,/截至目前已核對/);assert.match(document.body.textContent,/待儲存/);const groups=cashflow.cashflowSummary({expenses:current.expenses},'2026-09',1);assert.equal(groups[0].coverage.complete,false)})
test('no activity retains empty ledger and adding an expected exact card label does not fabricate transactions',async()=>{const data={...fixture(),expenses:[]};await render(data);await click('確認本月無活動');assert.equal(current.monthlyReviews[0].confirmations[0].decision,'no-activity');assert.deepEqual(current.expenses,[]);assert.match(document.body.textContent,/已人工核對/);assert.equal(cashflow.cashflowSummary({expenses:[]},'2026-09',1).length,0)})
test('observed outside scope is actionable and card/bank unclassified counts stay separate',async()=>{const data=fixture();delete data.expenses[0].category;data.monthlyReviews[0].expectedSources=[];data.bankTransactionAccounts=[{id:'bank',label:'Bank',bank:'Bank'}];data.bankTransactions=[{id:'b',accountId:'bank',date:'2026-09-02',description:'Unknown',amount:1,currency:'TWD',direction:'credit'}];let target;await render(data,{onUnclassified:s=>target=s});assert.equal(document.querySelectorAll('[data-review-source]').length,2);assert.ok([...document.querySelectorAll('[data-review-source]')].every(n=>n.textContent.includes('未分類 1 筆')));assert.equal([...document.querySelectorAll('button')].filter(b=>b.textContent==='加入預期來源').length,2);await click('查看信用卡未分類');assert.equal(target,'card');await click('查看銀行未分類');assert.equal(target,'bank');assert.equal(changed.length,0)})
test('copy previous expectations clears decisions rather than importing confirmations',async()=>{const data=fixture();data.monthlyReviews.push({month:'2026-08',expectedSources:[{kind:'card',card:' Previous '}],confirmations:[{source:{kind:'card',card:' Previous '},decision:'no-activity',fingerprint:'a'.repeat(64),confirmedAt:'2026-09-01T00:00:00Z'}]});await render(data);await click('複製上月預期來源');const rev=current.monthlyReviews.find(r=>r.month==='2026-09');assert.deepEqual(rev.expectedSources,[{kind:'card',card:' Previous '}]);assert.deepEqual(rev.confirmations,[])})
test('month switch while hashing rejects obsolete completion',async()=>{await render();const delay=deferDigest();try{await click('確認已核對');await rerender({month:'2026-08'});await delay.finish();assert.equal(changed.length,0)}finally{await delay.finish()}})
test('restore/data replacement while hashing rejects obsolete completion',async()=>{await render();const delay=deferDigest();try{await click('確認已核對');await rerender({data:{...fixture(),updatedAt:'2026-10-14T00:00:00Z'}});await delay.finish();assert.equal(changed.length,0)}finally{await delay.finish()}})
test('session replacement and synchronous owner guard block hashing completion',async()=>{let valid=true;await render(fixture(),{captureReviewGuard:()=>()=>valid});const delay=deferDigest();try{await click('確認已核對');valid=false;await delay.finish();assert.equal(changed.length,0)}finally{await delay.finish()}})
test('save start during hashing blocks certification',async()=>{await render();const delay=deferDigest();try{await click('確認已核對');await rerender({busy:true});await delay.finish();assert.equal(changed.length,0)}finally{await delay.finish()}})

async function input(node,value){await act(()=>{Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}))});await flush()}
test('explicit bounded exception note permits only the captured unclassified rows',async()=>{const data=fixture();delete data.expenses[0].category;await render(data);assert.ok(button('保留未分類並確認已核對').disabled);const textarea=document.querySelector('textarea');assert.equal(textarea.maxLength,500);await input(textarea,'保留待查');await click('保留未分類並確認已核對');assert.equal(current.monthlyReviews[0].confirmations[0].exceptionNote,'保留待查');assert.match(document.body.textContent,/保留 1 筆未分類/);await rerender({data:{...current,expenses:[{...current.expenses[0],amount:99}]}});assert.match(document.body.textContent,/需重新核對/);assert.equal(current.monthlyReviews[0].confirmations.length,1)})
test('manual expected card label preserves exact spacing with no fabricated records',async()=>{await render({...fixture(),expenses:[],monthlyReviews:[]});await input(document.querySelector('input:not([type="checkbox"])'),' New Card ');await act(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await flush();assert.deepEqual(current.monthlyReviews[0].expectedSources,[{kind:'card',card:' New Card '}]);assert.deepEqual(current.expenses,[])})
test('session identity replacement while hashing rejects old result',async()=>{await render();const delay=deferDigest();try{await click('確認已核對');await rerender({sessionIdentity:2});await delay.finish();assert.equal(changed.length,0)}finally{await delay.finish()}})


test('source groups identify repeated actions and exception edits stay draft until reconfirmed', async()=>{
 const data=fixture();delete data.expenses[0].category
 await render(data)
 const group=document.querySelector('[role=group][aria-label="信用卡 · Card"]')
 assert.ok(group)
 const note=group.querySelector('textarea[aria-label="信用卡 · Card 保留未分類原因"]')
 assert.ok(note)
 await input(note,'Original exception');await click('保留未分類並確認已核對')
 assert.doesNotMatch(document.body.textContent,/備註草稿尚未套用/)
 await input(document.querySelector('textarea'),'Revised exception')
 assert.equal(current.monthlyReviews[0].confirmations[0].exceptionNote,'Original exception')
 assert.match(document.body.textContent,/備註草稿尚未套用；請重新確認此來源，再儲存/)
 await click('保留未分類並確認已核對')
 assert.equal(current.monthlyReviews[0].confirmations[0].exceptionNote,'Revised exception')
 assert.doesNotMatch(document.body.textContent,/備註草稿尚未套用/)
})
test('copy previous expectations merges into a month that already has confirmations',async()=>{const data=fixture(),kept={source,decision:'reviewed',fingerprint:'a'.repeat(64),confirmedAt:'2026-10-01T00:00:00Z'};data.monthlyReviews[0].confirmations=[kept];data.monthlyReviews.push({month:'2026-08',expectedSources:[source,{kind:'card',card:'Previous'}],confirmations:[]});await render(data);await click('複製上月預期來源');const rev=current.monthlyReviews.find(r=>r.month==='2026-09');assert.deepEqual(rev.expectedSources,[source,{kind:'card',card:'Previous'}]);assert.deepEqual(rev.confirmations,[kept])})
