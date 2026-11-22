import { useMemo, useState } from 'react'
import { importPositionCsv, type ImportResult } from '../importSheet'
import { defaultCategory, type Position, type WealthData } from '../model'
import {
  importSecuritiesHistory,
  latestSecuritiesAccountDate,
  securitiesCash,
  securitiesPositionCsv,
  securitiesStatementItems,
  type NormalizedSecuritiesItem,
  type SecuritiesStatementResult,
} from '../securitiesStatements'
import type { PreparedStatement } from '../statementKind'
import { fmt } from '../format'
import { useCalendarNow } from '../useCalendarNow'

interface StatementEntry {
  file: File
  result: SecuritiesStatementResult
}

// One securities account of the batch: the latest statement may update current holdings (unless older than
// the account's existing data), and every valid dated statement records its closing positions in history.
interface Group {
  account: string
  file: File
  result: SecuritiesStatementResult
  /** All valid statements of this account in chronological order (oldest -> newest). */
  statements: StatementEntry[]
  older: number
}

function positionLine(p: Position) {
  if (p.type === 'cash') return `現金 · ${p.currency} ${fmt(p.quantity, 8)}`
  return `${p.symbol}${p.name ? ` ${p.name}` : ''} · 數量 ${fmt(p.quantity, 8)}${p.price ? ` · 單價 ${fmt(p.price, 8)} ${p.currency}` : ''}`
}

function itemLine(item: NormalizedSecuritiesItem) {
  if (item.type === 'cash') return `現金 · ${item.currency} ${fmt(item.quantity, 8)}`
  return `${item.symbol}${item.name ? ` ${item.name}` : ''} · 數量 ${fmt(item.quantity, 8)}${item.price ? ` · 單價 ${fmt(item.price, 8)} ${item.currency}` : ''}`
}

const fmtDate = (date: string) => date.replaceAll('-', '/')

// The securities statements of an import batch:
// - Every valid dated statement writes its closing cash & holdings into `history.quantityDays`.
// - Only the latest statement of each account may update current holdings in `accounts`, and ONLY when
//   it is not older than the account's existing records (preventing old monthly statements from wiping newer holdings).
export function SecuritiesImport({ files, prepared, data, busy, onChange, onImported, onCancel }: {
  files: File[]; prepared: Map<File, PreparedStatement>; data: WealthData; busy: boolean
  onChange: (next: WealthData) => void; onImported: (message: string) => void; onCancel: () => void
}) {
  const now = useCalendarNow()
  const [names, setNames] = useState<Record<string, string>>({})
  const [forceReplace, setForceReplace] = useState<Record<string, boolean>>({})

  const { groups, notes } = useMemo(() => {
    const byAccount = new Map<string, StatementEntry[]>()
    const notes: string[] = []
    for (const file of files) {
      const p = prepared.get(file)
      if (p?.kind !== 'securities') { notes.push(`${file.name} · 沒有可匯入的內容`); continue }
      const r = p.result
      if (r.broker !== 'moomoo') {
        notes.push(`${file.name} · ${r.account} ${r.statementDate ?? ''}：這類對帳單只有成交紀錄、沒有持倉與餘額，不匯入帳戶（成交紀錄的匯入尚未支援）`)
        continue
      }
      byAccount.set(r.account, [...(byAccount.get(r.account) ?? []), { file, result: r }])
    }
    const groups: Group[] = []
    for (const [account, list] of byAccount) {
      const sorted = [...list].sort((a, b) => (a.result.statementDate ?? '').localeCompare(b.result.statementDate ?? ''))
      const newest = sorted[sorted.length - 1]
      const olderCount = sorted.length - 1
      if (newest.result.status === 'partial') {
        notes.push(`${newest.file.name} · ${account} ${newest.result.statementDate ?? ''}：與對帳單自己印的合計對不上（${newest.result.warnings.map(w => `${w.code}${w.detail ? `：${w.detail}` : ''}`).join('、')}），這個帳戶不匯入${olderCount ? `；較舊的 ${olderCount} 份也不會拿來取代` : ''}`)
        continue
      }
      const valid: StatementEntry[] = []
      for (const entry of sorted) {
        if (entry.result.status === 'partial') {
          notes.push(`${entry.file.name} · ${account} ${entry.result.statementDate ?? ''}：與對帳單合計對不上（${entry.result.warnings.map(w => `${w.code}${w.detail ? `：${w.detail}` : ''}`).join('、')}），這份不匯入`)
        } else if (!securitiesPositionCsv(entry.result)) {
          notes.push(`${entry.file.name} · ${account} ${entry.result.statementDate ?? ''}：沒有現金或持倉可匯入`)
        } else {
          valid.push(entry)
        }
      }
      if (!valid.length) continue
      const latest = valid[valid.length - 1]
      groups.push({ account, file: latest.file, result: latest.result, statements: valid, older: valid.length - 1 })
    }
    return { groups, notes }
  }, [files, prepared])

  // Each account's import is previewed on the data the previous one produced, as the confirmation applies them.
  const previews = useMemo(() => {
    interface Preview {
      group: Group
      name: string
      before: WealthData
      nextData: WealthData
      result?: ImportResult
      matched?: string
      existingName?: string
      latestExistingDate?: string
      isOlderThanCurrent: boolean
      updateCurrent: boolean
      historyDates: string[]
      error?: string
    }
    const out: Preview[] = []
    let current = data
    const claimed = new Set<string>()
    for (const group of groups) {
      const similar = data.accounts.filter(a => a.kind === 'investment' && a.name.toLowerCase().includes(group.result.broker.toLowerCase()))
      const matched = similar.length === 1 && !claimed.has(similar[0].id) ? similar[0].name : undefined
      if (matched) claimed.add(similar[0].id)
      const name = (names[group.account] ?? matched ?? group.account).trim() || group.account
      const existing = current.accounts.find(a => a.name.trim().toUpperCase() === name.toUpperCase())
      const latestExistingDate = existing ? latestSecuritiesAccountDate(current, existing) : undefined
      const statementDate = group.result.statementDate
      const isOlderThanCurrent = Boolean(existing && latestExistingDate && statementDate && statementDate < latestExistingDate)
      const updateCurrent = !existing || !isOlderThanCurrent || !!forceReplace[group.account]

      let nextData = current
      let result: ImportResult | undefined
      let targetAccount = existing
      let error: string | undefined

      if (updateCurrent) {
        result = importPositionCsv(current, securitiesPositionCsv(group.result, name, existing ? '' : defaultCategory('investment', 'SG')))
        if (!result.errors.length && result.rows) {
          nextData = result.data
          targetAccount = nextData.accounts.find(a => a.name.trim().toUpperCase() === name.toUpperCase())
        }
      }

      const historyDates: string[] = []
      if (targetAccount && (!result || (!result.errors.length && result.rows))) {
        try {
          for (const entry of group.statements) {
            const beforeHistory = nextData
            nextData = importSecuritiesHistory(nextData, targetAccount, entry.result, now)
            if (nextData !== beforeHistory && entry.result.statementDate) historyDates.push(entry.result.statementDate)
          }
        } catch (e) {
          error = e instanceof Error ? e.message : '無法寫入歷史持倉紀錄'
        }
      }

      out.push({
        group,
        name,
        before: current,
        nextData,
        result,
        ...(names[group.account] === undefined && matched ? { matched } : {}),
        ...(existing && { existingName: existing.name }),
        ...(latestExistingDate && { latestExistingDate }),
        isOlderThanCurrent,
        updateCurrent,
        historyDates,
        ...(error && { error }),
      })
      if (!error && (!result || (!result.errors.length && result.rows))) current = nextData
    }
    return out
  }, [groups, names, forceReplace, data, now])

  const blocked = previews.some(p => !!p.error || (p.result && (p.result.errors.length > 0 || !p.result.rows)) || (!p.updateCurrent && !p.historyDates.length))
  const final = previews.length && !blocked ? previews[previews.length - 1].nextData : data
  const anyReplaced = previews.some(p => p.updateCurrent && (p.result?.replaced.length ?? 0) > 0)
  const anyCurrent = previews.some(p => p.updateCurrent)

  return <section className="panel statement-import">
    <div className="panel-head"><h2>證券帳戶對帳單</h2><button disabled={busy} onClick={onCancel}>取消匯入</button></div>
    <p className="muted small">
      券商對帳單會依對帳單日期寫入歷史持倉；若對帳單日期不早於帳戶現有紀錄，才會同步更新「帳戶」頁的目前持倉。確認後還要按「儲存變更」才會保存。
    </p>
    {notes.length > 0 && <ul className="notice" aria-label="未匯入的證券對帳單">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
    {previews.map(({ group, name, result, before, matched, existingName, latestExistingDate, isOlderThanCurrent, updateCurrent, historyDates, error }) => (
      <div key={group.account} className="statement-securities">
        <h3>{group.account} · {group.result.statementDate}</h3>
        <p className="muted small">
          來源：{group.file.name}
          {group.older ? `（同批另含 ${group.older} 份較早對帳單，將一併寫入對應日期的歷史紀錄）` : ''}
        </p>
        {matched && !isOlderThanCurrent && (
          <p className="notice">已有投資帳戶「{matched}」，預設匯入到它並取代其持倉；要另建新帳戶請改下方的名稱。</p>
        )}
        {isOlderThanCurrent && existingName && latestExistingDate && (
          <div className="notice">
            <p>
              <strong>此為歷史對帳單（{fmtDate(group.result.statementDate ?? '')}），早於「{existingName}」目前紀錄（最新至 {fmtDate(latestExistingDate)}）。</strong>
              {updateCurrent
                ? ' 你已勾選強制取代目前持倉，會覆蓋較新的資料。'
                : ' 預設只寫入該日期的歷史持倉紀錄，不會取代或刪除目前持倉。'}
            </p>
            <label className="completion-zero-toggle">
              <input
                type="checkbox"
                checked={!!forceReplace[group.account]}
                disabled={busy}
                onChange={(e) => setForceReplace((prev) => ({ ...prev, [group.account]: e.target.checked }))}
              />
              <span>仍要同時取代「{existingName}」的目前持倉（會覆蓋較新的資料）</span>
            </label>
          </div>
        )}
        {group.result.inTransit.length > 0 && (
          <p className="notice">
            在途的申購／贖回 {group.result.inTransit.length} 筆（{group.result.inTransit.map(t => `${t.type === 'Redemption' ? '贖回' : '申購'} ${t.currency} ${fmt(t.amount, 2)}`).join('、')}）已併入對應幣別的現金，總額才會和對帳單的淨資產一致。現金：{securitiesCash(group.result).map(c => `${c.currency} ${fmt(c.amount, 2)}`).join('、')}。
          </p>
        )}
        <label className="field">
          <span>匯入到帳戶（可改成既有帳戶名稱）</span>
          <input
            aria-label={`${group.account} 匯入到的帳戶名稱`}
            value={names[group.account] ?? matched ?? group.account}
            maxLength={100}
            disabled={busy}
            onChange={e => setNames(n => ({ ...n, [group.account]: e.target.value }))}
          />
        </label>
        {error && <div role="alert"><p>{error}</p></div>}
        {result && result.errors.length > 0 && (
          <div role="alert">
            <p>以下問題必須處理，尚未套用任何資料：</p>
            <ul>{result.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </div>
        )}
        {updateCurrent && result?.replaced.map((a) => (
          <div key={a.id}>
            <strong>將取代「{a.name}」，刪除以下 {a.positions.length} 筆原持倉：</strong>
            <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
          </div>
        ))}
        {updateCurrent && result && !result.errors.length && result.data.accounts.filter((a) => !before.accounts.includes(a)).map((a) => (
          <div key={a.id}>
            <strong>匯入後：{a.name} · {a.category} · {a.country || '未設定國家'}</strong>
            <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
          </div>
        ))}
        {!updateCurrent && historyDates.length > 0 && (
          <div>
            <strong>將寫入「{name}」歷史持倉（不更動目前持倉）：</strong>
            {group.statements.map((entry) => (
              <div key={entry.result.statementDate ?? entry.file.name}>
                <p className="muted small">{fmtDate(entry.result.statementDate ?? '')} · {entry.file.name}</p>
                <ul>{securitiesStatementItems(entry.result).map((item, idx) => <li key={idx}>{itemLine(item)}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
        {updateCurrent && historyDates.length > 0 && (
          <p className="muted small">同時寫入歷史持倉日期：{historyDates.map(fmtDate).join('、')}。</p>
        )}
      </div>
    ))}
    {!previews.length && (
      <div role="status">
        <p>沒有可匯入的證券帳戶內容，未匯入任何資料。</p>
        <button disabled={busy} onClick={() => onImported('沒有可匯入的證券帳戶內容，未匯入任何資料。')}>關閉這個分頁</button>
      </div>
    )}
    {previews.length > 0 && (
      <div className="row">
        <button
          className="primary"
          disabled={busy || !previews.length || blocked}
          onClick={() => {
            if (busy || !previews.length || blocked) return
            onChange(final)
            const accounts = previews.map(p => p.name).join('、')
            const historyOnly = !anyCurrent
            onImported(
              historyOnly
                ? `已匯入 ${previews.length} 個證券帳戶（${accounts}）的歷史持倉紀錄（目前持倉未變動）。請按「儲存變更」。`
                : `已匯入 ${previews.length} 個證券帳戶（${accounts}）的現金與持倉。請按「儲存變更」。`,
            )
          }}
        >
          {anyReplaced ? '確認匯入並取代上述資料' : anyCurrent ? '確認匯入' : '確認匯入歷史紀錄'}
        </button>
      </div>
    )}
    {anyCurrent && previews.some(p => p.result?.data.accounts.some(a => a.positions.some(x => x.type === 'holding' && !x.price && !x.priceManual))) && (
      <p className="muted small">沒有單價的標的會在匯入後的下一次報價更新時查價。</p>
    )}
  </section>
}
