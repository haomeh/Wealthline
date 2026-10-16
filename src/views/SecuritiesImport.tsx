import { useMemo, useState } from 'react'
import { importPositionCsv, type ImportResult } from '../importSheet'
import { defaultCategory, type Position, type WealthData } from '../model'
import { securitiesCash, securitiesPositionCsv, type SecuritiesStatementResult } from '../securitiesStatements'
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
    // The latest statement of each account decides: when it does not add up, the account is not imported at all,
    // so an older statement never replaces newer holdings.
    const latest = new Map<string, { file: File; result: SecuritiesStatementResult; older: number }>()
    const notes: string[] = []
    for (const file of files) {
      const p = prepared.get(file)
      if (p?.kind !== 'securities') { notes.push(`${file.name} · 沒有可匯入的內容`); continue }
      const r = p.result
      if (r.broker !== 'moomoo') {
        // Trade confirmations carry no holdings or balances.
        notes.push(`${file.name} · ${r.account} ${r.statementDate ?? ''}：這類對帳單只有成交紀錄、沒有持倉與餘額，不匯入帳戶（成交紀錄的匯入尚未支援）`)
        continue
      }
      const held = latest.get(r.account)
      if (!held) latest.set(r.account, { file, result: r, older: 0 })
      else if ((r.statementDate ?? '') >= (held.result.statementDate ?? '')) latest.set(r.account, { file, result: r, older: held.older + 1 })
      else held.older++
    }
    const groups: Group[] = []
    for (const [account, g] of latest) {
      const r = g.result
      if (r.status === 'partial') {
        notes.push(`${g.file.name} · ${account} ${r.statementDate ?? ''}：與對帳單自己印的合計對不上（${r.warnings.map(w => `${w.code}${w.detail ? `：${w.detail}` : ''}`).join('、')}），這個帳戶不匯入${g.older ? `；較舊的 ${g.older} 份也不會拿來取代` : ''}`)
      } else if (!securitiesPositionCsv(r)) {
        notes.push(`${g.file.name} · ${account} ${r.statementDate ?? ''}：沒有現金或持倉可匯入`)
      } else groups.push({ account, file: g.file, result: r, older: g.older })
    }
    return { groups, notes }
  }, [files, prepared])

  // Each account's import is previewed on the data the previous one produced, as the confirmation applies them.
  const previews = useMemo(() => {
    const out: { group: Group; name: string; result: ImportResult; before: WealthData; matched?: string }[] = []
    let current = data
    const claimed = new Set<string>()
    for (const group of groups) {
      // An investment account already named like the broker is the one to update: a new "moomoo (0936)" beside an
      // existing "Moomoo" would count the same holdings twice.
      // Only the accounts the user already had count, and each is the default for one statement only.
      const similar = data.accounts.filter(a => a.kind === 'investment' && a.name.toLowerCase().includes(group.result.broker.toLowerCase()))
      const matched = similar.length === 1 && !claimed.has(similar[0].id) ? similar[0].name : undefined
      if (matched) claimed.add(similar[0].id)
      const name = (names[group.account] ?? matched ?? group.account).trim() || group.account
      // A new account starts in the market's category; a same-named account keeps its own.
      const isNew = !current.accounts.some(a => a.name.trim().toUpperCase() === name.toUpperCase())
      const result = importPositionCsv(current, securitiesPositionCsv(group.result, name, isNew ? defaultCategory('investment', 'SG') : ''))
      out.push({ group, name, result, before: current, ...(names[group.account] === undefined && matched ? { matched } : {}) })
      if (!result.errors.length && result.rows) current = result.data
    }
    return out
  }, [groups, names, data])
  const blocked = previews.some(p => p.result.errors.length || !p.result.rows)
  const final = previews.reduce<WealthData>((d, p) => (p.result.errors.length || !p.result.rows ? d : p.result.data), data)

  return <section className="panel statement-import">
    <div className="panel-head"><h2>證券帳戶對帳單</h2><button disabled={busy} onClick={onCancel}>取消匯入</button></div>
    <p className="muted small">券商對帳單的現金餘額與持倉會匯入「帳戶」頁，同名帳戶的持倉整批換成對帳單的內容。每個帳戶只用日期最新的一份；確認後還要按「儲存變更」才會保存。</p>
    {notes.length > 0 && <ul className="notice" aria-label="未匯入的證券對帳單">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    {previews.map(({ group, result, before, matched }) => <div key={group.account} className="statement-securities">
      <h3>{group.account} · {group.result.statementDate}</h3>
      <p className="muted small">來源：{group.file.name}{group.older ? `（另有 ${group.older} 份較舊的對帳單不匯入）` : ''}</p>
      {matched && <p className="notice">已有投資帳戶「{matched}」，預設匯入到它並取代其持倉；要另建新帳戶請改下方的名稱。</p>}
      {group.result.inTransit.length > 0 && <p className="notice">在途的申購／贖回 {group.result.inTransit.length} 筆（{group.result.inTransit.map(t => `${t.type === 'Redemption' ? '贖回' : '申購'} ${t.currency} ${fmt(t.amount, 2)}`).join('、')}）已併入對應幣別的現金，總額才會和對帳單的淨資產一致。現金：{securitiesCash(group.result).map(c => `${c.currency} ${fmt(c.amount, 2)}`).join('、')}。</p>}
      <label className="field"><span>匯入到帳戶（可改成既有帳戶名稱）</span><input aria-label={`${group.account} 匯入到的帳戶名稱`} value={names[group.account] ?? matched ?? group.account} maxLength={100} disabled={busy}
        onChange={e => setNames(n => ({ ...n, [group.account]: e.target.value }))} /></label>
      {result.errors.length > 0 && <div role="alert"><p>以下問題必須處理，尚未套用任何資料：</p><ul>{result.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul></div>}
      {result.replaced.map((a) => <div key={a.id}>
        <strong>將取代「{a.name}」，刪除以下 {a.positions.length} 筆原持倉：</strong>
        <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
      </div>)}
      {!result.errors.length && result.data.accounts.filter((a) => !before.accounts.includes(a)).map((a) => <div key={a.id}>
        <strong>匯入後：{a.name} · {a.category} · {a.country || '未設定國家'}</strong>
        <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
      </div>)}
    </div>)}
    {!previews.length && <div role="status"><p>沒有可匯入的證券帳戶內容，未匯入任何資料。</p><button disabled={busy} onClick={() => onImported('沒有可匯入的證券帳戶內容，未匯入任何資料。')}>關閉這個分頁</button></div>}
    {previews.length > 0 && <div className="row">
      <button className="primary" disabled={busy || !previews.length || blocked} onClick={() => {
        if (busy || !previews.length || blocked) return
        onChange(final)
        const accounts = previews.map(p => p.name).join('、')
        onImported(`已匯入 ${previews.length} 個證券帳戶（${accounts}）的現金與持倉。請按「儲存變更」。`)
      }}>{previews.some(p => p.result.replaced.length) ? '確認匯入並取代上述資料' : '確認匯入'}</button>
    </div>}
    {previews.some(p => p.result.data.accounts.some(a => a.positions.some(x => x.type === 'holding' && !x.price && !x.priceManual))) &&
      <p className="muted small">沒有單價的標的會在匯入後的下一次報價更新時查價。</p>}
  </section>
}
