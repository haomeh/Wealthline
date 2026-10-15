// OCR worker reuse across the HSBC files of one run (src/statementPdf.ts + src/statementOcr.ts).
import assert from 'node:assert/strict'
import { before, after, test, mock } from 'node:test'
import { createServer } from 'vite'

const pdfMock = `
export const GlobalWorkerOptions={};export class PasswordException extends Error{};
export class PDFWorker{constructor(){this.promise=Promise.resolve()}destroy(){}}
export function getDocument(){const task={destroy:async()=>{}};
 const page={getViewport:({scale})=>({width:600*scale,height:800*scale,transform:[scale,0,0,-scale,0,800*scale]}),
  render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){}};
 task.promise=Promise.resolve({numPages:1,getMetadata:async()=>({info:{Title:'HSBC'}}),getPage:async()=>page});return task}`
// Only the HSBC branch matters here; the parsing helpers are stubbed so the test drives OCR alone.
const statementsMock = `
export function statementPasswordHandler(){return update=>update(new Error('no password'))}
export function statementMetadata(){return {bank:'匯豐'}}
export function hsbcSgPage(){return undefined}
export function taishinCardPage(){return undefined}
export function textLines(items){return items.map(i=>i.str)}
export function textRows(items){return items.map((i,n)=>({y:100+n*20,items:[i]}))}
export function hsbcMerchantRegions(items){return items.map((i,index)=>({index,left:50,right:200,top:110,bottom:95,line:i.str}))}
export function hsbcTransactionBounds(layout){return globalThis.__ocrCase.boundsFromText||layout.startsWith('OCR-TSV')?{top:-1e9,bottom:1e9}:undefined}
export function ocrMerchantLine(line,text){return line+' '+text}`
const textMock = `export async function readStatementText(){return {items:[{str:'09/01 09/02 100'}],styles:{},lang:null}}`
let server, card
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-statement-ocr-reuse', configFile: false, envDir: false, ssr: { noExternal: ['pdfjs-dist'] }, server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    plugins: [{ name: 'statement-ocr-reuse-mocks', enforce: 'pre', resolveId(id, importer) {
      if (id === 'pdfjs-dist/legacy/build/pdf.mjs') return '\0ocr-reuse-pdf'
      if (importer?.includes('/src/') && id === './statements') return '\0ocr-reuse-statements'
      if (importer?.includes('/src/') && id === './statementText') return '\0ocr-reuse-text'
    }, load(id) { if (id === '\0ocr-reuse-pdf') return pdfMock; if (id === '\0ocr-reuse-statements') return statementsMock; if (id === '\0ocr-reuse-text') return textMock } }] })
  card = await server.ssrLoadModule('/src/statementPdf.ts')
  // Load the OCR module now: vite's module runner uses setTimeout, which the test mocks.
  await server.ssrLoadModule('/src/statementOcr.ts')
})
after(async () => { await server.close(); delete globalThis.document; delete globalThis.__ocrCase })

function fakeTesseract() {
  const instances = []
  globalThis.Worker = class {
    constructor(url) { this.url = url; this.terminated = 0; this.pending = undefined; instances.push(this) }
    postMessage(m) {
      if (this.terminated) return // a terminated worker never answers
      if (m.action === 'recognize' && m.payload.output.tsv && globalThis.__ocrCase.layoutHangs) { this.pending = m; return } // slow device: no answer
      queueMicrotask(() => this.onmessage({ data: { jobId: m.jobId, status: 'resolve', data: m.action === 'recognize' ? (m.payload.output.tsv ? { text: '', confidence: 90, tsv: 'OCR-TSV' } : { text: 'SYNTHETIC SHOP', confidence: 95 }) : {} } }))
    }
    terminate() { this.terminated++ }
  }
  return instances
}
const canvas = () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: '' }), toBlob: cb => cb(new Blob(['png'])) })
const settle = async (n = 50) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)) }

test('a worker that timed out on the layout OCR is not reused by the next HSBC file of the run', async () => {
  globalThis.document = { createElement: () => canvas() }
  const instances = fakeTesseract()
  const run = new AbortController()
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    // File 1: the text layer cannot place the section, the layout OCR never answers (120 s timeout).
    globalThis.__ocrCase = { boundsFromText: false, layoutHangs: true }
    const first = card.readStatementPdf(new Uint8Array([1]), '', run.signal, 'hsbc-2026-04-a.pdf').then(r => ({ r }), e => ({ e }))
    await settle(); mock.timers.tick(120_000); await settle()
    const one = await first
    assert.match(one.e?.message ?? '', /無法定位/, 'file 1 fails: section not located')
    assert.ok(instances[0].terminated, 'the OCR timeout terminated the worker')
    // File 2: the text layer places the section; merchants are read by OCR.
    globalThis.__ocrCase = { boundsFromText: true, layoutHangs: false }
    const second = card.readStatementPdf(new Uint8Array([1]), '', run.signal, 'hsbc-2026-04-b.pdf')
    await settle(); mock.timers.tick(120_000); await settle()
    const two = await second
    assert.equal(instances.length, 2, `file 2 should load a fresh OCR worker; it reused the terminated one (ocrError: ${two.ocrError})`)
    assert.equal(two.ocrUsed, true)
    assert.equal(two.ocrError, undefined)
  } finally { mock.timers.reset(); run.abort() }
})

test('the next HSBC file of the run reuses a working OCR worker', async () => {
  globalThis.document = { createElement: () => canvas() }
  const instances = fakeTesseract()
  const run = new AbortController()
  try {
    globalThis.__ocrCase = { boundsFromText: true, layoutHangs: false }
    const one = await card.readStatementPdf(new Uint8Array([1]), '', run.signal, 'hsbc-2026-04-a.pdf')
    const two = await card.readStatementPdf(new Uint8Array([1]), '', run.signal, 'hsbc-2026-04-b.pdf')
    assert.equal(instances.length, 1, 'one OCR worker for both files')
    assert.deepEqual(two, one)
    assert.equal(instances[0].terminated, 0)
    run.abort(); assert.ok(instances[0].terminated, 'abort terminates the parked worker')
  } finally { run.abort() }
})
