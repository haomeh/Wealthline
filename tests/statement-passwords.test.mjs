import assert from 'node:assert/strict'
import {before,after,beforeEach,afterEach,test} from 'node:test'
import {createServer} from 'vite'
import {statementKeyStore} from './helpers/statement-key-store.mjs'
let server,vault,model,history,saveState,store
before(async()=>{
  server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  vault=await server.ssrLoadModule('/src/statementPasswords.ts')
  model=await server.ssrLoadModule('/src/model.ts')
  history=await server.ssrLoadModule('/src/history.ts')
  saveState=await server.ssrLoadModule('/src/saveState.ts')
})
beforeEach(()=>{store=statementKeyStore();globalThis.indexedDB=store})
afterEach(()=>{delete globalThis.indexedDB})
after(()=>server.close())

test('saved passwords use authenticated encryption, random IVs and account-bound non-extractable keys',async()=>{
  const secret='synthetic, literal password'
  const first=await vault.saveStatementPassword('google:a','Synthetic card',secret)
  const second=await vault.saveStatementPassword('google:a','Synthetic card',secret,first.id)
  assert.equal(first.keyId,second.keyId)
  assert.notEqual(first.iv,second.iv)
  assert.notEqual(first.ciphertext,second.ciphertext)
  assert.deepEqual(await vault.unlockStatementPasswords('google:a',[first]),{values:[secret],unavailable:0})
  assert.equal(store.records.get('google:a').key.extractable,false)
  await assert.rejects(()=>crypto.subtle.exportKey('raw',store.records.get('google:a').key))
  assert.deepEqual(await vault.unlockStatementPasswords('google:b',[first]),{values:[],unavailable:1})
  assert.deepEqual(await vault.unlockStatementPasswords('local',[first]),{values:[],unavailable:1})
  await vault.saveStatementPassword('google:b','Synthetic card',secret)
  assert.deepEqual(await vault.unlockStatementPasswords('google:b',[first]),{values:[],unavailable:1})
  const device=store.records.get('google:a')
  await assert.rejects(()=>vault.openStatementPassword('google:b',first,device))
  await assert.rejects(()=>vault.openStatementPassword('google:a',{...first,id:'swapped-id'},device))
  await assert.rejects(()=>vault.openStatementPassword('google:a',{...first,ciphertext:(first.ciphertext[0]==='A'?'B':'A')+first.ciphertext.slice(1)},device))
  assert.equal(JSON.stringify(first).includes(secret),false)
  assert.equal(JSON.stringify(first).includes('key"'),false)
  store.records.clear()
  assert.deepEqual(await vault.unlockStatementPasswords('google:a',[first]),{values:[],unavailable:1})
  const reset=await vault.saveStatementPassword('google:a','Synthetic card',secret,first.id)
  assert.notEqual(reset.keyId,first.keyId)
  assert.deepEqual(await vault.unlockStatementPasswords('google:a',[reset]),{values:[secret],unavailable:0})
})

test('password settings are validated, source errors are contextual and all saves retain version 12',async()=>{
  const entry=await vault.saveStatementPassword('google:a','Synthetic card','synthetic-password')
  const data={...model.emptyData(),statementPasswords:[{...entry,password:'must-drop',key:'must-drop'}]}
  const parsed=model.parseWealthData(data)
  assert.equal(parsed.version,12)
  assert.deepEqual(parsed.statementPasswords,[entry])
  assert.equal(model.parseWealthData({...model.emptyData(),statementPasswords:[]}).version,12)
  assert.equal(model.parseWealthData({...model.emptyData(),version:12}).version,12)
  assert.throws(()=>model.parseWealthData({...data,statementPasswords:[entry,entry]},'drive'),/Drive.*識別碼重複/)
  assert.throws(()=>model.parseWealthData({...data,statementPasswords:[{...entry,iv:'bad'}]},'file'),/上傳的資料檔.*格式不正確/)
  assert.throws(()=>vault.parseStatementPasswords(Array(21).fill(entry)))
  await assert.rejects(()=>vault.saveStatementPassword('google:a','Synthetic card',''))
  const stamped=history.recordSave(parsed,parsed)
  assert.equal(stamped.version,12)
  assert.equal(saveState.finishSave(parsed,parsed,stamped).version,12)
  const current={...parsed,expenseCategoryRules:[{keyword:'Test',category:'交通'}]}
  assert.equal(saveState.finishSave(current,parsed,stamped).version,12)
  const quantity=await server.ssrLoadModule('/src/quantityHistory.ts')
  const changed=quantity.applyQuantityDay(parsed,{date:'2025-09-01',updatedAt:'2025-09-01T12:00:00Z',entries:[]})
  assert.equal(changed.version,12)
  assert.deepEqual(changed.statementPasswords,[entry])
  assert.deepEqual(stamped.statementPasswords,[entry])
  delete globalThis.indexedDB
  await assert.rejects(()=>vault.saveStatementPassword('google:a','Synthetic card','synthetic-password'),/設定未保存/)
})

test('password input splits on commas and merges new rows after stored ones',()=>{
  assert.deepEqual(vault.splitStatementPasswords(' a b , c,,a b, '),['a b','c'])
  assert.deepEqual(vault.splitStatementPasswords(' , '),[])
  const row=id=>({id,label:id,keyId:'k',iv:'',ciphertext:''})
  assert.deepEqual(vault.mergeStatementPasswords([row('1'),row('2')],[{...row('2'),label:'new'},row('3')]).map(p=>`${p.id}:${p.label}`),['1:1','2:new','3:3'])
})
