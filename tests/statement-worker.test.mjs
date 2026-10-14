// Shared pdf.js worker in src/statementDocument.ts: wedged or crashed workers and idle timers.
import assert from 'node:assert/strict'
import { before, after, test, mock } from 'node:test'
import { createServer } from 'vite'

// pdf.js mock: a PDFWorker records destroy(); getDocument tasks can model a wedged or crashed worker
// (no answer to GetDocRequest, so task.promise never settles and task.destroy() never settles).
const pdfMock = `
export const GlobalWorkerOptions={};export class PasswordException extends Error{};
export class PDFWorker{constructor(){const s=globalThis.__rv;s.workers.push(this);this.destroyed=0;this.promise=Promise.resolve()}destroy(){this.destroyed++}}
export function getDocument(options){const s=globalThis.__rv;s.options.push(options);let reject;
 const task={destroy:async()=>{s.destroyed++;if(s.wedged)return new Promise(()=>{});reject?.(new Error('destroyed'))}};
 task.promise=new Promise((resolve,fail)=>{reject=fail;if(s.wedged)return;queueMicrotask(()=>resolve({numPages:1,getMetadata:async()=>({info:{}}),getPage:async()=>({
  getViewport:()=>({width:612,height:864,convertToViewportPoint:(x,y)=>[x,864-y]}),isPureXfa:false,
  streamTextContent:()=>new ReadableStream({start(c){c.enqueue({items:[{str:'Synthetic',transform:[1,0,0,1,30,820],width:60,height:9}],styles:{},lang:null});c.close()}}),
  cleanup(){}})}))});
 return task}`
let server, doc
const reset = extra => (globalThis.__rv = { workers: [], options: [], destroyed: 0, wedged: false, ...extra })
const settle = () => new Promise(resolve => setImmediate(resolve))
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-statement-worker', configFile: false, envDir: false, ssr: { noExternal: ['pdfjs-dist'] }, server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    plugins: [{ name: 'statement-worker-pdf-mock', enforce: 'pre', resolveId(id) { if (id === 'pdfjs-dist/legacy/build/pdf.mjs') return '\0statement-worker-pdf' }, load(id) { if (id === '\0statement-worker-pdf') return pdfMock } }] })
})
// Each test gets a fresh module instance, so module-level worker state does not leak between tests.
async function fresh() { server.moduleGraph.invalidateAll(); doc = await server.ssrLoadModule('/src/statementDocument.ts') }
after(async () => { await server.close(); delete globalThis.__rv })

// Card and bank tabs run together, each with its own signal. A PDF wedges the shared worker;
// the user cancels both tabs and retries: the retry must get a new worker, not hang.
test('a wedged shared worker is retired once both concurrent imports are cancelled', async () => {
  await fresh()
  const state = reset({ wedged: true })
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const card = new AbortController(), bank = new AbortController()
    doc.openStatementDocument('credit-card', new Uint8Array([1]), '', card.signal).promise.catch(() => {})
    doc.openStatementDocument('bank', new Uint8Array([1]), '', bank.signal).promise.catch(() => {})
    assert.equal(state.workers.length, 1)
    card.abort(); await settle(); mock.timers.tick(1000); await settle()
    bank.abort(); await settle(); mock.timers.tick(1000); await settle()
    mock.timers.tick(60_000); await settle()
    // A new import after both cancels.
    const retry = new AbortController()
    doc.openStatementDocument('bank', new Uint8Array([1]), '', retry.signal).promise.catch(() => {})
    const used = state.options.at(-1).worker
    assert.notEqual(used, state.workers[0], 'the retry must not be sent to the wedged worker (it would hang with no error)')
  } finally { mock.timers.reset() }
})

// Only the card tab is cancelled while the bank tab is stuck: a retry must not join the wedged worker.
test('after an abort-destroy timeout the suspect worker receives no new documents', async () => {
  await fresh()
  const state = reset({ wedged: true })
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const card = new AbortController(), bank = new AbortController()
    doc.openStatementDocument('credit-card', new Uint8Array([1]), '', card.signal).promise.catch(() => {})
    doc.openStatementDocument('bank', new Uint8Array([1]), '', bank.signal).promise.catch(() => {})
    card.abort(); await settle(); mock.timers.tick(1000); await settle()
    const retry = new AbortController()
    doc.openStatementDocument('credit-card', new Uint8Array([1]), '', retry.signal).promise.catch(() => {})
    assert.notEqual(state.options.at(-1).worker, state.workers[0], 'a retry after a timed-out abort should get a fresh worker')
    bank.abort(); retry.abort(); await settle(); mock.timers.tick(5000)
  } finally { mock.timers.reset() }
})

// A pending idle close must not terminate a worker that a new document is using.
test('a pending idle close does not terminate a worker that a new document uses', async () => {
  await fresh()
  const state = reset({})
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const run = new AbortController()
    await doc.readBankDocument(new Uint8Array([1]), '', run.signal)
    mock.timers.tick(2500)
    state.wedged = true // the next document stays open
    doc.openStatementDocument('bank', new Uint8Array([1]), '', run.signal).promise.catch(() => {})
    mock.timers.tick(1000)
    assert.equal(state.workers[0].destroyed, 0, 'idle timer from the previous document closed the worker under an open document')
    state.wedged = false; run.abort(); await settle(); mock.timers.tick(2000)
  } finally { mock.timers.reset() }
})
