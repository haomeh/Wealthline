import { PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { openStatementDocument, type StatementPageText, type StatementPdf } from './statementDocument'
import { readStatementText } from './statementText'
import { hsbcMerchantRegions, hsbcSgPage, hsbcTransactionBounds, ocrMerchantLine, statementMetadata, taishinCardPage, textLines, textRows } from './statements'

export type StatementPdfRead = {lines:string[];title:string;ocrUsed:boolean;ocrError?:string;transactionIndexes?:number[]}

export async function readStatementPdf(bytes: Uint8Array, password:string | readonly string[], signal:AbortSignal, fileName = '', onProgress?:(message:string)=>void): Promise<StatementPdfRead> {
  const task = openStatementDocument('credit-card',bytes,password,signal)
  const cancel = () => {void task.destroy()}
  signal.addEventListener('abort',cancel,{once:true})
  if(signal.aborted) {cancel();throw new Error('已取消解析')}
  try {
    return await readStatementPages(await task.promise,signal,fileName,onProgress)
  } catch(e) {
    throw statementPdfError(e)
  } finally {
    signal.removeEventListener('abort',cancel)
    await task.destroy()
  }
}

/** The message a failed card statement read reports: its own messages, else a generic one (PDF errors may hold document text). */
export function statementPdfError(e:unknown):Error {
  if(e instanceof PasswordException) return new Error('帳單需要密碼，或密碼不正確。請重新輸入。')
  return new Error(e instanceof Error && /帳單|PDF 沒有|已取消/.test(e.message) ? e.message : '無法讀取此 PDF，請確認檔案完整且為支援的文字帳單。')
}

/**
 * Card statement lines from an open document. `texts` is each page's text when it was already read
 * (the import entry reads it once to decide the kind); otherwise each page's text is read here.
 * Errors are raw: callers map them with `statementPdfError`. The caller destroys the document.
 */
export async function readStatementPages(pdf:StatementPdf, signal:AbortSignal, fileName = '', onProgress?:(message:string)=>void, texts?:readonly StatementPageText[]): Promise<StatementPdfRead> {
  let ocr:Awaited<ReturnType<typeof import('./statementOcr').createStatementOcr>> | undefined
  let ocrModule:typeof import('./statementOcr') | undefined
  const closeOcr = () => ocr?.close()
  signal.addEventListener('abort',closeOcr,{once:true})
  try {
    if(signal.aborted) throw new Error('已取消解析')
    if(pdf.numPages > 100) throw new Error('帳單超過 100 頁，請拆分後再匯入')
    const metadata = await pdf.getMetadata().catch(()=>null)
    const info = metadata?.info as {Title?:unknown} | undefined
    const title = typeof info?.Title === 'string' ? info.Title : ''
    let bank=statementMetadata([],title,fileName).bank
    const lines:string[] = [], transactionIndexes:number[] = []
    let scoped=false,singapore=false,taishinAmountX:number|undefined
    let ocrUsed=false,ocrError:string|undefined
    for(let i=1;i<=pdf.numPages;i++) {
      if(signal.aborted) throw new Error('已取消解析')
      const at=`第 ${i}／${pdf.numPages} 頁`
      onProgress?.(`讀取文字 · ${at}`)
      const page = await pdf.getPage(i)
      const text = texts?.[i-1] ?? await readStatementText(page)
      let pageLines=textLines(text.items)
      let allowed=pageLines.map((_,index)=>index)
      const pageInfo=statementMetadata(pageLines,title,fileName)
      bank ??= pageInfo.bank
      singapore ||= pageInfo.currency === 'SGD'
      const sg=bank === '匯豐' ? hsbcSgPage(text.items) : undefined
      if(sg) {pageLines=sg.lines;allowed=sg.transactionIndexes;scoped=true}
      else if(bank === '台新') {
        // Pages without the transaction table (summary, notices) carry no transactions.
        const taishin=taishinCardPage(text.items,taishinAmountX)
        allowed=taishin?.transactionIndexes ?? [];scoped=true
        if(taishin) {pageLines=taishin.lines;taishinAmountX=taishin.amountX}
      }
      else if(bank === '匯豐' && singapore) {allowed=[];scoped=true}
      else if(bank === '匯豐') {
        allowed=[];scoped=true
        const regions=hsbcMerchantRegions(text.items)
        const candidates=textRows(text.items).filter(row=>/^\d{1,2}[/.-]\d{1,2}\s+\d{1,2}[/.-]\d{1,2}(?:\s|$)/.test(row.items.map(i=>i.str).join(' ')))
        if(candidates.length) {
          let scopeReady=false
          const canvas=document.createElement('canvas')
          try {
            onProgress?.(`正在載入本機 OCR（英文／繁中）· ${at}`)
            if(!ocr) {ocrModule??=await import('./statementOcr');ocr=await ocrModule.takeStatementOcr(signal)}
            if(signal.aborted) throw new Error('已取消解析')
            const base=page.getViewport({scale:1})
            const scale=Math.min(4,4096/Math.max(base.width,base.height),Math.sqrt(16_000_000/(base.width*base.height)))
            const viewport=page.getViewport({scale})
            canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
            const context=canvas.getContext('2d')
            if(!context) throw new Error('OCR 無法建立圖片，請手動補上商家')
            const render=page.render({canvas,canvasContext:context,viewport})
            const abortRender=()=>render.cancel()
            signal.addEventListener('abort',abortRender,{once:true})
            try {await render.promise} finally {signal.removeEventListener('abort',abortRender)}
            onProgress?.(`正在本機定位匯豐交易區段 · ${at}`)
            const transactionTops=candidates.map(row=>viewport.transform[3]*(row.y+9.5)+viewport.transform[5])
            const textLayout='header\n'+textRows(text.items).map((row,index)=>[
              5,1,1,1,index,1,0,viewport.transform[3]*(row.y+9.5)+viewport.transform[5],1,13*scale,100,row.items.map(i=>i.str).join(' ')
            ].join('\t')).join('\n')
            let bounds=hsbcTransactionBounds(textLayout,transactionTops)
            if(!bounds) {
              onProgress?.(`正在本機 OCR 整頁定位交易區段 · ${at}（較慢）`)
              const pageBlob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('OCR 無法讀取圖片')),'image/png'))
              const layout=await ocr.recognize(new Uint8Array(await pageBlob.arrayBuffer()),true)
              bounds=hsbcTransactionBounds(layout.tsv ?? '',transactionTops)
            }
            if(!bounds) throw new Error('帳單無法定位前期餘額／交易明細區段，請對照原帳單；尚未匯入任何資料')
            allowed=textRows(text.items).flatMap((row,index)=>{
              const y=viewport.transform[3]*row.y+viewport.transform[5]
              return y > bounds.top && y < bounds.bottom ? [index] : []
            })
            scoped=true;scopeReady=true
            const active=regions.filter(r=>allowed.includes(r.index))
            for(let j=0;j<active.length;j++) {
              if(signal.aborted) throw new Error('已取消解析')
              onProgress?.(`正在本機辨識商家 · ${at} · ${j+1}／${active.length} 筆`)
              const region=active[j]
              const [a,b,c,d,e,f]=viewport.transform
              const [[x1,y1],[x2,y2]]=[[region.left,region.bottom],[region.right,region.top]].map(([x,y])=>[a*x+c*y+e,b*x+d*y+f])
              const crop=document.createElement('canvas')
              try {
                crop.width=Math.ceil(Math.abs(x2-x1))+20;crop.height=Math.ceil(Math.abs(y2-y1))+20
                const cropped=crop.getContext('2d')
                if(!cropped) throw new Error('OCR 無法建立圖片，請手動補上商家')
                cropped.fillStyle='#fff';cropped.fillRect(0,0,crop.width,crop.height)
                cropped.drawImage(canvas,Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1),10,10,crop.width-20,crop.height-20)
                const blob=await new Promise<Blob>((resolve,reject)=>crop.toBlob(b=>b?resolve(b):reject(new Error('OCR 無法讀取圖片')),'image/png'))
                const recognized=await ocr.recognize(new Uint8Array(await blob.arrayBuffer()))
                const enriched=ocrMerchantLine(region.line,recognized.text,recognized.confidence)
                pageLines[region.index]=enriched
                ocrUsed=true
              } finally {crop.width=0;crop.height=0}
            }
          } catch(e) {
            if(signal.aborted) throw new Error('已取消解析')
            // A worker that failed is not passed on to the next file.
            ocr?.close();ocr=undefined
            if(!scopeReady) throw new Error('帳單無法定位前期餘額／交易明細區段，請重新解析或對照原帳單；尚未匯入任何資料')
            ocrError=e instanceof Error && /^OCR /.test(e.message)?e.message:'OCR 未完成，請手動補上商家並核對繳款'
          } finally {canvas.width=0;canvas.height=0}
        }
      }
      transactionIndexes.push(...allowed.map(index=>lines.length+index))
      lines.push(...pageLines)
      page.cleanup()
      if(lines.join('').length > 500_000) throw new Error('帳單文字過多，請拆分後再匯入')
    }
    if(!lines.length) throw new Error('此 PDF 沒有可讀取的文字。第一版暫不支援掃描／圖片帳單。')
    return {lines,title,ocrUsed,ocrError,...(scoped && {transactionIndexes})}
  } finally {
    // A working OCR worker goes on to the next file of this import run.
    if(ocr && ocrModule) ocrModule.releaseStatementOcr(signal,ocr)
    else ocr?.close()
    signal.removeEventListener('abort',closeOcr)
  }
}
