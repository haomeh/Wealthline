import { useMemo, useState } from 'react'
import { importPositionCsv, type ImportResult } from '../importSheet'
import { defaultCategory, type Position, type WealthData } from '../model'
import { securitiesPositionCsv, type SecuritiesStatementResult } from '../securitiesStatements'
import type { PreparedStatement } from '../statementKind'
import { fmt } from '../format'

// One securities account of the batch: the latest statement of each account supplies its cash and holdings.
interface Group { account: string; file: File; result: SecuritiesStatementResult; older: number }

function positionLine(p: Position) {
  if (p.type === 'cash') return `現金 · ${p.currency} ${fmt(p.quantity, 8)}`
  return `${p.symbol}${p.name ? ` ${p.name}` : ''} · 數量 ${fmt(p.quantity, 8)}${p.price ? ` · 單價 ${fmt(p.price, 8)} ${p.currency}` : ''}`
}

// The securities statements of an import batch: cash per currency and holdings go to the accounts page, replacing
// the same-named account's positions after a preview. Only the statement with the latest date of each account is
// used; trade-only files (no holdings in the file) are listed, not imported.
export function SecuritiesImport({ files, prepared, data, busy, onChange, onImported, onCancel }: {
  files: File[]; prepared: Map<File, PreparedStatement>; data: WealthData; busy: boolean
  onChange: (next: WealthData) => void; onImported: (message: string) => void; onCancel: () => void
}) {
  const [names, setNames] = useState<Record<string, string>>({})
  const { groups, notes } = useMemo(() => {
    const byAccount = new Map<string, Group>()
    const notes: string[] = []
    for (const file of files) {
      const p = prepared.get(file)
      if (p?.kind !== 'securities') { notes.push(`${file.name} · 沒有可匯入的內容`); continue }
      const r = p.result
      if (r.status === 'partial') {
        notes.push(`${file.name} · ${r.account} 的部分內容與對帳單自己印的合計對不上，未匯入：${r.warnings.map(w => `${w.code}${w.detail ? `（${w.detail}）` : ''}`).join('、')}`)
        continue
      }
      if (!securitiesPositionCsv(r)) {
        notes.push(`${file.name} · ${r.account} ${r.statementDate ?? ''}：${r.positions.length || r.cash.length ? '沒有現金或持倉可匯入' : '只有成交紀錄、沒有持倉與餘額'}，不匯入帳戶（成交紀錄的匯入尚未支援）`)
        continue
      }
      const held = byAccount.get(r.account)
      if (!held) byAccount.set(r.account, { account: r.account, file, result: r, older: 0 })
      else if ((r.statementDate ?? '') >= (held.result.statementDate ?? '')) byAccount.set(r.account, { account: r.account, file, result: r, older: held.older + 1 })
      else held.older++
    }
    return { groups: [...byAccount.values()], notes }
  }, [files, prepared])

  // Each account's import is previewed on the data the previous one produced, as the confirmation applies them.
  const previews = useMemo(() => {
    const out: { group: Group; name: string; result: ImportResult }[] = []
    let current = data
    for (const group of groups) {
      const name = (names[group.account] ?? group.account).trim() || group.account
      // A new account starts in the market's category; a same-named account keeps its own.
      const isNew = !current.accounts.some(a => a.name.trim().toUpperCase() === name.toUpperCase())
      const result = importPositionCsv(current, securitiesPositionCsv(group.result, name, isNew ? defaultCategory('investment', group.result.broker === '台新證券' ? 'TW' : 'SG') : ''))
      if (!result.errors.length && result.rows) current = result.data
      out.push({ group, name, result })
    }
    return out
  }, [groups, names, data])
  const blocked = previews.some(p => p.result.errors.length || !p.result.rows)
  const final = previews.reduce<WealthData>((d, p) => (p.result.errors.length || !p.result.rows ? d : p.result.data), data)

  return <section className="panel statement-import">
    <div className="panel-head"><h2>證券帳戶對帳單</h2><button disabled={busy} onClick={onCancel}>取消匯入</button></div>
    <p className="muted small">券商對帳單的現金餘額與持倉會匯入「帳戶」頁，同名帳戶的持倉整批換成對帳單的內容。每個帳戶只用日期最新的一份；確認後還要按「儲存變更」才會保存。</p>
    {notes.length > 0 && <ul className="notice" aria-label="未匯入的證券對帳單">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    {previews.map(({ group, result }) => <div key={group.account} className="statement-securities">
      <h3>{group.account} · {group.result.statementDate}</h3>
      <p className="muted small">來源：{group.file.name}{group.older ? `（另有 ${group.older} 份較舊的對帳單不匯入）` : ''}</p>
      <label className="field"><span>匯入到帳戶（可改成既有帳戶名稱）</span><input aria-label={`${group.account} 匯入到的帳戶名稱`} value={names[group.account] ?? group.account} maxLength={100} disabled={busy}
        onChange={e => setNames(n => ({ ...n, [group.account]: e.target.value }))} /></label>
      {result.errors.length > 0 && <div role="alert"><p>以下問題必須處理，尚未套用任何資料：</p><ul>{result.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></div>}
      {result.replaced.map((a) => <div key={a.id}>
        <strong>將取代「{a.name}」，刪除以下 {a.positions.length} 筆原持倉：</strong>
        <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
      </div>)}
      {!result.errors.length && result.data.accounts.filter((a) => !data.accounts.includes(a)).map((a) => <div key={a.id}>
        <strong>匯入後：{a.name} · {a.category} · {a.country || '未設定國家'}</strong>
        <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
      </div>)}
    </div>)}
    {!previews.length && <p role="status">沒有可匯入的證券帳戶內容。</p>}
    <div className="row">
      <button className="primary" disabled={busy || !previews.length || blocked} onClick={() => {
        if (busy || !previews.length || blocked) return
        onChange(final)
        const accounts = previews.map(p => p.name).join('、')
        onImported(`已匯入 ${previews.length} 個證券帳戶（${accounts}）的現金與持倉。請按「儲存變更」。`)
      }}>{previews.some(p => p.result.replaced.length) ? '確認匯入並取代上述資料' : '確認匯入'}</button>
    </div>
    {previews.some(p => p.result.data.accounts.some(a => a.positions.some(x => x.type === 'holding' && !x.price && !x.priceManual))) &&
      <p className="muted small">沒有單價的標的會在匯入後的下一次報價更新時查價。</p>}
  </section>
}
