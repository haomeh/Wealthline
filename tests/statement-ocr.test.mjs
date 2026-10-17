import assert from 'node:assert/strict'
import {before,after,test,mock} from 'node:test'
import {createServer} from 'vite'
let server,createStatementOcr,takeStatementOcr,releaseStatementOcr,statementOcrWorkers
const originalWorker=globalThis.Worker
before(async()=>{
  server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  ;({createStatementOcr,takeStatementOcr,releaseStatementOcr,statementOcrWorkers}=await server.ssrLoadModule('/src/statementOcr.ts'))
})
after(async()=>{globalThis.Worker=originalWorker;await server.close()})
function fakeWorker(handler) {
  const calls=[],instances=[]
  globalThis.Worker=class {
    constructor(url){this.url=url;this.terminated=0;instances.push(this)}
    postMessage(message){calls.push(message);queueMicrotask(()=>handler(this,message))}
    terminate(){this.terminated++}
  }
  return {calls,instances}
}
const success=(worker,message)=>worker.onmessage({data:{jobId:message.jobId,status:'resolve',data:message.action==='recognize'?{text:'SYNTHETIC SHOP',confidence:95}:{}}})
test('OCR worker uses only local assets and returns text without storing images',async()=>{
  const {calls,instances}=fakeWorker(success)
  const ocr=await createStatementOcr(new AbortController().signal)
  assert.equal(instances[0].url,'/ocr/7.0.0/worker.min.js')
  assert.equal(calls[0].payload.options.corePath,'/ocr/7.0.0/core')
  assert.equal(calls[1].payload.options.langPath,'/ocr/7.0.0/lang')
  assert.equal(calls[1].payload.options.cacheMethod,'none')
  assert.deepEqual(await ocr.recognize(new Uint8Array([1,2,3])),{text:'SYNTHETIC SHOP',confidence:95})
  ocr.close();assert.ok(instances[0].terminated)
})
test('cancel during model loading terminates immediately and never sends an image',async()=>{
  const controller=new AbortController()
  const {calls,instances}=fakeWorker((worker,message)=>{if(message.action==='loadLanguage')controller.abort();else success(worker,message)})
  await assert.rejects(createStatementOcr(controller.signal),/已取消/)
  assert.ok(instances[0].terminated)
  assert.ok(calls.every(m=>m.action!=='recognize'))
})
test('cancel during recognition rejects pending work instead of leaving the parser hanging',async()=>{
  const controller=new AbortController()
  const {instances}=fakeWorker((worker,message)=>{if(message.action==='recognize')controller.abort();else success(worker,message)})
  const ocr=await createStatementOcr(controller.signal)
  await assert.rejects(ocr.recognize(new Uint8Array([1])),/已取消/)
  assert.ok(instances[0].terminated)
})
test('initialization failures are sanitized and worker is terminated',async()=>{
  const {instances}=fakeWorker((worker,message)=>worker.onmessage({data:{jobId:message.jobId,status:'reject',data:'private statement text should not leak'}}))
  await assert.rejects(createStatementOcr(new AbortController().signal),e=>/OCR/.test(e.message)&&!e.message.includes('private'))
  assert.ok(instances[0].terminated)
})


test('page layout recognition requests TSV and restores single-line mode for merchant crops',async()=>{
  const {calls}=fakeWorker(success)
  const ocr=await createStatementOcr(new AbortController().signal)
  await ocr.recognize(new Uint8Array([1]),true)
  assert.equal(calls.at(-2).payload.params.tessedit_pageseg_mode,'3')
  assert.equal(calls.at(-1).payload.output.tsv,true)
  await ocr.recognize(new Uint8Array([2]))
  assert.equal(calls.at(-2).payload.params.tessedit_pageseg_mode,'7')
  assert.equal(calls.at(-1).payload.output.tsv,false)
  ocr.close()
})

test('the files of one import run reuse a released OCR worker; other runs, abort and idle time do not',async()=>{
  const {calls,instances}=fakeWorker(success)
  const run=new AbortController(),other=new AbortController()
  const first=await takeStatementOcr(run.signal);releaseStatementOcr(run.signal,first)
  assert.equal(await takeStatementOcr(run.signal),first,'the next file of the run gets the loaded worker')
  assert.equal(calls.filter(m=>m.action==='loadLanguage').length,1)
  const second=await takeStatementOcr(run.signal);assert.notEqual(second,first,'a worker in use is never shared')
  // Four cores: three files of the run read at once, so three idle workers are kept.
  const cores=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{value:{hardwareConcurrency:4},configurable:true})
  try {
    assert.equal(statementOcrWorkers(),3)
    const third=await takeStatementOcr(run.signal),fourth=await takeStatementOcr(run.signal)
    for(const ocr of [first,second,third,fourth]) releaseStatementOcr(run.signal,ocr)
    assert.deepEqual(instances.slice(0,4).map(w=>!!w.terminated),[false,false,false,true],'up to three idle workers are kept')
    assert.equal(calls.filter(m=>m.action==='loadLanguage').length,4)
    const again=[await takeStatementOcr(run.signal),await takeStatementOcr(run.signal),await takeStatementOcr(run.signal)]
    assert.deepEqual(new Set(again),new Set([first,second,third]),'the next files get the idle workers');assert.equal(calls.filter(m=>m.action==='loadLanguage').length,4)
    for(const ocr of again) releaseStatementOcr(run.signal,ocr)
  } finally {Object.defineProperty(globalThis,'navigator',cores)}
  assert.notEqual(await takeStatementOcr(other.signal),first,'another run loads its own')
  run.abort();assert.ok(instances.slice(0,3).every(w=>w.terminated),'abort terminates the idle workers')
  await assert.rejects(takeStatementOcr(run.signal),/已取消/)
  const idle=new AbortController();mock.timers.enable({apis:['setTimeout']})
  try {const ocr=await takeStatementOcr(idle.signal);releaseStatementOcr(idle.signal,ocr);const worker=instances.at(-1)
    mock.timers.tick(9999);assert.equal(worker.terminated,0);mock.timers.tick(1);assert.ok(worker.terminated)
    assert.notEqual(await takeStatementOcr(idle.signal),ocr)} finally {mock.timers.reset()}
  other.abort();idle.abort()
})
test('files read at once follow the cores: one core free, two from six cores on, at most six',()=>{
  const cores=Object.getOwnPropertyDescriptor(globalThis,'navigator')
  try {
    const at=n=>{Object.defineProperty(globalThis,'navigator',{value:{hardwareConcurrency:n},configurable:true});return statementOcrWorkers()}
    assert.deepEqual([undefined,1,2,4,6,8,16].map(at),[1,1,1,3,4,6,6])
  } finally {Object.defineProperty(globalThis,'navigator',cores)}
})
