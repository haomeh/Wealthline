import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BANK_PDF_ERRORS, pdfFormatError } from '../bankStatementErrors'
import { CSV_MAX_BYTES, CsvError, csvErrorText, csvImportType, decodeCsv, isCsvFile } from '../csvImport'
import { unlockStatementPasswords, type StatementPassword } from '../statementPasswords'
import type { StatementKind } from '../statementKind'
import { ImportSteps } from './ImportSteps'
import { REPO_URL } from '../site'
import { CsvGuide } from './CsvGuide'

/** Files sorted by kind, handed to the card and bank import screens in turn. `notes` is the detection report. */
export type ImportPlan = { card: File[]; bank: File[]; password: string; notes: string[] }
type Detected = { file: File; name: string; kind: StatementKind | 'unknown' | 'error'; bank?: string; reason?: string; choice: StatementKind | 'skip' }

const KIND_NAMES: Record<StatementKind, string> = { card: '信用卡帳單', bank: '銀行帳單' }
// Messages the reader and the format check own; anything else is not shown, as it may hold document text.
const KNOWN_ERRORS = new Set<string>(Object.values(BANK_PDF_ERRORS))
function plan(list: Detected[], password: string, note: string): ImportPlan {
  const pick = (kind: StatementKind) => list.filter(d => d.choice === kind).map(d => d.file)
  return { card: pick('card'), bank: pick('bank'), password, notes: [...(note ? [note] : []), ...list.map(planNote)] }
}
const errorText = (e: unknown) => e instanceof Error && KNOWN_ERRORS.has(e.message) ? e.message.replace('原始銀行對帳單', '原始帳單') : BANK_PDF_ERRORS.unreadable

function planNote(d: Detected): string {
  const bank = d.bank ? `（${d.bank}）` : ''
  if (d.kind === 'error') return `${d.name} · 無法讀取：${d.reason?.replace(/。$/, '')}。未匯入。`
  if (d.kind === 'unknown') return d.choice === 'skip' ? `${d.name} · 無法辨識${bank}：${d.reason}。未匯入。` : `${d.name} · 無法辨識${bank}，依你的選擇以${KIND_NAMES[d.choice]}匯入。`
  return `${d.name} · ${KIND_NAMES[d.kind]}${bank}${d.reason ? ` · ${d.reason}` : ''}`
}

// One import entry: each PDF's text layer decides card or bank, then the files go to that kind's import screen.
// A file that is neither, or both, stays here as 無法辨識 until the user picks a kind or leaves it out.
export function StatementImportEntry({ passwords, passwordScope, busy, onCancel, onContinue }: { passwords: StatementPassword[]; passwordScope?: string; busy: boolean; onCancel: () => void; onContinue: (plan: ImportPlan) => void }) {
  const [files, setFiles] = useState<File[]>([]), [password, setPassword] = useState(''), [detecting, setDetecting] = useState(false)
  const [progress, setProgress] = useState<{ processed: number; total: number; current: string } | null>(null)
  const [results, setResults] = useState<Detected[] | null>(null), [secret, setSecret] = useState(''), [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const locked = busy || detecting


  async function detect(e: FormEvent) {
    e.preventDefault()
    if (locked || !files.length) return
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    const typed = password; setPassword(''); setDetecting(true); setResults(null); setNotice('')
    const found: Detected[] = []
    let note = ''
    try {
      let stored: Awaited<ReturnType<typeof unlockStatementPasswords>> = { values: [], unavailable: 0 }
      try { stored = await unlockStatementPasswords(passwordScope ?? '', passwords) } catch { note = BANK_PDF_ERRORS.passwordStore }
      if (abort.signal.aborted) return
      if (stored.unavailable) note = `${stored.unavailable} 組密碼無法在此瀏覽器解鎖，請重新設定或手動輸入。`
      const candidates = [...stored.values, ...typed.split(',').map(x => x.trim()).filter(Boolean)]
      for (let index = 0; index < files.length; index++) {
        const file = files[index], name = file.name?.trim() || `檔案 ${index + 1}`
        setProgress({ processed: index, total: files.length, current: name })
        // A CSV says its kind in the type column; balances and holdings belong to the accounts page.
        if (isCsvFile(file)) {
          try {
            if (file.size > CSV_MAX_BYTES) throw new CsvError('CSV 超過 5 MB，請拆分後再匯入。')
            const type = csvImportType(decodeCsv(new Uint8Array(await file.arrayBuffer())))
            if (abort.signal.aborted) return
            found.push(type === 'position'
              ? { file, name, kind: 'error', reason: '這是帳戶餘額與持倉 CSV，請到「帳戶」頁的「從試算表或 CSV 匯入」', choice: 'skip' }
              : { file, name, kind: type, reason: 'CSV 檔', choice: type })
          } catch (error) {
            if (abort.signal.aborted) return
            found.push({ file, name, kind: 'error', reason: csvErrorText(error), choice: 'skip' })
          }
          continue
        }
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error(BANK_PDF_ERRORS.size)
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (abort.signal.aborted) return
          const formatError = pdfFormatError(bytes); if (formatError) throw new Error(formatError)
          let reader: typeof import('../statementKind')
          try { reader = await import('../statementKind') } catch { throw new Error(BANK_PDF_ERRORS.module) }
          const kind = await reader.detectStatementKind(bytes, candidates, abort.signal, name)
          if (abort.signal.aborted) return
          found.push({ file, name, ...kind, choice: kind.kind === 'unknown' ? 'skip' : kind.kind })
        } catch (error) {
          if (abort.signal.aborted) return
          found.push({ file, name, kind: 'error', reason: errorText(error), choice: 'skip' })
        }
      }
      setProgress({ processed: files.length, total: files.length, current: '' })
      // Detection is over: leaving the entry must not count as a cancel, which would close the shared PDF worker.
      if (controller.current === abort) controller.current = null
      setFiles([]); setNotice(note)
      // Every file recognized: go straight on. Otherwise the report stays for the user to read and decide.
      if (found.every(d => d.kind === 'card' || d.kind === 'bank')) onContinue(plan(found, typed, note))
      else { setResults(found); setSecret(typed) }
    } finally { if (!abort.signal.aborted) setDetecting(false) }
  }

  const next = results && plan(results, secret, notice)
  return <section className="panel statement-import statement-entry">
    <div className="panel-head"><h2>匯入帳單</h2><ImportSteps step={1} /><button onClick={() => { controller.current?.abort(); onCancel() }}>取消匯入</button></div>
    <p className="statement-privacy">信用卡帳單和銀行帳單可以一起選，會自動分辨；分不出來的檔案會先列出，不會自動匯入。檔案只在這個瀏覽器讀取，原始帳單不保存、不上傳。</p>
    {!results ? <form onSubmit={detect}>
      <fieldset className="statement-upload-fields" disabled={locked}>
        <label className="field statement-upload"><span>帳單 PDF 或 CSV（可選多份）</span><small className="muted">PDF 每份最多 20 MB</small><input aria-label="帳單 PDF" type="file" multiple accept=".pdf,application/pdf,.csv,text/csv" onChange={e => { const chosen = Array.from(e.target.files ?? []); setFiles(chosen); setPassword(''); setProgress(null); if (chosen.some(f => !isCsvFile(f))) void import('../statementKind').then(m => m.warmStatementReader()).catch(() => {}) }} /></label>
        <label className="field statement-password"><span>PDF 密碼（多組以逗號 , 分隔）</span><input aria-label="帳單 PDF 密碼" type="password" autoComplete="off" placeholder="未加密的帳單可留空" value={password} onChange={e => setPassword(e.target.value)} /><small className="muted">已設定的帳單密碼會自動套用。這裡輸入的只供本次匯入，不會保存。</small></label>
      </fieldset>
      <button className="primary" disabled={locked || !files.length}>{detecting ? '正在本機判斷類型…' : `開始匯入${files.length ? `（${files.length} 份）` : ''}`}</button>
    </form> : <section className="notice statement-entry-report" aria-label="帳單類型判斷結果">
      <h3>有檔案無法自動判斷</h3>
      <p className="muted small">無法辨識的檔案預設不匯入。確定是哪一種帳單時再選擇類型；選錯類型可能解析出錯誤金額。</p>
      {notice && <p>{notice}</p>}
      <ul>{results.map((d, i) => <li key={i}>
        <span>{planNote(d)}</span>
        {d.kind === 'unknown' && <label className="field"><span className="muted small">{d.name} 的類型</span><select aria-label={`${d.name} 的類型`} disabled={busy} value={d.choice} onChange={e => setResults(list => list && list.map((x, j) => j === i ? { ...x, choice: e.target.value as Detected['choice'] } : x))}><option value="skip">不匯入</option><option value="card">以信用卡帳單匯入</option><option value="bank">以銀行帳單匯入</option></select></label>}
      </li>)}</ul>
      <div className="row">
        <button type="button" disabled={busy} onClick={() => { setResults(null); setSecret(''); setProgress(null) }}>重新選擇帳單</button>
        <button type="button" className="primary" disabled={busy || !next || !(next.card.length + next.bank.length)} onClick={() => { if (next) { setSecret(''); onContinue(next) } }}>{next && next.card.length + next.bank.length ? `繼續匯入${next.card.length ? ` · 信用卡 ${next.card.length} 份` : ''}${next.bank.length ? ` · 銀行 ${next.bank.length} 份` : ''}` : '沒有可匯入的檔案'}</button>
      </div>
    </section>}
    {!results && !detecting && <CsvGuide kinds={['card', 'bank']} where="在上方「帳單 PDF 或 CSV」選擇檔案（可和 PDF 一起選）" />}
    {detecting && progress && <p role="status" aria-label="帳單類型判斷進度">正在本機判斷類型 · {progress.processed}／{progress.total} 份{progress.current && ` · ${progress.current}`}</p>}
    <details className="statement-help"><summary>怎麼判斷類型</summary><p className="muted small">讀得到已支援的銀行交易表（日期、摘要、支出／存入、餘額）就是銀行帳單；否則帳單上有信用卡帳單字樣（如「本期應繳總額」「最低應繳」「消費日／入帳日」）就是信用卡帳單。兩者都不是的檔案列為無法辨識，不會自動匯入。銀行與版型的支援範圍與各自的匯入畫面相同。CSV 依 type 欄：card 是信用卡消費，bank 是銀行流水，格式見 <a href={`${REPO_URL}/blob/main/docs/csv-import.md`} target="_blank" rel="noreferrer">CSV 匯入格式</a>。</p></details>
  </section>
}
