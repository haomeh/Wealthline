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
