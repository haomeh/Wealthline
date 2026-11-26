import { useEffect, useMemo, useRef, useState } from 'react'
import { useHistoryExit } from '../useHistoryExit'
import { useCalendarNow } from '../useCalendarNow'
import { accountLabel, type WealthData } from '../model'
import { createPeriodIndex } from '../holdingPeriods'
import { localDate } from '../history'
import { applyBaseline, baselineDay, baselineRevision, quantityBaselines, type QuantityBaseline } from '../historyBaseline'
import { historyCatalog, instrumentKey, quantityPoint, valueEntries, type QuantityDay } from '../quantityHistory'
import { fmt } from '../format'
import { HistoricalFxValue } from './HistoricalFxValue'

export function HistoryBaseline({data,busy=false,initialDate='',onApply,onCancel}:{data:WealthData;busy?:boolean;initialDate?:string;onApply:(data:WealthData)=>void;onCancel:()=>void}) {
  const now=useCalendarNow()
  const sources=quantityBaselines(data,now)
  const original=data.history.quantityDays?.find(d=>d.date===initialDate)
  const initialSource=initialDate ? sources.find(s=>s.kind==='day' && s.date===initialDate && !s.error) ?? sources.filter(s=>s.kind==='day' && s.date<initialDate && !s.error).sort((a,b)=>b.date.localeCompare(a.date))[0] ?? sources.find(s=>s.id==='current') : undefined
  const [initialValues]=useState(()=>Object.fromEntries((initialSource?.entries ?? []).map(e=>[instrumentKey(e),(original?.entries.find(x=>instrumentKey(x)===instrumentKey(e)) ?? e).quantity?.toString() ?? ''])))
  const [sourceId,setSourceId]=useState(initialSource?.id ?? '')
  const [initialSourceId]=useState(sourceId)
  const [date,setDate]=useState(initialDate)
  const [values,setValues]=useState<Record<string,string>>(initialValues)
  const [complete,setComplete]=useState(false)
  const [confirmed,setConfirmed]=useState(false)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(false)
  const [preview,setPreview]=useState<{day:QuantityDay;revision:string;before:WealthData;source:QuantityBaseline}|null>(null)
  const latest=useRef(data), live=useRef(true), request=useRef(0), region=useRef<HTMLDialogElement>(null)
  useEffect(()=>{latest.current=data},[data])
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  const previewing=!!preview
  useEffect(()=>{const dialog=region.current;if(dialog&&!dialog.open)dialog.showModal()},[])
  useEffect(()=>{region.current?.querySelector<HTMLElement>('h4')?.focus()},[previewing])
  const source=sources.find(s=>s.id===sourceId)
  const selectedRevision=useRef(initialSource ? JSON.stringify(initialSource) : '')
  const reset=()=>{request.current++;setLoading(false);setPreview(null);setConfirmed(false);setError('')}
  const select=(id:string)=>{
    reset();setSourceId(id);setComplete(false)
    const chosen=sources.find(s=>s.id===id)
    setValues(Object.fromEntries((chosen?.entries ?? []).map(e=>[instrumentKey(e),e.quantity?.toString() ?? ''])))
    selectedRevision.current=JSON.stringify(chosen)
  }
  const prepare=async()=>{
    reset();const token=request.current
    try {
      if(!source || !complete) throw new Error('請先確認來源清單完整及未列項目的範圍')
      if(JSON.stringify(quantityBaselines(latest.current).find(s=>s.id===sourceId))!==selectedRevision.current) throw new Error('來源數量已變更，請重新選取基底')
      const entries=source.entries.map(e=>({...e,quantity:values[instrumentKey(e)]?.trim() ? Number(values[instrumentKey(e)]) : null}))
      const day=baselineDay(source,date,entries,undefined,initialDate ? 'edit' : 'copy'),before=latest.current,revision=baselineRevision(before,sourceId,date)
      setLoading(true)
      const valued={...day,entries:await valueEntries(day.entries,date)}
      if(live.current && request.current===token) setPreview({day:valued,revision,before,source})
    } catch(e) {if(live.current && request.current===token)setError(e instanceof Error?e.message:'無法預覽')}
    finally {if(live.current && request.current===token)setLoading(false)}
  }
  const periodBefore=useMemo(()=>{
    if(!preview) return []
    const lookup=createPeriodIndex(preview.before)
    return historyCatalog(preview.before).flatMap(e=>{const state=lookup(e,preview.day.date);return state?[{...e,...state}]:[]})
  },[preview])
  const previous=preview?.before.history.quantityDays?.find(d=>d.date===date)
  const snapshot=preview?.before.history.snapshots.find(s=>s.date===date)
  const removed=previous?.entries.filter(e=>!preview?.day.entries.some(x=>instrumentKey(x)===instrumentKey(e))) ?? []
  const missingAccounts=snapshot?.accounts.filter(a=>!preview?.day.inventory?.accounts.some(x=>x.id===a.id)) ?? []
  const total=preview ? quantityPoint(preview.day,snapshot).total : null
  const changed=date!==initialDate || complete || confirmed || !!preview || loading || (initialDate ? sourceId!==initialSourceId || JSON.stringify(values)!==JSON.stringify(initialValues) : !!source?.entries.some(e=>values[instrumentKey(e)]!==e.quantity?.toString()))
  const exit=useHistoryExit(changed,()=>{request.current++;onCancel()})
  return <dialog className="review quantity-editor form baseline-editor" ref={region} aria-label={initialDate ? `編輯 ${initialDate} 的持倉數量` : "沿用持倉回補"} onKeyDown={exit.onKeyDown} onCancel={e=>{e.preventDefault();exit.close()}}>
    <p className="eyebrow">{initialDate ? `編輯 ${initialDate} · 完整持倉清單` : '完整清單回補 · 只影響目的日'}</p>
    <h4 tabIndex={-1}>{preview?'確認回補差異':initialDate?'編輯當日持倉數量':'沿用某日持倉，只修改差異'}</h4>
    {!!initialDate && !original?.inventory && <p className="notice">這天沒有完整持倉數量。下方依選定基底帶入清單，相符項目保留已補登的數量；請核對每項當日數量，不能從原始總額快照還原。</p>}
    {!preview ? <>
      <label className="field"><span>持倉基底來源</span><select value={sourceId} onChange={e=>select(e.target.value)}><option value="">請選擇來源</option>{sources.map(s=><option key={s.id} value={s.id}>{s.kind==='current'?'目前持倉（含未儲存修改）':s.date} · {s.entries.length} 項{s.error?' · 不可作完整基底':''}</option>)}</select></label>
      <p className="muted small">只沿用數量／餘額。總額快照及部分／未驗證的歷史清單不能作持倉基底。選擇目前持倉時，以今天畫面上的完整清單為來源。</p>
      {source && <>
        <p className="quantity-selection">來源：{source.kind==='current'?'目前持倉 · ':''}{source.date}<br/>{source.accounts.length} 個帳戶 · {source.entries.length} 項數量</p>
        {source.error ? <p role="alert" className="notice error">{source.error}</p> : <>
          <label className="field"><span>回補目的日期</span><input type="date" readOnly={!!initialDate} max={localDate(now)} value={date} onChange={e=>{reset();setComplete(false);setDate(e.target.value)}}/></label>
          <p className="muted small">數量已帶入，只修改不同的項目。填的是目的日「絕對總數量」，不是增減量；當時未持有請填 0，不可留空。</p>
          {source.accounts.map(a=><fieldset className="baseline-account" key={a.id}><legend>{accountLabel({name:a.name,country:source.entries.find(e=>e.accountId===a.id)?.country})}</legend>{source.entries.filter(e=>e.accountId===a.id).map(e=>{
            const key=instrumentKey(e),text=values[key] ?? '',quantity=text.trim()?Number(text):NaN,delta=Number.isFinite(quantity)?quantity-e.quantity!:null
            return <label className="field" key={key}><span>{e.type==='cash'?'現金餘額':e.symbol} · {e.currency}</span><input aria-label={`${a.name} · ${e.symbol||e.currency} 目的日數量`} inputMode="decimal" value={text} onChange={event=>{reset();setValues(v=>({...v,[key]:event.target.value}))}}/><span className="muted small">來源 {fmt(e.quantity!,8)} → 目的 {Number.isFinite(quantity)?fmt(quantity,8):'待填'} · 差異 {delta===null?'待填':`${delta>0?'+':''}${fmt(delta,8)}`}</span></label>
          })}{!source.entries.some(e=>e.accountId===a.id)&&<p className="muted small">來源清單為空，目的日亦確認無持倉。</p>}</fieldset>)}
          <label className="baseline-confirm"><input type="checkbox" checked={complete} onChange={e=>{reset();setComplete(e.target.checked)}}/><span>我已核對來源清單，並確認以上是目的日的全部帳戶與持倉；未修改項目沿用來源數量，未列項目於目的日未持有。{initialDate ? '儲存只更新這天的歷史數量。' : '此確認不更動來源日。'}</span></label>
          <button className="primary" disabled={busy||loading||!complete} onClick={()=>void prepare()}>{loading?'取得目的日行情中…':'預覽回補差異'}</button>
        </>}
      </>}
    </> : <>
      <p className="quantity-selection">來源：{preview.day.inventory!.source.kind==='current'?'目前持倉 · ':''}{preview.day.inventory!.source.date}<br/>目的：{preview.day.date}<br/>完整範圍：{preview.day.inventory!.accounts.length} 個帳戶 · {preview.day.entries.length} 項</p>
      <p className="notice">目的日總資產：{total===null?'資料不完整（缺少目的日行情）':`NT$ ${fmt(total,2)}`}。價格與匯率只取目的日可用市場行情；負債沿用目的日原紀錄，未記錄則以 0 計並標示。</p>
      <div className="baseline-differences">{preview.day.entries.map(e=>{
        const key=instrumentKey(e),from=preview.source.entries.find(x=>instrumentKey(x)===key),old=previous?.entries.find(x=>instrumentKey(x)===key)
        return <div className="quantity-row" key={key}><strong>{e.account} · {e.symbol||'現金餘額'} · {e.currency}</strong><span>來源 {from?.quantity ?? '未知'} → 目的 {fmt(e.quantity!,8)}（{from?.quantity===e.quantity?'未變':`差異 ${e.quantity!-from!.quantity!>0?'+':''}${fmt(e.quantity!-from!.quantity!,8)}`}）</span>{previous&&<span>目的日原紀錄：{old ? old.quantity===null?'未知':fmt(old.quantity,8) : '未列出'}</span>}{e.price&&<p className="small">Yahoo {e.price.symbol} · {e.price.date} · {fmt(e.price.value,6)} {e.currency}</p>}{e.fx&&<HistoricalFxValue quote={e.fx}/>} {e.error&&<p className="notice">{e.error}</p>}</div>
      })}</div>
      {!!removed.length&&<div className="notice"><strong>目的日將移除的項目（確認當時未持有）</strong>{removed.map(e=><p key={instrumentKey(e)}>{e.account} · {e.symbol||e.currency}：{e.quantity ?? '未知'} → 未持有</p>)}</div>}
      {!!missingAccounts.length&&<div className="notice"><strong>原快照中的以下帳戶不在回補範圍（確認當時未持有）</strong>{missingAccounts.map(a=><p key={a.id}>{a.name} · 原快照 NT$ {fmt(a.value,2)}</p>)}</div>}
      {!!periodBefore.length&&<div className="notice"><strong>目的日原有期間推算</strong><p>完整回補只在目的日優先，以下期間基準及後續日期保持不變。</p>{periodBefore.map(e=><p key={instrumentKey(e)}>{e.account} · {e.symbol||e.currency}：基準日 {e.basisDate}，基準數量 {e.quantity===null?'未知':fmt(e.quantity,8)}（非目的日重新核對數量）</p>)}</div>}
      {(previous||snapshot)&&<p className="notice">目的日已有{previous?'持倉數量紀錄':'原始總額快照'}。套用會以此完整清單取代目的日的歷史估值；原始快照保留，其他日期不變。</p>}
      <label className="baseline-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>我已確認來源、目的日期、完整範圍與上述差異{previous||snapshot||periodBefore.length?'，同意覆寫目的日的數量／估值':''}。目前持倉及{initialDate ? '其他日期' : '來源日'}保持不變。</span></label>
      <div className="quantity-actions"><button className="primary" disabled={busy||!confirmed} onClick={()=>{try{if(busy)throw new Error('背景作業中，請稍後再儲存');onApply(applyBaseline(latest.current,preview.day,sourceId,preview.revision,confirmed,undefined,initialDate ? 'edit' : 'copy'))}catch(e){setError(e instanceof Error?e.message:'無法套用')}}}>儲存完整回補</button><button onClick={reset}>返回調整差異</button></div>
    </>}
    {error&&<p role="alert" className="banner error">{error}</p>}
    <div className="quantity-actions"><button onClick={exit.close}>取消回補</button></div>
    <p className="muted small">確認後直接儲存歷史修改；目前持倉不變。</p>
  </dialog>
}
