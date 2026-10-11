import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {createServer} from 'vite'
let server,core
before(async()=>{server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}});core=await server.ssrLoadModule('/src/bankTransactions.ts')})
after(()=>server?.close())
const accounts=[{id:'bank-one',label:'Example',bank:'Example'},{id:'bank-two',label:'Other',bank:'Example'}]
const row={date:'2031-04-08',description:'Example payment',currency:'TWD',direction:'debit',amount:42.5}
const prepare=(file,section='section-1',rows=[row],account='bank-one')=>core.prepareBankTransactions(rows,account,file.repeat(64),rows.map((_,i)=>({page:1,sectionKey:section,rowKey:`row-${i+1}`})))
test('equal rows in two sections of one mapped file remain legitimate with full context',async()=>{
 const a=await prepare('a'),b=await prepare('a','section-2'),all=[...a,...b];
 const r=core.mergeBankTransactions([],all,accounts,all);assert.equal(r.added,2);assert.equal(r.suspectedDuplicates,0)
 const sequential=core.mergeBankTransactions(a,b,accounts,all);assert.equal(sequential.added,1);assert.equal(sequential.suspectedDuplicates,0)
 // Without full batch context an existing equal row still requires review.
 assert.equal(core.mergeBankTransactions(a,b,accounts).suspectedDuplicates,1)
 const reimport=[...await prepare('a'),...await prepare('a','section-2')];const again=core.mergeBankTransactions(r.transactions,reimport,accounts,reimport);assert.equal(again.added,0);assert.equal(again.suspectedDuplicates,0)
})
test('batch duplicate files skipped, cross-document equal content still suspected and reviewable',async()=>{
 const a=await prepare('a'),copy=await prepare('a'),b=await prepare('b');
 const exact=core.mergeBankTransactions([],[...a,...copy],accounts);assert.equal(exact.added,1);assert.equal(exact.suspectedDuplicates,0)
 for(const existing of [[],a]){
  const incoming=existing.length?b:[...a,...b];const r=core.mergeBankTransactions(existing,incoming,accounts);assert.equal(r.suspectedDuplicates,1);assert.equal(r.added,existing.length?0:1)
  const kept=core.mergeBankTransactions(existing,incoming,accounts,incoming,{keepSuspectedDuplicates:true});assert.equal(kept.added,incoming.length)
 }
})
test('unproven persisted source hashes cannot bypass cross-document review',async()=>{
 const a=await prepare('a'),b=await prepare('b');b[0].sourceKey='bank-v1:'+ 'f'.repeat(64);
 const r=core.mergeBankTransactions([],[...a,...b],accounts);assert.equal(r.added,1);assert.equal(r.suspectedDuplicates,1)
})
test('repeated equal rows and opposite directions or accounts retain separate identities',async()=>{
 const repeated=await prepare('a','section-1',[row,row]);assert.equal(core.mergeBankTransactions([],repeated,accounts).added,2)
 const opposite=await prepare('b','section-1',[{...row,direction:'credit'}]);const counterpart=await prepare('a','section-2',[row],'bank-two');const all=[...repeated,...opposite,...counterpart];const r=core.mergeBankTransactions([],all,accounts);assert.equal(r.added,4);assert.equal(r.suspectedDuplicates,0)
})
