import assert from 'node:assert/strict'
import {before,after,beforeEach,afterEach,test} from 'node:test'
import {createServer} from 'vite'
import {JSDOM} from 'jsdom'
import {act,createElement} from 'react'
let server,dom,root,createRoot,Cashflow,Expenses,model,site,query
before(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/cashflow?month=2026-09'})
 for(const k of ['window','document','HTMLElement','Event','MouseEvent','KeyboardEvent'])globalThis[k]=dom.window[k]
 window.scrollTo=()=>{}
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 ;({createRoot}=await import('react-dom/client'))
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;({Cashflow}=await server.ssrLoadModule('/src/views/Cashflow.tsx'))
 ;({Expenses}=await server.ssrLoadModule('/src/views/Expenses.tsx'))
 model=await server.ssrLoadModule('/src/model.ts');site=await server.ssrLoadModule('/src/site.ts');query=await server.ssrLoadModule('/src/cashflowQuery.ts')
})
beforeEach(()=>window.history.replaceState({},'','/cashflow?month=2026-09'))
afterEach(async()=>{if(root)await act(()=>root.unmount());root=null})
after(async()=>{await server.close();dom.window.close()})
const card=(id,category='餐飲')=>({id,date:'2026-09-02',card:'Card',description:id,currency:'TWD',amount:10,category})
async function render(Component,props){root=createRoot(document.getElementById('root'));await act(()=>root.render(createElement(Component,props)))}
async function click(button){assert.ok(button);await act(()=>button.click())}
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)
const props=data=>({data,onGoExpenses(){},onGoBankTransactions(){}})
test('filter before shared 100 pagination, aggregate all matches, query-only navigation and popstate',async()=>{
 const data={...model.emptyData(),expenses:[card('shopping','購物'),...Array.from({length:101},(_,i)=>card(`dining${i}`))]}
 await render(Cashflow,props(data))
 await click([...document.querySelectorAll('.cashflow-category-rows button')].find(b=>b.textContent.startsWith('餐飲')))
 assert.match(window.location.search,/category=dining/)
 assert.equal(document.querySelectorAll('[data-entry]').length,100)
 assert.match(document.querySelector('[data-filtered-total]').textContent,/消費 1,010/)
 assert.equal(document.querySelector('[data-entry="card:shopping"]'),null)
 assert.equal(document.activeElement.textContent,'收支明細')
 await click(button('下一頁'));assert.equal(document.querySelectorAll('[data-entry]').length,1)
 assert.match(window.location.search,/page=2/)
 await act(()=>{window.history.replaceState({},'','/cashflow?month=2026-09&metric=consumption&category=shopping');window.dispatchEvent(new window.PopStateEvent('popstate'))})
 assert.equal(document.querySelectorAll('[data-entry]').length,1)
 assert.ok(document.querySelector('[data-entry="card:shopping"]'))
 await act(()=>site.navigate('/cashflow?month=2026-09&source=bank',{scroll:'preserve'}))
 assert.equal(document.querySelectorAll('[data-entry]').length,0)
})
test('card and bank membership, edit category and canonical return, missing record',async()=>{
 let data={...model.emptyData(),expenses:[card('dinner')],bankTransactionAccounts:[{id:'bank',label:'Bank',bank:'Bank'}],bankTransactions:[{id:'bank-dinner',accountId:'bank',date:'2026-09-03',description:'Bank dinner',direction:'debit',amount:20,currency:'TWD',classification:{kind:'expense',category:'餐飲'}}]}
 await act(()=>site.navigate('/cashflow?month=2026-09&metric=consumption&category=dining',{scroll:'preserve'}))
 await render(Cashflow,props(data));assert.equal(document.querySelectorAll('[data-entry]').length,2)
 assert.match(document.querySelector('[data-filtered-total]').textContent,/消費 30/)
 await click(document.querySelector('[data-entry="card:dinner"] button'))
 const params=new URLSearchParams(window.location.search),returnTo=params.get('returnTo')
 assert.equal(params.get('recordId'),'dinner')
 await act(()=>root.unmount());root=null
 await render(Expenses,{data,busy:false,recordId:'dinner',returnTo,onChange:next=>{data=next}})
 const select=document.querySelector('select')
 await act(()=>{select.value='購物';select.dispatchEvent(new Event('change',{bubbles:true}))})
 await act(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 await click(button('返回收支明細'));assert.equal(window.location.pathname+window.location.search,returnTo)
 await act(()=>root.unmount());root=null
 await render(Cashflow,props(data));assert.equal(document.querySelectorAll('[data-entry]').length,1)
 assert.equal(document.activeElement.textContent,'收支明細')
 assert.equal(window.history.state.focus,undefined)
 await act(()=>button('清除篩選').focus())
 await act(()=>root.render(createElement(Cashflow,props({...data}))))
 assert.equal(document.activeElement.textContent,'清除篩選')
 await act(()=>root.unmount());root=null
 await render(Expenses,{data,busy:false,recordId:'missing',returnTo,onChange(){}})
 assert.match(document.body.textContent,/找不到指定紀錄/);assert.equal(document.querySelector('h2').textContent,'信用卡消費')
})
test('readiness error retry and deletion replace-clamps current page',async()=>{
 const data={...model.emptyData(),expenses:[card('last')]};let retries=0
 await render(Cashflow,{...props(data),readiness:'error',ledgerError:'Failed',onRetryLedger:()=>retries++})
 await click(button('重試明細'));assert.equal(retries,1)
 await act(()=>site.navigate('/cashflow?month=2026-09&page=2',{scroll:'preserve'}))
 await act(()=>root.render(createElement(Cashflow,{...props(data),readiness:'ready'})))
 assert.doesNotMatch(window.location.search,/page=/)
 assert.equal(document.querySelectorAll('[data-entry]').length,1)
 assert.equal(query.parseCashflowQuery(window.location.search).query.page,1)
})

test('signed half-cent evidence reconciles the numbers actually displayed',async()=>{
 const {CashflowRecords}=await server.ssrLoadModule('/src/views/CashflowRecords.tsx')
 const data={...model.emptyData(),expenses:[{...card('refund1'),amount:-.125},{...card('refund2'),amount:-.125}]}
 await render(CashflowRecords,{...props(data),period:{selection:{range:'month',year:2026,month:9},endMonth:'2026-09',monthList:['2026-09'],label:'2026 年 9 月'},query:query.parseCashflowQuery('?month=2026-09').query,fx:[{month:'2026-09',currency:'TWD',rate:1}],readiness:'ready',loading:false,onQuery(){}})
 assert.match(document.body.textContent,/四捨五入調整 TWD：收入 0.00 · 消費 0.01 · 差額 -0.01/)
 assert.match(document.querySelector('[data-entry]').textContent,/TWD 收入 0.00 · 消費 -0.13/)
})
test('year and all category/page selections reveal matching month and year',async()=>{
 const data={...model.emptyData(),expenses:[...Array.from({length:100},(_,i)=>card(`sep${i}`)),{...card('aug'),date:'2026-08-02'},{...card('old'),date:'2025-08-02'}]}
 await act(()=>site.navigate('/cashflow?range=year&year=2026',{scroll:'preserve'}))
 await render(Cashflow,props(data))
 await click([...document.querySelectorAll('.cashflow-category-rows button')].find(b=>b.textContent.startsWith('餐飲')))
 assert.equal(document.querySelectorAll('[data-entry]').length,100)
 await click(button('下一頁'))
 assert.ok(document.querySelector('[data-entry="card:aug"]'))
 assert.match(document.querySelector('.cashflow-month-toggle[aria-expanded="true"]').textContent,/8 月/)
 await act(()=>root.render(createElement(Cashflow,props({...data,expenses:data.expenses.filter(e=>e.id!=='aug')}))))
 await act(()=>site.navigate('/cashflow?range=all&metric=consumption&category=dining&page=2',{scroll:'preserve'}))
 assert.ok(document.querySelector('[data-entry="card:old"]'))
 assert.match(document.querySelector('.cashflow-year-toggle[aria-expanded="true"]').textContent,/2025 年/)
 assert.match(document.querySelector('.cashflow-month-toggle:not(.cashflow-year-toggle)[aria-expanded="true"]').textContent,/8 月/)

})
test('delayed FX preserves record subtree, disclosure and user-moved focus',async()=>{
 const oldFetch=globalThis.fetch, pending=[]
 const {clearHistoryCache}=await server.ssrLoadModule('/src/priceHistory.ts');clearHistoryCache()
 globalThis.fetch=url=>new Promise(resolve=>pending.push({url,resolve}))
 try {
 const data={...model.emptyData(),expenses:[card('september'),{...card('foreign'),currency:'USD',date:'2026-08-03'}]}
 await render(Cashflow,props(data))
 await click(document.querySelector('.cashflow-period-trigger'))
 await click(document.querySelector('.cashflow-month-grid button[aria-label^="8 月"]'))
 const section=document.querySelector('.cashflow-records-tile'),disclosure=section.querySelector('details')
 await act(()=>{disclosure.open=false;button('清除篩選').focus()})
 const focused=document.activeElement
 assert.ok(pending.length)
 await act(async()=>{for(const p of pending)p.resolve(new Response(JSON.stringify({symbol:'USDTWD=X',currency:'TWD',asTraded:true,points:[{date:'2026-08-31',close:32}]})))})
 assert.equal(document.querySelector('.cashflow-records-tile')===section,true)
 assert.equal(disclosure.open,false)
 assert.equal(document.activeElement===focused,true)
 } finally {globalThis.fetch=oldFetch}
})


test('review unclassified action and shared filter exclude uncategorized excluded bank rows',async()=>{
 const data={...model.emptyData(),expenses:[card('card-unknown','未分類')],bankTransactionAccounts:[{id:'bank',label:'Bank',bank:'Bank'}],bankTransactions:[
  {id:'pending',accountId:'bank',date:'2026-09-03',description:'Unknown',direction:'credit',amount:20,currency:'TWD'},
  {id:'excluded',accountId:'bank',date:'2026-09-03',description:'Transfer',direction:'debit',amount:20,currency:'TWD',classification:{kind:'excluded',reason:'自有帳戶轉帳'}}]}
 const {cashflowEntries}=await server.ssrLoadModule('/src/cashflowEntries.ts'),rows=cashflowEntries(data)
 const ids=search=>query.filterCashflowEntries(rows,query.parseCashflowQuery(search).query).map(e=>e.recordId).sort()
 assert.deepEqual(ids('?month=2026-09&source=bank&category=unclassified'),['pending'])
 assert.deepEqual(ids('?month=2026-09&category=unclassified'),['card-unknown','pending'])
 assert.deepEqual(ids('?month=2026-09&source=bank'),['excluded','pending'])
 assert.deepEqual(ids('?month=2026-09&metric=excluded'),['excluded'])
 await act(()=>site.navigate('/cashflow?month=2026-09&panel=review',{scroll:'preserve'}))
 await render(Cashflow,{...props(data),readiness:'ready'})
 for(let i=0;i<8;i++)await act(()=>new Promise(resolve=>setTimeout(resolve,2)))
 await click(button('查看銀行未分類'))
 assert.match(window.location.search,/category=unclassified/)
 assert.deepEqual([...document.querySelectorAll('[data-entry]')].map(e=>e.dataset.entry),['bank:pending'])
})
