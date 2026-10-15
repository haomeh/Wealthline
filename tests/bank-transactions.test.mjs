import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, bank, privacy
before(async () => {
  server = await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  bank = await server.ssrLoadModule('/src/bankTransactions.ts')
  privacy = await server.ssrLoadModule('/src/bankTextPrivacy.ts')
})
after(() => server?.close())
const accounts = [{id:'ledger-1',label:'Test',bank:'Test bank'},{id:'ledger-2',label:'Other',bank:'Test bank'}]
const row = (overrides={}) => ({date:'2026-01-12',description:'Example transfer',currency:'TWD',direction:'credit',amount:100,...overrides})
const tx = (overrides={}) => ({id:'row-1',accountId:'ledger-1',...row(),...overrides})
const hash = 'a'.repeat(64)
const prep = (rows=[row()],accountId='ledger-1',fileHash=hash) => bank.prepareBankTransactions(rows,accountId,fileHash,rows.map((_,i)=>({page:1,sectionKey:'section-1',rowKey:String(i)})))

test('allowlisted collections validate real dates, amounts, currencies, ids and references', () => {
  const parsed = bank.parseBankTransactions([tx({balance:999,accountNumber:'123456789012',rawText:'secret',password:'secret'})],accounts)[0]
  assert.deepEqual(Object.keys(parsed).sort(),['accountId','amount','currency','date','description','direction','id'])
  for(const change of [{amount:-1},{amount:NaN},{amount:Infinity},{amount:1e12+1},{date:'2026-02-29'},{date:'2026-13-01'},{currency:'twd'},{direction:'unknown'},{id:''},{accountId:'missing'},{sourceKey:hash},{importKey:'bank-v1:bad'}]) assert.throws(()=>bank.parseBankTransactions([tx(change)],accounts))
  assert.equal(bank.parseBankTransactions([tx({amount:0,date:'2024-02-29'})],accounts)[0].amount,0)
  for(const raw of [null,{},[null],[[]]]) assert.throws(()=>bank.parseBankTransactions(raw,accounts))
  assert.throws(()=>bank.parseBankTransactions([tx(),tx()],accounts))
  assert.throws(()=>bank.parseBankTransactionAccounts([...accounts,accounts[0]]))
  assert.throws(()=>bank.parseBankTransactions([tx()],[accounts[0],accounts[0]]))
  assert.throws(()=>bank.parseBankTransactionAccounts([{...accounts[0],label:'x'.repeat(101)}]))
  assert.throws(()=>bank.parseBankTransactions([tx({description:'x'.repeat(501)})],accounts))
  assert.deepEqual(bank.parseBankTransactionAccounts([{...accounts[0],balance:20}]),[accounts[0]])
})

test('classification discriminants reject conflicting targets and preserve manual pending', () => {
  for(const classification of [{kind:'income',category:'購物'},{kind:'income',category:'薪資',reason:'信用卡繳款'},{kind:'pending',category:'薪資'},{kind:'excluded',reason:'bad'},{kind:'expense',category:'薪資'},[],null]) assert.throws(()=>bank.parseBankTransactions([tx({classification})],accounts))
  const rules=bank.parseBankCategoryRules([{keyword:'ｅｘａｍｐｌｅ   transfer',target:{kind:'income',category:'投資回收款'}},{keyword:'Example',target:{kind:'excluded',reason:'其他不計收支'}}])
  assert.deepEqual(bank.classifyBankTransaction(tx(),rules),{kind:'income',category:'投資回收款'})
  assert.deepEqual(bank.classifyBankTransaction(tx({classification:{kind:'pending'}}),rules),{kind:'pending'})
  assert.deepEqual(bank.classifyBankTransaction(tx(),[{keyword:'example',direction:'debit',target:{kind:'income',category:'薪資'}}]),{kind:'pending'})
  for(const raw of [{},Array(101).fill(rules[0]),[{keyword:' ',target:{kind:'pending'}}],[{keyword:'x',direction:'bad',target:{kind:'pending'}}]]) assert.throws(()=>bank.parseBankCategoryRules(raw))
  assert.deepEqual(bank.parseBankCategoryRules([{keyword:'example',target:{kind:'expense',category:'購物',balance:5},password:'secret'}]),[{keyword:'example',target:{kind:'expense',category:'購物'}}])
})

test('only clear directed income and card payment semantics get built-in suggestions', () => {
  for(const description of ['轉帳','TRANSFER','investment proceeds','unknown']) assert.deepEqual(bank.classifyBankTransaction(tx({description})),{kind:'pending'})
  assert.deepEqual(bank.classifyBankTransaction(tx({description:'薪資入帳'})),{kind:'income',category:'薪資'})
  assert.deepEqual(bank.classifyBankTransaction(tx({description:'薪資入帳',direction:'debit'})),{kind:'pending'})
  assert.deepEqual(bank.classifyBankTransaction(tx({description:'存款利息'})),{kind:'income',category:'利息'})
  for(const description of ['信用卡繳款','繳信用卡款','國泰信用卡費','玉山卡費','信用卡款','信用卡帳款','台新信用卡自動扣繳','繳卡費','信用卡轉','玉山卡款扣繳','CREDIT CARD PAYMENT']) assert.deepEqual(bank.classifyBankTransaction(tx({description,direction:'debit'})),{kind:'excluded',reason:'信用卡繳款'},description)
  for(const description of ['金融卡費','晶片卡費用','簽帳卡費','金融卡款','DEBIT CARD PAYMENT']) assert.deepEqual(bank.classifyBankTransaction(tx({description,direction:'debit'})),{kind:'pending'},description)
  assert.deepEqual(bank.classifyBankTransaction(tx({description:'國泰信用卡費'})),{kind:'pending'},'a credit is a refund, not a payment')
})

test('short account labels are not identifiers while complete and transient identifiers remain protected',()=>{
 for(const text of ['台新帳戶1','數位帳戶2.0回饋','帳戶 12345'])assert.equal(privacy.protectBankText(text),text)
 for(const text of ['帳號 12345678','帳戶 1234-5678','ACCOUNT NO 123456'])assert.ok(privacy.protectBankText(text).includes('[帳號已遮蔽]'))
 assert.equal(privacy.protectBankText('Memo 123456',{accountIdentifiers:['123456']}),'Memo [帳號已遮蔽]')
 assert.equal(privacy.protectBankText('身分證 A123456789'),'身分證 [識別碼已遮蔽]')
})
test('bare A/C account context masks like the parser labeledAccount grammar while short labels stay',()=>{
 for(const [text,masked] of [['A/C123456789','A/C[帳號已遮蔽]'],['A/C 123456789','A/C [帳號已遮蔽]'],['a/c: 1234-5678','a/c: [帳號已遮蔽]'],['Transfer A/C NO 123456789 fee','Transfer A/C NO [帳號已遮蔽] fee'],['A/C NUMBER 123456','A/C NUMBER [帳號已遮蔽]']])assert.equal(privacy.protectBankText(text),masked)
 for(const text of ['A/C 12345','A/C fee 2.0','A/C1','Order 123456789'])assert.equal(privacy.protectBankText(text),text)
 const once=privacy.protectBankText('A/C 123456789');assert.equal(privacy.protectBankText(once),once)
})
test('deterministic contextual and known-identifier protection retains numeric references', async () => {
  const text='帳號：１２３４－５６７８－９０１２ Order 987654321098 Reference 876543210123 身分證字號 A123456789'
  const masked=privacy.protectBankText(text)
  assert.ok(masked.includes('[帳號已遮蔽]'))
  assert.ok(masked.includes('[識別碼已遮蔽]'))
  assert.ok(masked.includes('987654321098'))
  assert.equal(privacy.protectBankText(masked),masked)
  assert.equal(privacy.protectBankText('帳戶: 1234–5678–9012'),'帳戶: [帳號已遮蔽]')
  assert.equal(privacy.protectBankText('身分證號: A123456789'),'身分證號: [識別碼已遮蔽]')
  assert.equal(privacy.protectBankText('Memo 1234-5678-9012',{accountIdentifiers:['123456789012']}),'Memo [帳號已遮蔽]')
  const loaded=bank.parseBankTransactions([tx({description:text})],accounts)[0]
  assert.equal(loaded.description,masked)
  assert.equal(bank.parseBankTransactionAccounts([{...accounts[0],label:'Account number: 123456789012'}])[0].label,'Account number: [帳號已遮蔽]')
  const prepared=await bank.prepareBankTransactions([row({description:'Memo 123456789012'})],'ledger-1',hash,[{page:1,sectionKey:'one',rowKey:'one'}],{accountIdentifiers:['123456789012']})
  assert.equal(prepared[0].description,'Memo [帳號已遮蔽]')
  assert.equal(JSON.stringify(prepared).includes('123456789012'),false)
  assert.equal(bank.parseBankTransactions(JSON.parse(JSON.stringify(prepared)),accounts)[0].description,prepared[0].description)
})

test('identity distinguishes account, direction, repeated occurrence; edits and rename survive reimport', async () => {
  const rows=await prep([row(),row()])
  assert.match(rows[0].sourceKey,/^bank-v1:[a-f0-9]{64}$/)
  assert.notEqual(rows[0].importKey,rows[1].importKey)
  const first=bank.mergeBankTransactions([],rows,accounts)
  assert.equal(first.added,2)
  const edited=first.transactions.map(t=>({...t,description:'edited',amount:50,classification:{kind:'pending'}}))
  assert.equal(bank.mergeBankTransactions(edited,await prep([row(),row()]),accounts.map(a=>({...a,label:'renamed'}))).added,0)
  assert.equal(bank.mergeBankTransactions(edited,await prep([row(),row()],'ledger-1','b'.repeat(64)),accounts).added,0)
  assert.equal(bank.mergeBankTransactions(rows,await prep([row()],'ledger-2'),accounts).added,1)
  assert.equal(bank.mergeBankTransactions(rows,await prep([row({direction:'debit'})],'ledger-1','c'.repeat(64)),accounts).added,1)
  const combined=bank.mergeBankTransactions([], [...rows,...await prep([row(),row()])],accounts)
  assert.equal(combined.added,2)
  assert.equal(combined.duplicates,2)
  assert.equal(bank.mergeBankTransactions([rows[1]],[rows[0]],accounts,rows).added,1)
  const other=await prep([row(),row(),row()],'ledger-1','b'.repeat(64))
  assert.equal(bank.mergeBankTransactions(rows,other,accounts).added,1)
})

test('remapping re-prepares original provenance; invalid batches are atomic and ambiguity is explicit', async () => {
  const a=await prep(), b=await prep([row()],'ledger-2')
  assert.notEqual(a[0].sourceKey,b[0].sourceKey)
  assert.notEqual(a[0].importKey,b[0].importKey)
  assert.equal(bank.mergeBankTransactions(b,await prep([row()],'ledger-2'),accounts).added,0)
  const existing=[tx()]
  const snapshot=structuredClone(existing)
  assert.throws(()=>bank.mergeBankTransactions(existing,[tx({id:'valid'}),tx({id:'bad',accountId:'missing'})],accounts))
  assert.deepEqual(existing,snapshot)
  assert.throws(()=>bank.validateBankLedger([accounts[0]],[tx({accountId:'ledger-2'})],[]))
  assert.throws(()=>bank.mergeBankTransactions(existing,[tx()],accounts))
  const result=bank.mergeBankTransactions(a,await prep([row()],'ledger-1','b'.repeat(64)),accounts)
  assert.equal(result.suspectedDuplicates,1)
  await assert.rejects(()=>bank.prepareBankTransactions([row()],'ledger-1','invalid',[{page:1,sectionKey:'s',rowKey:'r'}]))
})

test('corrected previews retain original identity when re-prepared and remapped', async () => {
  const original=[row(),row()]
  const corrected=original.map(r=>({...r,description:'corrected',amount:25}))
  const provenance=original.map((_,i)=>({page:1,sectionKey:'s',rowKey:String(i)}))
  const before=structuredClone({original,corrected,provenance})
  const originalPrepared=await bank.prepareBankTransactions(original,'ledger-2',hash,provenance)
  const correctedPrepared=await bank.prepareBankTransactions(corrected,'ledger-2',hash,provenance,{},original)
  assert.deepEqual(correctedPrepared.map(r=>r.importKey),originalPrepared.map(r=>r.importKey))
  assert.deepEqual(correctedPrepared.map(r=>r.sourceKey),originalPrepared.map(r=>r.sourceKey))
  assert.equal(correctedPrepared[0].description,'corrected')
  assert.deepEqual({original,corrected,provenance},before)
  for(const bad of [[],[{page:0,sectionKey:'s',rowKey:'r'}],[{page:101,sectionKey:'s',rowKey:'r'}],[{page:1,sectionKey:'',rowKey:'r'}]]) await assert.rejects(()=>bank.prepareBankTransactions([row()],'ledger-1',hash,bad))
  await assert.rejects(()=>bank.prepareBankTransactions(original,'ledger-1',hash,[provenance[0],provenance[0]]))
})

test('suspected cross-document duplicates can be explicitly kept, exact sources cannot', async () => {
  const first=await prep(), second=await prep([row()],'ledger-1','b'.repeat(64))
  const snapshot=structuredClone({first,second,accounts})
  const kept=bank.mergeBankTransactions(first,second,accounts,second,{keepSuspectedDuplicates:true})
  assert.equal(kept.added,1)
  assert.equal(kept.suspectedDuplicates,1)
  assert.deepEqual(kept.suspectedDuplicateRows,second)
  assert.equal(bank.mergeBankTransactions(first,await prep(),accounts,undefined,{keepSuspectedDuplicates:true}).added,0)
  assert.deepEqual({first,second,accounts},snapshot)
})

test('bank collection roundtrip is allowlisted and does not imply free-text anonymity', () => {
  const ledger=bank.validateBankLedger([{...accounts[0],accountNumber:'123456789012'}],[tx({description:'Order 123456789012',password:'do not save'})],[{keyword:'Order',target:{kind:'pending'},rawText:'do not save'}])
  assert.equal(ledger.transactions[0].description,'Order 123456789012')
  assert.deepEqual(bank.validateBankLedger(ledger.accounts,ledger.transactions,ledger.rules),ledger)
  assert.equal(JSON.stringify(ledger).includes('do not save'),false)
  assert.equal(bank.parseBankTransactions([tx({amount:1e12})],accounts)[0].amount,1e12)
  const classified=tx({classification:{kind:'income',category:'投資回收款'}})
  assert.deepEqual(bank.classifyBankTransaction(classified),{kind:'income',category:'投資回收款'})
  assert.deepEqual(bank.classifyBankTransaction(tx(),[{keyword:'Example',target:{kind:'expense',category:'購物'}}]),{kind:'expense',category:'購物'})
  assert.deepEqual(bank.classifyBankTransaction(tx(),[]),{kind:'pending'})
})
