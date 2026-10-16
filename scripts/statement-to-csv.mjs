#!/usr/bin/env node
// 本機驗證用：把銀行／信用卡帳單 PDF 轉成明細 CSV，不需開網頁。
// 與 App 使用同一套解析程式（src/statementKind.ts、src/statements.ts，經 Vite SSR 載入），不修改 App 程式。
//
//   node scripts/statement-to-csv.mjs [選項] <PDF 或資料夾>...
//   -o, --out <檔案>        寫入 CSV 檔（預設輸出到 stdout）
//   -p, --password <密碼>   帳單密碼，多組以逗號分隔（也可用環境變數 STATEMENT_PASSWORDS）
//       --env-file <檔案>   從該檔的 BANK_PASSWORDS 讀取密碼（只用來開檔，不會印出）
//       --month <YYYY-MM>   信用卡帳單辨識不出月份時的備用月份
//       --show-skipped      在 stderr 列出信用卡帳單中未轉成交易的文字列
//   -h, --help
//
// 證券帳戶對帳單（目前支援 moomoo 日結單／月結單、台新證券成交憑單／綜合月對帳單，src/securitiesStatements.ts）輸出 kind=position（現金餘額＋持倉，與 App 的
// CSV 匯入 type=position 相同：symbol 為空代表現金）、trade（成交）、cashflow（現金異動）、in-transit（在途申購／贖回）。
// 解析時會用對帳單自己印的合計交叉核對（持倉合計、成交合計與筆數、投資組合市值、現金餘額）；任何不符都標 status=partial。
// 需要 OCR 的帳單（匯豐信用卡的商家是圖片）在 Node 無法解析：CSV 會有一列 status=skipped 說明原因，不會靜默丟掉。
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string', short: 'o' }, 'env-file': { type: 'string' }, password: { type: 'string', short: 'p' }, month: { type: 'string' },
    'show-skipped': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  },
})
if (opt.help || !positionals.length) {
  console.error('用法：node scripts/statement-to-csv.mjs [-o out.csv] [-p 密碼[,密碼...]] [--month YYYY-MM] [--show-skipped] <PDF 或資料夾>...')
  process.exit(opt.help ? 0 : 1)
}
if (opt.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(opt.month)) { console.error('--month 格式須為 YYYY-MM'); process.exit(1) }

async function collect(path) {
  const info = await stat(path)
  if (!info.isDirectory()) return [path]
  const found = []
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) found.push(...await collect(child))
    else if (/\.pdf$/i.test(entry.name)) found.push(child)
  }
  return found
}
const files = []
for (const p of positionals) {
  try { files.push(...await collect(resolve(p))) } catch { console.error(`找不到：${p}`); process.exit(1) }
}
if (!files.length) { console.error('沒有找到任何 PDF'); process.exit(1) }

// App 程式在瀏覽器執行；這裡補上 Node 缺少的最小環境。OCR 用到的 Worker 不存在，OCR 路徑會乾淨地失敗。
globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null, toBlob() {} }) }
const nativeFetch = globalThis.fetch
// PDF.js 的字元映射表（cmaps）在 App 內是 Vite 資源網址；在這裡改讀 node_modules。
globalThis.fetch = (input, init) => {
  const path = String(input instanceof Request ? input.url : input).split('?')[0]
  if (path.startsWith('/node_modules/')) return readFile(join(root, path)).then(buf => new Response(buf))
  return nativeFetch(input, init)
}

const { createServer } = await import('vite')
const server = await createServer({ root, cacheDir: join(root, 'node_modules/.vite-statement-cli'), configFile: false, envDir: false, logLevel: 'error',
  server: { middlewareMode: true, watch: null, hmr: false, ws: false } })

const COLUMNS = ['file', 'kind', 'bank', 'date', 'description', 'currency', 'direction', 'amount', 'symbol', 'quantity', 'price', 'status', 'note']
const csvCell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csv = [COLUMNS.join(',')]
const emit = row => csv.push(COLUMNS.map(c => csvCell(row[c])).join(','))
const summary = []
const passwords = (opt.password ?? process.env.STATEMENT_PASSWORDS ?? '').split(',').map(p => p.trim()).filter(Boolean)
if (opt['env-file']) {
  // 只取 BANK_PASSWORDS；格式為逗號／空白分隔，或 JSON 陣列／物件。
  const raw = ((await readFile(resolve(opt['env-file']), 'utf8')).match(/^BANK_PASSWORDS=(.*)$/m)?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '')
  let list = raw.split(/[,;|\s]+/).filter(Boolean)
  try { const j = JSON.parse(raw); list = (Array.isArray(j) ? j : Object.values(j)).map(String) } catch { /* 非 JSON：維持分隔格式 */ }
  passwords.push(...list)
}

try {
  const { detectStatementKind } = await server.ssrLoadModule('/src/statementKind.ts')
  const { parseStatement, statementMetadata } = await server.ssrLoadModule('/src/statements.ts')
  const { hasPdfHeader } = await server.ssrLoadModule('/src/pdfSignature.ts')
  const { BANK_PDF_ERRORS } = await server.ssrLoadModule('/src/bankStatementErrors.ts')

  for (const path of files) {
    const file = basename(path)
    const skip = (note, extra = {}) => { emit({ file, status: 'skipped', note, ...extra }); summary.push(`略過  ${file}：${note}`) }
    const bytes = new Uint8Array(await readFile(path))
    if (!hasPdfHeader(bytes)) { skip(BANK_PDF_ERRORS.format.replace(/〔.*〕/, '')); continue }
    let detected
    try {
      detected = await detectStatementKind(bytes, passwords, new AbortController().signal, file)
    } catch (e) { skip(e instanceof Error ? e.message : '無法解析'); continue }
    const { kind, bank, reason, prepared } = detected

    if (kind === 'bank' && prepared?.kind === 'bank') {
      const { result } = prepared
      const status = result.status === 'recognized' ? 'ok' : 'partial'
      const warnings = [...result.warnings, ...result.sections.flatMap(s => s.warnings)].map(w => `${w.code}×${w.count}(p${w.page})`).join(' ')
      const note = [reason, result.rejectedCount && `${result.rejectedCount} 列未辨識`, warnings].filter(Boolean).join('；')
      let count = 0
      for (const section of result.sections) for (const row of section.rows) {
        count++
        emit({ file, kind: 'bank', bank: bank ?? section.bank, date: row.date, description: row.description, currency: row.currency || section.currency, direction: row.direction, amount: row.amount,
          status, note: [note, row.ambiguousNarration && '備註歸屬待確認'].filter(Boolean).join('；') })
      }
      if (!count) emit({ file, kind: 'bank', bank, status, note: note || '沒有交易列' })
      summary.push(`${status === 'ok' ? '完成' : '部分'}  ${file}：銀行帳單（${bank ?? result.bank}）${count} 筆${note ? `，${note}` : ''}`)
      continue
    }

    if (kind === 'card' && prepared?.kind === 'card') {
      if ('error' in prepared) {
        const needsOcr = /無法定位前期餘額／交易明細區段/.test(prepared.error)
        skip(needsOcr ? '需要 OCR（商家為圖片，僅瀏覽器版支援），本腳本不處理' : prepared.error, { kind: 'card', bank })
        continue
      }
      const pdf = prepared.read
      if (pdf.ocrError) { skip(`需要 OCR：${pdf.ocrError}`, { kind: 'card', bank }); continue }
      const info = statementMetadata(pdf.lines, pdf.title, file)
      const month = info.month || opt.month
      if (!month) { skip('無法辨識帳單月份，請用 --month YYYY-MM 指定', { kind: 'card', bank }); continue }
      const parsed = parseStatement(pdf.lines, month, info.currency || 'TWD', info.bank || file, pdf.transactionIndexes)
      const label = info.bank ? `${info.bank}${info.currency === 'SGD' ? ' (SG)' : ''}` : ''
      for (const r of parsed.rows) {
        // 卡片金額：正數為消費（debit），負數為退款／折抵（credit）。
        emit({ file, kind: 'card', bank: label, date: r.date, description: r.description, currency: r.currency,
          direction: r.amount < 0 ? 'credit' : 'debit', amount: Math.abs(r.amount), status: 'ok', note: `帳單月份 ${month}` })
      }
      if (!parsed.rows.length) emit({ file, kind: 'card', bank: label, status: 'partial', note: '沒有辨識到交易' })
      summary.push(`${parsed.rows.length ? '完成' : '部分'}  ${file}：信用卡帳單（${label || '未知發卡行'}，${month}）${parsed.rows.length} 筆，未轉成交易的文字列 ${parsed.skipped.length} 行`)
      if (opt['show-skipped']) for (const line of parsed.skipped) summary.push(`        未轉換：${line}`)
      continue
    }

    // 證券帳戶對帳單（moomoo、台新證券）：App 的類型偵測已認得，直接用它讀好的結果。
    {
      const securities = prepared?.kind === 'securities' ? prepared.result : undefined
      if (securities) {
        const s = securities, status = s.status === 'recognized' ? 'ok' : 'partial'
        const note = s.warnings.map(w => `${w.code}(p${w.page}${w.detail ? `:${w.detail}` : ''})`).join(' ')
        const common = { file, bank: s.account, date: s.statementDate, status, note }
        // type=position 與 App 的 CSV 匯入一致：symbol 為空代表現金餘額。
        for (const c of s.cash.filter(c => c.ending !== 0 || c.starting)) emit({ ...common, kind: 'position', currency: c.currency, quantity: c.ending, description: '現金餘額' })
        for (const p of s.positions) emit({ ...common, kind: 'position', symbol: p.symbol, description: p.name, currency: p.currency, quantity: p.quantity, price: p.price, amount: p.value })
        for (const t of s.trades) emit({ file, kind: 'trade', bank: s.account, date: t.date, description: `${t.name} ${t.time ?? ''}`.trim(), currency: t.currency, direction: /^(buy|現買|零買|資買|券買|買)/i.test(t.direction) ? 'buy' : /^(sell|現賣|零賣|資賣|券賣|賣)/i.test(t.direction) ? 'sell' : t.direction,
          amount: t.amount, symbol: t.symbol, quantity: t.quantity, price: t.price, status,
          note: [t.direction, t.fee !== undefined && `fee ${t.fee}`, t.tax !== undefined && `tax ${t.tax}`, t.net !== undefined && `net ${t.net}`].filter(Boolean).join('；') })
        // 申購／贖回在途：尚未進持倉也未進現金，單獨標示。
        for (const x of s.inTransit) emit({ file, kind: 'in-transit', bank: s.account, date: s.statementDate, description: `${x.type} ${x.name}`.trim(), currency: x.currency, direction: x.amount < 0 ? 'debit' : 'credit',
          amount: Math.abs(x.amount), symbol: x.symbol, status })
        for (const f of s.cashflows) emit({ file, kind: 'cashflow', bank: s.account, date: f.date, description: `${f.type} ${f.comment}`.trim(), currency: f.currency, direction: f.amount < 0 ? 'debit' : 'credit',
          amount: Math.abs(f.amount), status })
        if (s.netAssets) emit({ ...common, kind: 'info', description: '資產總淨額（對帳單未列持倉明細）', currency: s.netAssets.currency, amount: s.netAssets.value })
        if (s.closedCount) emit({ ...common, kind: 'info', note: [note, `${s.closedCount} 檔期間內已全數賣出（不列入持倉）`].filter(Boolean).join('；') })
        summary.push(`${status === 'ok' ? '完成' : '部分'}  ${file}：證券對帳單（${s.account}，${s.statementDate ?? '?'}）現金 ${s.cash.length}、持倉 ${s.positions.length}、成交 ${s.trades.length}、現金異動 ${s.cashflows.length}、在途 ${s.inTransit.length}${note ? `，${note}` : ''}`)
        continue
      }
    }
    skip(reason || `無法判斷帳單類型（${kind}）`, { kind, bank })
  }
} finally {
  await server.close()
}

const text = csv.join('\n') + '\n'
if (opt.out) await writeFile(resolve(opt.out), '﻿' + text)
else process.stdout.write(text)
console.error(summary.join('\n'))
console.error(`共 ${files.length} 份 PDF，${csv.length - 1} 列${opt.out ? `，已寫入 ${opt.out}` : ''}`)
