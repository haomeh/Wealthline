import assert from 'node:assert/strict'
import { before, beforeEach, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
let server, dom, root, createRoot, Summary, Overview, model
const originalFetch=globalThis.fetch
before(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/'})
 for(const key of ['window','document','HTMLElement','Event','MouseEvent','KeyboardEvent']) globalThis[key]=dom.window[key]
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 globalThis.ResizeObserver=class {observe(){} disconnect(){}}
 ;({createRoot}=await import('react-dom/client'))
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;({CashflowSummary:Summary}=await server.ssrLoadModule('/src/views/CashflowSummary.tsx'))
 ;({Overview}=await server.ssrLoadModule('/src/views/Overview.tsx'))
 model=await server.ssrLoadModule('/src/model.ts')
})
beforeEach(async()=>{
 const {clearHistoryCache}=await server.ssrLoadModule('/src/priceHistory.ts');clearHistoryCache()
 globalThis.fetch=async url=>{const symbol=new URL(url,'https://test').searchParams.get('symbol');return new Response(JSON.stringify({symbol,currency:'TWD',asTraded:true,points:[{date:'2026-01-24',close:32}]}))}
})
afterEach(async()=>{globalThis.fetch=originalFetch;if(root) await act(()=>root.unmount()); root=null})
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
 // The unclassified 500 credit counts as income.
 assert.match(document.querySelector('[data-cashflow-metric="income"]').textContent,/1,450/)
 assert.match(document.querySelector('[data-cashflow-metric="consumption"]').textContent,/180/)
 assert.match(document.querySelector('[data-cashflow-metric="difference"]').textContent,/1,270/)
 assert.match(document.body.textContent,/可能包含投入本金，不代表投資收益/)
 assert.match(document.body.textContent,/未分類.*500/)
 assert.match(document.body.textContent,/信用卡繳款/)
 await click(button('銀行流水'));await click(button('信用卡消費'));assert.equal(bankNav,1);assert.equal(cardNav,1)
 assert.match(document.body.textContent,/不是帳戶餘額或淨資產/)
})
test('nested rings normalize separately and preserve signed and zero categories',async()=>{
 await render(Summary,{expenses:[card],bankTransactions:[bank('a','credit',100,{kind:'income',category:'薪資'}),bank('b','debit',50,{kind:'income',category:'利息'}),bank('z','credit',0,{kind:'income',category:'股利'})],now:'2026-01-25'})
 const inner=document.querySelector('[data-cashflow-ring="income"]'),outer=document.querySelector('[data-cashflow-ring="consumption"]')
 assert.equal(inner.dataset.positiveTotal,'100');assert.equal(outer.dataset.positiveTotal,'200')
 assert.equal(inner.querySelectorAll('[data-cashflow-slice]').length,1)
 assert.ok(Number(inner.querySelector('circle').getAttribute('r'))<Number(outer.querySelector('circle').getAttribute('r')))
 assert.match(document.querySelector('[role="img"]').getAttribute('aria-label'),/內圈收入 50；外圈實際消費 200/)
 assert.match(document.querySelector('[aria-label="TWD 收入分類"]').textContent,/利息.*-50/)
 assert.match(document.querySelector('[aria-label="TWD 收入分類"]').textContent,/股利.*0/)
 assert.equal(document.querySelector('[data-cashflow-metric="difference"]').textContent,'-150')
 const salary=inner.querySelector('[data-cashflow-slice="薪資"]')
 assert.equal(salary.getAttribute('stroke-dasharray'),'100 0')
 assert.equal(salary.getAttribute('stroke'),document.querySelector('[aria-label="TWD 收入分類"] i').style.background)
 assert.doesNotMatch(document.body.innerHTML,/NaN/)
})
test('refund-only and zero unclassified records never turn into positive arcs',async()=>{
 await render(Summary,{bankTransactions:[bank('negative','credit',80,{kind:'expense',category:'購物'})],now:'2026-01-25'})
 assert.equal(document.querySelectorAll('[data-cashflow-slice]').length,0)
 assert.match(document.body.textContent,/-80/);assert.match(document.body.textContent,/沒有正值分類/)
 assert.equal(document.querySelector('[data-cashflow-metric="difference"]').textContent,'+80')
 await act(()=>root.unmount());root=null
 await render(Summary,{bankTransactions:[bank('pending','debit',0,{kind:'pending'})],now:'2026-01-25'})
 for(const key of ['income','consumption','difference'])assert.equal(document.querySelector(`[data-cashflow-metric="${key}"]`).textContent,'0')
 assert.match(document.body.textContent,/未分類 · 1 筆/)
 assert.equal(document.querySelectorAll('[data-cashflow-slice]').length,0)
 assert.doesNotMatch(document.body.textContent,/這段期間無紀錄/)
})
async function picker(){await click(document.querySelector('.cashflow-period-trigger'))}
async function selectMonth(month){await click(document.querySelector(`.cashflow-month-grid button[aria-label^="${month} 月"]`))}
// Harvey (2026-10-12): picking a month shows it at once; there is no separate 套用 step.
test('picking a month, year or range applies at once; arrows step; Escape and 關閉 close and restore focus',async()=>{
 await render(Summary,{expenses:[card,{...card,id:'feb',date:'2026-02-01',amount:300},{...card,id:'old',date:'2025-03-01',amount:50}],now:'2026-01-25'})
 const consumption=()=>document.querySelector('[data-cashflow-metric="consumption"]').textContent
 const trigger=()=>document.querySelector('.cashflow-period-trigger')
 assert.equal(consumption(),'200')
 assert.equal(button('套用'),undefined)
 await picker();assert.equal(document.querySelector('.cashflow-month-grid button[aria-pressed="true"]').textContent,'1 月')
 await selectMonth(2)
 assert.equal(document.querySelector('.cashflow-picker'),null)
 assert.equal(consumption(),'300')
 assert.equal(document.activeElement,trigger())
 await click(document.querySelector('[aria-label="上個月"]'))
 assert.match(trigger().textContent,/2026 年 1 月/);assert.equal(consumption(),'200')
 await click(document.querySelector('[aria-label="下個月"]'))
 assert.match(trigger().textContent,/2026 年 2 月/)
 await picker()
 await act(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 assert.equal(document.querySelector('.cashflow-picker'),null);assert.equal(document.activeElement,trigger())
 await picker();await click(button('關閉'))
 assert.equal(document.querySelector('.cashflow-picker'),null);assert.match(trigger().textContent,/2026 年 2 月/)
 await click(button('年度'))
 assert.match(trigger().textContent,/^2026 年/);assert.equal(consumption(),'500')
 await picker();await click(button('2025 年'))
 assert.equal(document.querySelector('.cashflow-picker'),null);assert.equal(consumption(),'50')
 await click(document.querySelector('[aria-label="後一年"]'))
 assert.equal(consumption(),'500')
 await click(button('全部期間'))
 assert.equal(trigger(),null);assert.equal(consumption(),'550')
 await click(button('月份'))
 assert.match(trigger().textContent,/2026 年 2 月/)
})
test('calendar year and all periods display one monthly-converted TWD total',async()=>{
 await render(Summary,{expenses:[card,{...card,id:'feb',date:'2026-02-01',amount:300},{...card,id:'old',date:'2025-01-01',amount:50},{...card,id:'usd',currency:'USD',amount:7}],now:'2026-01-25'})
 const amount=currency=>document.querySelector(`[aria-label="${currency} 收支"] [data-cashflow-metric="consumption"]`).textContent
 assert.equal(amount('TWD'),'424')
 await click(button('年度'))
 assert.equal(amount('TWD'),'724')
 await click(button('全部期間'))
 assert.equal(amount('TWD'),'774')
 assert.equal(document.querySelectorAll('.cashflow-currency').length,1)
 assert.equal(document.querySelector('select'),null)
 assert.match(document.body.textContent,/月底已完成匯率/)
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
  await picker()
  while(!document.querySelector('.cashflow-picker-year').textContent.includes('2026 年')) await click(document.querySelector('[aria-label="前一年"]'))
  await selectMonth(1)
  assert.match(document.querySelector('[data-cashflow-metric="income"]').textContent,source==='card'?/^0$/:/1,450/)
  assert.match(document.querySelector('[data-cashflow-metric="consumption"]').textContent,source==='bank'?/-20/:source==='card'?/200/:/180/)
  if(populated)assert.ok(document.querySelector('[aria-label="資產時間線"]'))
  else assert.match(document.body.textContent,/開始記錄你的資產/)
  assert.deepEqual(data,before)
  await act(()=>root.unmount());root=null
 }
})
test('no-record period stays distinct from zero and current month warns about coverage',async()=>{
 await render(Summary,{expenses:[{...card,date:'2025-01-01'}],now:'2026-01-25'})
 await picker();await click(document.querySelector('[aria-label="後一年"]'));await selectMonth(1)
 assert.match(document.body.textContent,/這段期間無紀錄/)
 assert.equal(document.querySelector('[data-cashflow-metric]'),null)
 assert.match(document.body.textContent,/本月尚未結束/)
 assert.match(document.body.textContent,/不代表完整月份/)
 assert.doesNotMatch(document.body.innerHTML,/NaN/)
})

test('category colors remain stable when other categories disappear between periods',async()=>{
 await render(Summary,{bankTransactions:[bank('salary','credit',100,{kind:'income',category:'薪資'}),bank('interest','credit',10,{kind:'income',category:'利息'}),{...bank('feb-interest','credit',15,{kind:'income',category:'利息'}),date:'2026-02-01'}],now:'2026-01-25'})
 const color=document.querySelector('[data-cashflow-slice="利息"]').getAttribute('stroke')
 await picker();await selectMonth(2)
 assert.equal(document.querySelector('[data-cashflow-slice="利息"]').getAttribute('stroke'),color)
 assert.equal(document.querySelector('[aria-label="TWD 收入分類"] i').style.background,color)
})

test('missing FX automatically requests, hides partial totals, and retry bypasses cached failure',async()=>{
 const calls=[]
 globalThis.fetch=async(url,options)=>{calls.push([url,options.cache]);return calls.length===1?new Response('{}',{status:502}):new Response(JSON.stringify({symbol:'USDTWD=X',currency:'TWD',asTraded:true,points:[{date:'2026-01-24',close:32}]}))}
 await render(Summary,{expenses:[card,{...card,id:'usd',currency:'USD',amount:1}],now:'2026-01-25'})
 assert.equal(calls.length,1);assert.match(document.querySelector('[role="alert"]').textContent,/未顯示部分合計/)
 assert.equal(document.querySelector('[data-cashflow-metric]'),null)
 await click(button('重試匯率'))
 assert.equal(calls.length,2);assert.equal(calls[1][1],'no-cache')
 assert.equal(document.querySelector('[data-cashflow-metric="consumption"]').textContent,'232')
})
test('new currency-month requests automatically and stale selection results cannot replace current totals',async()=>{
 const pending=[]
 globalThis.fetch=(url)=>new Promise(resolve=>pending.push({url,resolve}))
 await render(Summary,{expenses:[{...card,currency:'USD',amount:1},{...card,id:'feb',currency:'SGD',date:'2026-02-01',amount:2},{...card,id:'mar',date:'2026-03-01'}],now:'2026-03-10'})
 assert.equal(pending.length,0)
 await picker();await selectMonth(1)
 assert.match(document.querySelector('[role="status"]').textContent,/正在換算/)
 assert.equal(pending.length,1)
 await picker();await selectMonth(2)
 assert.equal(pending.length,2);assert.match(pending[1].url,/SGDTWD/)
 await act(async()=>pending[1].resolve(new Response(JSON.stringify({symbol:'SGDTWD=X',currency:'TWD',asTraded:true,points:[{date:'2026-02-27',close:24}]}))))
 assert.equal(document.querySelector('[data-cashflow-metric="consumption"]').textContent,'48')
 await act(async()=>pending[0].resolve(new Response(JSON.stringify({symbol:'USDTWD=X',currency:'TWD',asTraded:true,points:[{date:'2026-01-30',close:31}]}))))
 assert.equal(document.querySelector('[data-cashflow-metric="consumption"]').textContent,'48')
})

test('summary-only input converts to one chart without needing raw detail records',async()=>{
 const {cashflowMonths}=await server.ssrLoadModule('/src/cashflow.ts')
 const months=cashflowMonths({expenses:[card,{...card,id:'usd',currency:'USD',amount:2}]})
 const before=structuredClone(months)
 await render(Summary,{months,now:'2026-01-25'})
 assert.equal(document.querySelectorAll('.cashflow-currency').length,1)
 assert.equal(document.querySelector('[data-cashflow-metric="consumption"]').textContent,'264')
 await picker();assert.ok(document.querySelector('button[aria-label="1 月，有紀錄"]'))
 assert.deepEqual(months,before)
})

// A bank statement imported for an earlier month (Harvey's HSBC SG rows were 2024-04, all unclassified).
test('the overview opens on the latest recorded month when the current month has none, and shows unclassified bank rows',async()=>{
 const imported=[{...bank('a','debit',1060.03,undefined),date:'2024-04-03'},{...bank('b','credit',0.23,undefined),date:'2024-04-08'}]
 let bankNav=0
 await render(Summary,{bankTransactions:imported,now:'2026-10-12',onGoBankTransactions:()=>bankNav++})
 assert.match(document.querySelector('.cashflow-period-trigger').textContent,/2024 年 4 月/)
 assert.doesNotMatch(document.body.textContent,/這段期間無紀錄/)
 const note=document.querySelector('[data-cashflow-pending]')
 assert.ok(note,'unclassified rows are named outside the collapsed review')
 assert.match(note.textContent,/2 筆銀行流水未分類，已依入帳／支出計入收支/)
 assert.equal(document.querySelector('[data-cashflow-metric="income"]').textContent,'0.23')
 assert.equal(document.querySelector('[data-cashflow-metric="consumption"]').textContent,'1,060.03')
 await click([...note.querySelectorAll('button')].find(el=>el.textContent==='前往分類'));assert.equal(bankNav,1)
 // An empty month offers the latest recorded month.
 await picker();while(!document.querySelector('.cashflow-picker-year').textContent.includes('2026 年')) await click(document.querySelector('[aria-label="後一年"]'))
 await selectMonth(10)
 assert.match(document.body.textContent,/這段期間無紀錄/)
 await click(button('查看 2024 年 4 月'))
 assert.match(document.querySelector('.cashflow-period-trigger').textContent,/2024 年 4 月/)
 assert.ok(document.querySelector('[data-cashflow-pending]'))
})
test('the current month stays the default when it has records',async()=>{
 await render(Summary,{expenses:[card,{...card,id:'old',date:'2025-03-01'}],now:'2026-01-25'})
 assert.match(document.querySelector('.cashflow-period-trigger').textContent,/2026 年 1 月/)
 assert.equal(document.querySelector('[data-cashflow-pending]'),null)
})
