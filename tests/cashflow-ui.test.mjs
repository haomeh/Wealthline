import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
let server, dom, root, createRoot, Summary, Chart, Overview, model
before(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/'})
 for(const key of ['window','document','HTMLElement','Event','MouseEvent','KeyboardEvent']) globalThis[key]=dom.window[key]
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 globalThis.ResizeObserver=class {observe(){} disconnect(){}}
 ;({createRoot}=await import('react-dom/client'))
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;({CashflowSummary:Summary}=await server.ssrLoadModule('/src/views/CashflowSummary.tsx'))
 ;({CashflowChart:Chart}=await server.ssrLoadModule('/src/views/CashflowChart.tsx'))
 ;({Overview}=await server.ssrLoadModule('/src/views/Overview.tsx'))
 model=await server.ssrLoadModule('/src/model.ts')
})
afterEach(async()=>{if(root) await act(()=>root.unmount()); root=null})
after(async()=>{await server?.close();dom?.window.close()})
async function render(component,props){root=createRoot(document.getElementById('root'));await act(()=>root.render(createElement(component,props)))}
async function click(el){assert.ok(el);await act(()=>el.click())}
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text)
const bank=(id,direction,amount,classification)=>({id,accountId:'ledger',date:'2026-01-12',description:'Synthetic',currency:'TWD',direction,amount,classification})
const card={id:'card',date:'2026-01-12',description:'Synthetic',card:'Card',currency:'TWD',amount:200}
const rows=[bank('salary','credit',1000,{kind:'income',category:'薪資'}),bank('reversal','debit',50,{kind:'income',category:'薪資'}),bank('refund','credit',20,{kind:'expense',category:'購物'}),bank('payment','debit',200,{kind:'excluded',reason:'信用卡繳款'}),bank('pending','credit',500,{kind:'pending'}),bank('investment','credit',0,{kind:'income',category:'投資回收款'})]
test('unified totals, directional review, investment and separate source navigation',async()=>{
 let bankNav=0,cardNav=0
 await render(Summary,{expenses:[card],bankTransactions:rows,now:'2026-01-25',onGoBankTransactions:()=>bankNav++,onGoExpenses:()=>cardNav++})
 assert.match(document.querySelector('[data-cashflow-metric="income"]').textContent,/950/)
 assert.match(document.querySelector('[data-cashflow-metric="consumption"]').textContent,/180/)
 assert.match(document.querySelector('[data-cashflow-metric="difference"]').textContent,/770/)
 assert.match(document.body.textContent,/可能包含投入本金，不代表投資收益/)
 assert.match(document.body.textContent,/待確認.*500/)
 assert.match(document.body.textContent,/信用卡繳款/)
 await click(button('銀行流水'));await click(button('信用卡消費'));assert.equal(bankNav,1);assert.equal(cardNav,1)
 assert.match(document.body.textContent,/不是帳戶餘額或淨資產/)
})
test('category tabs retain controls and complete signed values; nonpositive nets have no donut',async()=>{
 await render(Summary,{bankTransactions:[bank('negative','credit',80,{kind:'expense',category:'購物'})],now:'2026-01-25'})
 await click(button('消費分類'))
 assert.equal(document.querySelector('[data-cashflow-donut]'),null)
 assert.match(document.body.textContent,/-80/)
 assert.match(document.body.textContent,/沒有正值分類/)
 assert.equal(document.querySelector('[aria-label="收支截止月份"]').value,'2026-01')
 await click(button('收入分類'));assert.doesNotMatch(document.body.innerHTML,/NaN/)
})
test('positive donut denominator excludes signed negative and zero categories',async()=>{
 await render(Summary,{bankTransactions:[bank('a','credit',100,{kind:'income',category:'薪資'}),bank('b','debit',50,{kind:'income',category:'利息'}),bank('z','credit',0,{kind:'income',category:'股利'})],now:'2026-01-25'})
 await click(button('收入分類'));assert.ok(document.querySelector('[data-cashflow-donut]'));assert.match(document.body.textContent,/正值占比/);assert.match(document.body.textContent,/-50/)
 assert.equal(document.querySelector('[data-positive-total]').dataset.positiveTotal,'100')
})
test('all twelve plot hits use actual narrow overlay at two offsets; keyboard month buttons agree',async()=>{
 const months=Array.from({length:12},(_,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,income:i===0?null:i*10,consumption:i===0?null:-i,difference:null}))
 let selected=''
 await render(Chart,{months,currency:'TWD',selectedMonth:'',onSelectMonth:m=>selected=m})
 const overlay=document.querySelector('[data-cashflow-hit]')
 for(const left of [20,170]){
  overlay.getBoundingClientRect=()=>({left,width:280,top:0,height:150,right:left+280,bottom:150})
  for(let i=0;i<12;i++) {await act(()=>overlay.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:left+(i+.5)*280/12})));assert.equal(selected,months[i].month)}
 }
 const nodes=[...document.querySelectorAll('[data-cashflow-month]')]
 for(const key of ['Enter',' ']) for(let i=0;i<12;i++){await act(()=>nodes[i].dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true})));assert.equal(selected,months[i].month)}
 assert.equal(document.querySelectorAll('[data-cashflow-bar]').length,22)
 assert.match(document.body.textContent,/無紀錄/);assert.doesNotMatch(document.body.innerHTML,/NaN/)
})
test('Overview uses one unified section in empty and populated asset branches for each source combination',async()=>{
 for(const populated of [false,true]) for(const source of ['bank','card','both']) {
  const data=model.emptyData();if(populated)data.accounts=[{id:'asset',name:'Cash',kind:'bank',category:'現金',positions:[{id:'p',type:'cash',currency:'TWD',amount:100}]}]
  if(source!=='card')data.bankTransactions=rows
  if(source!=='bank')data.expenses=[card]
  const before=structuredClone(data)
  await render(Overview,{data,onGoRates(){},onNewAccount(){},onImport(){},onOpenAccount(){}})
  assert.equal(document.querySelectorAll('[aria-label="統一收支總覽"]').length,1)
  assert.equal(document.querySelectorAll('[aria-label="消費統計"]').length,0)
  const picker=document.querySelector('[aria-label="收支截止月份"]')
  await act(()=>{picker.value='2026-01';picker.dispatchEvent(new Event('change',{bubbles:true}))})
  assert.match(document.querySelector('[data-cashflow-metric="income"]').textContent,source==='card'?/^0$/:/950/)
  assert.match(document.querySelector('[data-cashflow-metric="consumption"]').textContent,source==='bank'?/-20/:source==='card'?/200/:/180/)
  if(populated)assert.ok(document.querySelector('[aria-label="資產時間線"]'))
  else assert.match(document.body.textContent,/開始記錄你的資產/)
  assert.deepEqual(data,before)
  await act(()=>root.unmount());root=null
 }
})
test('period and chart month selection share the cutoff; tabs preserve month and currency',async()=>{
 await render(Summary,{expenses:[card,{...card,id:'usd',currency:'USD'}],now:'2026-01-25'})
 await click(button('近 12 月'));assert.equal(document.querySelectorAll('[data-cashflow-month]').length,12)
 const select=document.querySelector('[aria-label="收支幣別"]')
 await act(()=>{select.value='USD';select.dispatchEvent(new Event('change',{bubbles:true}))})
 assert.match(document.querySelector('.cashflow-currency-heading').textContent,/USD/)
 await click(button('收入分類'));await click(button('趨勢'))
 assert.equal(document.querySelectorAll('[data-cashflow-month]').length,12)
 assert.equal(document.querySelector('[aria-label="收支截止月份"]').value,'2026-01')
 await click(document.querySelector('[data-cashflow-month="2025-12"]'))
 assert.equal(document.querySelector('[aria-label="收支截止月份"]').value,'2025-12')
 assert.match(document.body.textContent,/這段期間無紀錄/)
})
test('one month retains two signed series and zero/pending-only coverage; negative investment warning remains',async()=>{
 await render(Summary,{expenses:[card],bankTransactions:[bank('neg','debit',50,{kind:'income',category:'投資回收款'}),bank('p','credit',20,{kind:'pending'})],now:'2026-01-25'})
 await click(button('近 1 月'))
 assert.equal(document.querySelectorAll('[data-cashflow-bar]').length,2)
 assert.match(document.body.textContent,/可能包含投入本金，不代表投資收益/)
 const bars=[...document.querySelectorAll('[data-cashflow-bar]')]
 assert.ok(bars.every(b=>Number(b.getAttribute('height'))>0))
 await act(()=>root.unmount());root=null
 await render(Summary,{bankTransactions:[bank('only-pending','debit',0,{kind:'pending'})],now:'2026-01-25'})
 for(const key of ['income','consumption','difference'])assert.equal(document.querySelector(`[data-cashflow-metric="${key}"]`).textContent,'0')
 assert.match(document.body.textContent,/待確認 · 1 筆/)
 assert.doesNotMatch(document.body.innerHTML,/NaN/)
})
test('no-record window is honest and currencies stay separate',async()=>{
 await render(Summary,{expenses:[{...card,date:'2025-01-01'}],now:'2026-01-25'})
 assert.match(document.body.textContent,/這段期間無紀錄/);assert.doesNotMatch(document.body.innerHTML,/NaN/)
 await act(()=>root.unmount());root=null
 await render(Summary,{expenses:[card,{...card,id:'usd',currency:'USD'}],now:'2026-01-25'})
 const select=document.querySelector('[aria-label="收支幣別"]');assert.equal(select.options.length,2)
 assert.match(document.body.textContent,/不換算/);assert.match(document.body.textContent,/本月尚未結束/);assert.match(document.body.textContent,/不代表完整月份/)
})
