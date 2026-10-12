import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
import {hsbc,compact,item,right,page,mast,hsbcHeader,compactHeader} from './fixtures/bank-statements/layouts.mjs'
import {observedSg,observedFubon,observedEsun} from './fixtures/bank-statements/fragmented.mjs'
test('closed Fubon TWD reopens validated foreign table on same or next page',()=>{
 for(const nextPage of [false,true]) {
  const p=compact('fubon');p[0].items.push(item('期末結餘',170,650));
  const fx=[...compactHeader('fubon',600,true),item('8800002222',23,580),item('USD',100,580),item('2031/04/09',135,580),item('Foreign payment',191,580),right('20.50',349,580)];
  if(nextPage)p.push(page(2,fx));else p[0].items.push(...fx);
  const r=bank.parseBankStatement(p);assert.equal(r.status,'recognized');assert.equal(r.recognizedCount,2);assert.deepEqual(r.sections.map(s=>s.currency),['TWD','USD']);
 }
})
test('HSBC orphan narration after completed amount is warned, not attached to next undated row',()=>{
 const p=hsbc();p[0].items.push(item('First trailing detail',103,655),item('Second payment',103,640),right('7.00',482,640));
 const r=bank.parseBankStatement(p);assert.equal(r.status,'partial');assert.equal(r.recognizedCount,2);assert.equal(r.sections[0].rows[1].description,'Second payment');assert.ok(r.sections[0].warnings.some(w=>w.code==='ambiguous-trailing-narration'));
})
test('validated activity-shaped footer row is warned rather than silently dropped',()=>{
 const p=hsbc();p[0].items.push(item('18/06/2031',53,90),item('Low payment',103,90),right('7.00',482,90));
 const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,1);assert.equal(r.status,'partial');assert.ok(r.sections[0].warnings.some(w=>w.code==='activity-below-table-boundary'));
})
let server,bank
before(async()=>{server=await createServer({cacheDir:'node_modules/.vite-bank-statements',configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}});bank=await server.ssrLoadModule('/src/bankStatements.ts')})
after(()=>server?.close())
test('observed HSBC variants group wrapped rows; amounts not balances or narrative numbers',()=>{
 for(const sg of [false,true]) {const r=bank.parseBankStatement(hsbc(sg));assert.equal(r.status,'recognized');assert.equal(r.sections[0].rows.length,1);assert.equal(r.sections[0].rows[0].amount,42.5);assert.equal(r.sections[0].rows[0].direction,'debit');assert.equal(r.sections[0].rows[0].date,sg?'2031-07-09':'2031-06-17');assert.match(r.sections[0].rows[0].description,/123456789012/);assert.ok(!JSON.stringify(r).includes('7700001111'))}
})
test('compact variants and partial E.SUN scope; Fubon references are not money',()=>{
 for(const name of ['taishin','fubon','esun']) {const r=bank.parseBankStatement(compact(name));assert.equal(r.sections[0].rows.length,1,name);assert.equal(r.sections[0].rows[0].amount,name==='taishin'?800:33);assert.equal(r.sections[0].rows[0].currency,'TWD');assert.equal(r.sections[0].rows[0].date,'2031-04-08');assert.equal(r.sections[0].partial,name==='esun');assert.match(r.sections[0].rows[0].description,/信用卡繳款/)}
})
test('DBS summary and unproven layouts are unsupported, never empty success',()=>{
 for(const p of [[page(1,[...mast('DBS 星展銀行'),item('綜合對帳單 帳戶摘要',30,700)])],[page(1,[...mast('HSBC Taiwan'),item('帳戶摘要 TWD',30,700)])]]) {const r=bank.parseBankStatement(p);assert.equal(r.status,'unsupported');assert.equal(r.sections.length,0)}
 assert.equal(bank.parseBankStatement([page(1,[item('Disclosure mentions 台新銀行',30,200)])]).status,'unsupported')
})
test('two money cells, shifted columns, impossible dates fail closed',()=>{
 const base=hsbc();for(const extra of [right('1.00',402,668),item('not currency',103,650)]) {const p=structuredClone(base);if(extra.text==='1.00')p[0].items.push(extra);else p[0].items.find(i=>i.text==='17/06/2031').text='31/02/2031';const r=bank.parseBankStatement(p);assert.equal(r.sections[0].rows.length,0);assert.ok(r.sections[0].warnings.length)}
 const p=hsbc();p[0].items.find(i=>i.text==='支出').x+=80;assert.equal(bank.parseBankStatement(p).status,'unsupported')
})

test('SG carries unfinished rows only through explicitly same-account consecutive pages',()=>{
 const base=hsbc(true);base[0].items=base[0].items.filter(i=>i.text!=='42.50');base[0].items.push(item('Balance Carried Forward',103,640));
 const next=page(2,[...mast('HSBC Singapore'),item('SGD Savings Account No: 7700001111',50,730),...hsbcHeader(700,true),item('Balance Brought Forward',103,688),item('continued account 7700001111',103,680),right('42.50',483,668),item('Closing Balance',103,640)]);
 const result=bank.parseBankStatement([...base,next]);assert.equal(result.recognizedCount,1);assert.equal(result.sections[0].rows[0].page,1);assert.match(result.sections[0].rows[0].description,/帳號已遮蔽/);
 next.items.find(i=>i.text.includes('Savings')).text='SGD Savings Account No: 7700009999';const rejected=bank.parseBankStatement([...base,next]);assert.equal(rejected.recognizedCount,0);assert.ok(rejected.rejectedCount>0)
})
test('HSBC local inherited dates and currencies reset across separate foreign sections',()=>{
 const p=hsbc();p[0].items.push(item('Second debit mentions SGD',103,650),right('20.00',482,650),item('USD 活期 帳號: 7700002222',50,620),...hsbcHeader(600),item('18/06/2031',53,580),item('Example income',103,580),right('10.00',402,580));
 const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,3);assert.deepEqual(r.sections.map(s=>s.currency),['TWD','USD']);assert.equal(r.sections[0].rows[1].date,'2031-06-17');assert.equal(r.sections[0].rows[1].currency,'TWD')
})
test('no activity needs explicit evidence, opening and closing balances alone are not success',()=>{
 const p=hsbc();p[0].items=p[0].items.filter(i=>i.y>=700);p[0].items.push(item('Opening Balance',103,680),right('100.00',573,680),item('Closing Balance',103,650),right('100.00',573,650));assert.equal(bank.parseBankStatement(p).status,'unsupported');
 p[0].items.splice(p[0].items.findIndex(i=>i.text==='Closing Balance'),0,item('No transactions',103,665));const r=bank.parseBankStatement(p);assert.equal(r.status,'recognized');assert.equal(r.sections[0].noTransactions,true);assert.equal(r.recognizedCount,0)
})
test('E.SUN ambiguous linkage, wrong period, deposit-side and missing currency fail closed',()=>{
 for(const mode of ['ambiguous','missing','wrong-year','credit']) {const p=compact('esun');if(mode==='ambiguous')p[0].items.push(item('帳戶摘要 帳號: 8800002222 USD',35,755));if(mode==='missing')p[0].items=p[0].items.filter(i=>!i.text.includes('帳戶摘要'));if(mode==='wrong-year')p[0].items.find(i=>i.text==='120/04/08').text='119/04/08';if(mode==='credit'){const i=p[0].items.find(i=>i.text==='33.00');i.x=366-i.width}const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,0,mode);assert.equal(r.status,'unsupported',mode)}
})
test('Fubon foreign table requires explicit row currency and strict decimal amounts',()=>{
 const p=compact('fubon');p[0].items=p[0].items.filter(i=>i.y>700);p[0].items.push(...compactHeader('fubon',700,true),item('8800002222',23,680),item('USD',100,680),item('2031/04/08',135,680),item('Incoming',191,680),right('44000055556666',349,680),right('20.50',468,680));const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,1);assert.equal(r.sections.at(-1).rows[0].currency,'USD');assert.equal(r.sections.at(-1).rows[0].direction,'credit');
 p[0].items=p[0].items.filter(i=>i.text!=='USD');assert.equal(bank.parseBankStatement(p).recognizedCount,0)
})
test('privacy sanitizes contextual identifiers but retains ordinary references and provenance',()=>{
 const p=hsbc();p[0].items.find(i=>i.text==='Example payment').text='Account No: 9900004444 Customer ID: A123456789';const r=bank.parseBankStatement(p);const row=r.sections[0].rows[0];assert.ok(!JSON.stringify(r).includes('9900004444'));assert.ok(!JSON.stringify(r).includes('A123456789'));assert.equal(row.sectionKey,'section-1');assert.match(row.rowKey,/^row-\d+$/);assert.equal('balance' in row,false)
})
test('positional parser limits, invalid coordinates and duplicate pages reject without input echoes',()=>{
 assert.throws(()=>bank.parseBankStatement([page(1,[item('secret',NaN,1)])]),/位置/);assert.throws(()=>bank.parseBankStatement([page(1,[]),page(1,[])]),/頁數/);assert.throws(()=>bank.parseBankStatement([page(1,[item('x'.repeat(500001),1,1)])]),/限制/)
})

test('neutral PDF lifecycle bounds, local resources, retries, abort and cleanup without card scoping',async()=>{
 const mockServer=await createServer({cacheDir:'node_modules/.vite-bank-pdf-lifecycle',configFile:false,envDir:false,ssr:{noExternal:['pdfjs-dist']},server:{middlewareMode:true,watch:null,hmr:false,ws:false},plugins:[{name:'bank-pdf-lifecycle-mock',enforce:'pre',resolveId(id){if(id==='pdfjs-dist/legacy/build/pdf.mjs')return '\0bank-pdf-test'},load(id){if(id==='\0bank-pdf-test')return `
 export const GlobalWorkerOptions={};export class PasswordException extends Error{};
 export function getDocument(options){const s=globalThis.__bankPdfLifecycle;s.options=options;s.opened++;if(s.openFailure)throw new Error('SECRET OPEN FAILURE');let reject;const task={destroy:async()=>{s.destroyed++;reject?.(new Error('destroyed'));if(s.destroyFailure)throw new Error('SECRET CLEANUP FAILURE')}};
 task.promise=new Promise((resolve,fail)=>{reject=fail;queueMicrotask(()=>{try {if(s.documentError)throw s.documentError;if(s.documentFailure)throw new Error('SECRET DOCUMENT FAILURE');if(s.password){for(let n=0;n<10;n++){let candidate;task.onPassword(value=>candidate=value);if(candidate instanceof Error)throw new PasswordException();s.tried.push(candidate);if(candidate===s.password)break;if(n===9)throw new PasswordException()}}
 resolve({numPages:s.numPages??1,getMetadata:async()=>({info:{Title:'Synthetic title'}}),getPage:async()=>{if(s.pageError)throw s.pageError;if(s.pageFailure)throw new Error('SECRET PAGE FAILURE');return {getViewport:()=>({width:612,height:864,convertToViewportPoint:(x,y)=>[x,864-y]}),getTextContent:async()=>{s.onText?.();if(s.textError)throw s.textError;if(s.failure)throw new Error('SECRET RAW CUSTOMER');return {items:s.items??[{str:'HSBC Taiwan',transform:[1,0,0,1,30,820],width:60,height:9}]};},cleanup:()=>s.cleaned++}}});}catch(e){fail(e)}})});return task;}`}}]})
 const reset=extra=>globalThis.__bankPdfLifecycle={opened:0,destroyed:0,cleaned:0,tried:[],...extra}
 try {const doc=await mockServer.ssrLoadModule('/src/statementDocument.ts');
  let state=reset({password:'synthetic-secret'});const r=await doc.readBankDocument(new Uint8Array([1]),['wrong','synthetic-secret'],new AbortController().signal);assert.equal(r.mode,'bank');assert.deepEqual(r.pages[0].items[0],{text:'HSBC Taiwan',x:30,y:820,width:60,height:9});assert.deepEqual(state.tried,['wrong','synthetic-secret']);assert.equal(state.cleaned,1);assert.equal(state.destroyed,1);assert.equal(state.options.useWorkerFetch,false);assert.equal(state.options.useWasm,false);
  state=reset({password:'synthetic-secret'});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),['wrong'],new AbortController().signal),/提供的密碼無法開啟/);assert.equal(state.destroyed,1)
  for(const passwords of ['',[],[''], ' , ']){state=reset({password:'synthetic-secret'});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),passwords,new AbortController().signal),/此帳單需要密碼/);assert.equal(state.destroyed,1)}
  state=reset({numPages:101});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',new AbortController().signal),/100 頁/);assert.equal(state.destroyed,1)
  state=reset({items:[{str:'x'.repeat(500001),transform:[1,0,0,1,1,1],width:1,height:1}]});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',new AbortController().signal),/文字過多/);assert.equal(state.cleaned,1);assert.equal(state.destroyed,1)
  state=reset({items:[]});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',new AbortController().signal),/沒有可讀取/);assert.equal(state.destroyed,1)
  state=reset({failure:true});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',new AbortController().signal),e=>!e.message.includes('SECRET'));assert.equal(state.cleaned,1);assert.equal(state.destroyed,1)
  for(const [flags,code,destroyed] of [[{openFailure:true},'BANK-OPEN',0],[{documentFailure:true},'BANK-OPEN',1],[{pageFailure:true},'BANK-PAGE',1],[{failure:true},'BANK-TEXT',1],[{destroyFailure:true},'BANK-CLEANUP',1],[{failure:true,destroyFailure:true},'BANK-TEXT',1]]){
   state=reset(flags);await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',new AbortController().signal),e=>e.message.includes(code)&&!e.message.includes('SECRET'));assert.equal(state.destroyed,destroyed);
  }
  for(const [flag,code] of [['documentError','BANK-OPEN-INTERNAL'],['pageError','BANK-PAGE-INTERNAL'],['textError','BANK-TEXT-INTERNAL']]){
   const wrapped=Object.assign(new Error('SECRET PDF CONTENT'),{name:'UnknownErrorException',details:'FormatError: SECRET RESOURCE'});
   state=reset({[flag]:wrapped,destroyFailure:true});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',new AbortController().signal),e=>e.message.includes(code)&&!e.message.includes('SECRET'));assert.equal(state.destroyed,1);
  }
  const controller=new AbortController();state=reset({onText:()=>controller.abort(),destroyFailure:true});await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',controller.signal),/取消/);assert.ok(state.destroyed>=1);assert.equal(state.cleaned,1)
  state=reset({});await assert.rejects(doc.readBankDocument(new Uint8Array(20*1024*1024+1),'',new AbortController().signal),/20MB/);assert.equal(state.opened,0)
  controller.abort();await assert.rejects(doc.readBankDocument(new Uint8Array([1]),'',controller.signal),/取消/);assert.equal(state.opened,0)
  const card=await mockServer.ssrLoadModule('/src/statementPdf.ts');state=reset({items:[{str:'09/01 STORE 100',transform:[1,0,0,1,30,700],width:90,height:9}]});const cardResult=await card.readStatementPdf(new Uint8Array([1]),'',new AbortController().signal);assert.deepEqual(cardResult,{lines:['09/01 STORE 100'],title:'Synthetic title',ocrUsed:false,ocrError:undefined});assert.equal(state.destroyed,1)
 }finally {await mockServer.close();delete globalThis.__bankPdfLifecycle}
})

test('bank movement descriptions mentioning investments retained; summary/card sections excluded',()=>{
 const p=hsbc();p[0].items.find(i=>i.text==='Example payment').text='Investment funding';p[0].items.push(item('Credit Card Summary',30,640),item('18/06/2031',53,620),item('Not a bank movement',103,620),right('10.00',482,620));const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,1);assert.match(r.sections[0].rows[0].description,/Investment funding/)
})
test('zero explicit amounts are valid, but missing year/currency and malformed money never guessed',()=>{
 const zero=hsbc();zero[0].items.find(i=>i.text==='42.50').text='0.00';assert.equal(bank.parseBankStatement(zero).sections[0].rows[0].amount,0)
 for(const mode of ['date','currency','amount']){const p=hsbc();if(mode==='date')p[0].items.find(i=>i.text==='17/06/2031').text='17/06';if(mode==='currency')p[0].items.find(i=>i.text.includes('活期')).text='活期 帳號: 7700001111';if(mode==='amount')p[0].items.push(right('3.xx',402,668));assert.equal(bank.parseBankStatement(p).recognizedCount,0,mode)}
})
test('E.SUN summary currency linkage and statement period can reside on previous page',()=>{
 const base=compact('esun')[0],meta=base.items.filter(i=>i.y>730),table=base.items.filter(i=>i.y<=730);const r=bank.parseBankStatement([page(1,meta),page(2,table)]);assert.equal(r.recognizedCount,1);assert.equal(r.sections[0].rows[0].page,2)
})
test('multiple same-currency account sections stay distinct without exposing account identities',()=>{
 const p=hsbc();p[0].items.push(item('TWD 活期 帳號: 7700002222',50,620),...hsbcHeader(600),item('18/06/2031',53,580),item('Example counterpart',103,580),right('42.50',402,580));const r=bank.parseBankStatement(p);assert.equal(r.sections.length,2);assert.equal(r.recognizedCount,2);assert.notEqual(r.sections[0].rows[0].sectionKey,r.sections[1].rows[0].sectionKey);assert.ok(!JSON.stringify(r).includes('7700002222'))
})

test('blank E.SUN currency never inherits a previous account linkage',()=>{
 const p=compact('esun');p[0].items.push(item('8800009999',35,660),item('120/04/09',112,660),item('Unknown account',173,660,80),right('20.00',307,660));const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,1);assert.ok(r.rejectedCount>0)
})
test('spatial sorting is deterministic and leaves source pages unchanged',()=>{
 const p=hsbc(),before=JSON.stringify(p),expected=bank.parseBankStatement(p);assert.equal(JSON.stringify(p),before);p[0].items.reverse();assert.deepEqual(bank.parseBankStatement(p),expected)
})

test('logo-only mastheads use observed table fingerprints plus statement context, not disclosure names',()=>{
 const p=hsbc();p[0].items=p[0].items.filter(i=>i.text!=='HSBC Taiwan');p[0].items.push(item('綜合理財對帳單',315,761));assert.equal(bank.parseBankStatement(p).recognizedCount,1)
 const ts=compact('taishin');ts[0].items=ts[0].items.filter(i=>i.text!=='台新銀行'&&i.y!==700);ts[0].items.push(item('綜合對帳單',311,739),item('新臺幣帳戶交易',49,775),item('帳號',82,700),item('日期',154,700),item('摘要',207,700),item('支票號碼',244,700),item('支出金額',297,700),item('存入金額',356,700),item('轉出入帳號',423,700),item('餘額',509,700));assert.equal(bank.parseBankStatement(ts).recognizedCount,1)
 const fb=compact('fubon');fb[0].items=fb[0].items.filter(i=>i.text!=='台北富邦銀行'&&i.y!==700);fb[0].items.push(item('綜合對帳單',363,744),item('台幣明細',26,715),item('帳號',47,700),item('日期',120,700),item('摘要',178,700),item('支出',265,700),item('收入',388,700),item('餘額',511,700));assert.equal(bank.parseBankStatement(fb).recognizedCount,1)
})
test('monthly E.SUN heading and centered actual columns preserve partial linked withdrawals',()=>{
 const p=compact('esun');p[0].items=p[0].items.filter(i=>i.y!==700&&!i.text.startsWith('2031/'));p[0].items.push(item('2031年04月',35,796),item('轉出帳號',35,700),item('交易日期',118,700),item('摘要',205,700),item('提款',291,700),item('存款',366,700),item('幣別',392,700),item('轉入帳戶',416,700));assert.equal(bank.parseBankStatement(p).recognizedCount,1)
})

test('PDF whitespace spacers and fragmented labels cannot corrupt dates or money',()=>{
 const p=hsbc();for(const line of p[0].items.filter(i=>i.y===700)){if(line.text==='日期'){line.text='日';line.width=8;p[0].items.push(item('期',68,700,8))}if(line.text==='交易明細'){line.text='交易';line.width=16;p[0].items.push(item('明細',119,700,16))}}
 p[0].items.push(item(' ',53,680,0),item('',482,668,0),item(' ',100,680,0));assert.equal(bank.parseBankStatement(p).recognizedCount,1)
})
test('SG unlabeled repeated account heading and summary link establish continuation, not inferred region',()=>{
 const p=observedSg(),r=bank.parseBankStatement(p);assert.equal(r.status,'recognized');assert.equal(r.recognizedCount,2);assert.equal(r.sections.length,1);assert.equal(r.sections[0].rows[1].page,1);assert.equal(r.sections[0].rows[1].date,'2031-07-09');
 p[1].items.find(i=>i.text==='7700001111').text='7700009999';const rejected=bank.parseBankStatement(p);assert.equal(rejected.recognizedCount,1);assert.ok(rejected.rejectedCount>0)
})
test('Fubon opening balance retains only section identity; following rows omit own account',()=>{
 const p=observedFubon(),r=bank.parseBankStatement(p);assert.equal(r.status,'recognized');assert.equal(r.recognizedCount,1);assert.equal(r.sections[0].rows[0].direction,'credit');assert.equal(r.sections[0].rows[0].amount,20.5);assert.ok(!JSON.stringify(r).includes('8800002222'));assert.ok(!JSON.stringify(r).includes('100.00'))
})
test('E.SUN masked positional summary linkage and monthly heading are explicit evidence',()=>{
 const p=observedEsun(),r=bank.parseBankStatement(p);assert.equal(r.status,'partial');assert.equal(r.recognizedCount,1);assert.equal(r.sections[0].currency,'TWD');
 p[1].items.push(item('880***2222',204,726),item('USD',363,726));assert.equal(bank.parseBankStatement(p).recognizedCount,0)
})
test('Chinese section currencies and zero transaction counts do not become amounts',()=>{
 const p=hsbc();p[0].items=p[0].items.filter(i=>i.y>=700);p[0].items.find(i=>i.text.includes('活期')).text='綜合外幣存款';p[0].items.push(item('美金',559,686),item('17/06/2031',53,678),item('承前結餘',103,678),right('100.00',573,678),item('結餘',103,670),right('100.00',573,670),item('交易總額',103,662),right('0.00',402,662),right('0.00',482,662),item('交易次數',103,654),right('0',402,654),right('0',482,654));const r=bank.parseBankStatement(p);assert.equal(r.status,'recognized');assert.equal(r.sections[0].currency,'USD');assert.equal(r.sections[0].noTransactions,true);assert.equal(r.recognizedCount,0)
})
test('raster DBS logo requires statement plus branded footer; generic/disclosure headers fail closed',()=>{
 const p=[page(1,[item('綜合對帳單',325,533),item('DBS Bank',138,67)])];assert.equal(bank.parseBankStatement(p).bank,'DBS');assert.equal(bank.parseBankStatement(p).warnings[0].code,'unsupported-dbs-activity-layout');
 const generic=hsbc();generic[0].items=generic[0].items.filter(i=>i.y<=700);generic[0].items.push(item('Disclosure mentions HSBC',30,200));assert.equal(bank.parseBankStatement(generic).status,'unsupported');
 const bad=hsbc();bad[0].items.find(i=>i.text.includes('活期')).text='信用卡摘要 SGD';assert.equal(bank.parseBankStatement(bad).recognizedCount,0)
})

test('unlabeled HSBC own-account heading is transient privacy evidence, never draft data',()=>{
 const p=hsbc();p[0].items.find(i=>i.text.includes('活期')).text='TWD 活期存款';p[0].items.push(item('7700001111',277,730));p[0].items.find(i=>i.text==='Example payment').text='Example 7700001111';const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,1);assert.ok(!JSON.stringify(r).includes('7700001111'));assert.match(r.sections[0].rows[0].description,/帳號已遮蔽/)
})
test('explicit period metadata cannot override a conflicting printed E.SUN month',()=>{
 assert.equal(bank.parseBankStatement(observedEsun(),{periodStart:'2030-04-01',periodEnd:'2030-04-30'}).recognizedCount,0)
})

// Rereview P2-B / P3-C. Entirely synthetic narration and positions.
const narration=r=>r.sections[0].rows.map(row=>row.ambiguousNarration)
test('omitted-date multiline row keeps its amount line and exposes the unowned narration as a candidate on both neighbours',()=>{
 const p=hsbc();p[0].items.push(item('Second payment line',103,655),item('Second ref detail',103,640),right('7.00',482,640));
 const r=bank.parseBankStatement(p);assert.equal(r.status,'partial');assert.equal(r.recognizedCount,2);assert.equal(r.rejectedCount,1);
 assert.deepEqual(r.sections[0].rows.map(row=>row.description),['Example payment Order 123456789012','Second ref detail']);
 assert.deepEqual(narration(r),[{leading:[],trailing:['Second payment line']},{leading:['Second payment line'],trailing:[]}]);
 // Location identity of rows emitted before this fix must not move.
 assert.deepEqual(r.sections[0].rows.map(row=>row.rowKey),['row-4','row-7']);assert.equal(r.sections[0].rows[1].date,'2031-06-17');assert.equal(r.sections[0].rows[1].amount,7)
})
test('amount-only line after one unowned narration line still emits the second row with an empty summary awaiting review',()=>{
 const p=hsbc();p[0].items.push(item('Second payment',103,655),right('7.00',482,640));
 const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,2);assert.equal(r.rejectedCount,1);assert.equal(r.status,'partial');
 assert.deepEqual(r.sections[0].warnings.map(w=>w.code),['ambiguous-trailing-narration']);
 const second=r.sections[0].rows[1];assert.equal(second.description,'');assert.equal(second.direction,'debit');assert.equal(second.amount,7);assert.equal(second.date,'2031-06-17');
 assert.deepEqual(narration(r),[{leading:[],trailing:['Second payment']},{leading:['Second payment'],trailing:[]}])
})
test('narration candidates use the recognized-identifier privacy boundary and never reach a following dated row',()=>{
 const p=hsbc();p[0].items.push(item('Trailing ref 7700001111',103,655),item('18/06/2031',53,640),item('Dated payment',103,640),right('7.00',482,640));
 const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,2);assert.ok(!JSON.stringify(r).includes('7700001111'));
 assert.deepEqual(narration(r),[{leading:[],trailing:['Trailing ref [帳號已遮蔽]']},undefined]);assert.equal(r.sections[0].rows[1].description,'Dated payment')
 // Unambiguous rows carry no review metadata at all.
 for(const sg of [false,true])assert.equal('ambiguousNarration' in bank.parseBankStatement(hsbc(sg)).sections[0].rows[0],false)
})
test('undated money in a validated wrapped table below the footer boundary warns; footer numbers and balances do not',()=>{
 const low=hsbc();low[0].items.push(right('7.00',482,90));
 const r=bank.parseBankStatement(low);assert.equal(r.recognizedCount,1);assert.equal(r.status,'partial');assert.deepEqual(r.sections[0].warnings.map(w=>w.code),['activity-below-table-boundary']);
 const footer=hsbc();footer[0].items.push(item('Page 1 of 3',280,40),item('Disclosure ref 20310617 12.00',40,60),right('987.00',573,90));
 assert.equal(bank.parseBankStatement(footer).status,'recognized');
 const closed=hsbc();closed[0].items.push(item('Closing Balance',103,640),right('7.00',482,90));assert.equal(bank.parseBankStatement(closed).status,'recognized');
 const two=hsbc();two[0].items.push(right('7.00',482,90),right('7.00',402,90));assert.equal(bank.parseBankStatement(two).status,'recognized')
})

// All values are invented. Coordinates and labels reflect the observed DBS SG table.
const dbsSg=()=>[
 {page:1,width:594,height:792,items:[item('DBS Bank Ltd',30,740),item('Consolidated Statement',401,711)]},
 {page:2,width:594,height:792,items:[
  item('My Account',45,626),item('Account No. 271-000111-7',441,626),
  item('Date',45,604),item('Description',113,604),item('Withdrawal (-)',338,604),item('Deposit (+)',430,604),item('Balance',515,604),
  item('CURRENCY: SINGAPORE DOLLAR',53,574),
  item('Balance Brought Forward',113,549),right('987654.32',548,549),
  item('02/09/2031',45,531),item('Example incoming',113,531),right('42.50',474,531),right('987696.82',548,531),
  item('Account No. 271-000111-7',113,521),item('Reference 123456789012',113,510),
  item('03/09/2031',45,483),item('Example payment',113,483),right('12.00',395,483),right('987684.82',548,483),
  item('VALUE DATE : 03/09/2031',113,473),
  item('Total Balance Carried Forward in SGD:',113,122),right('12.00',395,122),right('42.50',474,122),right('987684.82',548,122),
 ]},
 {page:3,width:594,height:792,items:[item('Disclosure',34,704),item('04/09/2031',45,600),item('Not an activity table',113,600),right('99.00',395,600)]}
]
test('DBS Singapore validates own account and SGD table, separates money from balances, preserves wrapped narration for review',()=>{
 const pages=dbsSg(),before=JSON.stringify(pages),r=bank.parseBankStatement(pages);
 assert.equal(r.bank,'DBS Singapore');assert.equal(r.status,'partial');assert.equal(r.recognizedCount,2);assert.equal(r.sections.length,1);
 assert.deepEqual(r.sections[0].rows.map(row=>[row.date,row.currency,row.direction,row.amount]),[['2031-09-02','SGD','credit',42.5],['2031-09-03','SGD','debit',12]]);
 assert.ok(r.sections[0].warnings.every(w=>w.code==='ambiguous-trailing-narration'));
 assert.equal(r.sections[0].rows[0].page,2);assert.match(r.sections[0].rows[0].ambiguousNarration.trailing.join(' '),/帳號已遮蔽/);assert.match(r.sections[0].rows[1].ambiguousNarration.trailing.join(' '),/VALUE DATE/);
 assert.ok(!JSON.stringify(r).includes('271-000111-7'));assert.ok(!JSON.stringify(r).includes('987684.82'));assert.equal(JSON.stringify(pages),before);
 pages[1].items.reverse();assert.deepEqual(bank.parseBankStatement(pages),r);
})
test('DBS Singapore needs bank identity, complete positional header, own-account heading and exact currency evidence',()=>{
 for(const kind of ['bank','header','shifted','account','currency','conflict']){
  const p=dbsSg();
  if(kind==='bank'){p[0].items[0].text='Other bank';p[1].items.push(item('Payment to DBS Bank',113,450));}
  if(kind==='header')p[1].items=p[1].items.filter(i=>i.text!=='Deposit (+)');
  if(kind==='shifted')p[1].items.find(i=>i.text==='Withdrawal (-)').x+=70;
  if(kind==='account')p[1].items=p[1].items.filter(i=>!i.text.startsWith('Account No.'));
  if(kind==='currency')p[1].items.find(i=>i.text.startsWith('CURRENCY:')).text='CURRENCY: US DOLLAR';
  if(kind==='conflict')p[1].items.push(item('Account No. 271-000222-8',441,636),item('My Account',45,636));
  assert.equal(bank.parseBankStatement(p).recognizedCount,0,kind);
 }
})
test('DBS Singapore rejects missing dates, ambiguous debit/credit, malformed amounts and undated activity without importing balances',()=>{
 for(const kind of ['missing-date','invalid-date','two-amounts','malformed','undated']){
  const p=dbsSg();
  if(kind==='missing-date')p[1].items=p[1].items.filter(i=>i.text!=='03/09/2031');
  if(kind==='invalid-date')p[1].items.find(i=>i.text==='03/09/2031').text='31/09/2031';
  if(kind==='two-amounts')p[1].items.push(right('8.00',474,483));
  if(kind==='malformed')p[1].items.find(i=>i.text==='12.00'&&i.y===483).text='12.xx';
  if(kind==='undated')p[1].items.push(item('Unexpected payment',113,450),right('8.00',395,450));
  const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,kind==='undated'?2:1,kind);assert.ok(r.rejectedCount>0,kind);
 }
})
test('DBS opening and closing balances alone never prove zero transactions',()=>{
 const p=dbsSg();p[1].items=p[1].items.filter(i=>i.y>=549||i.y===122);const r=bank.parseBankStatement(p);
 assert.equal(r.status,'unsupported');assert.equal(r.recognizedCount,0);assert.ok(!r.sections.some(s=>s.noTransactions));
})

const dbsSgWithoutNarration=()=>{
 const p=dbsSg();p[1].items=p[1].items.filter(i=>![521,510,473,122].includes(i.y));return p;
}
test('DBS Singapore closes foreign currency blocks and warns before or after an SGD total',()=>{
 for(const withTotal of [false,true]){
  const p=dbsSgWithoutNarration();
  if(withTotal)p[1].items.push(item('Total Balance Carried Forward in SGD:',113,470),right('12.00',395,470),right('42.50',474,470),right('987684.82',548,470));
  p[1].items.push(item('CURRENCY: US DOLLAR',53,450),item('04/09/2031',45,420),item('Foreign payment',113,420),right('55.00',395,420),right('145.00',548,420));
  const r=bank.parseBankStatement(p);assert.equal(r.status,'partial',String(withTotal));assert.equal(r.recognizedCount,2);assert.equal(r.sections.length,1);
  assert.deepEqual(r.sections[0].rows.map(row=>[row.currency,row.amount]),[['SGD',42.5],['SGD',12]]);
  assert.deepEqual(r.sections[0].warnings.map(w=>w.code),['unsupported-dbs-sg-account']);
  assert.equal(r.rejectedCount,1);assert.ok(!JSON.stringify(r).includes('Foreign payment'));
 }
})
test('DBS foreign currency boundary discards pending and requires a new validated table to resume',()=>{
 for(const marker of ['CURRENCY: US DOLLAR','CURRENCY : EURO','CURRENCY:']){
  const p=dbsSgWithoutNarration();
  p[1].items.push(item('04/09/2031',45,470),item('Unfinished SGD payment',113,470),item(marker,53,450),right('55.00',395,430),item('CURRENCY: SINGAPORE DOLLAR',53,410),item('05/09/2031',45,390),item('Unvalidated return to SGD',113,390),right('66.00',395,390));
  const r=bank.parseBankStatement(p);assert.equal(r.recognizedCount,2);assert.equal(r.status,'partial');
  assert.deepEqual(r.sections[0].warnings.map(w=>w.code),['currency-boundary','unsupported-dbs-sg-account']);
  assert.ok(!JSON.stringify(r).includes('Unfinished SGD payment'));assert.ok(!JSON.stringify(r).includes('Unvalidated return to SGD'));
 }
})
test('unrecognized DBS region is generic even when the masthead mentions Singapore',()=>{
 for(const brand of ['DBS Singapore','DBS Taiwan','DBS Bank Ltd']){
  const r=bank.parseBankStatement([{page:1,width:594,height:792,items:[item(brand,30,740),item('Account Summary',30,600)]}]);
  assert.equal(r.status,'unsupported');assert.equal(r.bank,'DBS');assert.equal(r.recognizedCount,0);
 }
})

test('open DBS SGD page without a closing total warns even if all recognized rows are complete',()=>{
 for(const continuation of [false,true]){
  const p=dbsSgWithoutNarration();
  if(continuation)p[2]={page:3,width:594,height:792,items:[item('04/09/2031',45,600),item('Unverified headerless continuation',113,600),right('55.00',395,600)]};
  else p.splice(2);
  const r=bank.parseBankStatement(p);assert.equal(r.status,'partial');assert.equal(r.recognizedCount,2);assert.equal(r.rejectedCount,1);
  assert.deepEqual(r.sections[0].warnings,[{page:2,code:'unproven-page-continuity',count:1}]);
  assert.ok(!JSON.stringify(r).includes('Unverified headerless continuation'));
 }
})
test('DBS closing total keeps a complete clean table recognized without a continuity warning',()=>{
 const p=dbsSgWithoutNarration();p[1].items.push(item('Total Balance Carried Forward in SGD:',113,122),right('12.00',395,122),right('42.50',474,122),right('987684.82',548,122));
 const r=bank.parseBankStatement(p);assert.equal(r.status,'recognized');assert.equal(r.recognizedCount,2);assert.equal(r.rejectedCount,0);
})
test('Currency-prefixed DBS narration stays a review candidate and never switches the table currency',()=>{
 for(const text of ['Currency: US DOLLAR','CURRENCY: SINGAPORE DOLLAR','Currency:']){
  const p=dbsSg();p[1].items.push(item(text,113,460));const r=bank.parseBankStatement(p);
  assert.equal(r.recognizedCount,2);assert.equal(r.sections.length,1);assert.equal(r.sections[0].currency,'SGD');
  assert.ok(r.sections[0].rows[1].ambiguousNarration.trailing.includes(text));
  assert.ok(r.sections[0].warnings.every(w=>w.code==='ambiguous-trailing-narration'));
 }
})
test('DBS currency evidence comes from the date column, excluding nearby description text',()=>{
 const misplaced=dbsSg();misplaced[1].items.find(i=>i.text==='CURRENCY: SINGAPORE DOLLAR').x=113;
 assert.equal(bank.parseBankStatement(misplaced).recognizedCount,0);
 const nearby=dbsSg();nearby[1].items.push(item('Currency: US DOLLAR',113,565));
 const r=bank.parseBankStatement(nearby);assert.equal(r.bank,'DBS Singapore');assert.equal(r.recognizedCount,2);
})
