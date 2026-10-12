import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, model, history, save, quantity, periods
before(async () => {
  server = await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  ;[model,history,save,quantity,periods] = await Promise.all(['model','history','saveState','quantityHistory','holdingPeriods'].map(n=>server.ssrLoadModule(`/src/${n}.ts`)))
})
after(()=>server.close())
const account = {id:'ledger-1',label:'Test',bank:'Test bank'}
const row = {id:'row-1',accountId:'ledger-1',date:'2026-01-12',description:'Example',currency:'TWD',direction:'credit',amount:100,sourceKey:`bank-v1:${'a'.repeat(64)}`,classification:{kind:'income',category:'薪資'}}
const ledger = () => ({...model.emptyData(),bankTransactionAccounts:[account],bankTransactions:[row],bankCategoryRules:[{keyword:'Example',target:{kind:'pending'}}]})
const roundtrip = d => model.parseWealthData(JSON.parse(JSON.stringify(d)))
test('legacy versions retain versions and do not invent bank fields',()=>{
  for(let version=1;version<=12;version++) {
    const d={...model.emptyData(),version,...(version===10?{expenses:[]}: {})}
    const parsed=roundtrip(d)
    assert.equal(parsed.version,version)
    for(const key of ['bankTransactionAccounts','bankTransactions','bankCategoryRules']) assert.equal(Object.hasOwn(parsed,key),false)
  }
})
test('each bank collection including empty arrays promotes to13; explicit13 persists',()=>{
  for(const key of ['bankTransactionAccounts','bankTransactions','bankCategoryRules']) {
    const parsed=roundtrip({...model.emptyData(),[key]:[]})
    assert.equal(parsed.version,13); assert.deepEqual(parsed[key],[])
    assert.equal(roundtrip(parsed).version,13)
  }
  assert.equal(roundtrip({...model.emptyData(),version:13}).version,13)
})
test('bank ledger roundtrip allowlists and masks recognized text atomically',()=>{
  const d=ledger()
  d.bankTransactions=[{...row,description:'Account number: 123456789012',balance:99,accountNumber:'123456789012',rawText:'private',password:'private'}]
  d.bankTransactionAccounts=[{...account,label:'帳號: 123456789012',balance:99}]
  const parsed=roundtrip(d)
  assert.equal(parsed.version,13)
  assert.equal(parsed.bankTransactions[0].sourceKey,row.sourceKey)
  const json=JSON.stringify(parsed)
  for(const text of ['123456789012','rawText','accountNumber','password','balance']) assert.equal(json.includes(text),false)
  assert.deepEqual(roundtrip(parsed),parsed)
})
test('invalid collections, duplicate ids and dangling references fail with safe source context',()=>{
  for(const extra of [
    {bankTransactionAccounts:null}, {bankTransactions:{}}, {bankCategoryRules:null},
    {bankTransactionAccounts:[account,account]}, {bankTransactions:[row,row]},
    {bankTransactions:[{...row,accountId:'private-secret'}]},
    {bankTransactionAccounts:undefined}, {bankTransactions:[{...row,amount:-1}]},
    {bankTransactions:[{...row,classification:{kind:'income',category:'薪資',reason:'private-secret'}}]},
  ]) for(const source of ['file','browser','drive']) {
    assert.throws(()=>model.parseWealthData({...ledger(),...extra},source),e=>{
      assert.match(e.message,/格式不正確/)
      assert.ok(e.message.includes({file:'上傳',browser:'瀏覽器',drive:'Drive'}[source]))
      assert.equal(e.message.includes('private-secret'),false)
      return true
    })
  }
})
test('save and quantity operations preserve bank data without asset changes',()=>{
  const d=roundtrip(ledger()), before=structuredClone(d)
  const saved=history.recordSave(d,{...d,updatedAt:'2026-02-01T12:00:00.000Z'})
  assert.equal(saved.version,13)
  assert.deepEqual(saved.accounts,d.accounts);assert.deepEqual(saved.liabilities,d.liabilities)
  assert.deepEqual(saved.history.changes,d.history.changes)
  const changed=quantity.applyQuantityDay(d,{date:'2026-01-01',updatedAt:'2026-02-01T12:00:00Z',entries:[],sparse:true})
  assert.equal(changed.version,13)
  const period={id:'period-1',accountId:'asset-1',account:'Synthetic',category:'股票',country:'TW',type:'holding',symbol:'TEST',currency:'TWD',updatedAt:'2026-02-01T12:00:00Z',start:'2026-01-01',end:'2026-01-02',quantity:10,timeZone:'Asia/Taipei'}
  const withPeriod=periods.applyHoldingPeriod(d,period,periods.periodRevision(d),true,'2026-02-01T12:00:00Z')
  assert.equal(withPeriod.version,13)
  for(const next of [saved,changed,withPeriod]) for(const key of ['bankTransactionAccounts','bankTransactions','bankCategoryRules']) assert.deepEqual(next[key],d[key])
  assert.deepEqual(d,before)
})
test('persistence boundary validates and sanitizes bank inputs without touching assets',()=>{
  const d=ledger()
  d.accounts=[{id:'asset-1',name:'Synthetic asset',kind:'bank',country:'TW',category:'現金與外幣活存',positions:[{id:'cash-1',type:'cash',currency:'TWD',symbol:'',quantity:50,price:1,addedAt:'2026-01-01T12:00:00Z'}]}]
  const baseline=history.recordSave(null,d)
  const edited={...baseline,bankTransactions:[{...row,description:'帳號: 123456789012',balance:50,rawText:'private',password:'private'}]}
  const saved=history.recordSave(baseline,edited)
  assert.equal(saved.version,13)
  assert.deepEqual(saved.accounts,baseline.accounts)
  assert.deepEqual(saved.history.changes,baseline.history.changes)
  assert.deepEqual(saved.history.snapshots,baseline.history.snapshots)
  assert.equal(JSON.stringify(saved.bankTransactions).includes('123456789012'),false)
  for(const key of ['balance','rawText','password']) assert.equal(Object.hasOwn(saved.bankTransactions[0],key),false)
  assert.throws(()=>history.recordSave(baseline,{...edited,bankTransactions:[{...row,accountId:'missing'}]}))
  assert.throws(()=>history.recordSave(baseline,{...edited,bankTransactionAccounts:null}))
})
test('deferred finish keeps new bank labels classifications and rules; persisted13 never downgrades',()=>{
  const submitted=roundtrip(ledger())
  const persisted=history.recordSave(submitted,{...submitted,updatedAt:'2026-02-01T12:00:00.000Z'})
  const current={...submitted,bankTransactionAccounts:[{...account,label:'Renamed'}],bankTransactions:[{...row,classification:{kind:'pending'}}],bankCategoryRules:[]}
  const result=save.finishSave(current,submitted,persisted)
  assert.equal(result.version,13)
  for(const key of ['bankTransactionAccounts','bankTransactions','bankCategoryRules']) assert.equal(result[key],current[key])
  assert.equal(result.history,persisted.history)
  assert.equal(save.finishSave({...model.emptyData()},submitted,persisted).version,13)
})
test('version helper retains legacy promotion priorities and accepts operation floors',async()=>{
  const {dataVersion}=await server.ssrLoadModule('/src/dataVersion.ts')
  for(let version=1;version<=13;version++) {
    assert.equal(dataVersion({version},{minimumVersion:2}),Math.max(2,version))
    for(let minimumVersion=3;minimumVersion<=12;minimumVersion++) assert.equal(dataVersion({version},{minimumVersion}),Math.max(version,minimumVersion))
  }
  assert.equal(dataVersion({version:2,history:{quantityDays:[]}}),3)
  assert.equal(dataVersion({version:2,history:{holdingPeriods:[]}}),5)
  assert.equal(dataVersion({version:2,liabilities:[{schedule:{}}]}),4)
  for(const [field,version] of [['expenses',10],['expenseCategoryRules',11],['statementPasswords',12],['bankTransactions',13]]) assert.equal(dataVersion({version:2,[field]:[]}),version)
  assert.equal(dataVersion({version:2},{persistedVersion:13}),13)
  assert.equal(dataVersion({version:2,history:{holdingPeriods:[]}},{legacyHistory:false}),2)
})


test('statement closing-balance provenance survives v14 parse and persistence with allowlisted fields',()=>{
 const d=ledger();d.bankTransactionAccounts[0].bank='DBS Singapore';d.bankStatementBalances=[{id:'balance-1',ledgerAccountId:account.id,accountId:'asset-dbs',bank:'DBS Singapore',date:'2025-09-30',currency:'SGD',quantity:888.5,fileHash:'a'.repeat(64),rawText:'PRIVATE',password:'PRIVATE'}];
 const parsed=roundtrip(d);assert.equal(parsed.version,14);assert.equal(parsed.bankStatementBalances.length,1);assert.ok(!JSON.stringify(parsed).includes('PRIVATE'));assert.equal(roundtrip(parsed).bankStatementBalances[0].quantity,888.5);
 for(const patch of [{quantity:-1},{fileHash:'private'},{date:'2025-02-30'},{ledgerAccountId:'missing'},{currency:'ZZZ'}])assert.throws(()=>roundtrip({...d,bankStatementBalances:[{...d.bankStatementBalances[0],...patch}]}));
})


test('reimported statement balance never overwrites a later manual history edit',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:'DBS Singapore'}]};const candidate={bank:'DBS Singapore',date:'2025-09-30',currency:'SGD',quantity:888.5,fileHash:'a'.repeat(64),ledgerAccountId:account.id};const first=helper.importStatementBalances(d,[candidate]).data;
 const day=first.history.quantityDays[0],edited={...first,history:{...first.history,quantityDays:[{...day,entries:[{...day.entries[0],quantity:777}]}]}};const loaded=roundtrip(edited),again=helper.importStatementBalances(loaded,[candidate]);assert.equal(again.added,0);assert.equal(again.skipped,1);assert.equal(again.data.history.quantityDays[0].entries[0].quantity,777);assert.equal(history.recordSave(loaded,{...loaded,updatedAt:new Date().toISOString()}).version,14);
})
test('balance imports preserve completion entries and expose unknown other assets instead of inventing a total',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const cash={accountId:'dbs',account:'DBS',category:'現金與外幣活存',country:'SG',type:'cash',symbol:'',currency:'SGD',quantity:5};const other={...cash,accountId:'other',account:'Other',country:'TW',currency:'TWD',quantity:42};const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:'DBS Singapore'}],accounts:[{id:'dbs',name:'DBS',country:'SG',kind:'bank',category:'現金與外幣活存',positions:[{id:'cash',type:'cash',symbol:'',currency:'SGD',quantity:999,price:1}]}],history:{changes:[],snapshots:[],quantityDays:[{date:'2025-09-30',updatedAt:'2025-10-01T00:00:00Z',entries:[],sparse:true,completion:{source:{kind:'current',date:'2025-09-30'},accounts:[{id:'dbs',name:'DBS'},{id:'other',name:'Other'}],entries:[cash,other]}}]}};
 const next=helper.importStatementBalances(d,[{bank:'DBS Singapore',date:'2025-09-30',currency:'SGD',quantity:888.5,fileHash:'a'.repeat(64),ledgerAccountId:account.id}]).data;assert.equal(next.history.quantityDays[0].entries[0].quantity,888.5);assert.deepEqual(next.history.quantityDays[0].completion.entries,[other]);assert.equal(next.accounts,d.accounts);
 const sparse=helper.importStatementBalances({...d,history:{changes:[],snapshots:[]} },[{bank:'DBS Singapore',date:'2025-09-30',currency:'TWD',quantity:100,fileHash:'b'.repeat(64),ledgerAccountId:account.id}]).data;assert.equal(history.totalPoints(sparse,new Date().toISOString()).find(p=>p.date==='2025-09-30').total,null);
})
test('statement balances reject conflicting documents, future dates and prototype property bank names',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:'DBS Singapore'}]};const a={bank:'DBS Singapore',date:'2025-09-30',currency:'SGD',quantity:100,fileHash:'a'.repeat(64),ledgerAccountId:account.id};assert.throws(()=>helper.importStatementBalances(d,[a,{...a,fileHash:'b'.repeat(64),quantity:200}]),/餘額不一致/);assert.throws(()=>helper.importStatementBalances(d,[{...a,date:'2099-09-30'}]),/未來/);for(const bank of ['constructor','toString','__proto__'])assert.equal(helper.bankStatementIdentity(bank),undefined);assert.equal(d.bankStatementBalances,undefined);
})


test('bank balances reuse suffixed asset names and reject ambiguous institution aliases atomically',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const candidate={bank:'HSBC Singapore',date:'2025-09-30',currency:'SGD',quantity:100,fileHash:'a'.repeat(64),ledgerAccountId:account.id};
 for(const name of ['HSBC SG','HSBC (SG)','匯豐 SG']){
  const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:candidate.bank}],accounts:[{id:'asset-hsbc',name,country:'SG',kind:'bank',category:'現金與外幣活存',positions:[]}]};
  const next=helper.importStatementBalances(d,[candidate]).data;assert.equal(next.history.quantityDays[0].entries[0].accountId,'asset-hsbc',name);assert.equal(next.accounts,d.accounts);
 }
 for(const names of [['HSBC','匯豐'],['匯豐','HSBC']]){
  const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:candidate.bank}],accounts:names.map((name,i)=>({id:'asset-'+i,name,country:'SG',kind:'bank',category:'現金與外幣活存',positions:[]}))};const before=structuredClone(d);
  assert.throws(()=>helper.importStatementBalances(d,[candidate]),/多個資產帳戶/);assert.deepEqual(d,before);
 }
})
test('closing cash cannot declare complete coverage for a newly included bank with unknown currencies',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const other={accountId:'other',account:'Other',category:'現金與外幣活存',country:'TW',type:'cash',symbol:'',currency:'TWD',quantity:42};
 for(const kind of ['inventory','completion']){
  const coverage={source:{kind:'current',date:'2025-09-30'},accounts:[{id:'other',name:'Other'}],...(kind==='completion'?{entries:[other]}:{})};
  const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:'Taishin'}],accounts:[{id:'asset-bank',name:'台新銀行',kind:'bank',country:'TW',category:'現金與外幣活存',positions:[{id:'usd',type:'cash',symbol:'',currency:'USD',quantity:50,price:1}]}],history:{changes:[],snapshots:[],quantityDays:[{date:'2025-09-30',updatedAt:'2025-10-01T00:00:00Z',entries:kind==='inventory'?[other]:[],...(kind==='completion'?{sparse:true}:{}),[kind]:coverage}]}};
  const next=helper.importStatementBalances(d,[{bank:'Taishin',date:'2025-09-30',currency:'TWD',quantity:100,fileHash:'a'.repeat(64),ledgerAccountId:account.id}]).data;
  assert.equal(history.totalPoints(next,new Date().toISOString()).find(p=>p.date==='2025-09-30').total,null,kind);
  const expanded=periods.expandPeriodDays(next).find(day=>day.date==='2025-09-30');assert.ok(expanded.entries.some(e=>e.accountId==='asset-bank'&&e.currency==='USD'&&e.quantity===null),kind);assert.ok(expanded.entries.some(e=>e.accountId==='other'&&e.quantity===42),kind);
  assert.ok(!next.history.quantityDays[0].entries.some(e=>e.currency==='USD'),kind);
  const bankUsd={accountId:'asset-bank',account:'台新銀行',country:'TW',category:'現金與外幣活存',type:'cash',symbol:'',currency:'USD'},otherTwd={...other};delete otherTwd.quantity;
  const held={...d,history:{...d.history,holdingPeriods:[{...bankUsd,id:'period-usd',quantity:50,start:'2025-09-01',updatedAt:'2025-09-01T00:00:00Z',timeZone:'Asia/Taipei'},{...otherTwd,id:'period-other',quantity:75,start:'2025-09-01',updatedAt:'2025-09-01T00:00:00Z',timeZone:'Asia/Taipei'}]}};
  const imported=helper.importStatementBalances(held,[{bank:'Taishin',date:'2025-09-30',currency:'TWD',quantity:100,fileHash:'a'.repeat(64),ledgerAccountId:account.id}]).data;
  assert.equal(periods.periodQuantityOn(imported,bankUsd,'2025-10-01').quantity,50,kind);assert.equal(periods.periodQuantityOn(imported,otherTwd,'2025-10-01').quantity,75,kind);
 }
})


test('later asset creation cannot duplicate an already imported historical bank identity',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const candidate={bank:'Taishin',date:'2025-09-30',currency:'TWD',quantity:100,fileHash:'a'.repeat(64),ledgerAccountId:account.id};const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:candidate.bank}]};const first=helper.importStatementBalances(d,[candidate]).data;
 const changed={...first,accounts:[{id:'asset-later',name:'台新銀行',kind:'bank',country:'TW',category:'現金與外幣活存',positions:[]}]};const before=structuredClone(changed);
 assert.throws(()=>helper.importStatementBalances(changed,[{...candidate,quantity:120,fileHash:'b'.repeat(64)}]),/歷史帳戶/);assert.deepEqual(changed,before);assert.equal(changed.history.quantityDays[0].entries.length,1);
})


test('same-batch statements share one historical bank identity across legacy ledger mappings',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const a={...account,bank:'Taishin'},b={...a,id:'ledger-b',label:'Other legacy label'};const d={...model.emptyData(),bankTransactionAccounts:[a,b]};const candidate={bank:'Taishin',date:'2025-09-30',currency:'TWD',quantity:100,fileHash:'a'.repeat(64),ledgerAccountId:a.id};
 assert.throws(()=>helper.importStatementBalances(d,[candidate,{...candidate,quantity:120,fileHash:'b'.repeat(64),ledgerAccountId:b.id}]),/餘額不一致/);
 const next=helper.importStatementBalances(d,[candidate,{...candidate,fileHash:'b'.repeat(64),ledgerAccountId:b.id}]).data;assert.equal(next.history.quantityDays[0].entries.length,1);assert.equal(next.history.quantityDays[0].entries[0].quantity,100);assert.equal(new Set(next.bankStatementBalances.map(b=>b.accountId)).size,1);assert.equal(d.bankStatementBalances,undefined);
})
test('deferred saves preserve later statement history and source provenance together in v14',async()=>{
 const helper=await server.ssrLoadModule('/src/bankStatementAssets.ts');const d={...model.emptyData(),bankTransactionAccounts:[{...account,bank:'Taishin'}]};const a={bank:'Taishin',date:'2025-09-30',currency:'TWD',quantity:100,fileHash:'a'.repeat(64),ledgerAccountId:account.id};const submitted=helper.importStatementBalances(d,[a]).data;
 const persisted=history.recordSave(d,submitted);const current=helper.importStatementBalances(submitted,[{...a,date:'2025-10-01',quantity:120,fileHash:'b'.repeat(64)}]).data;const next=save.finishSave(current,submitted,persisted);assert.equal(next.version,14);assert.equal(next.history.quantityDays.length,2);assert.equal(next.bankStatementBalances.length,2);assert.equal(roundtrip(next).bankStatementBalances[1].quantity,120);
})
