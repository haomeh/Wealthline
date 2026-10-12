import { useCalendarNow } from '../useCalendarNow'
import { calendarDate, captureBasis, nextMonthlyDate, projectLiability } from '../loanSchedule'
import { useState, type FormEvent } from 'react'
import { COMMON_CURRENCIES, newId, type WealthData } from '../model'
import { LIABILITY_KINDS, balanceSheet, liabilityBaseValue, parseLiability, type Liability } from '../liabilities'
import { fmt } from '../format'
import { REPAYMENT_METHODS, estimateLoan, type RepaymentMethod } from '../loanEstimate'
import { LoanProjection } from './LoanEstimate'
import { ActionIcon } from './ActionIcon'

export function Liabilities({ data, onChange }: { data: WealthData; onChange: (data: WealthData) => void }) {
  const [editing, setEditing] = useState<Liability | 'new' | null>(null)
  const now = useCalendarNow()
  const [reset, setReset] = useState(false)
  const debts = data.liabilities ?? []
  const totals = balanceSheet(data, now)
  if (editing) return <LiabilityForm key={`${editing === 'new' ? 'new' : editing.id}-${reset}`} reset={reset} liability={editing === 'new' ? undefined : editing}
    onCancel={() => setEditing(null)} onSave={(d) => {
      onChange({ ...data, liabilities: debts.some((x) => x.id === d.id) ? debts.map((x) => x.id === d.id ? d : x) : [...debts, d] })
      setEditing(null)
    }} />
  return <>
    <div className="page-head">
      <div><h2>負債</h2><p className="muted">設定原始本金、利率、總期數與第一期還款日，自動推算預估欠款。假設固定利率且每期按時繳足；不代表銀行實際餘額，也不扣除現金。</p></div>
      <button className="primary" onClick={() => { setReset(false); setEditing('new') }}>＋ 新增負債</button>
    </div>
    <section className="panel stat">
      <span className="eyebrow">{debts.some(d => d.schedule) ? '總負債（含預估）' : '總負債'}</span><strong>{totals.liabilities === null ? '尚無法換算' : `NT$ ${fmt(totals.liabilities, 0)}`}</strong>
      <span className="muted small">{debts.length} 筆 · 餘額以正值記錄，淨資產會扣除此金額</span>
    </section>
    {!debts.length && <section className="panel empty"><p>尚未記錄負債。新增貸款或信用卡目前未償餘額。</p></section>}
    <div className="liability-list">{debts.map((d) => {
      const value = liabilityBaseValue(data, d, now)
      const projected = projectLiability(d, now)
      const hasDetails = d.schedule || d.annualRate !== undefined || d.paymentAmount !== undefined || d.totalInstallments !== undefined || d.paidInstallments !== undefined || (d.repaymentMethod && d.repaymentMethod !== 'none') || d.basisHistory?.length || d.notes
      return <section className="panel liability-record" key={d.id}>
        <div className="panel-head"><h3>{d.name}</h3><span className="tag">{LIABILITY_KINDS[d.kind]}</span></div>
        <p className="liability-balance">{d.currency} {projected.balance === null ? '基準日前無法估算' : fmt(projected.balance)}</p>
        <p className="muted small">{d.schedule ? '預估未償本金' : '目前未償餘額'} · {Number.isFinite(value) ? `NT$ ${fmt(value, 0)}` : '缺少有效匯率，請至「匯率」設定'}</p>
        {d.schedule ? <>
          <p className="muted small liability-schedule-summary">截至 {projected.asOf} · 剩餘 {projected.remaining ?? '—'} 期 · {projected.nextDueDate ? `下一期：第 ${projected.elapsed + 1} 期，${projected.nextDueDate}` : projected.balance === null ? '基準日前無法估算' : '預估已清償'}</p>
          <p className="muted small">按期預估，尚未確認實際付款；不扣現金。</p>
        </> : (d.nextDueDate || d.remainingInstallments !== undefined) && <p className="muted small liability-schedule-summary">{d.nextDueDate && `下次到期日 ${d.nextDueDate}`}{d.nextDueDate && d.remainingInstallments !== undefined && ' · '}{d.remainingInstallments !== undefined && `剩餘 ${d.remainingInstallments} 期`}</p>}
        {hasDetails && <details className="liability-record-details">
          <summary>條件與試算</summary>
          {d.schedule && <div className="notice">
            <p>截至 {projected.asOf}（{d.schedule.timeZone}）預估已到期 {projected.elapsed} 期。</p>
            <p>{d.schedule.source === 'original' ? '原始貸款總額' : '校正基準本金'}：{d.currency} {fmt(d.balance)} · {d.remainingInstallments} 期 · {d.schedule.source === 'correction' && `基準日 ${d.schedule.baseDate} 結束時 · `}第一筆還款 {d.schedule.firstDueDate} · 每月 {d.schedule.monthlyDay} 日（短月取月底）</p>
            <p>預估已償本金 {d.currency} {fmt(projected.principalRepaid)}。只減本金，不把利息當本金扣減；尚未確認實際付款。</p>
          </div>}
          <dl className="liability-details">
            {d.annualRate !== undefined && <><dt>年利率</dt><dd>{fmt(d.annualRate, 4)}%</dd></>}
            {d.paymentAmount !== undefined && <><dt>既有手填每期應付</dt><dd>{d.currency} {fmt(d.paymentAmount)}</dd></>}
            {!d.schedule && d.totalInstallments !== undefined && <><dt>總期數</dt><dd>{d.totalInstallments}</dd></>}
            {!d.schedule && d.paidInstallments !== undefined && <><dt>已繳期數</dt><dd>{d.paidInstallments}</dd></>}
          </dl>
          {d.repaymentMethod && d.repaymentMethod !== 'none' && <LoanProjection scheduled={!!d.schedule} principal={d.balance} annualRate={d.annualRate} periods={d.remainingInstallments} method={d.repaymentMethod} currency={d.currency} />}
          {!!d.basisHistory?.length && <section><h4>基準變更紀錄（{d.basisHistory.length}）</h4>{d.basisHistory.map(b => <p key={b.id} className="small">{b.at} · {b.reason} · 舊基準 {b.currency} {fmt(b.balance)}，{b.annualRate ?? '—'}%，{b.remainingInstallments ?? '—'} 期，{b.repaymentMethod ? REPAYMENT_METHODS[b.repaymentMethod] : '手動'}{b.schedule && ` · ${b.schedule.source === 'original' ? '原始貸款' : `校正日 ${b.schedule.baseDate}`} · 首期 ${b.schedule.firstDueDate} · 每月 ${b.schedule.monthlyDay} 日 · ${b.schedule.timeZone}`}</p>)}</section>}
          {d.notes && <p className="liability-notes muted">{d.notes}</p>}
        </details>}
        <div className="row liability-actions">
          <button title="編輯" onClick={() => { setReset(false); setEditing(d) }} aria-label={`編輯負債 ${d.name}`}><ActionIcon name="edit" /></button>
          {d.schedule && <button title="校正餘額／重設基準" aria-label={`校正餘額／重設基準 ${d.name}`} onClick={() => { setReset(true); setEditing(d) }}><ActionIcon name="undo" /></button>}
          <button className="danger" title="刪除" aria-label={`刪除負債 ${d.name}`} onClick={() => {
            if (confirm(`刪除負債「${d.name}」？這只移除紀錄，不表示貸款已清償。`)) onChange({ ...data, liabilities: debts.filter((x) => x.id !== d.id) })
          }}><ActionIcon name="delete" /></button>
        </div>
      </section>
    })}</div>
  </>
}

function LiabilityForm({ liability, reset, onSave, onCancel }: { liability?: Liability; reset: boolean; onSave: (liability: Liability) => void; onCancel: () => void }) {
  const now = useCalendarNow()
  const zone = liability?.schedule?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const projected = liability ? projectLiability(liability, now) : undefined
  const [mode, setMode] = useState<'original' | 'manual' | 'correction'>(reset ? 'correction' : liability?.schedule?.source ?? (liability ? 'manual' : 'original'))
  const locked = !!liability?.schedule && !reset
  const [draft, setDraft] = useState(() => ({
    name: liability?.name ?? '', kind: liability?.kind ?? 'personal', currency: liability?.currency ?? 'TWD',
    balance: reset ? String(projected?.balance ?? liability?.balance ?? '') : liability?.balance.toString() ?? '',
    annualRate: liability?.annualRate?.toString() ?? '',
    repaymentMethod: liability ? liability.repaymentMethod ?? 'none' : 'annuity',
    remainingInstallments: reset ? String(Math.max(1, projected?.remaining ?? 1)) : liability?.remainingInstallments?.toString() ?? '',
    nextDueDate: liability?.nextDueDate ?? '', notes: liability?.notes ?? '',
    firstDueDate: reset ? projected?.nextDueDate ?? nextMonthlyDate(calendarDate(now, zone), liability?.schedule?.monthlyDay ?? 1) : liability?.schedule?.firstDueDate ?? '',
    monthlyDay: liability?.schedule ? String(liability.schedule.monthlyDay) : '', timeZone: zone,
    baseDate: reset ? calendarDate(now, zone) : liability?.schedule?.baseDate ?? calendarDate(now, zone), reason: '',
  }))
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const set = (key: keyof typeof draft, value: string) => setDraft((d) => ({ ...d, [key]: value }))
  const number = (value: string) => value.trim() ? Number(value.replace(/,/g, '')) : undefined
  const method = draft.repaymentMethod as RepaymentMethod
  const scheduled = mode !== 'manual' && method !== 'none'
  function submit(e: FormEvent) {
    e.preventDefault()
    try {
      if (locked) { onSave(parseLiability({ ...liability, name: draft.name, notes: draft.notes })); return }
      if (reset && (!confirmed || !draft.reason.trim())) throw new Error('請填寫校正原因並確認基準餘額')
      const monthlyDay = number(draft.monthlyDay) ?? Number(draft.firstDueDate.slice(-2))
      const previous = new Date(`${draft.firstDueDate}T00:00:00Z`)
      previous.setUTCDate(previous.getUTCDate() - 1)
      const schedule = scheduled ? { source: mode, baseDate: mode === 'original' ? previous.toISOString().slice(0, 10) : draft.baseDate, firstDueDate: draft.firstDueDate, monthlyDay, timeZone: draft.timeZone } : undefined
      if (schedule?.source === 'correction' && schedule.baseDate > calendarDate(now, schedule.timeZone)) throw new Error('校正基準日不得晚於貸款時區的今天')
      const next = parseLiability({ ...liability, ...draft, id: liability?.id ?? newId(), balance: number(draft.balance), annualRate: method === 'none' ? liability?.annualRate : number(draft.annualRate), remainingInstallments: method === 'none' ? liability?.remainingInstallments : number(draft.remainingInstallments), nextDueDate: draft.nextDueDate || undefined, schedule })
      if (method !== 'none') estimateLoan({ principal: next.balance, annualRate: next.annualRate!, periods: next.remainingInstallments!, method })
      if (liability && (reset || scheduled)) next.basisHistory = [...(liability.basisHistory ?? []), captureBasis(liability, now, draft.reason.trim() || '改用原始貸款計畫')]
      onSave(next)
    } catch (e) { setError(e instanceof Error ? e.message : '請檢查輸入資料') }
  }
  return <form className="panel form liability-form" onSubmit={submit}>
    <h3>{reset ? '校正餘額／重設基準' : liability ? '編輯負債' : '新增負債'}</h3>
    <p className="muted small">第一期還款日是第一次應繳款的日期，不是撥款日。按月到期即計入預估已償本金；假設固定利率、按期繳足，不表示銀行已扣款。</p>
    {locked && <p className="notice">此處可修改名稱與備註。變更本金、利率、期數或還款日，請使用「校正餘額／重設基準」，避免回頭套用新條件。</p>}
    {error && <p role="alert" className="banner error">{error}</p>}
    <label className="field"><span>負債名稱</span><input required autoFocus value={draft.name} onChange={(e) => set('name', e.target.value)} /></label>
    <fieldset disabled={locked} className="loan-terms">
    <label className="field"><span>負債類型</span><select value={draft.kind} onChange={(e) => { const kind = e.target.value as typeof draft.kind; setDraft(d => ({ ...d, kind, repaymentMethod: kind === 'credit' ? 'none' : d.repaymentMethod })); if (kind === 'credit') setMode('manual') }}>{Object.entries(LIABILITY_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label className="field"><span>幣別</span><input required list="liability-currencies" value={draft.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></label>
    <datalist id="liability-currencies">{[...new Set([...COMMON_CURRENCIES, 'USDC'])].map((c) => <option key={c} value={c} />)}</datalist>
    <label className="field"><span>還款方式</span><select value={method} onChange={(e) => set('repaymentMethod', e.target.value)}>{Object.entries(REPAYMENT_METHODS).map(([key, label]) => <option key={key} value={key} disabled={draft.kind === 'credit' && key !== 'none'}>{label}</option>)}</select></label>
    <details open={reset || (!!liability && !liability.schedule)}><summary>進階／既有剩餘本金模式</summary>
      <label className="field"><span>計算基準</span><select value={mode} disabled={method === 'none'} onChange={(e) => {
        const nextMode = e.target.value as typeof mode
        setMode(nextMode)
        if (nextMode === 'original' && liability && !liability.schedule) setDraft(d => ({ ...d, balance: '', remainingInstallments: '', firstDueDate: '', monthlyDay: '' }))
      }}><option value="original" disabled={reset}>原始貸款，自動按期預估</option><option value="manual">手動記錄目前餘額，不自動扣減</option>{reset && <option value="correction">校正後從新基準按期預估</option>}</select></label>
      <p className="muted small">舊資料保留原本金與剩餘期數，不反推原始貸款。信用卡、不規則還款與寬限期請使用手動模式。</p>
    </details>
    <label className="field"><span>{scheduled && mode === 'original' ? '原始貸款總額' : '目前未償餘額'}</span><input required inputMode="decimal" value={draft.balance} onChange={(e) => set('balance', e.target.value)} /><small className="muted">本金以正值記錄；已清償可填 0。</small></label>
    {method !== 'none' && <>
      <div className="liability-form-grid">
        <label className="field"><span>年利率（%）</span><input required inputMode="decimal" value={draft.annualRate} onChange={(e) => set('annualRate', e.target.value)} /></label>
        <label className="field"><span>{scheduled && mode === 'original' ? '總期數（月）' : '剩餘期數（月）'}</span><input required inputMode="numeric" value={draft.remainingInstallments} onChange={(e) => set('remainingInstallments', e.target.value)} /><small className="muted">1–1200 期；每月一期。</small></label>
      </div>
      {scheduled && <>
        {mode === 'correction' && <label className="field"><span>校正基準日</span><input required type="date" value={draft.baseDate} onChange={e => set('baseDate', e.target.value)} /><small>本金為此日結束時的實際餘額。上方預填值仍為估算，請核對銀行資料。</small></label>}
        <label className="field"><span>{mode === 'original' ? '第一期還款日' : '新基準後第一期還款日'}</span><input required type="date" value={draft.firstDueDate} onChange={e => set('firstDueDate', e.target.value)} /><small>到期當日依貸款時區計入預估已償本金，不是實際付款紀錄。</small></label>
        <p className="muted small">貸款日曆時區：{draft.timeZone}；每月 {draft.monthlyDay || draft.firstDueDate.slice(-2) || '—'} 日，短月取月底，下月回到原訂日。</p>
        <details><summary>調整每月日期／貸款時區</summary>
          <label className="field"><span>每月還款日（選填）</span><input inputMode="numeric" placeholder="預設第一期的日期" value={draft.monthlyDay} onChange={e => set('monthlyDay', e.target.value)} /><small>例如第一期為 2 月底、之後每月 31 日，可填 31；第一期日期須符合該月的還款日。</small></label>
          <label className="field"><span>貸款日曆時區</span><input required value={draft.timeZone} onChange={e => set('timeZone', e.target.value)} /><small>IANA 時區，例如 Asia/Taipei。儲存後跨裝置使用相同時區。</small></label>
        </details>
      </>}
      <LoanProjection scheduled={scheduled} principal={number(draft.balance)} annualRate={number(draft.annualRate)} periods={number(draft.remainingInstallments)} method={method} currency={draft.currency} />
    </>}
    </fieldset>
    {reset && <>
      <label className="field"><span>校正原因</span><input required value={draft.reason} onChange={e => set('reason', e.target.value)} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> 我已核對基準本金、利率、期數與日期；從新基準估算，保留舊基準紀錄。</label>
    </>}
    {liability && (liability.paymentAmount !== undefined || liability.totalInstallments !== undefined || liability.paidInstallments !== undefined || (!liability.repaymentMethod && liability.annualRate !== undefined)) && <details>
      <summary>既有手填資料（保留，未作為試算條件）</summary>
      <p className="muted small">每期應付：{liability.paymentAmount ?? '未填'}；總期數：{liability.totalInstallments ?? '未填'}；已繳期數：{liability.paidInstallments ?? '未填'}；原年利率：{liability.annualRate ?? '未填'}%。不會自動推算剩餘期數。</p>
    </details>}
    <details><summary>日期與備註（選填）</summary>
      {!scheduled && <label className="field"><span>下次到期日（選填）</span><input type="date" value={draft.nextDueDate} onChange={(e) => set('nextDueDate', e.target.value)} /></label>}
      <label className="field"><span>備註（選填）</span><textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} /></label>
    </details>
    <div className="row"><button type="submit" className="primary">套用負債</button><button type="button" onClick={onCancel}>取消</button></div>
    <p className="muted small">套用後仍須按「儲存變更」才會寫入 Drive。自動估算不改寫本金、不建立付款紀錄、不扣現金。</p>
  </form>
}
