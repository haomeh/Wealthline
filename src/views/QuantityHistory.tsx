import { useEffect, useRef, useState } from 'react'
import { applyHoldingPeriod, expandPeriodDays, periodConflicts, periodQuantityOn, periodRevision, shiftDate, type HoldingPeriod } from '../holdingPeriods'
import { accountLabel, type WealthData } from '../model'
import type { ReactNode } from 'react'
import { DetailRecord } from './DetailRecord'
import { ActionIcon } from './ActionIcon'
import { localDate } from '../history'
import { entriesForDate, entryValue, historyCatalog, instrumentKey, parseQuantityDays, quantityPoint, validatePastDate, valueDays, valueEntries, type QuantityDay, type QuantityEntry } from '../quantityHistory'
import { useHistoryExit } from '../useHistoryExit'
import { HistoryBaseline } from './HistoryBaseline'
import { HistoricalFxValue } from './HistoricalFxValue'
import { quantityOnly } from '../historyBaseline'
import { prepareCompletion, applyCompletion, completionRevision, resolveCompletion, removalMessage } from '../historyCompletion'
import { fmt } from '../format'

export interface QuantityEditRequest { focusKey?:string; mode?:'baseline'; date: string; expected?: QuantityDay; entryKey?: string }
const nameOf = (e: QuantityEntry) => `${e.account} · ${e.symbol || e.currency} · ${e.currency}`
const stamp = () => new Date().toISOString()

export function QuantityHistory({ data, busy = false, onChange, request: editing, onRequest: setEditing, displayDays, carried }: {
  data: WealthData; busy?: boolean; onChange: (d: WealthData) => void; displayDays?: QuantityDay[];
  carried?: (date: string, entry: QuantityEntry) => { value: number; note: string } | undefined;
  request?: QuantityEditRequest; onRequest: (request: QuantityEditRequest | undefined) => void;
}) {
  const [undo, setUndo] = useState<{ before: {days?:QuantityDay[];periods?:HoldingPeriod[]}; after: {days?:QuantityDay[];periods?:HoldingPeriod[]} } | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const previousEditing=useRef(editing)
  useEffect(()=>{
    if(previousEditing.current && !editing) {
      const key=previousEditing.current.focusKey ?? 'new'
      const target=[...document.querySelectorAll<HTMLElement>('[data-history-entry]')].find(e=>e.dataset.historyEntry===key)
      if(target) { let parent=target.parentElement; while(parent) { if(parent.tagName==='DETAILS') (parent as HTMLDetailsElement).open=true; parent=parent.parentElement } target.focus() }
      else document.querySelector<HTMLElement>('[data-history-entry="new"]')?.focus()
    }
    previousEditing.current=editing
  },[editing])
  const days = data.history.quantityDays ?? []
  const apply = (next: WealthData) => { onChange(next); setUndo({ before:{days:data.history.quantityDays,periods:data.history.holdingPeriods}, after:{days:next.history.quantityDays,periods:next.history.holdingPeriods} }); }
  const accounts = [...new Map(days.flatMap(d => [...d.entries,...(d.completion?.entries ?? [])].map(e => [e.accountId, e.account] as const))).entries()]
  const activeFilter = accounts.some(([id]) => id === filter) ? filter : ''
  return <section className="panel quantity-panel" aria-label="歷史持倉數量">
    <div className="panel-head"><h3>歷史持倉數量</h3>{!editing && <div className="history-entry-actions"><button disabled={busy} data-history-entry="new" onClick={() => setEditing({ date: localDate(stamp()),focusKey:'new' })}>＋ 補登歷史數量</button><button disabled={busy} data-history-entry="baseline" onClick={()=>setEditing({date:'',mode:'baseline',focusKey:'baseline'})}>沿用持倉回補差異</button></div>}</div>
    <p className="muted small">補登單日或持有期間；修改既有紀錄可從日期列直接選項目。所有操作只影響歷史數量。</p>
    {days.some(d=>[...d.entries,...(d.completion?.entries ?? [])].some(e=>e.quantity===null)) && <p className="notice">既有未知數量會保留並中斷對應持有期間。舊資料無法判別佔位或刻意清除，請逐項核對，不會自動移除。</p>}
    {error && <p role="alert" className="banner error">{error}</p>}
    {editing?.mode==='baseline' ? <HistoryBaseline key={editing.date} initialDate={editing.date} data={data} busy={busy} onCancel={()=>setEditing(undefined)} onApply={next=>{apply(next);setEditing(undefined)}}/> : editing ? <QuantityEditor key={`${editing.date}:${editing.entryKey ?? ''}`} data={data} busy={busy} date={editing.date} expected={editing.expected} entryKey={editing.entryKey}
      onCancel={() => setEditing(undefined)} onApply={next => { apply(next); setEditing(undefined) }} /> : <>
      {undo && <button disabled={busy} onClick={() => {
        if ((data.history.quantityDays !== undo.after.days || data.history.holdingPeriods !== undo.after.periods)) { setError('歷史已變更，無法直接復原；請重新檢查。'); return }
        onChange({ ...data, history: { ...data.history, quantityDays: undo.before.days ?? [], holdingPeriods: undo.before.periods } }); setUndo(null)
      }}>復原上次歷史修改</button>}
      {(data.history.holdingPeriods ?? []).map(period => <details className="quantity-day" data-period-management="true" key={period.id}>
        <summary>{period.start} → {period.end ?? '持續持有'} · {period.symbol || period.currency}</summary>
        <p>{period.account} · {period.currency} · 數量 {fmt(period.quantity,8)}</p>
        <p className="muted small">開始日含、結束／賣出日不含；日曆時區 {period.timeZone}。明確數量紀錄及較晚開始的期間優先。</p>
        <button disabled={busy} className="danger" onClick={() => { if(confirm('移除此持有期間？會依其他期間與單日紀錄重新估算，目前持倉不變。')) apply({...data,history:{...data.history,holdingPeriods:data.history.holdingPeriods?.filter(p=>p.id!==period.id)}}) }}>移除期間 {period.start}</button>
      </details>)}
      {!days.length ? <p className="muted">尚未單日補登。舊每日快照只有總額，無法還原各持倉數量。</p> : <label className="field"><span>篩選已補登帳戶</span><select value={activeFilter} onChange={e => setFilter(e.target.value)}><option value="">全部帳戶</option>{accounts.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>}
      {[...days].reverse().filter(day => !activeFilter || day.entries.some(e => e.accountId === activeFilter)).map(day => <details className="quantity-day" key={day.date}>
        <summary>{day.date}{day.inventory ? ' · 完整回補' : day.completion ? ' · 當日補齊' : ''} · {day.entries.filter(e => (!activeFilter || e.accountId === activeFilter) && e.quantity !== null).length} 項已填數量</summary>
        <div className="quantity-rows">{(displayDays?.find(d => d.date === day.date)?.entries ?? day.entries).filter(e => !activeFilter || e.accountId === activeFilter).map(entry => <QuantityRecord key={instrumentKey(entry)} entry={entry} carried={carried?.(day.date, entry)} actions={
          <button disabled={busy} title="編輯這項數量" data-history-entry={`item:${day.date}:${instrumentKey(entry)}`} aria-label={`編輯 ${day.date} ${nameOf(entry)}`} onClick={() => setEditing({ date: day.date, expected: day, entryKey: instrumentKey(entry),focusKey:`item:${day.date}:${instrumentKey(entry)}` })}><ActionIcon name="edit" /></button>
        } />)}</div>
        <div className="row"><button disabled={busy} data-history-entry={`list:${day.date}`} onClick={() => setEditing({ date: day.date, mode:'baseline', expected: day,focusKey:`list:${day.date}` })}>編輯 {day.date}</button><button disabled={busy} className="danger" onClick={() => {
          if (confirm(removalMessage(data,day.date))) apply({ ...data, history: { ...data.history, quantityDays: days.filter(d => d !== day) } })
        }}>移除 {day.date}</button></div>
      </details>)}
    </>}
  </section>
}

export function QuantityEditor({ data, busy = false, date: initialDate, expected, entryKey, onCancel, onApply }: {
  data: WealthData; busy?: boolean; date: string; expected?: QuantityDay; entryKey?: string; onCancel: () => void; onApply: (data: WealthData) => void;
}) {
  const catalog = historyCatalog(data)
  const editEntries = expected ? resolveCompletion(data,expected).entries : []
  const editingDay = !!expected
  const initialKey = entryKey ?? (editEntries.length === 1 ? instrumentKey(editEntries[0]) : '')
  const initial = editingDay ? editEntries.find(e => instrumentKey(e) === initialKey) : catalog.find(e => instrumentKey(e) === initialKey)
  const [step, setStep] = useState(initial ? 2 : editingDay ? -1 : 0)
  const [accountId, setAccountId] = useState(initial?.accountId ?? '')
  const [selectedKey, setSelectedKey] = useState(initialKey)
  const [date, setDate] = useState(initialDate)
  const [mode,setMode] = useState<'day'|'period'>('day')
  const [end,setEnd] = useState('')
  const [timeZone,setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [periodPreview,setPeriodPreview] = useState<{period:HoldingPeriod;revision:string;conflicts:string[];days:QuantityDay[];before:WealthData}|null>(null)
  const [confirmed,setConfirmed] = useState(false)
  const [quantity, setQuantity] = useState(() => initial ? (expected ? resolveCompletion(data,expected).entries : entriesForDate(data,initialDate)).find(e => instrumentKey(e) === initialKey)?.quantity?.toString() ?? '' : '')
  const [symbol, setSymbol] = useState('')
  const [currency, setCurrency] = useState('TWD')
  const [type, setType] = useState<'holding' | 'cash'>('holding')
  const [preview, setPreview] = useState<QuantityDay | null>(null)
  const [completionView,setCompletionView]=useState<{entries:QuantityEntry[];filled:string[];revision:string;source?:string;zeros:string[]}|null>(null)
  const [total, setTotal] = useState<number|null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const baseline = useRef(expected ?? data.history.quantityDays?.find(d => d.date === initialDate))
  const latest = useRef(data)
  const revision = useRef(0)
  const live = useRef(true)
  const editor = useRef<HTMLDialogElement>(null)
  useEffect(() => { latest.current = data }, [data])
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => { const dialog = editor.current; if (dialog && !dialog.open) dialog.showModal() }, [])
  useEffect(() => { editor.current?.querySelector<HTMLElement>('h4')?.focus() }, [step])
  const accounts = new Map(catalog.map(e => [e.accountId, { id:e.accountId, name:e.account, category:e.category, country:e.country }]))
  for (const a of data.accounts) accounts.set(a.id,a)
  const account = accounts.get(accountId)
  const choices = (editingDay ? editEntries : catalog).filter(e => e.accountId === accountId)
  const selected = selectedKey === '__new__' && account ? { accountId, account:account.name, category:account.category, country:account.country, type, symbol:type === 'cash' ? '' : symbol.trim().toUpperCase(), currency:currency.trim().toUpperCase() } : choices.find(e => instrumentKey(e) === selectedKey)
  const existingEntry = editEntries.find(e => instrumentKey(e) === selectedKey)
  const resetPreview = () => { revision.current++; setLoading(false); setPreview(null); setCompletionView(null); setPeriodPreview(null); setConfirmed(false); setError('') }
  const loadQuantity = (key: string, onDate = date) => {
    const day=latest.current.history.quantityDays?.find(d=>d.date===onDate)
    setQuantity((day ? resolveCompletion(latest.current,day).entries : entriesForDate(latest.current,onDate)).find(e=>instrumentKey(e)===key)?.quantity?.toString() ?? '')
  }
  const chooseAccount = (id: string) => { resetPreview(); setAccountId(id); setSelectedKey(''); setQuantity(''); setSymbol(''); setCurrency('TWD'); setType('holding') }
  const chooseInstrument = (key: string) => { resetPreview(); setSelectedKey(key); loadQuantity(key); setTimeZone(latest.current.history.holdingPeriods?.find(p=>instrumentKey(p)===key)?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) }
  const goToQuantity = () => {
    try {
      if (!selected) throw new Error('請先選擇標的')
      parseQuantityDays([{ date:localDate(stamp()), updatedAt:stamp(), entries:[{ ...selected, quantity:null }] }])
      if (selectedKey === '__new__' && choices.some(e => instrumentKey(e) === instrumentKey(selected))) { setSelectedKey(instrumentKey(selected)); loadQuantity(instrumentKey(selected)) }
      resetPreview(); setStep(2)
    } catch (e) { setError(e instanceof Error ? e.message : '請檢查標的資料') }
  }
  const changeDate = (value: string) => {
    resetPreview(); setDate(value); baseline.current = latest.current.history.quantityDays?.find(d => d.date === value)
    loadQuantity(selected ? instrumentKey(selected) : '',value)
  }
  const prepare = async (zeros:string[]=[]) => {
    resetPreview(); const request = revision.current
    try {
      if (mode==='day') validatePastDate(date)
      if (!selected) throw new Error('請重新選擇帳戶與標的')
      if (mode==='period') {
        if(!quantity.trim()) throw new Error('持有期間請填寫絕對數量；單日模式才可留空表示未知')
        const before=latest.current, fingerprint=periodRevision(before)
        const period:HoldingPeriod={...selected,id:crypto.randomUUID(),updatedAt:stamp(),start:date,...(end && {end}),quantity:Number(quantity),timeZone}
        const candidate=applyHoldingPeriod(before,period,fingerprint,true)
        setLoading(true)
        const days=await valueDays(expandPeriodDays(candidate))
        if(live.current && request===revision.current) { setPeriodPreview({period,revision:fingerprint,conflicts:periodConflicts(before,period),days,before}); setStep(3) }
        return
      }
      if (latest.current.history.quantityDays?.find(d => d.date === date) !== baseline.current) throw new Error('這一天已變更，請取消並重新開啟，避免覆蓋其他修改')
      if(baseline.current?.inventory && !quantity.trim()) throw new Error('完整回補清單的數量不可留空；當時未持有請填 0。')
      if(baseline.current?.inventory && !baseline.current.inventory.accounts.some(a=>a.id===selected.accountId)) throw new Error('此帳戶不在這天的完整回補範圍。請取消編輯，使用「沿用持倉回補差異」重新回補此日期以擴大範圍；不必刪除原紀錄。')
      const entry: QuantityEntry = { ...selected, quantity:quantity.trim() ? Number(quantity) : null }
      const before=latest.current, fingerprint=completionRevision(before)
      const prepared=prepareCompletion(before,date,entry,zeros)
      const candidate=prepared.day
      setLoading(true)
      const projectedData={...before,history:{...before.history,quantityDays:[...(before.history.quantityDays ?? []).filter(d=>d.date!==date),candidate]}}
      const projected=expandPeriodDays(projectedData).find(d=>d.date===date) ?? candidate
      const entries = await valueEntries(prepared.projectedEntries ?? projected.entries,date)
      if (live.current && revision.current === request) {
        setTotal(quantityPoint({...candidate,entries},before.history.snapshots.find(s=>s.date===date)).total)
        setCompletionView({entries,filled:prepared.filled,revision:fingerprint,source:candidate.completion ? `${candidate.completion.source.date}（${candidate.completion.source.kind==='current'?'目前完整持倉':'已確認完整清單'}）` : undefined,zeros})
        setPreview({...candidate,...(candidate.completion && {completion:{...candidate.completion,entries:candidate.completion.entries.map(e=>quantityOnly(entries.find(value=>instrumentKey(value)===instrumentKey(e))!))}}),entries:candidate.entries.map(row=>instrumentKey(row)===instrumentKey(entry) ? entries.find(e=>instrumentKey(e)===instrumentKey(entry))! : row)});setStep(3)
      }
    } catch (e) { if (live.current && revision.current === request) setError(e instanceof Error ? e.message : '無法取得歷史行情') }
    finally { if (live.current && revision.current === request) setLoading(false) }
  }
  const completeDay=!!data.history.quantityDays?.find(d=>d.date===date)?.inventory
  const originalQuantity=selected ? (expected ? resolveCompletion(data,expected).entries : entriesForDate(data,date)).find(e=>instrumentKey(e)===instrumentKey(selected))?.quantity?.toString() ?? '' : ''
  const changed=quantity!==originalQuantity || date!==initialDate || mode!=='day' || !!end || !!symbol || currency!=='TWD' || type!=='holding' || !!preview || !!periodPreview || loading
  const exit=useHistoryExit(changed,()=>{revision.current++;onCancel()})
  const active = preview?.entries.find(e => selected && instrumentKey(e) === instrumentKey(selected))
  const steps = ['選帳戶','選標的','日期與數量','預覽確認']
  return <dialog ref={editor} className="review quantity-editor form" aria-label="編輯歷史數量" onKeyDown={exit.onKeyDown} onCancel={e => { e.preventDefault(); exit.close() }}>
    <p className="eyebrow">{editingDay ? `編輯 ${initialDate} · ${step===-1 ? '選擇項目' : step===2 ? '修改數量' : '確認修改'}` : `新增補登 · 步驟 ${step + 1}／4`}</p><h4 tabIndex={-1}>{step===-1 ? '選擇要修改的項目' : editingDay && step===2 ? '修改當日數量' : steps[step]}</h4>
    {step===-1 && <>
      <p className="muted small">這天有 {editEntries.length} 項紀錄。選擇一項修改，其餘資料保留。</p>
      <div className="history-item-choices">{editEntries.map(entry=><button key={instrumentKey(entry)} onClick={()=>{ resetPreview(); setAccountId(entry.accountId); setSelectedKey(instrumentKey(entry)); setQuantity(entry.quantity?.toString() ?? ''); setStep(2) }}>
        <strong>{entry.account}</strong><span>{entry.type==='cash' ? '現金餘額' : entry.symbol} · {entry.currency}</span><span>既有數量：{entry.quantity===null ? '未知' : fmt(entry.quantity,8)}</span>
      </button>)}</div>
      {!editEntries.length && <p className="notice">這天沒有可修改的項目，請取消後使用「補登歷史數量」。</p>}
    </>}
    {step > 0 && account && <p className="quantity-selection">{existingEntry?.account ?? account.name}{step > 1 && selected && <><br />{selected.type==='cash' ? '現金餘額' : selected.symbol} · {selected.currency}</>}</p>}
    {step === 0 && <>
      <label className="field"><span>補登帳戶</span><select value={accountId} onChange={e => chooseAccount(e.target.value)}><option value="">請選擇帳戶</option>{[...accounts.values()].map(a => <option key={a.id} value={a.id}>{a.name}{data.accounts.some(x => x.id === a.id) ? '' : '（歷史帳戶）'}</option>)}</select></label>
      {!accounts.size && <p className="notice">目前沒有可補登的帳戶，請先到「帳戶」建立一個帳戶。</p>}
    </>}
    {step === 1 && <>
      <label className="field"><span>補登標的</span><select value={selectedKey} onChange={e => chooseInstrument(e.target.value)}><option value="">請選擇標的</option>{choices.map(e => <option key={instrumentKey(e)} value={instrumentKey(e)}>{e.type === 'cash' ? '現金餘額' : e.symbol} · {e.currency}</option>)}<option value="__new__">其他／已移除的標的</option></select></label>
      {!choices.length && <p className="notice">此帳戶目前沒有持倉，可選「其他／已移除的標的」補登。</p>}
      {selectedKey === '__new__' && <>
        <label className="field"><span>歷史持倉類型</span><select value={type} onChange={e => { resetPreview(); setType(e.target.value as typeof type) }}><option value="holding">持倉</option><option value="cash">現金</option></select></label>
        {type === 'holding' && <label className="field"><span>歷史標的代號</span><input value={symbol} onChange={e => { resetPreview(); setSymbol(e.target.value) }} /></label>}
        <label className="field"><span>歷史持倉幣別</span><input value={currency} onChange={e => { resetPreview(); setCurrency(e.target.value) }} /></label>
        <p className="muted small">只補登歷史，不新增目前持倉；沒有市場行情時保留數量，估值為未知。</p>
      </>}
    </>}
    {step === 2 && selected && <>
      {!editingDay && <label className="field"><span>補登方式</span><select value={mode} onChange={e=>{resetPreview();setMode(e.target.value as typeof mode)}}><option value="day">單日數量</option><option value="period">持有期間</option></select></label>}
      <label className="field"><span>{mode==='period' ? '開始日期（含）' : '歷史日期'}</span><input type="date" max={mode==='day' ? localDate(stamp()) : undefined} disabled={mode==='day' && !!expected} value={date} onChange={e => changeDate(e.target.value)} /></label>
      {mode==='period' && <>
        <label className="field"><span>結束／賣出日期（不含，選填）</span><input type="date" value={end} onChange={e=>{resetPreview();setEnd(e.target.value)}} /></label>
        <p className="muted small">例如 9/1 買入、10/2 全部賣出：9/1–10/1 持有，10/2 收盤為 0；後續再買紀錄優先。空白表示持續持有的歷史基準，不能覆蓋目前實際持倉。</p>
        <details><summary>期間日曆時區：{timeZone}</summary><label className="field"><span>期間日曆時區</span><input value={timeZone} onChange={e=>{resetPreview();setTimeZone(e.target.value)}} /></label></details>
      </>}
      {existingEntry && <p className="history-original">既有數量：{existingEntry.quantity===null ? '未知' : fmt(existingEntry.quantity,8)} · 只修改 {initialDate}，目前持倉不變。</p>}
      <label className="field"><span>{mode==='period' ? '期間基準數量' : '當日絕對數量'}</span><input aria-label={`${nameOf({ ...selected,quantity:null })} 當日數量`} inputMode="decimal" value={quantity} onChange={e => { resetPreview(); setQuantity(e.target.value) }} /></label>
      <p className="muted small">填該日的絕對總數量，不是增減量。0 為確定未持有；同帳戶、同標的、同幣別合計所有批次。{completeDay ? '完整清單須保留已知數量，不能留空。' : '空白為未知。'}</p>
      {mode==='day' && !completeDay && <button onClick={() => { resetPreview(); setQuantity('') }}>清除數量（未知）</button>}
    </>}
    {step === 3 && active && <>
      <p><strong>{date}</strong> · 數量 {active.quantity === null ? '未知' : fmt(active.quantity,8)}</p><Valuation entry={active} />
      <p className="notice" role="status">當日總資產：{total === null ? '資料不完整，圖表顯示缺口' : `NT$ ${fmt(total,2)}`}。本次修改與當日明確紀錄優先；原有 0 與未知保留，補齊僅作用於這天。</p>
      {preview?.completion && completionView ? <>
        <p><strong>補齊來源：{completionView.source}</strong><br/>目的日：{date}；價格與匯率重新查詢目的日，不沿用來源日。</p>
        <p className="muted small">最近完整清單按日曆距離選取；同距離取較早日期。來源可能晚於目的日，請把當時未持有的補入項目標為 0。</p>
        {data.history.snapshots.find(s=>s.date===date)?.accounts.some(a=>a.value!==0 && !preview.completion?.accounts.some(known=>known.id===a.id)) && <p className="notice">原始快照另有未涵蓋的帳戶，無法從總額還原數量；總資產仍保持未知，原始快照保留。</p>}
        <ul className="period-preview">{completionView.entries.map(e=>{
          const key=instrumentKey(e), filled=completionView.filled.includes(key)
          const label=selected && key===instrumentKey(selected) ? '本次修改' : filled ? '來源補入' : e.quantity===null ? '保留未知' : '保留目的日數量'
          return <li key={key}><strong>{nameOf(e)}</strong><p>{label}：{e.quantity===null?'未知':fmt(e.quantity,8)}</p><Valuation entry={e}/>{filled && <label><input type="checkbox" checked={completionView.zeros.includes(key)} onChange={event=>void prepare(event.target.checked ? [...completionView.zeros,key] : completionView.zeros.filter(k=>k!==key))}/> 目的日未持有（填 0）</label>}</li>
        })}</ul>
        <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 我已核對來源與目的日差異，確認當日補齊範圍；既有未知不自動補成 0。</label>
      </> : !preview?.inventory && <p className="notice">沒有可用的完整基底；維持單項補登，其餘未記錄數量保持未知。</p>}
      <p className="muted small">價格與匯率只取市場來源；不使用手填歷史價。負債沿用當日紀錄，沒有紀錄時以 0 計，並標示為未記錄。</p>
    </>}
    {step===3 && periodPreview && <>
      <p><strong>{periodPreview.period.start} 至 {periodPreview.period.end ?? '持續持有'}</strong> · 基準數量 {fmt(periodPreview.period.quantity,8)}</p>
      <p className="notice" role="status">期間預覽：{periodPreview.days.length} 個日期；{periodPreview.days.filter(d=>quantityPoint(d).total===null).length} 日資料不完整。開始含、結束不含；只重建已結束日，今天仍顯示目前持倉。近十年逐日使用市場價格與匯率。已有原始快照保留原值；需要修正該日請使用單日補登。</p>
      <p className="muted small">較晚開始的期間接手後，舊期間不會恢復；單日及數量異動在同日優先，持續到下一個明確基準。期間內的加減碼請分段或保留明確數量紀錄。</p>
      <ul className="period-preview">{periodPreview.days.filter(d=>[periodPreview.period.start,periodPreview.period.end,periodPreview.period.end ? shiftDate(periodPreview.period.end,-1):'',periodPreview.days.at(-1)?.date].includes(d.date)).map(day=>{
        const entry=day.entries.find(e=>instrumentKey(e)===instrumentKey(periodPreview.period))!
        const old=periodQuantityOn(periodPreview.before,periodPreview.period,day.date)?.quantity ?? entriesForDate(periodPreview.before,day.date).find(e=>instrumentKey(e)===instrumentKey(periodPreview.period))?.quantity
        return <li key={day.date}><strong>{day.date}</strong><p>數量 {old ?? '未知'} → {entry.quantity ?? '未知'}</p><Valuation entry={entry}/></li>
      })}</ul>
      {!!periodPreview.conflicts.length && <><details open><summary>需確認的重疊／明確紀錄（{periodPreview.conflicts.length}）</summary><ul>{periodPreview.conflicts.map((message,i)=><li key={i}>{message}</li>)}</ul></details><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> 我已核對差異，同意依上述優先順序套用；原紀錄保留。</label></>}
    </>}
    {error && <p role="alert" className="banner error">{error}</p>}
    {busy && <p role="status">背景作業中，請稍後再儲存。</p>}
    <div className="quantity-actions">
      {step === 0 && <button className="primary" disabled={!account} onClick={() => setStep(1)}>下一步：選標的</button>}
      {step === 1 && <button className="primary" disabled={!selected} onClick={goToQuantity}>下一步：填數量</button>}
      {step === 2 && <button className="primary" disabled={loading || busy} onClick={() => void prepare()}>{loading ? '取得歷史行情中…' : '取得歷史估值'}</button>}
      {step === 3 && <button className="primary" disabled={loading || busy} onClick={() => { try { if (busy) throw new Error('背景作業中，請稍後再儲存'); if(periodPreview) onApply(applyHoldingPeriod(latest.current,periodPreview.period,periodPreview.revision,confirmed)); else if (preview && completionView) onApply(applyCompletion(latest.current,preview,completionView.revision,confirmed)) } catch (e) { setError(e instanceof Error ? e.message : '無法套用') } }}>儲存歷史數量</button>}
      {step > 0 && (!editingDay || step===3 || editEntries.length>1) && <button onClick={() => { resetPreview(); setStep(editingDay && step===2 ? -1 : step - 1) }}>{step === 3 ? '返回修改' : editingDay ? '改選其他項目' : '上一步'}</button>}
      <button onClick={exit.close}>取消歷史編輯</button>
    </div>
    <p className="muted small">確認後直接儲存歷史修改；目前持倉不變。</p>
  </dialog>
}

export function Valuation({ entry: e, showValue = true }: { entry: QuantityEntry; showValue?: boolean }) {
  const value = entryValue(e)
  const price = e.price?.source === 'Yahoo' ? `Yahoo ${e.price.symbol} · ${e.price.date} 收盤 ${fmt(e.price.value, 6)} ${e.currency}` : undefined
  return (
    <div className="small">
      {showValue && <span>{value === null ? '估值未知' : `NT$ ${fmt(value, 2)}`}</span>}
      {e.quantity !== null && e.quantity !== 0 && (
        <>
          <div>{e.type === 'cash' ? '單位值 1' : (price ?? '缺歷史收盤價')}</div>
          <div>{e.currency === 'TWD' ? 'TWD 匯率 1' : e.fx ? <HistoricalFxValue quote={e.fx}/> : '缺歷史匯率'}</div>
        </>
      )}
      {e.error && <p className="notice">{e.error}</p>}
    </div>
  )
}

// `carried`: the earlier value the day's total uses when this entry is unknown (carriedEntry).
export function QuantityRecord({ entry, actions, carried }: { entry: QuantityEntry; actions: ReactNode; carried?: { value: number; note: string } }) {
  const value = entryValue(entry) ?? carried?.value ?? null
  const title = `${accountLabel({name:entry.account,country:entry.country})} · ${entry.symbol || entry.currency}${entry.symbol ? ` · ${entry.currency}` : ''}`
  return <DetailRecord className="quantity-record" title={title} label={`查看來源 ${title}`} actions={actions} meta={carried?.note}
    value={value === null ? <strong className="record-unknown">估值未知</strong> : <span className="record-money"><small>NT$</small><strong>{fmt(value, 2)}</strong></span>}>
    <p>{title}</p>
    {carried && <p className="muted small">這天沒有這項的數量或行情，總資產{carried.note}的金額。可按編輯補登這天的實際數量。</p>}
    <p>數量 {entry.quantity === null ? '未知' : fmt(entry.quantity, 8)}{entry.quantityAsOf && ` · 數量基準 ${entry.quantityAsOf}`}</p>
    <Valuation entry={entry} showValue={false} />
  </DetailRecord>
}
