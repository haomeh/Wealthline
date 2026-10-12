import { accountLabel } from '../model'
import { ActionIcon } from './ActionIcon'
import { removalMessage } from '../historyCompletion'
import { useCalendarNow } from '../useCalendarNow'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useHistoricalValuations } from '../useHistoricalValuations'
import { fmt } from '../format'
import { localDate, snapshotOf, totalPoints, type Change } from '../history'
import { type WealthData } from '../model'
import { displaySymbol } from '../quotes'
import { LiabilityChangeRow } from './LiabilityChange'
import { filledNote } from './historySeries'
import { QuantityHistory, QuantityRecord, type QuantityEditRequest } from './QuantityHistory'
import { instrumentKey } from '../quantityHistory'


interface Props {
  initialDate?: string
  data: WealthData
  dirty: boolean
  busy: boolean
  onSave: () => void
  onChange: (d: WealthData) => void
  onOpenAccount: (id: string) => void
}

export function HistoryView({ initialDate, data, dirty, busy, onSave, onChange, onOpenAccount }: Props) {
  const historical = useHistoricalValuations(data)
  const [sourceDate, setSourceDate] = useState(initialDate ?? '')
  const sourcePanel = useRef<HTMLElement>(null)
  const [visibleDays, setVisibleDays] = useState(30)
  const [accountFilter, setAccountFilter] = useState('')
  const now = useCalendarNow()
  const [quantityRequest,setQuantityRequest] = useState<QuantityEditRequest>()
  const { snapshots: saved, changes } = data.history

  // Today is always shown with the current numbers; saving records it.
  const today = snapshotOf({ ...data, liabilities: data.liabilities ?? [] }, now)
  const savedToday = saved.some((s) => s.date === today.date)
  const points = totalPoints(historical.data, now)
  const sourcePoint = points.find(p => p.date === sourceDate) ?? points.at(-1)
  const sourceDay = sourcePoint && (sourcePoint.manual || sourcePoint.periodDerived) ? historical.data.history.valuedQuantityDays?.find(d => d.date === sourcePoint.date) ?? historical.data.history.quantityDays?.find(d => d.date === sourcePoint.date) : undefined

  // Opened for one day (from the overview): bring that day's details and edit buttons into view.
  useEffect(() => {
    if (initialDate) { sourcePanel.current?.scrollIntoView?.({ block: 'start' }); sourcePanel.current?.focus() }
  }, [initialDate])

  // Accounts that have since been deleted keep their name from the last snapshot they appear in.
  const dayChanges = sourcePoint ? [...changes].filter((c) => localDate(c.at) === sourcePoint.date).sort((a, b) => b.at.localeCompare(a.at)) : []
  const accountNames = new Map<string, string>()
  for (const s of points) for (const a of s.accounts) accountNames.set(a.id, a.name)

  return (
    <div className="history-page history-management">
      <div className="page-head history-heading">
        <div>
          <h2>歷史明細</h2>
          <p className="muted">逐日查看總覽的資料明細與估值來源，補登或修正過去的持有數量。</p>
        </div>
        {!savedToday && !dirty && (data.accounts.length > 0 || !!data.liabilities?.length) && (
          <button className="primary" onClick={onSave} disabled={busy}>
            記錄今天的資產
          </button>
        )}
      </div>

      {dirty && <p className="notice">請先儲存或捨棄其他未儲存修改，再編輯歷史。</p>}
      <section className="history-source" aria-label="歷史資料與行情來源">
        <div className="history-source-head"><h3>資料與行情</h3>{!!(data.history.quantityDays?.length || data.history.holdingPeriods?.length) && <button disabled={historical.loading} onClick={historical.refresh}>{historical.loading ? '查詢歷史行情中…' : '重新查詢歷史行情'}</button>}</div>
        <div className="history-source-notes">
          <p><strong>紀錄規則</strong><span>原始快照保留原值；期間推算補上沒有快照的日期，單日補登優先。</span></p>
          <p><strong>市場來源</strong><span>價格與匯率採 Yahoo 實際行情日期，可能延遲。缺價或缺匯率保持未知，不使用儲存價格代替。</span></p>
        </div>
        {historical.omittedDays > 0 && <p className="muted small">總覽時間線略過 {historical.omittedDays} 個沒有原始紀錄、且持倉數量不足的推算日；不代表資產為零。明確未知及缺少行情的日期仍保留缺口。</p>}
        {historical.status && <p className="muted small" aria-live="polite">{historical.status}</p>}
        {historical.error && <p role="alert" className="banner error">{historical.error}</p>}
      </section>
      {sourcePoint && <div className="tiles history-day-tiles">
        <section className="panel deep tile-stat span-2" aria-label="當日資產">
          <span>{sourcePoint.date.replace(/-/g, '/')} · 總資產 · TWD</span>
          <strong>{sourcePoint.total === null ? '資料不完整' : fmt(sourcePoint.total, 0)}</strong>
          <small>淨資產 {money(sourcePoint.netWorth)} · 總負債 {money(sourcePoint.liabilityTotal)}{sourcePoint.liabilityEstimated ? '（預估）' : ''}</small>
        </section>
        <section className="panel span-2 history-day-changes" aria-label="當日異動">
          <h3>這天的異動</h3>
          {dayChanges.length ? <ul>{dayChanges.slice(0, 4).map((c, i) => <ChangeRow key={`${c.at}-${i}`} c={c} showAccount />)}</ul>
            : <p className="muted small">這天沒有異動紀錄。若當時的持倉不同，可在下方每日紀錄按「編輯數量」補登這天。</p>}
          {dayChanges.length > 4 && <p className="muted small">另有 {dayChanges.length - 4} 筆，見下方異動紀錄。</p>}
        </section>
      </div>}
      {sourcePoint && <section ref={sourcePanel} className="panel" aria-label="快照資料明細" tabIndex={-1}>
        <div className="panel-head"><h3>快照資料明細</h3><label className="field"><span>明細日期</span><select value={sourcePoint.date} onChange={e => setSourceDate(e.target.value)}>{[...points].reverse().map(p => <option key={p.date} value={p.date}>{p.date}</option>)}</select></label></div>
        {initialDate && !points.some(p => p.date === initialDate) && <p className="notice">{initialDate} 沒有可展示的快照，先顯示最近紀錄。</p>}
        <p className="muted">{sourcePoint.periodDerived ? '持有期間推算' : sourcePoint.manual ? '單日補登／完整回補' : sourcePoint.date === today.date ? '目前餘額／當日快照' : '原始每日快照'} · {sourcePoint.date} · 總資產 {sourcePoint.total === null ? '資料不完整' : `NT$ ${fmt(sourcePoint.total, 0)}`}</p>
        {sourceDay?.inventory && <p className="muted small">持倉清單來源：{sourceDay.inventory.source.date} · {sourceDay.inventory.source.kind === 'current' ? '目前完整持倉' : '已確認完整清單'}</p>}
        {sourceDay?.completion && <p className="muted small">當日補齊來源：{sourceDay.completion.source.date} · {sourceDay.completion.source.kind === 'current' ? '目前完整持倉' : '已確認完整清單'}</p>}
        <ul className="snapshot-accounts">{sourcePoint.accounts.map(a => <li key={a.id}><span>{accountLabel({ name: a.name, country: sourceDay?.entries.find(e => e.accountId === a.id)?.country ?? data.accounts.find(x => x.id === a.id)?.country })}{filledNote(sourcePoint, a.id) && <small className="muted"> · {filledNote(sourcePoint, a.id)}</small>}</span><strong>{a.value === null ? '資料不完整' : `NT$ ${fmt(a.value, 0)}`}</strong></li>)}</ul>
        {!!sourcePoint.filled?.length && <p className="muted small">{sourcePoint.filled.length} 個帳戶這天沒有完整紀錄或行情，以之前最近一筆金額補上；沒有更早紀錄的未知項目以 0 計。可在下方逐項編輯數量補登這天。</p>}
        <p className="muted small">分類總額：{Object.entries(sourcePoint.categories).map(([name, value]) => `${name} ${value === null ? '未知' : `NT$ ${fmt(value, 0)}`}`).join(' · ') || '未記錄'}</p>
        {sourceDay ? <div className="quantity-rows">{sourceDay.entries.map(entry => <QuantityRecord key={instrumentKey(entry)} entry={entry} actions={
          <button title="編輯來源數量" aria-label="編輯來源數量" disabled={busy || !!quantityRequest} data-history-entry={`source:${sourcePoint.date}:${instrumentKey(entry)}`} onClick={() => setQuantityRequest({ date: sourcePoint.date, expected: data.history.quantityDays?.find(d => d.date === sourcePoint.date), entryKey: instrumentKey(entry), focusKey: `source:${sourcePoint.date}:${instrumentKey(entry)}` })}><ActionIcon name="edit" /></button>
        } />)}</div> : <p className="muted small">原始快照只保存帳戶與分類總額，無法還原當時各項數量與行情；可從下方每日紀錄補登數量。目前持倉可在帳戶頁編輯。</p>}
      </section>}
      <QuantityHistory data={data} busy={busy} onChange={onChange} request={quantityRequest} onRequest={setQuantityRequest} displayDays={historical.data.history.valuedQuantityDays ?? historical.data.history.quantityDays}/>
      <section className="panel">
        <div className="panel-head">
          <h3>異動紀錄</h3>
          {changes.length > 0 && (
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} aria-label="篩選帳戶">
              <option value="">所有帳戶</option>
              {[...new Map(changes.map((c) => [c.accountId, accountNames.get(c.accountId) ?? c.account]))].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>
        <ChangeList
          changes={accountFilter ? changes.filter((c) => c.accountId === accountFilter) : changes}
          showAccount={!accountFilter}
          onOpenAccount={(id) => data.accounts.some((a) => a.id === id) && onOpenAccount(id)}
          onDelete={busy ? undefined : (c) => {
            if (!confirm(`刪除「${c.account}」${c.type === 'cash' ? `${c.currency} 餘額` : c.symbol} 的這筆異動紀錄？目前的數字不會改變。`)) return
            onChange({ ...data, history: { ...data.history, changes: changes.filter((x) => x !== c) } })
          }}
        />
      </section>

      <section className="panel">
        <h3>負債異動</h3>
        {!data.history.liabilityChanges?.length ? <p className="muted">修改負債並儲存後，這裡會保留修改前後的資料。</p> :
          <ul className="liability-changes">{[...(data.history.liabilityChanges ?? [])].sort((a, b) => b.at.localeCompare(a.at)).map((c, i) => <LiabilityChangeRow key={`${c.at}-${i}`} change={c} extra={<button disabled={busy} className="icon" aria-label="刪除這筆負債紀錄" onClick={() => {
            if (confirm('刪除這筆負債異動紀錄？目前負債餘額不會改變。')) onChange({ ...data, history: { ...data.history, liabilityChanges: data.history.liabilityChanges?.filter((x) => x !== c) } })
          }}>×</button>} />)}</ul>}
      </section>
      {points.length > 0 && (
        <section className="panel daily" aria-label="每日紀錄">
          <div className="panel-head">
            <h3>每日紀錄</h3>
            <span className="muted small">{points.length} 天 · 與總覽時間線共用資料；當天沒有紀錄的帳戶沿用之前最近一筆金額。</span>
          </div>
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="num">總資產</th>
                  <th className="num">總負債</th>
                  <th className="num">淨資產</th>
                  <th className="num">帳戶數</th>
                  <th className="daily-actions-heading">操作</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().slice(0,visibleDays).map((s) => (
                  <tr key={s.date}>
                    <td data-label="日期"><span className="daily-cell-value daily-date"><time dateTime={s.date}>{s.date.replace(/-/g, '/')}</time><span className="daily-source muted small">{s.periodDerived ? '期間推算' : s.manual ? (data.history.quantityDays?.find(d=>d.date===s.date)?.inventory ? '完整回補' : '手動') : s.date === today.date ? '目前' : '原始快照'}{s.filled?.length ? ` · ${s.filled.length} 個帳戶沿用` : ''}</span></span></td>
                    <td className="num" data-label="總資產"><span className="daily-cell-value">{s.total === null ? '資料不完整' : `NT$ ${fmt(s.total, 0)}`}</span></td>
                    <td className="num" data-label="總負債"><span className="daily-cell-value">{s.liabilityEstimated && '預估 · '}{s.liabilityAssumed ? '未記錄（以 0 計）' : s.liabilityTotal === undefined ? '未記錄' : s.liabilityTotal === null ? '無法換算' : `NT$ ${fmt(s.liabilityTotal, 0)}`}</span></td>
                    <td className="num" data-label="淨資產"><span className="daily-cell-value">{s.liabilityEstimated && '預估 · '}{s.netWorth === undefined ? '未記錄' : s.netWorth === null ? '無法換算' : `NT$ ${fmt(s.netWorth, 0)}`}</span></td>
                    <td className="num" data-label="帳戶數"><span className="daily-cell-value">{s.accounts.length}</span></td>
                    <td className="num daily-actions"><div className="daily-action-group">
                      <button className="daily-action" aria-label={`查看明細 ${s.date}`} title="查看明細" onClick={() => { setSourceDate(s.date); sourcePanel.current?.scrollIntoView?.({ block: 'start' }); sourcePanel.current?.focus() }}><ActionIcon name="view" /></button>
                      <button className="daily-action" aria-label={`編輯數量 ${s.date}`} title="編輯當日持倉數量" data-history-entry={`day:${s.date}`} disabled={busy || !!quantityRequest} onClick={()=>setQuantityRequest({date:s.date,mode:'baseline',expected:data.history.quantityDays?.find(d=>d.date===s.date),focusKey:`day:${s.date}`})}><ActionIcon name="edit" /></button>
                      {data.history.quantityDays?.some(d=>d.date===s.date) && <button className="daily-action danger" aria-label={`移除補登 ${s.date}`} title="移除補登，恢復原始資料" disabled={busy || !!quantityRequest} onClick={()=>{
                        if(confirm(removalMessage(data,s.date))) {
                          onChange({...data,history:{...data.history,quantityDays:data.history.quantityDays?.filter(d=>d.date!==s.date)}})
                          requestAnimationFrame(()=>{
                            const target=[...document.querySelectorAll<HTMLElement>('[data-history-entry]')].find(e=>e.dataset.historyEntry===`day:${s.date}`) ?? document.querySelector<HTMLElement>('[data-history-entry="new"]')
                            target?.focus()
                          })
                        }
                      }}><ActionIcon name="undo" /></button>}
                      {s.periodDerived && <button className="daily-action" aria-label="管理持有期間" title="管理持有期間" disabled={busy || !!quantityRequest} onClick={()=>{
                        const section=document.querySelector<HTMLElement>('[aria-label="歷史持倉數量"]')
                        section?.querySelectorAll<HTMLDetailsElement>('[data-period-management]').forEach(d=>{d.open=true})
                        section?.scrollIntoView?.({block:'start'})
                        section?.querySelector<HTMLElement>('[data-period-management] summary')?.focus()
                      }}><ActionIcon name="calendar" /></button>}
                      {!s.manual && !s.periodDerived && saved.some(x=>x.date===s.date) && <button disabled={busy}
                        className="daily-action danger"
                        aria-label={`刪除 ${s.date} 的紀錄`}
                        title="刪除這天的原始快照"
                        onClick={() => {
                          if (!confirm(`刪除 ${s.date.replace(/-/g, '/')} 的原始快照？期間推算可能仍會顯示這天。`)) return
                          onChange({ ...data, history: { ...data.history, snapshots: saved.filter((x) => x.date !== s.date) } })
                        }}
                      >
                        <ActionIcon name="delete" />
                      </button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {points.length > visibleDays && <button disabled={busy} onClick={()=>setVisibleDays(n=>n+30)}>顯示更早 30 日（尚有 {points.length-visibleDays} 日）</button>}
          {saved.some((s) => s.date === today.date) && (
            <p className="muted small hint">未補登的今天會顯示目前值；已補登日期優先採手動數量估值。移除手動補登可恢復原始快照。</p>
          )}
        </section>
      )}
    </div>
  )
}

const money = (n: number | null | undefined) => n === undefined ? '未記錄' : n === null ? '無法換算' : `NT$ ${fmt(n, 0)}`
const signed = (n: number, digits: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), digits)}`

export function ChangeRow({
  c,
  showAccount,
  onOpenAccount,
  showTime = true,
  extra,
  className = '',
}: {
  c: Change
  showAccount: boolean
  onOpenAccount?: (id: string) => void
  showTime?: boolean
  extra?: ReactNode
  className?: string
}) {
  const what = c.type === 'cash' ? `${c.currency} 餘額` : displaySymbol(c.symbol)
  const time = new Date(c.at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
  let detail: React.ReactNode
  if (!c.before || !c.after) {
    const s = (c.after ?? c.before)!
    detail = (
      <>
        <span className={`tag ${c.after ? 'good' : ''}`}>{c.after ? '新增' : '移除'}</span>
        <span className="num">
          {c.type === 'cash' ? `${fmt(s.quantity)} ${c.currency}` : `${fmt(s.quantity, 8)} × ${fmt(s.price, 4)} ${c.currency}`}
        </span>
      </>
    )
  } else {
    const qty = c.after.quantity - c.before.quantity
    const priceChanged = c.type === 'holding' && c.after.price !== c.before.price
    detail = (
      <>
        {qty !== 0 && (
          <span className="num">
            {c.type === 'holding' && <span className="muted">數量 </span>}
            <span className="muted">{fmt(c.before.quantity, 8)} →</span> {fmt(c.after.quantity, 8)}
            <span className="delta">{signed(qty, 8)}</span>
          </span>
        )}
        {priceChanged && (
          <span className="num">
            <span className="muted">單價 {fmt(c.before.price, 4)} →</span> {fmt(c.after.price, 4)} {c.currency}
          </span>
        )}
      </>
    )
  }
  return (
    <li className={`${showTime ? '' : 'no-time'} ${className}`.trim()}>
      {showTime && <span className="when muted small">{time}</span>}
      <span className="what">
        {showAccount &&
          (onOpenAccount ? (
            <button className="link acct" onClick={() => onOpenAccount(c.accountId)}>
              {c.account}
            </button>
          ) : (
            <span className="acct">{c.account}</span>
          ))}
        <strong>{what}</strong>
      </span>
      <span className="detail">
        {detail}
        {extra}
      </span>
    </li>
  )
}

// Edits grouped by day, newest first.
export function ChangeList({
  changes,
  showAccount = true,
  onOpenAccount,
  onDelete,
  limit = 60,
}: {
  changes: Change[]
  showAccount?: boolean
  onOpenAccount?: (id: string) => void
  onDelete?: (c: Change) => void
  limit?: number
}) {
  const [shown, setShown] = useState(limit)
  if (changes.length === 0) {
    return <p className="muted">還沒有異動。修改餘額或持倉並儲存後，原本的數字會記錄在這裡。</p>
  }
  const sorted = [...changes].sort((a, b) => b.at.localeCompare(a.at))
  const days = new Map<string, Change[]>()
  for (const c of sorted.slice(0, shown)) {
    const d = localDate(c.at)
    days.set(d, [...(days.get(d) ?? []), c])
  }
  return (
    <div className="changes">
      {[...days].map(([day, list]) => (
        <div key={day} className="change-day">
          <h4>{day.replace(/-/g, '/')}</h4>
          <ul>
            {list.map((c, i) => (
              <ChangeRow
                key={`${c.at}-${i}`}
                c={c}
                showAccount={showAccount}
                onOpenAccount={onOpenAccount}
                extra={
                  onDelete && (
                    <button className="icon" aria-label="刪除這筆紀錄" title="刪除這筆紀錄" onClick={() => onDelete(c)}>
                      ×
                    </button>
                  )
                }
              />
            ))}
          </ul>
        </div>
      ))}
      {sorted.length > shown && (
        <button className="ghost small" onClick={() => setShown(shown + limit)}>
          顯示更早的紀錄（還有 {sorted.length - shown} 筆）
        </button>
      )}
    </div>
  )
}
