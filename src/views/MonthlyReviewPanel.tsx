import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cashflowEntries, type CashflowSource } from '../cashflowEntries'
import type { LedgerReadiness } from '../cashflowQuery'
import type { WealthData } from '../model'
import { parseMonthlyReviews, type MonthlyReview } from '../monthlyReview'
import { monthlyReviewState, reviewFingerprint, reviewSourceKey, reviewSources, type MonthlyReviewState } from '../monthlyReviewState'

export interface MonthlyReviewPanelProps {
  data: WealthData; month: string; today: string; readiness: LedgerReadiness
  busy?: boolean; dirty?: boolean; sessionIdentity?: number
  captureReviewGuard?: () => () => boolean
  onChange?: (next: WealthData) => void
  onUnclassified: (source: 'bank' | 'card') => void
}
export function MonthlyReviewPanel(props: MonthlyReviewPanelProps) {
  const { data, month, today, readiness, busy, dirty, onChange, onUnclassified } = props
  const review = useMemo(() => data.monthlyReviews?.find(r => r.month === month) ?? { month, expectedSources: [], confirmations: [] }, [data, month])
  const entries = useMemo(() => readiness === 'ready' ? cashflowEntries({expenses:data.expenses, expenseRules:data.expenseCategoryRules, bankTransactions:data.bankTransactions, bankRules:data.bankCategoryRules}) : [], [data, readiness])
  const labels = useMemo(() => Object.fromEntries((data.bankTransactionAccounts ?? []).map(a => [a.id, a.label])), [data])
  const [result, setResult] = useState<{ review: MonthlyReview; data: WealthData; state: MonthlyReviewState } | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [card, setCard] = useState('')
  const [notes, setNotes] = useState<Record<string, string>>({})
  const latest = useRef(props)
  const generation = useRef(0)
  useLayoutEffect(() => { latest.current = props })
  useLayoutEffect(() => { const counter = generation; counter.current++; return () => { counter.current++ } }, [data, month, readiness, busy, props.sessionIdentity])
  useEffect(() => {
    if (readiness !== 'ready') return
    let active = true
    void monthlyReviewState(entries, review, today, labels).then(state => { if (active) setResult({ review, data, state }) }, e => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [entries, review, today, labels, readiness, data])
  const state = result?.data === data && result.review === review && readiness === 'ready' ? result.state : null
  const disabled = readiness !== 'ready' || !!busy || pending || month > today.slice(0, 7) || !onChange
  const commit = (next: MonthlyReview) => {
    try {
      const monthlyReviews = parseMonthlyReviews([...(data.monthlyReviews ?? []).filter(r => r.month !== month), next].sort((a, b) => a.month.localeCompare(b.month)))
      onChange?.({ ...data, monthlyReviews })
    } catch { setError('核對資料超出限制：每月最多 200 個來源、備註最多 500 字。') }
  }
  const expected = new Set(review.expectedSources.map(reviewSourceKey))
  const sources = reviewSources(entries, review)
  const choices = new Map(sources.map(s => [reviewSourceKey(s), s]))
  for (const source of [...(data.bankTransactionAccounts ?? []).map(a => ({ kind: 'bank' as const, accountId: a.id })), ...(data.expenses ?? []).map(e => ({ kind: 'card' as const, card: e.card }))]) choices.set(reviewSourceKey(source), source)
  const toggle = (source: CashflowSource) => { if (disabled) return; const key = reviewSourceKey(source); commit({ ...review, expectedSources: expected.has(key) ? review.expectedSources.filter(s => reviewSourceKey(s) !== key) : [...review.expectedSources, source] }) }
  const label = (source: CashflowSource) => source.kind === 'card' ? source.card : labels[source.accountId] ?? `已移除帳戶 ${source.accountId}`
  const previousMonth = `${Number(month.slice(0, 4)) - (month.endsWith('-01') ? 1 : 0)}`.padStart(4, '0') + '-' + String(month.endsWith('-01') ? 12 : Number(month.slice(5)) - 1).padStart(2, '0')
  const previous = data.monthlyReviews?.find(r => r.month === previousMonth)
  const confirmSource = async (source: CashflowSource) => {
    if (disabled || !state || !expected.has(reviewSourceKey(source))) return
    const key = reviewSourceKey(source), row = state.sources.find(s => reviewSourceKey(s.source) === key)!
    const note = notes[key] ?? review.confirmations.find(c => reviewSourceKey(c.source) === key)?.exceptionNote ?? ''
    if (row.unclassifiedCount && !note.trim()) return
    const epoch = generation.current
    const identity = props, guard = props.captureReviewGuard?.() ?? (() => true)
    setPending(true); setError('')
    try {
      const fingerprint = await reviewFingerprint(entries, review, source, labels)
      // Never certify a different month, restored revision, session, or save state.
      const current = latest.current
      if (current.data !== identity.data || current.month !== identity.month || current.sessionIdentity !== identity.sessionIdentity || current.readiness !== 'ready' || current.busy || !guard()) return
      if (generation.current !== epoch) return
      commit({ ...review, confirmations: [...review.confirmations.filter(c => reviewSourceKey(c.source) !== key), { source, decision: row.count ? 'reviewed' : 'no-activity', fingerprint, confirmedAt: new Date().toISOString(), ...(note.trim() && { exceptionNote: note.trim() }) }] })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setPending(false) }
  }
  const status = !state ? '正在檢查核對狀態…' : state.status === 'reviewed' ? state.currentMonth ? '截至目前已核對' : '已人工核對' : state.status === 'stale' ? '需重新核對' : state.status === 'in-progress' ? '核對中' : '未核對'
  const exceptions = state?.sources.filter(s => s.current).reduce((sum, s) => sum + s.unclassifiedCount, 0) ?? 0
  return <section className="panel monthly-review" aria-label="每月核對">
    <div className="panel-head"><h3>{month} 每月核對</h3><span role="status">{readiness === 'error' ? '明細載入失敗，無法核對' : readiness !== 'ready' ? '明細尚未載入，無法核對' : status}{exceptions > 0 ? ` · 保留 ${exceptions} 筆未分類` : ''}{dirty ? ' · 待儲存' : ''}{busy ? ' · 儲存中' : ''}</span></div>
    <p className="muted small">人工核對只代表你已檢查預期來源；依已匯入紀錄，不代表完整月份。{month > today.slice(0, 7) ? '未來月份不能確認。' : ''}</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={disabled}><legend>預期來源（包含所有幣別）</legend>
      {[...choices.values()].map(source => <label className="review-source-choice" key={reviewSourceKey(source)}><input type="checkbox" checked={expected.has(reviewSourceKey(source))} onChange={() => toggle(source)} />{source.kind === 'card' ? '信用卡' : '銀行'} · {label(source)}</label>)}
      <form onSubmit={e => { e.preventDefault(); if (!disabled && card.trim() && !expected.has(reviewSourceKey({ kind: 'card', card }))) { commit({ ...review, expectedSources: [...review.expectedSources, { kind: 'card', card }] }); setCard('') } }}>
        <label>新增預期信用卡<input value={card} maxLength={100} onChange={e => setCard(e.target.value)} /></label><button disabled={!card.trim()}>加入來源</button>
      </form>
      <button disabled={!previous} onClick={() => previous && commit({ month, expectedSources: previous.expectedSources.map(s => ({ ...s })), confirmations: [] })}>複製上月預期來源</button>
    </fieldset>
    {sources.length === 0 && <p>尚未設定預期來源；無紀錄不代表已核對。</p>}
    {sources.map(source => {
      const key = reviewSourceKey(source), row = state?.sources.find(s => reviewSourceKey(s.source) === key)
      const prior = review.confirmations.find(c => reviewSourceKey(c.source) === key)
      const note = notes[key] ?? prior?.exceptionNote ?? ''
      const sourceLabel = `${source.kind === 'card' ? '信用卡' : '銀行'} · ${label(source)}`
      const noteDraft = notes[key] !== undefined && note.trim() !== (prior?.exceptionNote ?? '')
      const currencies = [...new Set(entries.filter(e => e.date.startsWith(month + '-') && reviewSourceKey(e.source) === key).map(e => e.currency))].sort()
      return <div className="review-source-row" key={key} data-review-source={key} role="group" aria-label={sourceLabel}>
        <strong>{source.kind === 'card' ? '信用卡' : '銀行'} · {label(source)}</strong>
        <span>{row?.count ?? '—'} 筆 · {currencies.join(' / ') || '無觀測幣別'} · 未分類 {row?.unclassifiedCount ?? '—'} 筆</span>
        {!expected.has(key) && <button disabled={disabled} onClick={() => toggle(source)}>加入預期來源</button>}
        {!!row?.unclassifiedCount && <><button onClick={() => onUnclassified(source.kind)}>查看{source.kind === 'card' ? '信用卡' : '銀行'}未分類</button><label>保留未分類原因（最多 500 字）<textarea aria-label={`${sourceLabel} 保留未分類原因`} maxLength={500} value={note} disabled={disabled} onChange={e => setNotes({ ...notes, [key]: e.target.value })} /></label></>}
        {noteDraft && <small role="status">備註草稿尚未套用；請重新確認此來源，再儲存。</small>}
        {prior && <small>{row?.current ? '確認有效' : '原確認待重新核對'} · {prior.confirmedAt}</small>}
        <button disabled={disabled || !row || !expected.has(key) || (source.kind === 'bank' && !Object.hasOwn(labels, source.accountId)) || (!!row.unclassifiedCount && !note.trim())} onClick={() => void confirmSource(source)}>{row?.count === 0 ? '確認本月無活動' : row?.unclassifiedCount ? '保留未分類並確認已核對' : '確認已核對'}</button>
      </div>
    })}
  </section>
}
