import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { WealthData } from '../model'
import { bankDisplayAccounts } from '../ledgerEdits'
import { applyQuickChoice, isQuickPending, quickChosenKey, quickDescription, quickItem, quickOptions, quickQueue, similarPending, suggestKeyword, type QuickChoice, type QuickItem, type QuickRef, type QuickSource } from '../quickClassify'
import { fmt } from '../format'
import { RecordMoney } from './RecordMoney'
import { BANK_TEXT_NOTICE } from './bankUiHelpers'

// 快速分類: the records still to classify as a stack of cards, one at a time. A tap on a category
// classifies the card (and, if left on, the others with the same description) and shows the next.
// The queue is fixed when the dialog opens; cards a choice already classified are passed over.
// Changes go through onChange like any other edit, so they still need 儲存變更.
export function QuickClassify({ data, onChange, busy, sources, inRange, onClose }: {
  data: WealthData; onChange: (next: WealthData) => void; busy: boolean
  sources: readonly QuickSource[]; inRange?: (date: string) => boolean; onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const latest = useRef(data)
  useLayoutEffect(() => { latest.current = data })
  const [queue, setQueue] = useState<QuickRef[]>(() => quickQueue(data, sources, inRange))
  // pos: the card shown (queue.length once every card is handled); back: the cards shown before it.
  const [pos, setPos] = useState(0), [back, setBack] = useState<number[]>([]), [error, setError] = useState('')
  const item = pos < queue.length ? quickItem(data, queue[pos]) : undefined
  const id = item ? queue[pos].id : ''
  const similar = useMemo(() => item ? similarPending(data, item) : [], [data, item])
  // The options under the card start over for each card.
  const [extras, setExtras] = useState({ id: '', similar: true, rule: false, keyword: '' })
  if (item && extras.id !== id) setExtras({ id, similar: true, rule: false, keyword: suggestKeyword(quickDescription(item)) })
  const pendingNow = (r: QuickRef) => { const it = quickItem(data, r); return !!it && isQuickPending(data, it) }
  // remaining: from the card shown on; left: every card still to classify, skipped ones included.
  const remaining = queue.slice(pos).filter(pendingNow).length, left = queue.filter(pendingNow)

  useEffect(() => { if (ref.current?.showModal) ref.current.showModal(); else ref.current?.setAttribute('open', '') }, [])

  // The next card after `from` still to classify in `current`, or the end of the queue.
  const next = (from: number, current: WealthData) => {
    for (let i = from + 1; i < queue.length; i++) { const it = quickItem(current, queue[i]); if (it && isQuickPending(current, it)) return i }
    return queue.length
  }
  const go = (to: number) => { setBack([...back, pos]); setPos(to); setError('') }
  function choose(choice: QuickChoice) {
    if (busy || !item) return
    if (extras.rule && !extras.keyword.trim()) { setError('請填寫規則關鍵字，或取消建立規則。'); return }
    try {
      const updated = applyQuickChoice(latest.current, item, choice, { alsoIds: extras.similar ? similar.map((r) => r.id) : [], ruleKeyword: extras.rule ? extras.keyword : undefined })
      onChange(updated)
      go(next(pos, updated))
    } catch {
      setError(extras.rule ? '無法建立規則：請縮短關鍵字，勿含帳號、姓名或身分資料。' : '無法套用這個分類，請改用編輯。')
    }
  }
  const skip = () => { if (item) go(next(pos, data)) }
  const previous = () => { if (!back.length) return; setPos(back.at(-1)!); setBack(back.slice(0, -1)); setError('') }
  const groups = item ? quickOptions(item) : []
  const chosen = item && quickChosenKey(item)
  // Digits pick from the first group; arrows move between cards. Typing in the keyword field is left alone.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
    const digit = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1
    if (digit >= 0 && groups[0]?.options[digit]) { e.preventDefault(); choose(groups[0].options[digit].choice) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); skip() }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); previous() }
  }
  const accounts = useMemo(() => new Map(bankDisplayAccounts(data.bankTransactionAccounts ?? []).map((a) => [a.id, a.label])), [data.bankTransactionAccounts])

  return <dialog ref={ref} className="quick-classify" aria-label="快速分類" onKeyDown={onKeyDown} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose() }}>
    <header className="quick-classify-head">
      <div><h3>快速分類</h3><p className="muted small" role="status">{queue.length ? item ? `還有 ${remaining} 筆未分類` : `已分類 ${queue.length - left.length}／${queue.length} 筆` : '沒有未分類的紀錄'}</p></div>
      <button type="button" className="quick-classify-close" aria-label="關閉快速分類" onClick={onClose}>✕</button>
    </header>
    {queue.length > 0 && <div className="quick-classify-progress" role="progressbar" aria-label="分類進度" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={queue.length - remaining}><i style={{ width: `${(queue.length - remaining) / queue.length * 100}%` }} /></div>}
    {item ? <>
      <QuickCard key={id} item={item} account={item.source === 'bank' ? accounts.get(item.row.accountId) ?? '未辨識帳戶' : item.expense.card || '未命名卡片'} />
      {groups.map((group, g) => {
        const options = <div className="quick-options">{group.options.map((o, i) => <button key={o.key} type="button" className={`chip${chosen === o.key ? ' on' : ''}`} aria-pressed={chosen === o.key} disabled={busy} onClick={() => choose(o.choice)}>
          {g === 0 && i < 9 && <kbd className="desktop-only" aria-hidden>{i + 1}</kbd>}{o.label}
        </button>)}</div>
        // The other side (a refund, income paid back) is rare: folded away unless it is the current choice.
        return g < 2 ? <fieldset key={group.label} className="quick-group"><legend>{group.label}</legend>{options}</fieldset>
          : <details key={group.label} className="quick-group quick-group-more" open={group.options.some((o) => o.key === chosen)}><summary>{group.label}</summary>{options}</details>
      })}
      <div className="quick-extras">
        {similar.length > 0 && <label className="quick-check"><input type="checkbox" checked={extras.similar} disabled={busy} onChange={(e) => setExtras({ ...extras, similar: e.target.checked })} />摘要相同的另外 {similar.length} 筆一起套用</label>}
        <label className="quick-check"><input type="checkbox" checked={extras.rule} disabled={busy} onChange={(e) => setExtras({ ...extras, rule: e.target.checked })} />建立規則，以後摘要含關鍵字的也自動套用</label>
        {extras.rule && <label className="field quick-keyword"><span>摘要關鍵字</span><input aria-label="快速分類規則關鍵字" maxLength={100} value={extras.keyword} disabled={busy} onChange={(e) => setExtras({ ...extras, keyword: e.target.value })} />{item.source === 'bank' && <small className="muted">{BANK_TEXT_NOTICE}</small>}</label>}
      </div>
      {error && <p role="alert" className="quick-error">{error}</p>}
      <footer className="quick-classify-actions">
        <button type="button" disabled={!back.length} onClick={previous}>上一筆</button>
        <span className="muted small desktop-only">數字鍵選分類 · ← → 切換</span>
        <button type="button" onClick={skip}>略過</button>
      </footer>
    </> : <div className="quick-classify-done">
      <p>{!queue.length ? '目前沒有需要分類的紀錄。' : left.length ? `還有 ${left.length} 筆略過未分類。` : '全部分類完成。'}</p>
      {queue.length > left.length && <p className="muted small">記得按「儲存變更」保存。</p>}
      <div className="quick-classify-actions">
        {back.length > 0 && <button type="button" onClick={previous}>上一筆</button>}
        {left.length > 0 && <button type="button" onClick={() => { setQueue(left); setPos(0); setBack([]) }}>再看略過的 {left.length} 筆</button>}
        <button type="button" className="primary" onClick={onClose}>完成</button>
      </div>
    </div>}
  </dialog>
}

function QuickCard({ item, account }: { item: QuickItem; account: string }) {
  const bank = item.source === 'bank'
  const date = bank ? item.row.date : item.expense.date, currency = bank ? item.row.currency : item.expense.currency
  const amount = bank ? item.row.amount : Math.abs(item.expense.amount)
  const incoming = bank ? item.row.direction === 'credit' : item.expense.amount < 0
  const kind = bank ? (incoming ? '入帳' : '支出') : (incoming ? '退款' : '消費')
  return <article className="quick-card" aria-label={`${kind} ${currency} ${fmt(amount)}`}>
    <p className="quick-card-meta"><span className="tag">{bank ? '銀行流水' : '信用卡'}</span><span className="quick-card-account">{account}</span><time dateTime={date}>{date}</time></p>
    <p className="quick-card-title">{quickDescription(item)}</p>
    <p className="quick-card-amount"><span className="muted small">{kind}</span><RecordMoney currency={currency} amount={amount} sign={incoming ? '+' : bank ? '−' : ''} tone={incoming ? 'credit' : undefined} /></p>
  </article>
}

// The prompt above a list that has records to classify.
export function QuickClassifyCallout({ count, what, busy, onStart }: { count: number; what: string; busy: boolean; onStart: () => void }) {
  return <div className="quick-classify-callout">
    <span><strong>{count} {what}</strong><small className="muted">一張一張卡片快速設定分類</small></span>
    <button type="button" disabled={busy} onClick={onStart}>快速分類</button>
  </div>
}
