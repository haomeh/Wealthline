import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
let server, dom, root, createRoot, AccountDetail, model
before(async()=>{
 dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/'})
 for(const key of ['window','document','HTMLElement','Event','MouseEvent','KeyboardEvent']) globalThis[key]=dom.window[key]
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 globalThis.ResizeObserver=class {observe(){} disconnect(){}}
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true}
 ;({createRoot}=await import('react-dom/client'))
 server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
 ;({AccountDetail}=await server.ssrLoadModule('/src/views/AccountDetail.tsx'))
 model=await server.ssrLoadModule('/src/model.ts')
})
afterEach(async()=>{if(root) await act(()=>root.unmount()); root=null})
after(async()=>{await server?.close();dom?.window.close()})

const holding=(id,symbol,quantity)=>({id,type:'holding',symbol,quantity,price:100,currency:'TWD'})
const account=positions=>({id:'broker',name:'Broker',kind:'investment',category:'股票',country:'TW',positions})

test('holdings whose quantity differs from the saved account are marked as unsaved',async()=>{
 const saved=account([holding('a','0050',12000),holding('b','2330',800)])
 const current=account([holding('a','0050',12200),holding('b','2330',800),holding('c','0056',50)])
 const data={...model.emptyData(),accounts:[current]}
 root=createRoot(document.getElementById('root'))
 await act(()=>root.render(createElement(AccountDetail,{data,account:current,saved,onChange(){},onEdit(){},onBack(){},onRefreshPrices:async()=>{},priceError:''})))
 const rows=[...document.querySelectorAll('table.holdings tbody tr')]
 const mark=row=>row.querySelector('.unsaved-mark')?.textContent
 assert.equal(mark(rows[0]),'● 數量 +200（未儲存）')
 assert.ok(rows[0].classList.contains('unsaved'))
 assert.equal(mark(rows[1]),undefined)
 assert.equal(mark(rows[2]),'● 數量 +50（未儲存）')
})

test('without a saved account nothing is marked',async()=>{
 const current=account([holding('a','0050',12200)])
 root=createRoot(document.getElementById('root'))
 await act(()=>root.render(createElement(AccountDetail,{data:{...model.emptyData(),accounts:[current]},account:current,onChange(){},onEdit(){},onBack(){},onRefreshPrices:async()=>{},priceError:''})))
 assert.equal(document.querySelector('.unsaved-mark'),null)
})

test('account detail lists historical time nodes and opens single-item backfill for any date or missing node',async()=>{
 const bank={id:'hsbc',name:'HSBC',kind:'bank',category:'現金與外幣活存',country:'TW',positions:[{id:'c1',type:'cash',symbol:'',currency:'TWD',quantity:300000,price:1}]}
 const other={id:'dbs',name:'DBS',kind:'bank',category:'現金與外幣活存',country:'SG',positions:[{id:'c2',type:'cash',symbol:'',currency:'SGD',quantity:20000,price:1}]}
 let current={
  ...model.emptyData(),
  accounts:[bank,other],
  fxRates:{SGD:24},
  history:{
   changes:[],
   snapshots:[
    {date:'2026-08-31',at:'2026-08-31T12:00:00Z',total:480000,accounts:[{id:'dbs',name:'DBS',value:480000}],categories:{}},
    {date:'2026-09-30',at:'2026-09-30T12:00:00Z',total:780000,accounts:[{id:'dbs',name:'DBS',value:480000},{id:'hsbc',name:'HSBC',value:300000}],categories:{}},
   ],
  },
 }
 const renderDetail=()=>act(()=>root.render(createElement(AccountDetail,{
  data:current,account:bank,onChange(){},onEdit(){},onBack(){},onRefreshPrices:async()=>{},priceError:'',
  onSaveHistory(next){current=next},
 })))
 root=createRoot(document.getElementById('root'))
 await renderDetail()

 const panel=document.querySelector('section[aria-label="歷史時間節點"]')
 assert.ok(panel)
 assert.match(panel.textContent,/2026\/09\/30/)
 assert.match(panel.textContent,/快照 NT\$ 300,000/)
 assert.match(panel.textContent,/2026\/08\/31/)
 assert.match(panel.textContent,/缺少紀錄（以 0 計）/)

 // Custom date backfill button opens QuantityEditor preselected for this account.
 const addBtn=[...panel.querySelectorAll('button')].find(b=>b.textContent==='＋ 補登歷史日期')
 assert.ok(addBtn)
 await act(()=>addBtn.click())
 let dialog=document.querySelector('dialog[aria-label="編輯歷史數量"]')
 assert.ok(dialog && dialog.open)
 assert.match(dialog.textContent,/HSBC/)
 assert.match(dialog.textContent,/現金餘額 · TWD/)
 await act(()=>[...dialog.querySelectorAll('button')].find(b=>b.textContent==='取消歷史編輯').click())

 // Clicking 補登這天 on 2026/08/31 prefills 2026-08-31 and saves in one click without completion checkboxes.
 const backfillBtn=[...panel.querySelectorAll('button')].find(b=>b.textContent==='補登這天')
 assert.ok(backfillBtn)
 await act(()=>backfillBtn.click())
 dialog=document.querySelector('dialog[aria-label="編輯歷史數量"]')
 assert.equal(dialog.querySelector('input[type="date"]').value,'2026-08-31')
 const input=dialog.querySelector('input[inputmode="decimal"]')
 await act(()=>{
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'250000')
  input.dispatchEvent(new dom.window.Event('input',{bubbles:true}))
 })
 await act(async()=>{[...dialog.querySelectorAll('button')].find(b=>b.textContent==='取得歷史估值').click()})
 assert.equal(dialog.querySelectorAll('input[type="checkbox"]').length,0)
 await act(()=>[...dialog.querySelectorAll('button')].find(b=>b.textContent==='儲存歷史數量').click())
 assert.equal(current.history.quantityDays.find(d=>d.date==='2026-08-31').entries.find(e=>e.accountId==='hsbc').quantity,250000)

 await renderDetail()
 assert.match(document.querySelector('section[aria-label="歷史時間節點"]').textContent,/TWD 250,000/)
 assert.doesNotMatch(document.querySelector('section[aria-label="歷史時間節點"]').textContent,/缺少紀錄（以 0 計）/)
})
