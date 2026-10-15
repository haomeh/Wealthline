import assert from 'node:assert/strict'
import { before, after, afterEach, test } from 'node:test'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { statementKeyStore } from './helpers/statement-key-store.mjs'
import { createFakeDrive } from './helpers/fake-drive.mjs'
let server,dom,root,createRoot,Page,routes,pdf,App,appHook,auth,model
const originalFetch=globalThis.fetch
const appMock=`import {createElement} from 'react';import {BankTransactions as Real} from '/src/views/BankTransactions.tsx';export let change,data;export function BankTransactions(props){change=props.onChange;data=props.data;return createElement(Real,props)}`
const pdfMock=`let results=[],hold=false,pauseAt=0,resolve;export let calls=[];export function reset(next){results=next;calls=[];hold=false;resolve=undefined}export function pause(index=0){hold=true;pauseAt=index}export function isPaused(){return hold}export function release(){hold=false;resolve?.()}export function progress(index,completed,total){calls[index].onPageProgress?.({completed,total})}export async function readBankStatementPdf(bytes,password,signal,onPageProgress){calls.push({password,signal,onPageProgress});if(hold&&calls.length-1===pauseAt)await new Promise(r=>resolve=r);if(signal.aborted)throw new Error('abort');const next=results.shift();if(next instanceof Error)throw next;return {pages:next}}export function parseBankStatement(pages){if(pages.parseError)throw pages.parseError;return pages}`
// The import entry's detection and the card reader, for the 自動判斷 flow.
const kindMock=`let kinds=[];export let calls=[];export function setKinds(next){kinds=next;calls=[]}export async function detectStatementKind(bytes,password,signal,name,onProgress){calls.push({name,password});const next=kinds.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(onProgress):next}`
const cardMock=`let results=[],hold,resolve;export let calls=[];export function setResults(next){results=next;calls=[];hold=false}export function pause(){hold=true}export function release(){hold=false;resolve?.()}export async function readStatementPdf(bytes,password,signal,name,onProgress){calls.push({name,password});onProgress?.('正在本機定位匯豐交易區段 · 第 2／3 頁');if(hold)await new Promise(r=>resolve=r);return results.shift()}`
before(async()=>{dom=new JSDOM('<div id="root"></div>',{url:'https://wealthline.test/'});for(const k of ['window','document','HTMLElement','Event','MouseEvent','KeyboardEvent','PopStateEvent','localStorage','sessionStorage'])globalThis[k]=dom.window[k];globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.ResizeObserver=class{observe(){}disconnect(){}};globalThis.requestAnimationFrame=callback=>setTimeout(callback,0);window.scrollTo=()=>{};window.HTMLDialogElement.prototype.showModal=function(){this.open=true};({createRoot}=await import('react-dom/client'));server=await createServer({cacheDir:'node_modules/.vite-bank-ui',configFile:false,envDir:false,plugins:[{name:'bank-pdf-mock',enforce:'pre',resolveId(id,importer){if(id==='bank-app-test-hook'||id==='./views/BankTransactions'&&importer?.endsWith('/src/App.tsx'))return '\0bank-app-mock';if(id.endsWith('/bankStatements')||id==='/src/bankStatements.ts')return '\0bank-pdf-mock';if(id.endsWith('/statementKind')||id==='/src/statementKind.ts')return '\0kind-mock';if(id.endsWith('/statementPdf')||id==='/src/statementPdf.ts')return '\0card-pdf-mock'},load(id){if(id==='\0bank-app-mock')return appMock;if(id==='\0bank-pdf-mock')return pdfMock;if(id==='\0kind-mock')return kindMock;if(id==='\0card-pdf-mock')return cardMock}}],server:{middlewareMode:true,watch:null,hmr:false,ws:false}});pdf=await server.ssrLoadModule('/src/bankStatements.ts');routes=await server.ssrLoadModule('/src/routes.ts');({BankTransactions:Page}=await server.ssrLoadModule('/src/views/BankTransactions.tsx'));App=(await server.ssrLoadModule('/src/App.tsx')).default;appHook=await server.ssrLoadModule('bank-app-test-hook');auth=await server.ssrLoadModule('/src/google/auth.ts');model=await server.ssrLoadModule('/src/model.ts')})
afterEach(async()=>{if(root)await act(()=>root.unmount());root=null;globalThis.fetch=originalFetch;localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/');delete globalThis.confirm;delete globalThis.indexedDB})
after(async()=>{await server?.close();dom?.window.close()})
const empty={version:13,accounts:[],history:[],bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]}
async function render(data=empty,busy=false,passwordScope){let latest=data;root=createRoot(document.getElementById('root'));const props=()=>({data:latest,busy,passwordScope,onChange:next=>{latest=next;root.render(createElement(Page,props()))}});await act(()=>root.render(createElement(Page,props())));return()=>latest}
const button=t=>[...document.querySelectorAll('button')].find(x=>x.textContent===t||x.title===t)
async function click(t){assert.ok(button(t),t);await act(()=>button(t).click());if(t==='確認匯入')await settle(()=>!button(t)||!button(t).disabled&&(!!document.querySelector('[aria-label="銀行重複核對"]')||!!document.querySelector('[role="alert"]')))}
// The bank page's button opens the shared import entry; the bank import screen itself stays at /bank-transactions/import.
async function openBankImport(){assert.ok(button('匯入銀行帳單'));await act(async()=>{window.history.pushState(null,'','/bank-transactions/import');window.dispatchEvent(new PopStateEvent('popstate'))})}
async function input(label,value){const el=document.querySelector(`[aria-label="${label}"]`);assert.ok(el,label);await act(()=>{Object.getOwnPropertyDescriptor(dom.window[el.tagName==='SELECT'?'HTMLSelectElement':'HTMLInputElement'].prototype,'value').set.call(el,value);el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))})}
async function typeText(label,text){await input(label,'');for(const char of text){const el=document.querySelector(`[aria-label="${label}"]`);await input(label,el.value+char)}assert.equal(document.querySelector(`[aria-label="${label}"]`).value,text)}
test('incremental drafts preserve spaces and mask complete identifiers only at commit',async()=>{
 const latest=await render();await typeText('帳戶標籤','帳號 12345678');await typeText('銀行名稱','ATM withdrawal fee');await click('新增流水帳戶');assert.equal(latest().bankTransactionAccounts[0].label,'帳號 [帳號已遮蔽]');assert.equal(latest().bankTransactionAccounts[0].bank,'ATM withdrawal fee');const id=latest().bankTransactionAccounts[0].id;await act(()=>box(`編輯帳戶 ${id}`).click());await typeText(`帳戶標籤 ${id}`,'台新帳戶1');await click('改名');assert.equal(latest().bankTransactionAccounts[0].label,'台新帳戶1');await click('手動新增流水');await input('流水日期','2026-01-12');await typeText('流水摘要','ATM withdrawal fee');await typeText('流水摘要','帳號 12345678');await click('套用修改');assert.equal(latest().bankTransactions[0].description,'帳號 [帳號已遮蔽]');await click('新增銀行規則');await typeText('規則關鍵字','ATM withdrawal fee');await typeText('規則關鍵字','帳號 12345678');await click('儲存規則');assert.equal(latest().bankCategoryRules[0].keyword,'帳號 [帳號已遮蔽]')
})
test('investment warning applies only to effective investment recovery income',async()=>{
 await render({...empty,bankTransactionAccounts:[account],bankTransactions:[{...tx,classification:{kind:'income',category:'薪資'}}]});await act(()=>document.querySelector('[aria-label="編輯流水 row"]').click());assert.equal(document.body.textContent.includes('不代表投資收益'),false);await input('流水分類','income:投資回收款');assert.match(document.body.textContent,/不代表投資收益/);await input('流水分類','income:利息');assert.equal(document.body.textContent.includes('不代表投資收益'),false)
})
test('unchecked invalid manual draft does not poison parsed context; selected invalid still rejects',async()=>{
 pdf.reset([parsed()]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');await click('補登一筆交易');await click('確認匯入');assert.ok(document.querySelector('[role="alert"]'));await act(()=>document.querySelector('[aria-label="區段 1 選取 2"]').click());await click('確認匯入');assert.equal(latest().bankTransactions.length,1)
})
test('preview drafts preserve incremental input and reparse cancel preserves all edits',async()=>{
 pdf.reset([parsed(),parsed()]);const latest=await render();await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','new');await typeText('區段 1 新標籤','帳號 12345678');await typeText('區段 1 交易 1 摘要','ATM withdrawal fee');await input('區段 1 交易 1 分類','income:薪資');assert.equal(document.body.textContent.includes('不代表投資收益'),false);await input('區段 1 交易 1 分類','income:投資回收款');assert.match(document.body.textContent,/不代表投資收益/);await typeText('區段 1 交易 1 摘要','帳號 12345678');await click('補登一筆交易');await act(()=>document.querySelector('[aria-label="區段 1 選取 2"]').click());await files();let confirmations=0;globalThis.confirm=()=>{confirmations++;return false};await submitImport();assert.equal(confirmations,1);assert.equal(pdf.calls.length,1);assert.equal(document.querySelector('[aria-label="區段 1 新標籤"]').value,'帳號 12345678');assert.equal(document.querySelector('[aria-label="區段 1 交易 1 摘要"]').value,'帳號 12345678');assert.equal(document.querySelector('[aria-label="區段 1 選取 2"]').checked,false);await click('確認匯入');assert.equal(latest().bankTransactions[0].description,'帳號 [帳號已遮蔽]');assert.equal(latest().bankTransactionAccounts[0].label,'帳號 [帳號已遮蔽]')
})
test('manual preview bank drafts preserve incremental spaces and commit only protected text',async()=>{const latest=await render();await click('匯入銀行帳單');await click('手動補登其他帳戶');await typeText('區段 1 銀行','ATM withdrawal fee');await typeText('區段 1 銀行','帳號 12345678');await input('區段 1 帳戶','new');await typeText('區段 1 新標籤','ATM withdrawal fee');await input('區段 1 交易 1 日期','2026-01-12');await typeText('區段 1 交易 1 摘要','帳號 12345678');await click('確認匯入');assert.equal(JSON.stringify(latest()).includes('12345678'),false);assert.equal(latest().bankTransactionAccounts[0].bank,'帳號 [帳號已遮蔽]');assert.equal(latest().bankTransactionAccounts[0].label,'ATM withdrawal fee');assert.equal(latest().bankTransactions[0].description,'帳號 [帳號已遮蔽]')})
test('reparse asks before discarding edited manual rows and mappings',async()=>{pdf.reset([parsed(),parsed([])]);await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');await input('區段 1 交易 1 金額','42');await click('補登一筆交易');await input('區段 1 交易 2 摘要','Manual draft');await act(()=>document.querySelector('[aria-label="區段 1 選取 1"]').click());await files();let asked=false;globalThis.confirm=()=>{asked=true;return false};await submitImport();assert.equal(asked,true);assert.equal(document.querySelector('[aria-label="區段 1 帳戶"]').value,'ledger');assert.equal(document.querySelector('[aria-label="區段 1 交易 1 金額"]').value,'42');assert.equal(document.querySelector('[aria-label="區段 1 交易 2 摘要"]').value,'Manual draft');assert.equal(document.querySelector('[aria-label="區段 1 選取 1"]').checked,false)})
test('preview investment notice follows effective category including rules',async()=>{pdf.reset([parsed()]);await render({...empty,bankCategoryRules:[{keyword:'Example transfer',target:{kind:'income',category:'投資回收款'}}]});await click('匯入銀行帳單');await files();await submitImport();assert.match(document.body.textContent,/不代表投資收益/);await input('區段 1 交易 1 分類','income:薪資');assert.equal(document.body.textContent.includes('不代表投資收益'),false)})
test('explicitly accepting discard replaces preview',async()=>{pdf.reset([parsed(),parsed([])]);await render();await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 交易 1 金額','42');await files();globalThis.confirm=()=>true;await submitImport();await settle(()=>!document.querySelector('.bank-preview-row'));assert.equal(pdf.calls.length,2);assert.match(document.body.textContent,/已證明無交易/)})
test('independent bank route and empty-assets page',async()=>{assert.deepEqual(routes.parseRoute('/bank-transactions'),{tab:'bank-transactions'});assert.equal(routes.routePath({tab:'bank-transactions'}),'/bank-transactions');await render();assert.match(document.body.textContent,/銀行流水/);assert.match(document.body.textContent,/替每筆設定分類/);assert.ok(button('新增流水帳戶'))})
test('account creation masks contextual identifiers, rename keeps identity and referenced deletion guarded',async()=>{const latest=await render();await input('帳戶標籤','帳號 123456789012');await input('銀行名稱','Synthetic');await click('新增流水帳戶');assert.equal(latest().bankTransactionAccounts.length,1);assert.equal(latest().bankTransactionAccounts[0].label,'帳號 [帳號已遮蔽]');assert.deepEqual(latest().accounts,[]);assert.deepEqual(latest().history,[])})
test('busy page prevents mutations',async()=>{await render(empty,true);assert.ok(button('新增流水帳戶').disabled);assert.ok(button('匯入銀行帳單').disabled)})

const account={id:'ledger',label:'Synthetic ledger',bank:'Synthetic bank'}
const tx={id:'row',accountId:'ledger',date:'2026-01-12',description:'Example transfer',currency:'TWD',direction:'debit',amount:100}
const draft={sectionKey:'section-1',page:1,rowKey:'row-1',date:'2026-01-12',description:'帳號 123456789012 Example transfer',currency:'TWD',direction:'debit',amount:100}
const parsed=(rows=[draft],partial=false)=>({status:partial?'partial':'recognized',bank:'Synthetic bank',recognizedCount:rows.length,rejectedCount:0,warnings:[],sections:[{key:'section-1',bank:'Synthetic bank',currency:'TWD',rows,warnings:[],noTransactions:!rows.length,partial}]})
async function files(count=1){const el=document.querySelector('[aria-label="銀行帳單 PDF"]');Object.defineProperty(el,'files',{configurable:true,value:Array.from({length:count},(_,i)=>({size:30,name:`synthetic-${i}.pdf`,arrayBuffer:async()=>new TextEncoder().encode('%PDF-synthetic'+i).buffer}))});await act(()=>el.dispatchEvent(new Event('change',{bubbles:true})))}
async function settle(predicate){for(let i=0;i<100&&!predicate();i++)await act(()=>new Promise(resolve=>setTimeout(resolve,5)));assert.ok(predicate(),'async operation settled')}
async function submitImport(){await act(async()=>document.querySelector('.bank-import form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await settle(()=>pdf.isPaused()?pdf.calls.length>0:!!button('解析銀行帳單'))}
test('manual row and refund semantics preserve asset domains; referenced account deletion guarded',async()=>{
 const latest=await render({...empty,bankTransactionAccounts:[account]});await click('手動新增流水');await input('流水日期','2026-01-12');await input('流水摘要','Refund');await input('流水方向','credit');await input('流水金額','20');await input('流水分類','expense:購物');await click('套用修改');assert.equal(latest().bankTransactions.length,1);assert.match(document.body.textContent,/消費退款/);assert.ok(document.querySelector('[aria-label^="刪除帳戶"]').disabled);assert.deepEqual(latest().accounts,[]);assert.deepEqual(latest().history,[]);const id=latest().bankTransactionAccounts[0].id;await act(()=>box(`編輯帳戶 ${id}`).click());await input(`帳戶標籤 ${id}`,'Renamed');await click('改名');assert.equal(latest().bankTransactionAccounts[0].id,id);assert.equal(latest().bankTransactions[0].accountId,id)
})
test('manual pending overrides normalized directed rule and quick-edit changes first match',async()=>{
 const latest=await render({...empty,bankTransactionAccounts:[account],bankTransactions:[tx]});assert.match(document.body.textContent,/未分類 · 計入消費/);await click('新增銀行規則');await input('規則關鍵字','example transfer');await input('規則方向','debit');await input('規則分類','expense:購物');await click('儲存規則');assert.match(document.querySelector('.bank-record').textContent,/購物/);await act(()=>document.querySelector('[aria-label="編輯流水 row"]').click());await input('流水分類','pending');await click('套用修改');assert.equal(latest().bankTransactions[0].classification.kind,'pending');assert.match(document.querySelector('.bank-record').textContent,/未分類 · 計入消費/);await click('編輯匹配規則／新增規則');assert.equal(document.querySelector('[aria-label="規則關鍵字"]').value,'example transfer');await act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));assert.equal(document.querySelector('[role="dialog"]'),null)
})
test('mixed unsupported and partial batch, explicit mapping, masking, preview-rule cancel and atomic confirm',async()=>{
 pdf.reset([{status:'unsupported',sections:[],warnings:[{code:'unsupported-dbs-activity-layout',count:1,page:1}],recognizedCount:0,rejectedCount:0},parsed([draft],true)]);const latest=await render();await click('匯入銀行帳單');await files(2);await input('銀行 PDF 密碼','manual');await submitImport();await settle(()=>!!document.querySelector('[aria-label="銀行解析結果"]'));assert.match(document.body.textContent,/不支援／未辨識 · 未匯入任何交易/);assert.match(document.body.textContent,/只列轉出交易/);assert.match(document.body.textContent,/unsupported-dbs/);assert.equal(latest().bankTransactions.length,0);assert.equal(document.querySelector('[aria-label="銀行 PDF 密碼"]').value,'');await input('區段 1 帳戶','new');await input('區段 1 新標籤','Personal');await input('區段 1 交易 1 金額','42');await click('編輯匹配規則／新增規則');await click('取消規則');assert.equal(document.querySelector('[aria-label="區段 1 交易 1 金額"]').value,'42');assert.equal(document.querySelector('[aria-label="區段 1 選取 1"]').checked,true);assert.match(document.querySelector('[aria-label="區段 1 交易 1 摘要"]').value,/\[帳號已遮蔽\]/);await click('確認匯入');assert.equal(latest().bankTransactionAccounts.length,1);assert.equal(latest().bankTransactions.length,1);assert.equal(latest().bankTransactions[0].amount,42);assert.match(latest().bankTransactions[0].sourceKey,/^bank-v1:/);assert.deepEqual(latest().accounts,[]);assert.deepEqual(latest().history,[])
})
test('mapping required and cancellation leaves no orphan account',async()=>{pdf.reset([parsed()]);const latest=await render();await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');assert.match(document.querySelector('[role="alert"]').textContent,/選擇要記入/);await input('區段 1 帳戶','new');await input('區段 1 新標籤','Unsaved');await click('取消匯入');assert.equal(latest().bankTransactionAccounts.length,0);assert.equal(latest().bankTransactions.length,0)})
test('remapping regenerates account keys; exact reimport skipped; cross-document duplicates require explicit keep',async()=>{
 const second={...account,id:'second',label:'Second'};const latest=await render({...empty,bankTransactionAccounts:[account,second]});async function preview(count=1){pdf.reset(Array.from({length:count},()=>parsed()));await click('匯入銀行帳單');await files(count);await submitImport();await input('區段 1 帳戶','ledger')}
 await preview();await input('區段 1 帳戶','second');assert.equal(document.querySelector('[aria-label="銀行重複核對"]'),null);await click('確認匯入');assert.equal(latest().bankTransactions[0].accountId,'second');const original=latest().bankTransactions[0];await preview();await input('區段 1 帳戶','second');await click('確認匯入');assert.ok(button('確認銀行匯入').disabled);await click('取消匯入');await preview(2);await input('區段 1 帳戶','second');await input('銀行預覽區段','1');await input('區段 2 帳戶','second');await input('銀行預覽區段','0');await act(()=>document.querySelector('[aria-label="區段 1 選取 1"]').click());await click('確認匯入');assert.match(document.querySelector('[aria-label="銀行重複核對"]').textContent,/疑似重複 1/);assert.ok(button('確認銀行匯入').disabled);await act(()=>document.querySelector('[aria-label="保留疑似重複"]').click());await click('確認銀行匯入');assert.equal(latest().bankTransactions.length,2);assert.equal(latest().bankTransactions[0].sourceKey,original.sourceKey)
})
test('unmount aborts in-flight PDF and never confirms old session',async()=>{pdf.reset([parsed()]);pdf.pause();const latest=await render();await click('匯入銀行帳單');await files();await submitImport();assert.equal(pdf.calls.length,1);await click('取消匯入');assert.equal(pdf.calls[0].signal.aborted,true);await act(()=>pdf.release());assert.equal(latest().bankTransactions.length,0)})

const appData=()=>({...model.emptyData(),history:{changes:[],liabilityChanges:[],snapshots:[]},version:13,fxRates:{USD:32,SGD:24},fxUpdatedAt:new Date().toISOString(),bankTransactionAccounts:[account],bankTransactions:[tx],bankCategoryRules:[]})
async function renderApp(){root=createRoot(document.getElementById('root'));await act(async()=>root.render(createElement(App)));await settle(()=>!!document.querySelector('.bank-page'))}
function drive(data){let uploaded,writes=0;const profile={sub:'bank-ui-test',name:'Synthetic',email:'synthetic@example.test'};auth.storeSession({profile,token:{value:'test',expiresAt:Date.now()+3600000}});const fake=createFakeDrive();fake.seed(data);fake.hold((file,init)=>{if(file.appProperties.weWealth!=='data')return false;writes++;uploaded=fake.joined(init.body);assert.equal(init.headers['If-Match'],'"v1"');return true});globalThis.fetch=async(url,init={})=>String(url).includes('userinfo')?Response.json(profile):fake.fetch(url,init);return {get uploaded(){return uploaded},get writes(){return writes},finish:async(status=200)=>act(async()=>{await fake.release(status);await new Promise(resolve=>setTimeout(resolve,0))})} }
test('App route, normal bank save, locked pending controls and external deferred update retained (not interactive editing)',async()=>{
 window.history.replaceState(null,'','/bank-transactions');const original=appData(),d=drive(original);await renderApp();await act(()=>box('編輯帳戶 ledger').click());await input('帳戶標籤 ledger','Before save');await click('改名');assert.equal(d.writes,0);await click('儲存變更');assert.equal(d.writes,1);assert.ok(box('編輯帳戶 ledger').disabled);assert.ok(document.querySelector('[aria-label="編輯流水 row"]').disabled);assert.ok(button('匯入銀行帳單').disabled);assert.ok(button('編輯匹配規則／新增規則').disabled);assert.ok(button('管理帳單密碼').disabled);await act(()=>box('編輯帳戶 ledger').click());assert.equal(box('帳戶標籤 ledger'),null);assert.equal(appHook.data.bankTransactionAccounts[0].label,'Before save');assert.deepEqual(d.uploaded.accounts,original.accounts);assert.deepEqual(d.uploaded.liabilities,original.liabilities);assert.deepEqual(d.uploaded.history,original.history)
 // Explicit external state injection through a test-only forwarding component. Busy UI stays locked.
 await act(()=>appHook.change({...appHook.data,bankTransactionAccounts:[{...account,label:'External later label'}],bankTransactions:[{...tx,classification:{kind:'expense',category:'購物'}}]}));await d.finish();assert.equal(appHook.data.bankTransactionAccounts[0].label,'External later label');assert.equal(appHook.data.bankTransactions[0].classification.category,'購物');assert.ok(button('儲存變更'));assert.equal(d.uploaded.bankTransactionAccounts[0].label,'Before save');assert.equal(appHook.data.version,15)
 await act(()=>{window.history.pushState(null,'','/expenses');window.dispatchEvent(new PopStateEvent('popstate'))});assert.ok(document.querySelector('.expenses-page'));assert.equal(document.querySelector('.bank-page'),null);await act(()=>{window.history.pushState(null,'','/bank-transactions');window.dispatchEvent(new PopStateEvent('popstate'))});assert.ok(document.querySelector('.bank-page'))
})
test('App Drive 412 retains actual bank edit and backup guard',async()=>{window.history.replaceState(null,'','/bank-transactions');const d=drive(appData());await renderApp();await act(()=>box('編輯帳戶 ledger').click());await input('帳戶標籤 ledger','Unsaved bank edit');await click('改名');await click('儲存變更');await d.finish(412);assert.equal(appHook.data.bankTransactionAccounts[0].label,'Unsaved bank edit');assert.ok(button('儲存變更'));assert.match(document.querySelector('[role="alert"]').textContent,/其他裝置/);assert.ok(button('下載本機資料備份'))})
test('App local conflict retains actual bank edit and independent ledger',async()=>{globalThis.fetch=async()=>{throw new Error('offline')};localStorage.setItem('wealthline.local.active','1');const data=appData();localStorage.setItem('wealthline.local.data',JSON.stringify(data));window.history.replaceState(null,'','/bank-transactions');await renderApp();await act(()=>box('編輯帳戶 ledger').click());await input('帳戶標籤 ledger','Local unsaved');await click('改名');localStorage.setItem('wealthline.local.data',JSON.stringify({...data,bankTransactionAccounts:[{...account,label:'Other tab'}]}));await click('儲存變更');await settle(()=>!!document.querySelector('[role="alert"]'));assert.equal(appHook.data.bankTransactionAccounts[0].label,'Local unsaved');assert.equal(JSON.parse(localStorage.getItem('wealthline.local.data')).bankTransactionAccounts[0].label,'Other tab');assert.ok(button('儲存變更'));assert.deepEqual(appHook.data.accounts,data.accounts)})

test('no-transaction evidence remains empty and manual supplementation has no fabricated date or provenance',async()=>{pdf.reset([parsed([])]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();assert.match(document.body.textContent,/已證明無交易/);assert.equal(document.querySelector('.bank-preview-row'),null);assert.equal(latest().bankTransactions.length,0);await click('補登一筆交易');await input('區段 1 帳戶','ledger');assert.equal(document.querySelector('[aria-label="區段 1 交易 1 日期"]').value,'');await input('區段 1 交易 1 日期','2026-01-12');await input('區段 1 交易 1 摘要','Manual zero');await input('區段 1 交易 1 方向','credit');await click('確認匯入');assert.equal(latest().bankTransactions[0].amount,0);assert.equal(latest().bankTransactions[0].sourceKey,undefined);assert.equal(latest().bankTransactions[0].classification,undefined)})
test('bad PDF magic never reaches reader; fully unsupported file can be supplemented manually',async()=>{pdf.reset([]);const latest=await render();await click('匯入銀行帳單');const el=document.querySelector('[aria-label="銀行帳單 PDF"]');Object.defineProperty(el,'files',{value:[{size:5,arrayBuffer:async()=>new TextEncoder().encode('BAD!!').buffer}]});await act(()=>el.dispatchEvent(new Event('change',{bubbles:true})));await submitImport();assert.equal(pdf.calls.length,0);assert.match(document.querySelector('[aria-label="銀行解析結果"]').textContent,/無法解析/);await click('手動補登其他帳戶');await input('區段 1 帳戶','new');await input('區段 1 新標籤','Manual ledger');await input('區段 1 交易 1 日期','2026-01-12');await input('區段 1 交易 1 摘要','Example salary');await input('區段 1 交易 1 金額','-1');await click('確認匯入');assert.equal(latest().bankTransactionAccounts.length,0);assert.match(document.querySelector('[role="alert"]').textContent,/檢查/);await input('區段 1 交易 1 金額','12');await click('確認匯入');assert.equal(latest().bankTransactionAccounts.length,1);assert.equal(latest().bankTransactions[0].amount,12)})
test('same-bank same-currency sections require separate explicit mappings and retain both counterparts',async()=>{pdf.reset([{...parsed(),recognizedCount:2,sections:[parsed().sections[0],{...parsed().sections[0],key:'section-2',rows:[{...draft,sectionKey:'section-2',direction:'credit'}]}]}]);const latest=await render();await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','new');await input('區段 1 新標籤','First');await input('銀行預覽區段','1');await input('區段 2 帳戶','new');await input('區段 2 新標籤','Second');await click('確認匯入');assert.equal(latest().bankTransactionAccounts.length,2);assert.equal(new Set(latest().bankTransactions.map(r=>r.accountId)).size,2);assert.deepEqual(latest().bankTransactions.map(r=>r.direction),['debit','credit']);assert.equal(latest().bankTransactions.every(r=>r.classification===undefined),true)})
test('preview edits retain original content identity and full-section occurrence order before unchecking',async()=>{pdf.reset([parsed([draft,{...draft,rowKey:'row-2'}])]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');await input('區段 1 交易 2 金額','42');await act(()=>document.querySelector('[aria-label="區段 1 選取 1"]').click());await click('確認匯入');const core=await server.ssrLoadModule('/src/bankTransactions.ts'),expense=await server.ssrLoadModule('/src/expenses.ts');const hash=await expense.sha256(new TextEncoder().encode('%PDF-synthetic0'));const original=await core.prepareBankTransactions([draft,draft],'ledger',hash,[{page:1,sectionKey:'section-1',rowKey:'row-1'},{page:1,sectionKey:'section-1',rowKey:'row-2'}]);assert.equal(latest().bankTransactions.length,1);assert.equal(latest().bankTransactions[0].amount,42);assert.equal(latest().bankTransactions[0].importKey,original[1].importKey);assert.equal(latest().bankTransactions[0].sourceKey,original[1].sourceKey)})

test('shared scoped vault candidates plus manual fallback without retaining password in ledger or preview',async()=>{globalThis.indexedDB=statementKeyStore();const vault=await server.ssrLoadModule('/src/statementPasswords.ts');const encrypted=await vault.saveStatementPassword('test-scope','Arbitrary label','synthetic-vault-secret');pdf.reset([parsed()]);const latest=await render({...empty,statementPasswords:[encrypted]},false,'test-scope');await click('匯入銀行帳單');await files();await input('銀行 PDF 密碼','synthetic-manual-secret');await submitImport();await settle(()=>!!document.querySelector('[aria-label="銀行解析結果"]'));assert.deepEqual(pdf.calls[0].password,['synthetic-vault-secret','synthetic-manual-secret']);assert.equal(document.querySelector('[aria-label="銀行 PDF 密碼"]').value,'');assert.equal(document.body.textContent.includes('synthetic-vault-secret'),false);assert.equal(JSON.stringify(latest()).includes('synthetic-manual-secret'),false);await click('取消匯入');pdf.reset([parsed()]);delete globalThis.indexedDB;await click('匯入銀行帳單');await files();await input('銀行 PDF 密碼','fallback');await submitImport();await settle(()=>!!document.querySelector('[aria-label="銀行解析結果"]'));assert.match(document.body.textContent,/無法在此瀏覽器解鎖/);assert.deepEqual(pdf.calls[0].password,['fallback'])})

// Rereview P2-A / P2-B / P3-D. Synthetic drafts only.
const section=n=>document.querySelector(`[aria-label="帳戶區段 ${n}"]`)
const box=label=>document.querySelector(`[aria-label="${label}"]`)
const flagged=()=>[{...draft,ambiguousNarration:{leading:[],trailing:['Second payment line']}},{...draft,rowKey:'row-2',description:'',amount:7,ambiguousNarration:{leading:['Second payment line'],trailing:[]}}]
test('equal warning codes aggregate into one actionable Chinese line and a non-partial section still gets a review badge',async()=>{
 const w=code=>({code,count:1,page:1}),r=parsed();r.status='partial';r.rejectedCount=6;r.warnings=[w('unanchored-transaction'),w('unanchored-transaction')];r.sections[0].warnings=[w('ambiguous-trailing-narration'),w('ambiguous-trailing-narration'),w('activity-below-table-boundary'),w('synthetic-future-code')]
 pdf.reset([r]);await render();await click('匯入銀行帳單');await files();await submitImport();
 const text=section(1).textContent,count=(value,part)=>value.split(part).length-1
 assert.equal(count(text,'ambiguous-trailing-narration'),1);assert.match(text,/摘要可能不完整.*2 個事件/);assert.match(text,/逐筆核對/);assert.match(text,/未匯入.*金額/);assert.match(text,/synthetic-future-code/);assert.match(text,/不是漏列筆數/);
 assert.ok(box('區段 1 解析警告'));assert.equal(count(box('銀行解析結果').textContent,'unanchored-transaction'),1);assert.match(box('銀行解析結果').textContent,/2 個事件/)
 const ui=await server.ssrLoadModule('/src/views/bankUiHelpers.ts');for(const code of ['ambiguous-trailing-narration','invalid-description','activity-below-table-boundary','ambiguous-transaction'])assert.match(ui.bankWarningText(code),/[\u3400-\u9fff]{6}/,code);assert.match(ui.bankWarningText('synthetic-future-code'),/synthetic-future-code/)
 pdf.reset([parsed()]);globalThis.confirm=()=>true;await files();await submitImport();await settle(()=>!box('區段 1 解析警告'));assert.equal(box('區段 1 解析警告'),null)
})
test('one import selection accepts the current summary; empty selected summaries block and candidates stay optional',async()=>{
 pdf.reset([parsed(flagged()),parsed(flagged())]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');
 const rows=()=>[...document.querySelectorAll('.bank-preview-row')];assert.equal(rows().length,2);for(const r of rows()){assert.equal(r.querySelectorAll('input[type="checkbox"]').length,1);assert.match(r.textContent,/補充敘述/);assert.match(r.textContent,/Second payment line/)}
 assert.equal(box('區段 1 交易 2 摘要').value,'');assert.equal(box('區段 1 交易 1 摘要').value,'帳號 [帳號已遮蔽] Example transfer');
 const blocked=async()=>{await click('確認匯入');assert.match(document.querySelector('[role="alert"]').textContent,/請填寫已選交易的摘要/);assert.ok(!box('銀行重複核對'));assert.equal(latest().bankTransactions.length,0)}
 await blocked();
 // Unchecked empty summaries do not block the selected row's current summary.
 await act(()=>box('區段 1 選取 2').click());await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 1 筆/,'narration to check keeps the review open');assert.equal(latest().bankTransactions.length,0);
 // Optional candidates are assigned only by the user; selection/editing invalidates the prepared review.
 await act(()=>box('區段 1 選取 2').click());assert.ok(!box('銀行重複核對'));await blocked();await act(()=>box('區段 1 交易 2 加入候選 1').click());assert.equal(box('區段 1 交易 2 摘要').value,'Second payment line');assert.equal(box('區段 1 交易 1 摘要').value,'帳號 [帳號已遮蔽] Example transfer');
 await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 2 筆/);await typeText('區段 1 交易 2 摘要','Second payment');assert.ok(!box('銀行重複核對'));assert.equal(latest().bankTransactions.length,0);
 await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 2 筆/);await click('確認銀行匯入');
 assert.deepEqual(latest().bankTransactions.map(r=>r.description),['帳號 [帳號已遮蔽] Example transfer','Second payment']);assert.equal(latest().bankTransactions.every(r=>r.classification===undefined),true);assert.equal(JSON.stringify(latest()).includes('Narration'),false);assert.deepEqual(Object.keys(latest().bankTransactions[1]).sort(),['accountId','amount','currency','date','description','direction','id','importKey','sourceKey']);assert.equal(latest().version,13)
 // Reimporting the same file with a different summary still skips both original document positions.
 await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');await typeText('區段 1 交易 2 摘要','Other wording');await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 0 筆 · 略過 2 筆 · 疑似重複 0/);assert.equal(latest().bankTransactions.length,2)
})
test('manual A/C account context is raw while typing and masked at commit',async()=>{const latest=await render();await typeText('帳戶標籤','A/C 123456789');await typeText('銀行名稱','Synthetic');await click('新增流水帳戶');assert.equal(latest().bankTransactionAccounts[0].label,'A/C [帳號已遮蔽]');assert.equal(JSON.stringify(latest()).includes('123456789'),false)})

// Failures use fixed messages and do not discard other files from the batch.
test('bank import reports safe, actionable file failures and preserves successful previews',async()=>{
 const errors=await server.ssrLoadModule('/src/bankStatementErrors.ts');
 pdf.reset([new Error(errors.BANK_PDF_ERRORS.passwordRequired),new Error(errors.BANK_PDF_ERRORS.passwordIncorrect),new Error('SECRET RAW CUSTOMER password'),parsed()]);
 const latest=await render();await click('匯入銀行帳單');await files(4);await submitImport();
 const report=document.querySelector('[aria-label="銀行解析結果"]').textContent;
 assert.ok(report.includes(errors.BANK_PDF_ERRORS.passwordRequired));assert.ok(report.includes(errors.BANK_PDF_ERRORS.passwordIncorrect));assert.ok(report.includes(errors.BANK_PDF_ERRORS.open));assert.ok(!report.includes('SECRET'));assert.match(report,/synthetic-3\.pdf.*已辨識 1 筆/);
 assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.equal(latest().bankTransactions.length,0);
})
test('bank import rejects size and non-PDF files with distinct messages before opening reader',async()=>{
 pdf.reset([]);await render();await click('匯入銀行帳單');
 const el=document.querySelector('[aria-label="銀行帳單 PDF"]');
 Object.defineProperty(el,'files',{value:[{size:20*1024*1024+1,arrayBuffer:async()=>{throw new Error('must not read')}},{size:5,arrayBuffer:async()=>new TextEncoder().encode('BAD!!').buffer}]});
 await act(()=>el.dispatchEvent(new Event('change',{bubbles:true})));await submitImport();
 const report=document.querySelector('[aria-label="銀行解析結果"]').textContent;
 assert.match(report,/20MB/);assert.match(report,/檔案不是 PDF/);assert.equal(pdf.calls.length,0);
})

test('bank import accepts a PDF header after leading bytes and names a misnamed HTML file',async()=>{
 pdf.reset([parsed([draft],true)]);await render();await click('匯入銀行帳單');
 const el=document.querySelector('[aria-label="銀行帳單 PDF"]');
 Object.defineProperty(el,'files',{value:[{name:'玉山 2026-09.pdf',size:20,arrayBuffer:async()=>new TextEncoder().encode('\uFEFF\r\n%PDF-1.4 bom').buffer},{size:30,arrayBuffer:async()=>new TextEncoder().encode('<!DOCTYPE html><html>x</html>').buffer}]});
 await act(()=>el.dispatchEvent(new Event('change',{bubbles:true})));await submitImport();
 const report=document.querySelector('[aria-label="銀行解析結果"]').textContent;
 assert.equal(pdf.calls.length,1);assert.match(report,/玉山 2026-09\.pdf · Synthetic bank · 已辨識 1 筆 · 僅部分明細/);assert.doesNotMatch(report,/檔案 1/);assert.doesNotMatch(report,/需核對|解析問題事件/);
 assert.match(report,/檔案 2 · 無法解析：檔案不是 PDF：內容是網頁.*BANK-FORMAT-HTML/);
})

test('bank PDF diagnostic messages reject raw errors even with a known prefix',async()=>{
 const {BANK_PDF_ERRORS,bankStatementErrorMessage}=await server.ssrLoadModule('/src/bankStatementErrors.ts');
 for(const value of Object.values(BANK_PDF_ERRORS))assert.equal(bankStatementErrorMessage(new Error(value)),value);
 for(const error of [new Error(BANK_PDF_ERRORS.textLimit+' SECRET CUSTOMER'),new Error('密碼 SECRET'),{message:BANK_PDF_ERRORS.passwordRequired},'SECRET',null])assert.equal(bankStatementErrorMessage(error),BANK_PDF_ERRORS.unreadable);
})


test('unreadable selected file reports file stage, keeps later files and never echoes raw errors',async()=>{
 pdf.reset([parsed()]);const latest=await render();await click('匯入銀行帳單');await files(2);
 const el=document.querySelector('[aria-label="銀行帳單 PDF"]');el.files[0].arrayBuffer=async()=>{throw new Error('SECRET FILE PROVIDER')};
 await submitImport();const report=document.querySelector('[aria-label="銀行解析結果"]').textContent;
 assert.match(report,/BANK-FILE/);assert.ok(!report.includes('SECRET'));assert.match(report,/synthetic-1\.pdf.*已辨識 1 筆/);assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.equal(latest().bankTransactions.length,0);
})
test('fingerprint failure is distinct from PDF opening and leaves ledger untouched',async()=>{
 pdf.reset([parsed()]);const latest=await render();await click('匯入銀行帳單');await files();const original=Object.getOwnPropertyDescriptor(crypto.subtle,'digest');Object.defineProperty(crypto.subtle,'digest',{configurable:true,value:async()=>{throw new Error('SECRET CRYPTO FAILURE')}});
 try{await submitImport();const report=document.querySelector('[aria-label="銀行解析結果"]').textContent;assert.match(report,/BANK-HASH/);assert.ok(!report.includes('SECRET'));assert.ok(!document.querySelector('.bank-preview-row'));assert.equal(latest().bankTransactions.length,0)}finally{if(original)Object.defineProperty(crypto.subtle,'digest',original);else delete crypto.subtle.digest}
})
test('transaction parser failure reports parsing stage without raw PDF text',async()=>{
 pdf.reset([{parseError:new Error('SECRET PARSER TEXT')}]);const latest=await render();await click('匯入銀行帳單');await files();await submitImport();const report=document.querySelector('[aria-label="銀行解析結果"]').textContent;assert.match(report,/BANK-PARSE/);assert.ok(!report.includes('SECRET'));assert.ok(!document.querySelector('.bank-preview-row'));assert.equal(latest().bankTransactions.length,0);
})
test('preview construction failure rolls back all sections and success reports of that file',async()=>{
 const first=parsed(),second={...first.sections[0],key:'section-2'};
 // Fail when preparing the second section, independently of UUID allocation order.
 Object.defineProperty(second,'rows',{get(){throw new Error('SECRET PREVIEW FAILURE')}});
 pdf.reset([{...first,recognizedCount:2,sections:[first.sections[0],second]},parsed()]);const latest=await render();await click('匯入銀行帳單');await files(2);
 await submitImport();const reports=[...document.querySelectorAll('[aria-label="銀行解析結果"] li')].map(n=>n.textContent);assert.ok(reports.some(r=>r.includes('synthetic-0.pdf')&&r.includes('BANK-PREVIEW')));assert.ok(!reports.some(r=>r.includes('synthetic-0.pdf')&&r.includes('已辨識')));assert.ok(!reports.join('').includes('SECRET'));assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.equal(latest().bankTransactions.length,0);
})

test('PDF opening distinguishes worker, runtime and document failures using only fixed diagnostics',async()=>{
 const {bankStatementErrorMessage}=await server.ssrLoadModule('/src/bankStatementErrors.ts');
 for(const [error,code] of [[new Error('Setting up fake worker failed: SECRET https://private.test/path'),'BANK-OPEN-WORKER'],[new TypeError('SECRET runtime variable'),'BANK-OPEN-RUNTIME'],[new ReferenceError('SECRET missing variable'),'BANK-OPEN-RUNTIME'],[Object.assign(new Error('SECRET document bytes'),{name:'InvalidPDFException'}),'BANK-OPEN-DOCUMENT']]){
  const message=bankStatementErrorMessage(error,'open');assert.ok(message.includes(code));assert.ok(!message.includes('SECRET'));assert.ok(!message.includes('private.test'));assert.ok(!message.includes('variable'));
 }
})


test('wrapped PDF worker failures keep the processing stage and never expose message or details',async()=>{
 const {bankStatementErrorMessage}=await server.ssrLoadModule('/src/bankStatementErrors.ts');
 for(const details of ['TypeError: SECRET API','ReferenceError: SECRET VARIABLE','FormatError: SECRET DOCUMENT']){
  const error=Object.assign(new Error('SECRET https://private.test/document'),{name:'UnknownErrorException',details});
  for(const [stage,code] of [['open','BANK-OPEN-INTERNAL'],['page','BANK-PAGE-INTERNAL'],['text','BANK-TEXT-INTERNAL']]){
   const message=bankStatementErrorMessage(error,stage);assert.ok(message.includes(code));assert.match(message,/解析程式或檔案格式/);assert.ok(!message.includes('SECRET'));assert.ok(!message.includes('private.test'));assert.ok(!message.includes(details));
  }
  assert.ok(bankStatementErrorMessage(error,'cleanup').includes('BANK-CLEANUP'));
 }
})
test('wrapped worker failure reaches the import report safely and later files still preview',async()=>{
 pdf.reset([Object.assign(new Error('SECRET CUSTOMER'),{name:'UnknownErrorException',details:'TypeError: SECRET PDF URL'}),parsed()]);
 const latest=await render();await click('匯入銀行帳單');await files(2);await submitImport();
 const report=document.querySelector('[aria-label="銀行解析結果"]').textContent;
 assert.match(report,/BANK-OPEN-INTERNAL/);assert.match(report,/解析程式或檔案格式/);assert.ok(!report.includes('SECRET'));assert.match(report,/synthetic-1\.pdf.*已辨識 1 筆/);assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.equal(latest().bankTransactions.length,0);
})


test('PDF diagnostics never throw when an Error has a non-string message or inaccessible fields',async()=>{
 const {bankStatementErrorMessage}=await server.ssrLoadModule('/src/bankStatementErrors.ts');
 for(const message of [undefined,null,42,{},Object('SECRET RESOURCE')]){
  const error=Object.assign(new Error(),{message});const diagnostic=bankStatementErrorMessage(error,'open');assert.match(diagnostic,/BANK-OPEN/);assert.ok(!diagnostic.includes('SECRET'));
 }
 for(const field of ['message','name']){
  const error=new Error('SECRET RESOURCE');Object.defineProperty(error,field,{get(){throw new Error('SECRET FIELD ACCESS')}});
  const diagnostic=bankStatementErrorMessage(error,'open');assert.match(diagnostic,/BANK-OPEN/);assert.ok(!diagnostic.includes('SECRET'));
 }
})
test('malformed reader error stays a file failure instead of becoming a vault failure',async()=>{
 const readerError=Object.assign(new Error(),{message:undefined,name:'AbortException'});pdf.reset([readerError,parsed()]);
 const latest=await render();await click('匯入銀行帳單');await files(2);await submitImport();
 assert.ok(!document.querySelector('[role="alert"]'),document.querySelector('[role="alert"]')?.textContent);
 const report=document.querySelector('[aria-label="銀行解析結果"]')?.textContent??'';
 assert.match(report,/synthetic-0\.pdf.*BANK-OPEN/);assert.match(report,/synthetic-1\.pdf.*已辨識 1 筆/);assert.ok(!document.querySelector('[role="alert"]'));assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.equal(latest().bankTransactions.length,0);
})


for(const manual of ['', 'synthetic-manual-fallback'])test(`unexpected vault rejection still allows ${manual?'manual password':'unencrypted PDF'} import`,async()=>{
 // Fail at the vault boundary before its normal per-key recovery, without test hooks in production.
 const passwords=new Proxy([],{get(target,key,receiver){if(key==='length')throw new Error('SECRET VAULT REJECTION');return Reflect.get(target,key,receiver)}});
 pdf.reset([parsed()]);const latest=await render({...empty,statementPasswords:passwords});await click('匯入銀行帳單');await files();if(manual)await input('銀行 PDF 密碼',manual);await submitImport();
 assert.ok(!document.querySelector('[role="alert"]'),document.querySelector('[role="alert"]')?.textContent);
 const report=document.querySelector('[aria-label="銀行解析結果"]')?.textContent??'';assert.match(report,/BANK-PASSWORDS/);assert.ok(!report.includes('SECRET'));assert.match(report,/已辨識 1 筆/);assert.deepEqual(pdf.calls[0].password,manual?[manual]:[]);assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.equal(document.querySelector('[aria-label="銀行 PDF 密碼"]').value,'');assert.equal(latest().bankTransactions.length,0);
})

// Compact previews keep edits and a single import selection across disclosure toggles.
test('collapsed bank preview retains edited values and selection when reopened',async()=>{
 pdf.reset([parsed()]);const latest=await render();await click('匯入銀行帳單');await files();await submitImport();
 const row=document.querySelector('.bank-preview-row'),details=row.querySelector('details.bank-row-details');assert.ok(details);assert.equal(details.open,false);
 const summary=details.querySelector('summary');assert.match(row.querySelector('.bank-preview-overview').textContent,/2026-01-12/);assert.match(row.querySelector('.bank-preview-overview').textContent,/100/);
 await act(()=>summary.click());assert.equal(details.open,true);await input('區段 1 交易 1 摘要','Changed transfer');await input('區段 1 交易 1 金額','42');await act(()=>box('區段 1 選取 1').click());
 await act(()=>summary.click());assert.equal(details.open,false);assert.match(row.querySelector('.bank-preview-overview').textContent,/Changed transfer/);assert.match(row.querySelector('.bank-preview-overview').textContent,/42/);
 await act(()=>summary.click());assert.equal(details.open,true);assert.equal(box('區段 1 交易 1 摘要').value,'Changed transfer');assert.equal(box('區段 1 交易 1 金額').value,'42');assert.equal(box('區段 1 選取 1').checked,false);assert.equal(latest().bankTransactions.length,0);
})
test('collapsed narration preview imports a selected current summary without a second checkbox',async()=>{
 pdf.reset([parsed(flagged())]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');
 const row=document.querySelector('.bank-preview-row'),details=row.querySelector('details.bank-row-details');assert.ok(details);assert.equal(details.open,false);assert.equal(box('區段 1 選取 1').checked,true);assert.match(row.querySelector('.bank-preview-overview').textContent,/補充敘述/);assert.ok(!box('區段 1 交易 1 確認摘要'));assert.ok(!row.textContent.includes('摘要已核對'));
 await act(()=>box('區段 1 選取 2').click());await click('確認匯入');assert.ok(!document.querySelector('[role="alert"]'));assert.equal(details.open,false);assert.match(box('銀行重複核對').textContent,/可新增 1 筆/);assert.match(box('銀行重複核對').textContent,/目前摘要/);assert.equal(latest().bankTransactions.length,0);
 await click('確認銀行匯入');assert.equal(latest().bankTransactions.length,1);assert.equal(latest().bankTransactions[0].description,'帳號 [帳號已遮蔽] Example transfer');assert.equal(latest().bankTransactions[0].classification,undefined);
})


test('collapsed bank preview can add and edit a category rule without opening the transaction editor',async()=>{
 pdf.reset([parsed()]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');
 const row=document.querySelector('.bank-preview-row'),details=row.querySelector('.bank-row-details'),action=box('區段 1 交易 1 分類規則');assert.equal(details.open,false);assert.ok(action);assert.ok(!action.closest('details:not([open])'),'category shortcut must be available while transaction fields are collapsed');
 await act(()=>action.click());await input('規則關鍵字','Example transfer');await input('規則分類','excluded:自有帳戶轉帳');await click('取消規則');assert.equal(details.open,false);assert.equal(box('區段 1 選取 1').checked,true);assert.equal(latest().bankCategoryRules.length,0);
 await act(()=>box('區段 1 交易 1 分類規則').click());await input('規則關鍵字','Example transfer');await input('規則分類','excluded:自有帳戶轉帳');await click('儲存規則');assert.match(row.querySelector('.bank-preview-overview').textContent,/自有帳戶轉帳/);assert.equal(details.open,false);assert.equal(latest().bankCategoryRules.length,1);assert.equal(latest().bankTransactions.length,0);
 await act(()=>box('區段 1 交易 1 分類規則').click());assert.equal(box('規則關鍵字').value,'Example transfer');await input('規則分類','expense:購物');await click('儲存規則');assert.equal(latest().bankCategoryRules.length,1);assert.match(row.querySelector('.bank-preview-overview').textContent,/購物/);assert.equal(box('區段 1 選取 1').checked,true);
 await click('確認匯入');assert.equal(latest().bankTransactions.length,1,'nothing to decide: the one click imports');
})


test('recognized DBS SG uses the bank country label without asking for a ledger mapping',async()=>{
 const r=parsed();r.bank='DBS Singapore';r.sections[0].bank='DBS Singapore';r.sections[0].currency='SGD';r.sections[0].rows[0]={...draft,currency:'SGD'};pdf.reset([r,r]);const latest=await render({...model.emptyData(),bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]});
 await click('匯入銀行帳單');await files();await submitImport();assert.ok(!box('區段 1 帳戶'));assert.match(document.querySelector('.bank-section').textContent,/DBS \(SG\)/);await click('確認匯入');assert.equal(latest().bankTransactionAccounts[0].label,'DBS (SG)');assert.equal(latest().bankTransactions.length,1);
 await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 0 筆.*略過 1 筆/);assert.equal(latest().bankTransactionAccounts.length,1);
})
test('confirmed bank import backfills the dated cash balance while keeping current holdings and other historical entries',async()=>{
 const r=parsed();r.bank='DBS Singapore';r.sections[0].bank='DBS Singapore';r.sections[0].currency='SGD';r.sections[0].rows[0]={...draft,currency:'SGD'};r.balances=[{bank:'DBS Singapore',date:'2025-09-30',currency:'SGD',quantity:888.5}];pdf.reset([r]);
 const asset={id:'asset-dbs',name:'DBS',country:'SG',kind:'bank',category:'現金與外幣活存',positions:[{id:'dbs-sgd',type:'cash',symbol:'',currency:'SGD',quantity:999,price:1}]};const other={accountId:'other',account:'Other',category:'現金與外幣活存',country:'TW',type:'cash',symbol:'',currency:'TWD',quantity:42};
 const data={...model.emptyData(),accounts:[asset],history:{changes:[],snapshots:[],quantityDays:[{date:'2025-09-30',updatedAt:'2025-10-01T00:00:00Z',entries:[other],sparse:true}]},bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]};const latest=await render(data);
 await click('匯入銀行帳單');await files();await submitImport();assert.match(document.body.textContent,/2025-09-30/);assert.match(document.body.textContent,/888.5/);await click('確認匯入');assert.deepEqual(latest().accounts,[asset]);assert.equal(latest().history.quantityDays[0].entries.find(e=>e.accountId==='asset-dbs').quantity,888.5);assert.deepEqual(latest().history.quantityDays[0].entries.find(e=>e.accountId==='other'),other);assert.equal(latest().bankStatementBalances.length,1);assert.equal(latest().version,14);
})


test('a bank import with no asset account offers to create one so today\'s total includes the closing balance',async()=>{
 const statement=()=>{const r=parsed([]);r.bank='DBS Singapore';r.sections[0].bank='DBS Singapore';r.sections[0].currency='SGD';r.sections[0].noTransactions=false;r.balances=[{bank:'DBS Singapore',date:'2025-09-30',currency:'SGD',quantity:888.5}];return r}
 for(const create of [true,false]){
  pdf.reset([statement()]);const latest=await render({...model.emptyData(),bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]});await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入')
  const offer=box('建立資產帳戶');assert.ok(offer);assert.match(offer.textContent,/DBS \(SG\).*SGD 888\.5.*2025\/09\/30/);assert.equal(box('同時建立資產帳戶').checked,true)
  if(!create)await act(()=>box('同時建立資產帳戶').click())
  await click('確認銀行匯入')
  if(create){const [asset]=latest().accounts;assert.equal(asset.id,latest().bankTransactionAccounts[0].id);assert.equal(asset.id,latest().history.quantityDays[0].entries[0].accountId);assert.deepEqual([asset.name,asset.country,asset.kind,asset.positions[0].currency,asset.positions[0].quantity],['DBS','SG','bank','SGD',888.5]);assert.match(document.body.textContent,/建立資產帳戶 1 個/)}
  else assert.equal(latest().accounts.length,0)
  await act(()=>root.unmount());root=null
 }
})

test('automatic same-bank sections share a ledger even when the first section is unchecked',async()=>{
 const r=parsed();r.bank='DBS Singapore';const first={...r.sections[0],bank:'DBS Singapore',currency:'SGD',rows:[{...draft,currency:'SGD'}]};r.sections=[first,{...first,key:'section-2',rows:[{...draft,sectionKey:'section-2',currency:'SGD',rowKey:'row-2'}]}];r.recognizedCount=2;pdf.reset([r]);const latest=await render({...model.emptyData(),bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]});await click('匯入銀行帳單');await files();await submitImport();await act(()=>box('區段 1 選取 1').click());await click('確認匯入');assert.equal(latest().bankTransactionAccounts.length,1);assert.equal(latest().bankTransactions.length,1);
})
test('a closing balance can be imported without fabricating a transaction',async()=>{
 const r=parsed([]);r.bank='DBS Singapore';r.sections[0].bank='DBS Singapore';r.sections[0].currency='SGD';r.sections[0].noTransactions=false;r.balances=[{bank:'DBS Singapore',date:'2025-09-30',currency:'SGD',quantity:0}];pdf.reset([r]);const latest=await render({...model.emptyData(),bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]});await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');assert.match(box('銀行重複核對').textContent,/期末餘額可補入 1 筆/,'an asset account to create keeps the review open');await click('確認銀行匯入');assert.equal(latest().bankTransactions.length,0);assert.equal(latest().history.quantityDays[0].entries[0].quantity,0);assert.equal(latest().bankTransactionAccounts.length,1);
})


test('PDF bank names stay visible and different asset names are confirmed before backfilling without changing identifiers',async()=>{
 for(const existing of [false,true]){
  const r=parsed();r.bank='DBS Singapore';r.sections[0].bank=r.bank;r.sections[0].currency='SGD';r.sections[0].rows[0]={...draft,currency:'SGD'};r.balances=[{bank:r.bank,date:'2025-09-30',currency:'SGD',quantity:888.5}];pdf.reset([r,r]);
  const asset={id:'asset-sg',name:'星展',country:'SG',kind:'investment',category:'現金與外幣活存',positions:[{id:'current-cash',type:'cash',currency:'SGD',symbol:'',quantity:999,price:1},{id:'current-holding',type:'holding',currency:'SGD',symbol:'D05.SI',quantity:25,price:40}]};const tw={...asset,id:'asset-tw',country:'TW',kind:'bank'};const legacy={id:'legacy-dbs',label:'My old label',bank:r.bank};const latest=await render({...model.emptyData(),accounts:[tw,asset],bankTransactionAccounts:existing?[legacy]:[],bankTransactions:[]});const label=model.accountLabel(asset);
  await click('匯入銀行帳單');await files();await submitImport();assert.ok(!box('區段 1 帳戶'));assert.equal(document.querySelector('.bank-section h3').textContent,'DBS (SG)');assert.ok(box('帳單期末餘額').textContent.includes('DBS (SG)'));assert.ok(box('帳單期末餘額').textContent.includes(label));
  await click('確認匯入');assert.equal(latest().bankTransactions.length,0);assert.equal(latest().history.quantityDays,undefined);assert.match(box('餘額帳戶對應').textContent,/DBS \(SG\).*星展 \(SG\)/);assert.ok(!box('餘額帳戶對應').textContent.includes('星展 (TW)'));await click('確認對應並匯入');const saved=latest();assert.equal(saved.bankTransactionAccounts.length,1);assert.equal(saved.bankTransactionAccounts[0].label,existing?legacy.label:'DBS (SG)');assert.ok(document.querySelector('.bank-record').textContent.includes('DBS (SG)'));if(existing)assert.equal(saved.bankTransactionAccounts[0].id,legacy.id);assert.deepEqual(saved.accounts,[tw,asset]);const entry=saved.history.quantityDays[0].entries[0];assert.equal(entry.accountId,asset.id);assert.equal(entry.account,asset.name);assert.equal(entry.country,asset.country);
  const source=saved.bankTransactions[0].sourceKey;await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 0 筆.*略過 1 筆/);assert.equal(latest().bankTransactions[0].sourceKey,source);assert.ok(!box('餘額帳戶對應'));await click('取消匯入');
 }
})


test('PDF display naming preserves legacy canonical mapping and duplicate keys across multiple ledgers',async()=>{
 const r=parsed();r.bank='DBS Singapore';r.sections[0].bank=r.bank;r.sections[0].currency='SGD';r.sections[0].rows[0]={...draft,currency:'SGD'};pdf.reset([r,r]);
 const asset={id:'asset-sg',name:'星展',country:'SG',kind:'bank',category:'現金與外幣活存',positions:[]},a={id:'canonical',label:'DBS (SG)',bank:r.bank},b={id:'legacy-other',label:'Savings',bank:r.bank};const latest=await render({...model.emptyData(),accounts:[asset],bankTransactionAccounts:[a,b],bankTransactions:[]});
 const names=[...document.querySelectorAll('.bank-account strong')].map(o=>o.textContent);assert.ok(names.includes('DBS (SG)'));assert.ok(names.includes('DBS (SG) · Savings'));
 await click('匯入銀行帳單');await files();await submitImport();assert.ok(!box('區段 1 帳戶'));await click('確認匯入');assert.deepEqual(latest().bankTransactionAccounts,[a,b]);assert.equal(latest().bankTransactions[0].accountId,a.id);const source=latest().bankTransactions[0].sourceKey;
 await click('匯入銀行帳單');await files();await submitImport();assert.ok(!box('區段 1 帳戶'));await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 0 筆.*略過 1 筆/);assert.equal(latest().bankTransactions[0].sourceKey,source);
})

test('a user can import only transactions when the PDF and asset names do not match',async()=>{
 const r=parsed();r.bank='DBS Singapore';r.sections[0].bank=r.bank;r.sections[0].currency='SGD';r.sections[0].rows[0]={...draft,currency:'SGD'};r.balances=[{bank:r.bank,date:'2025-09-30',currency:'SGD',quantity:888.5}];pdf.reset([r,r]);
 const asset={id:'asset-sg',name:'星展',country:'SG',kind:'bank',category:'現金與外幣活存',positions:[]};const data={...model.emptyData(),accounts:[asset],bankTransactionAccounts:[],bankTransactions:[]};const latest=await render(data);
 await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');assert.ok(box('餘額帳戶對應'));await click('只匯入流水');assert.equal(latest().bankTransactions.length,1);assert.equal(latest().history,data.history);assert.equal(latest().bankStatementBalances,undefined);assert.deepEqual(latest().accounts,[asset]);
 // Declining a correspondence does not consume the PDF closing-balance source.
 await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');assert.match(box('銀行重複核對').textContent,/可新增 0 筆.*略過 1 筆/);assert.ok(box('餘額帳戶對應'));await click('確認對應並匯入');assert.equal(latest().bankTransactions.length,1);assert.equal(latest().history.quantityDays[0].entries[0].accountId,asset.id);assert.equal(latest().bankStatementBalances.length,1);
})

test('asset identity changes after correspondence preview reject the entire import until reviewed again',async()=>{
 const r=parsed();r.bank='DBS Singapore';r.sections[0].bank=r.bank;r.sections[0].currency='SGD';r.sections[0].rows[0]={...draft,currency:'SGD'};r.balances=[{bank:r.bank,date:'2025-09-30',currency:'SGD',quantity:888.5}];pdf.reset([r]);
 const asset={id:'asset-sg',name:'星展',country:'SG',kind:'bank',category:'現金與外幣活存',positions:[]};let current={...model.emptyData(),accounts:[asset],bankTransactionAccounts:[],bankTransactions:[]};const props=()=>({data:current,busy:false,onChange:next=>{current=next;root.render(createElement(Page,props()))}});root=createRoot(document.getElementById('root'));await act(()=>root.render(createElement(Page,props())));
 await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');assert.ok(box('餘額帳戶對應'));await act(()=>{current={...current,accounts:[{...asset,name:'DBS'}]};root.render(createElement(Page,props()))});const changed=current;
 await click('確認對應並匯入');assert.equal(current,changed);assert.equal(current.bankTransactions.length,0);assert.equal(current.bankTransactionAccounts.length,0);assert.equal(current.bankStatementBalances,undefined);assert.ok(document.querySelector('[role="alert"]'));
 await click('確認匯入');assert.equal(current.bankTransactions.length,1);assert.equal(current.history.quantityDays[0].entries[0].accountId,asset.id);assert.equal(current.history.quantityDays[0].entries[0].account,'DBS');
})

test('ledger pagination bounds rows and keeps descending groups, editing and full filters',async()=>{
 const second={...account,id:'other',label:'Other'};
 const transactions=Array.from({length:205},(_,i)=>({...tx,id:`ledger-${i}`,accountId:i<105?'ledger':'other',date:i<105?'2026-02-01':'2026-01-01',currency:i<105?'TWD':'USD',description:`Transfer ${i}`}));
 const latest=await render({...empty,bankTransactionAccounts:[account,second],bankTransactions:transactions});
 assert.equal(document.querySelectorAll('.bank-record').length,100);assert.match(box('銀行流水分頁').textContent,/1.*3/);assert.match(document.querySelector('.bank-month-head').textContent,/2026 年 2 月.*105 筆/);assert.match(document.querySelector('.bank-record .detail-record-subtitle').textContent,/^1 日/);assert.match(document.body.textContent,/205 筆銀行流水/);
 await act(()=>box('銀行流水下一頁').click());assert.ok(box('編輯流水 ledger-100'));assert.equal(document.querySelectorAll('.bank-record').length,100);
 await act(()=>box('編輯流水 ledger-100').click());await input('流水金額','42');await click('套用修改');assert.equal(latest().bankTransactions.find(r=>r.id==='ledger-100').amount,42);assert.ok(box('編輯流水 ledger-100'));
 await act(()=>box('銀行流水下一頁').click());assert.equal(document.querySelectorAll('.bank-record').length,5);
 await input('流水幣別篩選','USD');assert.equal(document.querySelectorAll('.bank-record').length,100);assert.equal(box('銀行流水分頁'),null);assert.match(document.querySelector('.bank-filter-summary').textContent,/100 筆符合篩選/);
 await input('流水月份篩選','2026-02');assert.equal(document.querySelectorAll('.bank-record').length,0);await input('流水幣別篩選','');assert.equal(document.querySelectorAll('.bank-record').length,100);
 await input('流水帳戶篩選','other');assert.equal(document.querySelectorAll('.bank-record').length,0);await input('流水月份篩選','');assert.equal(document.querySelectorAll('.bank-record').length,100);
})
test('ledger lists rows by month with day, account and category, and filters to unclassified rows',async()=>{
 await render({...empty,bankTransactionAccounts:[account],bankTransactions:[{...tx,id:'pending',date:'2026-03-05'},{...tx,id:'salary',date:'2026-02-10',direction:'credit',amount:50,classification:{kind:'income',category:'薪資'}},{...tx,id:'fee',date:'2026-02-03'}]});
 assert.deepEqual([...document.querySelectorAll('.bank-month-head h4')].map(h=>h.textContent),['2026 年 3 月','2026 年 2 月']);assert.match(document.querySelectorAll('.bank-month-head')[1].textContent,/2 筆.*TWD.*\+50.*−100/);
 assert.deepEqual([...document.querySelectorAll('.bank-record .detail-record-subtitle')].map(e=>e.textContent),['5 日Synthetic ledger未分類','10 日Synthetic ledger薪資','3 日Synthetic ledger未分類']);
 await click('其中 2 筆未分類，只看這些');assert.equal(box('流水分類篩選').value,'pending');assert.deepEqual([...document.querySelectorAll('.bank-record')].map(r=>r.querySelector('[aria-label^="編輯流水"]').getAttribute('aria-label')),['編輯流水 pending','編輯流水 fee']);
 await input('流水分類篩選','classified');assert.equal(document.querySelectorAll('.bank-record').length,1);await click('清除篩選');assert.equal(document.querySelectorAll('.bank-record').length,3);assert.equal(button('清除篩選'),undefined);
})
test('narrow-screen row buttons are revealed by focus and a tap on the row hides them without opening it',async()=>{
 await render({...empty,bankTransactionAccounts:[account],bankTransactions:[tx,{...tx,id:'second'}]});const rows=()=>[...document.querySelectorAll('.bank-record')];
 assert.ok(rows().every(r=>r.hasAttribute('data-swipe')&&!r.hasAttribute('data-revealed')));
 await act(()=>box('編輯流水 row').focus());assert.ok(rows()[0].hasAttribute('data-revealed'));assert.ok(!rows()[1].hasAttribute('data-revealed'));
 await act(()=>box('編輯流水 second').focus());assert.ok(!rows()[0].hasAttribute('data-revealed'));assert.ok(rows()[1].hasAttribute('data-revealed'));
 await act(()=>rows()[1].querySelector('summary').click());assert.ok(!rows()[1].hasAttribute('data-revealed'));assert.ok(!rows()[1].querySelector('details').open);
 await act(()=>rows()[1].querySelector('summary').click());assert.ok(rows()[1].querySelector('details').open);
})
test('a touch drag slides the row with the finger and settles open past half the button width',async()=>{
 await render({...empty,bankTransactionAccounts:[account],bankTransactions:[tx]});const row=()=>document.querySelector('.bank-record'),summary=()=>row().querySelector('summary');
 const touch=(type,x,y=10)=>{const e=new window.MouseEvent(type,{bubbles:true,clientX:x,clientY:y});Object.defineProperty(e,'pointerType',{value:'touch'});summary().dispatchEvent(e)};
 const drag=async(...xs)=>act(()=>{touch('pointerdown',xs[0]);for(const x of xs.slice(1))touch('pointermove',x);touch('pointerup',xs.at(-1));summary().click()});
 await act(()=>{touch('pointerdown',300);touch('pointermove',260)});assert.ok(row().hasAttribute('data-dragging'));assert.equal(row().style.getPropertyValue('--swipe'),'-40px');await act(()=>touch('pointerup',260));
 assert.ok(!row().hasAttribute('data-revealed'));assert.equal(row().style.getPropertyValue('--swipe'),'');
 await drag(300,280,260,250);assert.ok(!row().hasAttribute('data-revealed'));assert.ok(!row().querySelector('details').open);
 await drag(300,250,200);assert.ok(row().hasAttribute('data-revealed'));assert.ok(!row().querySelector('details').open);
 await drag(200,250,300);assert.ok(!row().hasAttribute('data-revealed'));
 await act(()=>{touch('pointerdown',300);touch('pointermove',302,60)});assert.ok(!row().hasAttribute('data-dragging'));
})
test('deleting the final ledger page clamps back to an available page',async()=>{
 const latest=await render({...empty,bankTransactionAccounts:[account],bankTransactions:Array.from({length:101},(_,i)=>({...tx,id:`clamp-${i}`}))});assert.equal(document.querySelectorAll('.bank-record').length,100);await act(()=>box('銀行流水下一頁').click());assert.equal(document.querySelectorAll('.bank-record').length,1);await act(()=>box('編輯流水 clamp-100').click());globalThis.confirm=()=>true;await click('移除流水');assert.equal(latest().bankTransactions.length,100);assert.equal(document.querySelectorAll('.bank-record').length,100);assert.equal(box('銀行流水分頁'),null);
})
test('preview pages and sections retain drafts, mappings and selections and import hidden rows',async()=>{
 const rows=Array.from({length:120},(_,i)=>({...draft,rowKey:`row-${i}`,description:`Transfer ${i}`,amount:i+1}));const r=parsed(rows);r.sections.push({...parsed().sections[0],key:'section-2',rows:[{...draft,sectionKey:'section-2',description:'Other section',amount:900}]});r.recognizedCount=121;pdf.reset([r]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();
 assert.equal(document.querySelectorAll('.bank-preview-row').length,50);assert.equal(document.querySelectorAll('.bank-section').length,1);assert.match(box('銀行預覽總計').textContent,/121.*121/);await input('區段 1 帳戶','ledger');await input('區段 1 交易 1 金額','42');
 await act(()=>box('銀行預覽下一頁').click());await act(()=>box('區段 1 選取 51').click());await act(()=>box('銀行預覽下一頁').click());await input('區段 1 交易 120 摘要','');await input('區段 1 交易 120 金額','7');
 await input('銀行預覽區段','1');assert.equal(document.querySelectorAll('.bank-preview-row').length,1);await input('區段 2 帳戶','ledger');await click('確認匯入');assert.match(document.querySelector('[role="alert"]').textContent,/已選交易的摘要/);assert.equal(latest().bankTransactions.length,0);
 await input('銀行預覽區段','0');assert.equal(box('區段 1 交易 1 金額').value,'42');assert.equal(box('區段 1 帳戶').value,'ledger');await act(()=>box('銀行預覽下一頁').click());assert.equal(box('區段 1 選取 51').checked,false);await act(()=>box('銀行預覽下一頁').click());assert.equal(box('區段 1 交易 120 金額').value,'7');await input('區段 1 交易 120 摘要','Hidden row fixed');
 await input('銀行預覽區段','1');assert.equal(box('區段 2 帳戶').value,'ledger');await click('確認匯入');assert.equal(latest().bankTransactions.length,120);assert.equal(latest().bankTransactions.find(row=>row.description==='Hidden row fixed').amount,7);assert.equal(latest().bankTransactions.find(row=>row.description==='Transfer 0').amount,42);assert.ok(!latest().bankTransactions.some(row=>row.description==='Transfer 50'));
})
test('manual additions open the relevant last preview page and new section',async()=>{
 pdf.reset([parsed(Array.from({length:50},(_,i)=>({...draft,rowKey:`row-${i}`})))]);await render();await click('匯入銀行帳單');await files();await submitImport();await click('補登一筆交易');assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.ok(box('區段 1 交易 51 摘要'));await input('區段 1 交易 51 摘要','Manual last page');await click('手動補登其他帳戶');assert.ok(box('區段 2 交易 1 摘要'));await input('銀行預覽區段','0');await act(()=>box('銀行預覽下一頁').click());assert.equal(box('區段 1 交易 51 摘要').value,'Manual last page');
})
test('95-file orchestration paints file and page progress, counts failures, then completes pending review',async()=>{
 pdf.reset([new Error('synthetic failure'),...Array.from({length:94},()=>parsed())]);pdf.pause(1);const latest=await render();await click('匯入銀行帳單');await files(95);await submitImport();await settle(()=>pdf.calls.length===2);
 const progress=()=>box('銀行解析進度');assert.ok(progress());assert.equal(progress().querySelector('progress').value,1);assert.equal(progress().querySelector('progress').max,95);assert.match(progress().textContent,/1.*95/);assert.match(progress().textContent,/1%/);assert.match(progress().textContent,/失敗 1/);assert.match(progress().textContent,/synthetic-1.pdf/);
 await act(()=>pdf.progress(1,2,3));assert.match(progress().textContent,/2.*3.*頁/);assert.equal(progress().querySelector('progress').value,1);await act(()=>pdf.progress(0,99,100));assert.match(progress().textContent,/2.*3.*頁/);assert.doesNotMatch(progress().textContent,/99.*100.*頁/);await act(()=>pdf.release());await settle(()=>!!button('解析銀行帳單'));assert.equal(progress().querySelector('progress').value,95);assert.match(progress().textContent,/100%/);assert.match(progress().textContent,/成功 94.*失敗 1/);assert.match(progress().textContent,/還沒匯入/);assert.equal(document.querySelectorAll('.bank-preview-row').length,1);assert.equal(latest().bankTransactions.length,0);
 await click('確認匯入');assert.match(progress().textContent,/還沒匯入/);
})
test('cancelled parsing discards late page callbacks and cannot mutate a later preview',async()=>{
 pdf.reset([parsed()]);pdf.pause();const latest=await render();await click('匯入銀行帳單');await files();await submitImport();assert.ok(box('銀行解析進度'));const old=pdf.calls[0];await click('取消匯入');await click('匯入銀行帳單');await act(()=>{old.onPageProgress?.({completed:99,total:100});pdf.release()});assert.equal(box('銀行解析進度'),null);assert.equal(document.querySelector('.bank-preview-row'),null);assert.equal(latest().bankTransactions.length,0);
})
test('unsupported-only processing completes without claiming rows are ready for import',async()=>{
 pdf.reset([{status:'unsupported',sections:[],warnings:[],recognizedCount:0,rejectedCount:0}]);const latest=await render();await click('匯入銀行帳單');await files();await submitImport();const progress=box('銀行解析進度');assert.match(progress.textContent,/100%/);assert.match(progress.textContent,/成功 0.*失敗 1/);assert.match(progress.textContent,/沒有可匯入的預覽/);assert.ok(!button('確認匯入'));assert.equal(latest().bankTransactions.length,0);assert.match(box('銀行解析結果').textContent,/不支援／未辨識/);
})
test('duplicate review preparation shows its own busy state while parsing stays complete',async()=>{
 pdf.reset([parsed()]);const latest=await render({...empty,bankTransactionAccounts:[account]});await click('匯入銀行帳單');await files();await submitImport();await input('區段 1 帳戶','ledger');const digest=crypto.subtle.digest;let release;
 try{crypto.subtle.digest=(...args)=>new Promise(resolve=>{release=()=>{crypto.subtle.digest=digest;resolve(digest.apply(crypto.subtle,args))}});await act(()=>button('確認匯入').click());await settle(()=>!!release);assert.match(document.body.textContent,/正在準備重複交易與餘額核對/);assert.match(box('銀行解析進度').textContent,/處理完成.*100%/);assert.ok(button('確認匯入').disabled);assert.ok(button('解析銀行帳單'));assert.equal(latest().bankTransactions.length,0);await act(()=>release());await settle(()=>latest().bankTransactions.length===1)}finally{crypto.subtle.digest=digest}
})
test('Drive ledger displays before archived history is requested; import blocks on failure and retry',async()=>{
 const profile={sub:'bank-archive-test',name:'Synthetic',email:'synthetic@example.test'},token={value:'test',expiresAt:Date.now()+3600000};auth.storeSession({profile,token});const fake=createFakeDrive();globalThis.fetch=fake.fetch;
 const store=await server.ssrLoadModule('/src/google/driveStore.ts');const snapshot={date:'2025-09-30',at:'2025-09-30T00:00:00.000Z',total:100,accounts:[],categories:{}};await store.saveDrive(token,{...appData(),history:{changes:[],liabilityChanges:[],snapshots:[snapshot]}},store.emptyDriveState());
 const before=fake.log.length;let archiveReads=0,resolveArchive;globalThis.fetch=async(url,init={})=>{if(String(url).includes('userinfo'))return Response.json(profile);const request=new URL(String(url)),id=request.pathname.split('/').at(-1),file=fake.files.get(id);if(request.searchParams.get('alt')==='media'&&file?.appProperties.part?.startsWith('history-')){archiveReads++;if(archiveReads===1)return new Response('',{status:503});return new Promise(resolve=>{resolveArchive=()=>resolve(fake.fetch(url,init))})}return fake.fetch(url,init)};
 window.history.replaceState(null,'','/bank-transactions');await renderApp();assert.equal(document.querySelectorAll('.bank-record').length,1);assert.equal(archiveReads,0);assert.ok(fake.log.slice(before).some(r=>r.url.includes('alt=media')));
 await openBankImport();await settle(()=>!!document.querySelector('[role="alert"]'));assert.match(document.querySelector('[role="alert"]').textContent,/往年歷史/);assert.equal(document.querySelector('.bank-import form'),null);assert.ok(button('取消匯入'));await click('重試');await settle(()=>archiveReads===2);assert.equal(document.querySelector('.bank-import form'),null);await act(()=>resolveArchive());await settle(()=>!!document.querySelector('.bank-import form'));assert.equal(appHook.data.history.snapshots.some(s=>s.date==='2025-09-30'),true);await click('取消匯入');assert.equal(document.querySelectorAll('.bank-record').length,1);
})
test('the bank page button opens the shared import entry, and cancelling returns to the bank page',async()=>{
 window.history.replaceState(null,'','/bank-transactions');drive(appData());await renderApp();await click('匯入銀行帳單');assert.equal(window.location.pathname,'/cashflow/import')
 assert.ok(document.querySelector('.statement-entry form'));assert.equal(document.querySelector('[aria-label="帳單類型"]'),null,'the entry detects the kind; there is no kind switch')
 await click('取消匯入');assert.equal(window.location.pathname,'/bank-transactions');assert.ok(button('匯入銀行帳單'))
 await openBankImport();await settle(()=>!!document.querySelector('.bank-import form'));assert.equal(document.querySelector('[aria-label="帳單類型"]'),null)
 await click('取消匯入');assert.equal(window.location.pathname,'/bank-transactions')
})
test('a balance for a currency without transactions imports with the same bank section',async()=>{
 const r=parsed();r.bank='DBS Singapore';r.sections[0].bank=r.bank;r.sections[0].currency='SGD';r.sections[0].rows[0]={...draft,currency:'SGD'};r.balances=[{bank:r.bank,date:'2025-09-30',currency:'SGD',quantity:888.5},{bank:r.bank,date:'2025-09-30',currency:'USD',quantity:12.5}];pdf.reset([r]);
 const latest=await render({...model.emptyData(),bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]})
 await click('匯入銀行帳單');await files();await submitImport();assert.match(document.body.textContent,/USD 12.5/);await click('確認匯入');await click('確認銀行匯入')
 assert.deepEqual(latest().history.quantityDays[0].entries.map(e=>[e.currency,e.quantity]).sort(),[['SGD',888.5],['USD',12.5]]);assert.equal(latest().bankStatementBalances.length,2)
})
test('balances from a statement with only an account summary import under the bank ledger account',async()=>{
 const r=parsed();r.bank='DBS Singapore';r.sections=[];r.recognizedCount=0;r.balances=[{bank:r.bank,date:'2025-09-30',currency:'SGD',quantity:888.5},{bank:r.bank,date:'2025-09-30',currency:'USD',quantity:12.5}];pdf.reset([r])
 const latest=await render({...model.emptyData(),bankTransactionAccounts:[],bankTransactions:[],bankCategoryRules:[]})
 await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入');await click('確認銀行匯入')
 assert.deepEqual(latest().bankTransactionAccounts.map(a=>a.label),['DBS (SG)']);assert.equal(latest().bankTransactions.length,0)
 assert.deepEqual(latest().history.quantityDays[0].entries.map(e=>[e.currency,e.quantity]).sort(),[['SGD',888.5],['USD',12.5]])
})
test('summary-only balances ask which ledger account when the bank has several, then use the choice',async()=>{
 const r=parsed();r.bank='Fubon';r.sections=[];r.recognizedCount=0;r.balances=[{bank:'Fubon',date:'2025-09-30',currency:'TWD',quantity:545},{bank:'Fubon',date:'2025-09-30',currency:'USD',quantity:3.38}];pdf.reset([r])
 const ledgers=[{id:'salary',label:'Salary',bank:'Fubon'},{id:'savings',label:'Savings',bank:'Fubon'}]
 const latest=await render({...model.emptyData(),bankTransactionAccounts:ledgers,bankTransactions:[],bankCategoryRules:[]})
 await click('匯入銀行帳單');await files();await submitImport();await click('確認匯入')
 assert.match(document.querySelector('[role=alert]').textContent,/選擇帳單餘額對應的流水帳戶/)
 await input(`${box('帳單期末餘額').querySelector('select').getAttribute('aria-label')}`,'savings')
 await click('確認匯入');await click('確認銀行匯入')
 assert.deepEqual(latest().bankTransactionAccounts.map(a=>a.id),['salary','savings'])
 assert.deepEqual(latest().bankStatementBalances.map(b=>[b.currency,b.ledgerAccountId]).sort(),[['TWD','savings'],['USD','savings']])
})

// 自動判斷: one entry for card and bank statements.
async function entryFiles(names){const el=box('帳單 PDF');Object.defineProperty(el,'files',{configurable:true,value:names.map(name=>({size:30,name,arrayBuffer:async()=>new TextEncoder().encode('%PDF-'+name).buffer}))});await act(()=>el.dispatchEvent(new Event('change',{bubbles:true})))}
async function detect(){await act(async()=>document.querySelector('.statement-entry form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))}
async function openEntry(){window.history.replaceState(null,'','/cashflow/import');root=createRoot(document.getElementById('root'));await act(async()=>root.render(createElement(App)));await settle(()=>!!box('帳單 PDF'));return {kind:await server.ssrLoadModule('/src/statementKind.ts'),card:await server.ssrLoadModule('/src/statementPdf.ts')}}
const cardResult=()=>({lines:['HSBC','04/01 04/02 SHOP 100'],title:'',ocrUsed:false})
const tabs=()=>[...document.querySelectorAll('[role="tab"]')].map(b=>`${b.textContent}${b.getAttribute('aria-selected')==='true'?' *':''}`)
const panel=kind=>document.getElementById(`batch-panel-${kind}`)
test('the import entry detects each file, lists the unrecognized one, then shows card and bank statements in two tabs',async()=>{
 const d=drive(appData());const {kind,card}=await openEntry()
 assert.equal(document.querySelector('[aria-label="帳單類型"]'),null,'the entry detects the kind; there is no kind switch')
 kind.setKinds([{kind:'card',bank:'匯豐'},{kind:'bank',bank:'HSBC (TW)'},{kind:'unknown',reason:'沒有已支援的銀行交易表，也沒有信用卡帳單特徵'},new Error('提供的密碼無法開啟此帳單，請核對密碼或新增其他密碼後重新解析')]);card.setResults([cardResult()]);pdf.reset([parsed()])
 await entryFiles(['card-2026-04.pdf','bank.pdf','other.pdf','locked.pdf']);await input('帳單 PDF 密碼','typed-secret');await detect()
 await settle(()=>!!box('帳單類型判斷結果'))
 assert.deepEqual(kind.calls.map(c=>c.name),['card-2026-04.pdf','bank.pdf','other.pdf','locked.pdf']);assert.ok(kind.calls.every(c=>c.password.includes('typed-secret')))
 const report=box('帳單類型判斷結果').textContent
 assert.match(report,/card-2026-04\.pdf · 信用卡帳單（匯豐）/);assert.match(report,/bank\.pdf · 銀行帳單（HSBC \(TW\)）/);assert.match(report,/other\.pdf · 無法辨識：沒有已支援的銀行交易表.*未匯入/);assert.match(report,/locked\.pdf · 無法讀取：提供的密碼無法開啟此帳單.*未匯入/)
 assert.equal(box('other.pdf 的類型').value,'skip','an unrecognized file is left out unless the user picks a kind');assert.equal(box('locked.pdf 的類型'),null)
 await click('繼續匯入 · 信用卡 1 份 · 銀行 1 份')
 assert.equal(window.location.pathname,'/cashflow/import','the batch stays on one screen')
 assert.deepEqual(tabs(),['信用卡帳單 · 1 份 *','銀行對帳單 · 1 份'])
 // Both kinds parse at once; the hidden tab keeps its preview.
 await settle(()=>!!panel('card').querySelector('.statement-group')&&!!panel('bank').querySelector('.bank-preview-row'))
 assert.equal(panel('card').hidden,false);assert.equal(panel('bank').hidden,true)
 assert.deepEqual(card.calls.map(c=>c.name),['card-2026-04.pdf']);assert.ok(card.calls[0].password.includes('typed-secret'));assert.equal(pdf.calls.length,1);assert.ok(pdf.calls[0].password.includes('typed-secret'))
 assert.match(box('帳單類型判斷結果').textContent,/other\.pdf · 無法辨識/)
 await act(()=>[...document.querySelectorAll('[role="tab"]')][1].click());assert.deepEqual(tabs(),['信用卡帳單 · 1 份','銀行對帳單 · 1 份 *']);assert.equal(panel('card').hidden,true)
 await input('區段 1 帳戶','ledger')
 await act(()=>[...document.querySelectorAll('[role="tab"]')][0].click());assert.ok(panel('card').querySelector('.statement-group'),'switching tabs keeps the card preview')
 await click('確認匯入 1 筆')
 assert.deepEqual(tabs(),['信用卡帳單 · 1 份 ✓','銀行對帳單 · 1 份 *'],'a finished tab gives way to the open one')
 assert.match(panel('card').textContent,/已加入 1 筆/);assert.equal(box('區段 1 帳戶').value,'ledger','the bank mapping survived')
 await click('確認匯入')
 const result=box('匯入結果').textContent;assert.match(result,/信用卡帳單：已加入 1 筆/);assert.match(result,/銀行對帳單：已新增 1 筆/)
 assert.equal(appHook.data.expenses.length,1,'the bank tab sees the card rows already imported');assert.equal(d.writes,0,'nothing is saved before 儲存變更')
 await click('返回收支總覽');assert.equal(window.location.pathname,'/cashflow')
})
test('a detected card statement shows which file and step it is on while it parses, without the empty file picker',async()=>{
 drive(appData());const {kind,card}=await openEntry()
 kind.setKinds([{kind:'card',bank:'匯豐'}]);card.setResults([cardResult()]);card.pause();await entryFiles(['card-2026-04.pdf']);await detect()
 await settle(()=>!!box('信用卡帳單解析進度'))
 const status=box('信用卡帳單解析進度').textContent
 assert.match(status,/正在本機解析 · 第 1／1 份/);assert.match(status,/目前檔案（第 1／1 份）：card-2026-04\.pdf · 正在本機定位匯豐交易區段 · 第 2／3 頁/)
 assert.equal(document.querySelector('.statement-import form').hidden,true,'files from the entry are not asked for again')
 await act(async()=>card.release());await settle(()=>!!document.querySelector('.statement-group'));assert.equal(box('信用卡帳單解析進度'),null)
 await click('取消匯入')
})
test('each file is read once: the tabs use what detection read (card lines, bank result, card error) and detection shows file and step',async()=>{
 drive(appData());const {kind,card}=await openEntry()
 let finish;const held=new Promise(r=>finish=r)
 kind.setKinds([async step=>{step('正在本機辨識商家 · 第 2／3 頁 · 45／46 筆');await held;return {kind:'card',bank:'匯豐',prepared:{kind:'card',read:cardResult()}}},{kind:'bank',bank:'HSBC (TW)',prepared:{kind:'bank',result:parsed()}},{kind:'card',bank:'台新',prepared:{kind:'card',error:'帳單無法定位前期餘額／交易明細區段，請重新解析或對照原帳單；尚未匯入任何資料'}}]);card.setResults([]);pdf.reset([])
 await entryFiles(['card-2026-04.pdf','bank.pdf','taishin-2026-04.pdf']);await detect()
 await settle(()=>/辨識商家/.test(box('帳單類型判斷進度')?.textContent??''))
 assert.equal(box('帳單類型判斷進度').textContent,'正在本機讀取並判斷類型 · 第 1／3 份 · card-2026-04.pdf · 正在本機辨識商家 · 第 2／3 頁 · 45／46 筆')
 await act(async()=>finish())
 await settle(()=>!!panel('card')?.querySelector('.statement-group')&&!!panel('bank')?.querySelector('.bank-preview-row'))
 assert.equal(card.calls.length,0,'the card reader does not read the files again');assert.equal(pdf.calls.length,0,'the bank reader does not read the file again')
 assert.match(box('各帳單解析結果').textContent,/card-2026-04\.pdf：.*1 筆待核對/);assert.match(box('各帳單解析結果').textContent,/taishin-2026-04\.pdf：帳單無法定位前期餘額／交易明細區段/)
})
test('a fully recognized batch goes straight to the import; an unrecognized file runs only with the kind the user picked; each tab cancels on its own',async()=>{
 drive(appData());const {kind,card}=await openEntry()
 kind.setKinds([{kind:'bank',bank:'HSBC (TW)'}]);card.setResults([]);pdf.reset([parsed()]);await entryFiles(['bank.pdf']);await detect()
 await settle(()=>!!document.querySelector('.bank-preview-row'));assert.equal(window.location.pathname,'/cashflow/import');assert.deepEqual(tabs(),[],'one kind needs no tabs');assert.equal(card.calls.length,0)
 await click('取消匯入');assert.match(box('匯入結果').textContent,/銀行對帳單：已取消，未匯入/)
 await click('返回收支總覽');assert.equal(window.location.pathname,'/cashflow')
 await act(async()=>{window.history.pushState(null,'','/cashflow/import');window.dispatchEvent(new PopStateEvent('popstate'))});await settle(()=>!!box('帳單 PDF'))
 kind.setKinds([{kind:'unknown',bank:'富邦銀行 (TW)',reason:'看起來是 富邦銀行 (TW) 的文件，但沒有已支援的銀行交易表，也沒有信用卡帳單特徵'},{kind:'bank'}]);card.setResults([cardResult()]);pdf.reset([parsed()])
 await entryFiles(['odd-2026-04.pdf','bank.pdf']);await detect();await settle(()=>!!box('帳單類型判斷結果'))
 await input('odd-2026-04.pdf 的類型','card');await click('繼續匯入 · 信用卡 1 份 · 銀行 1 份')
 await settle(()=>!!panel('card').querySelector('.statement-group')&&!!panel('bank').querySelector('.bank-preview-row'));assert.deepEqual(card.calls.map(c=>c.name),['odd-2026-04.pdf'])
 assert.match(box('帳單類型判斷結果').textContent,/odd-2026-04\.pdf · 無法辨識（富邦銀行 \(TW\)），依你的選擇以信用卡帳單匯入/)
 await act(()=>[...panel('card').querySelectorAll('button')].find(b=>b.textContent==='取消匯入').click())
 assert.deepEqual(tabs(),['信用卡帳單 · 1 份 ✓','銀行對帳單 · 1 份 *']);assert.match(panel('card').textContent,/已取消，未匯入信用卡帳單/);assert.ok(panel('bank').querySelector('.bank-preview-row'),'the other tab keeps its preview')
 // Leaving the screen drops the batch: its files and typed password are not kept.
 await act(async()=>{window.history.pushState(null,'','/expenses');window.dispatchEvent(new PopStateEvent('popstate'))});await act(async()=>{window.history.pushState(null,'','/cashflow/import');window.dispatchEvent(new PopStateEvent('popstate'))})
 await settle(()=>!!box('帳單 PDF'));assert.deepEqual(tabs(),[])
})
test('nothing to import keeps the entry, and cancelling it returns to the cashflow page',async()=>{
 drive(appData());const {kind}=await openEntry()
 kind.setKinds([{kind:'unknown',reason:'證券對帳單不支援'}]);await entryFiles(['broker.pdf']);await detect();await settle(()=>!!box('帳單類型判斷結果'))
 assert.ok(button('沒有可匯入的檔案').disabled);await click('重新選擇帳單');assert.ok(box('帳單 PDF'))
 await click('取消匯入');assert.equal(window.location.pathname,'/cashflow')
})
