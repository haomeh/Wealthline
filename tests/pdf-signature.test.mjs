import assert from 'node:assert/strict'
import {before,after,test} from 'node:test'
import {readFile} from 'node:fs/promises'
import {createServer} from 'vite'
let server,errors
before(async()=>{
  server=await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  errors=await server.ssrLoadModule('/src/bankStatementErrors.ts')
})
after(()=>server.close())
const enc=text=>new TextEncoder().encode(text)
const join=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out}

test('PDF header is accepted anywhere in the first 1024 bytes, like PDF.js and Acrobat',()=>{
  for(const prefix of ['','﻿','\r\n  \n','Content-Type: application/pdf\r\n\r\n','x'.repeat(1019)])
    assert.equal(errors.pdfFormatError(enc(prefix+'%PDF-1.7\n')),undefined,JSON.stringify(prefix.slice(0,20)))
  assert.ok(errors.pdfFormatError(enc('x'.repeat(1020)+'%PDF-1.7\n')))
  assert.ok(errors.pdfFormatError(enc('%PDF')))
})

test('non-PDF files name only their coarse type with a stable code',()=>{
  const cases=[
    [new Uint8Array(),'BANK-FORMAT-EMPTY'],
    [new Uint8Array([0x50,0x4b,0x03,0x04,1,2,3]),'BANK-FORMAT-ZIP'],
    [enc('﻿\n<!DOCTYPE html><html><body>statement</body></html>'),'BANK-FORMAT-HTML'],
    [enc('<html><head><meta charset="utf-8"></head></html>'),'BANK-FORMAT-HTML'],
    [new Uint8Array([0xff,0xd8,0xff,0xe0,0,0]),'BANK-FORMAT-IMAGE'],
    [new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a]),'BANK-FORMAT-IMAGE'],
    [join(new Uint8Array([0,0,0,0x18]),enc('ftypheic'),new Uint8Array(8)),'BANK-FORMAT-IMAGE'],
    [new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1]),'BANK-FORMAT-OFFICE'],
    [enc('Received: from mail\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n'),'BANK-FORMAT-EMAIL'],
    [enc('BAD!!'),'BANK-FORMAT-TEXT'],
    [new Uint8Array(64).fill(1),'BANK-FORMAT〕'],
  ]
  for(const [bytes,code] of cases){
    const message=errors.pdfFormatError(bytes)
    assert.ok(message?.includes(code),`${code}: ${message}`)
    assert.match(message,/^檔案不是 PDF：/)
    // Fixed application messages only: they pass the diagnostic allowlist unchanged.
    assert.equal(errors.bankStatementErrorMessage(new Error(message),'fileRead'),message)
  }
  assert.ok(!errors.pdfFormatError(enc('<html>SECRET CUSTOMER</html>')).includes('SECRET'))
})

test('PDF.js opens an encrypted statement that has bytes before its header',async()=>{
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf=new Uint8Array(await readFile(new URL('./fixtures/synthetic-statement-encrypted.pdf',import.meta.url)))
  const bytes=join(enc('﻿\r\n'),pdf)
  assert.equal(errors.pdfFormatError(bytes),undefined)
  const task=getDocument({data:bytes,password:'fixture-password',stopAtErrors:true,verbosity:0,useWorkerFetch:false})
  try{
    const doc=await task.promise,page=await doc.getPage(1),text=await page.getTextContent()
    assert.ok(text.items.some(i=>/\d+\.\d{2}/.test(i.str)))
  }finally{await task.destroy()}
})
