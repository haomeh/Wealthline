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
