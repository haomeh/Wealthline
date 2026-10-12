import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { cashflowMonthList, cashflowSummary, type CashflowInput, type CashflowReviewTotals, type CashflowCurrencySummary } from '../cashflow'
import { fmt } from '../format'
import { CashflowChart } from './CashflowChart'
import { cashflowInTwd } from '../cashflowFx'
import { fetchHistory } from '../priceHistory'

export interface CashflowSummaryProps extends CashflowInput {
  now: string
  onGoExpenses?: () => void
  onGoBankTransactions?: () => void
}
function Review({label,total,currency}: {label:string;total:CashflowReviewTotals;currency:string}) {
  return <div className="cashflow-review-item"><strong>{label} · {total.count} 筆</strong><span>支出方向 {total.debitCount} 筆 · {currency} {fmt(total.debitAmount)}</span><span>入帳方向 {total.creditCount} 筆 · {currency} {fmt(total.creditAmount)}</span></div>
}
type Selection = {range:'month'|'year'|'all';year:number;month:number}
const monthKey=(year:number,month:number)=>`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}`
const monthSelection=(key:string):Selection=>({range:'month',year:Number(key.slice(0,4)),month:Number(key.slice(5,7))})

export function CashflowSummary({now,onGoExpenses,onGoBankTransactions,...input}: CashflowSummaryProps) {
  const date=new Date(now)
  const currentMonth=monthKey(date.getFullYear(),date.getMonth()+1)
  const {expenses,expenseRules,bankTransactions,bankRules,months}=input
  const monthList=useMemo(()=>cashflowMonthList({expenses,bankTransactions,months}),[expenses,bankTransactions,months])
  const recordedMonths=new Set(monthList)
  // An imported statement is usually for an earlier month: without records this month, open on the latest one.
  const latestMonth=monthList.find(month=>month<=currentMonth) ?? monthList[0]
  const [selection,setSelection]=useState<Selection>(()=>monthSelection(recordedMonths.has(currentMonth) || !latestMonth || latestMonth>currentMonth ? currentMonth : latestMonth))
  const [draft,setDraft]=useState(selection)
  const [open,setOpen]=useState(false)
  const pickerId=useId()
  const trigger=useRef<HTMLButtonElement>(null)
  const endMonth=monthKey(selection.year,selection.range==='year'?12:selection.month)
  const period=selection.range==='all'?'all':selection.range==='year'?12:1
  const rawGroups=useMemo(()=>cashflowSummary({expenses,expenseRules,bankTransactions,bankRules,months},endMonth,period),[expenses,expenseRules,bankTransactions,bankRules,months,endMonth,period])
  const today=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  const needsFx=rawGroups.some(group=>group.currency!=='TWD')
  const [attempt,setAttempt]=useState(0)
  const [conversion,setConversion]=useState<{source:typeof rawGroups;today:string;attempt:number;group?:CashflowCurrencySummary;error?:string}>()
  useEffect(()=>{
    if(!needsFx) return
    let active=true
    cashflowInTwd(rawGroups,today,(symbol,from)=>fetchHistory(symbol,from,attempt>0)).then(group=>{
      if(active) setConversion({source:rawGroups,today,attempt,group})
    },error=>{
      if(active) setConversion({source:rawGroups,today,attempt,error:error instanceof Error?error.message:'匯率查詢失敗'})
    })
    return ()=>{active=false}
  },[rawGroups,today,attempt,needsFx])
  const current=conversion?.source===rawGroups && conversion.today===today && conversion.attempt===attempt?conversion:undefined
  const groups=needsFx?(current?.group?[current.group]:[]):rawGroups
  const loading=needsFx && !current

  const label=selection.range==='all'?'全部期間':`${selection.year} 年${selection.range==='month'?` ${selection.month} 月`:''}`
  const close=()=>{setOpen(false);trigger.current?.focus()}
  return <section className="panel span-2 cashflow-summary" aria-label="統一收支總覽">
    <div className="panel-head"><h3>收支總覽</h3><div className="row cashflow-source-links">
      {onGoBankTransactions && <button onClick={onGoBankTransactions}>銀行流水</button>}
      {onGoExpenses && <button onClick={onGoExpenses}>信用卡消費</button>}
    </div></div>
    <button ref={trigger} className="cashflow-period-trigger" aria-label={`選擇收支期間：${label}`} aria-expanded={open} aria-controls={pickerId} onClick={()=>{if(open){close();return}setDraft(selection);setOpen(true)}}>{label}<span aria-hidden="true"> ▾</span></button>
    {open && <section id={pickerId} className="cashflow-picker" aria-label="時間選擇" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();close()}}}>
      <div className="cashflow-picker-head"><button autoFocus onClick={close}>取消</button><strong>時間選擇</strong><button onClick={()=>{setSelection(draft);close()}}>套用</button></div>
      <div className="segmented" role="group" aria-label="時間範圍">{([['month','月份'],['year','年度'],['all','全部期間']] as const).map(([range,text])=><button key={range} aria-pressed={draft.range===range} className={draft.range===range?'on':''} onClick={()=>setDraft({...draft,range})}>{text}</button>)}</div>
      {draft.range!=='all' && <div className="cashflow-picker-year"><button aria-label="前一年" disabled={draft.year<=1} onClick={()=>setDraft({...draft,year:draft.year-1})}>‹</button><strong>{draft.year} 年</strong><button aria-label="後一年" disabled={draft.year>=9999} onClick={()=>setDraft({...draft,year:draft.year+1})}>›</button></div>}
      {draft.range==='month' && <><div className="cashflow-month-grid">{Array.from({length:12},(_,i)=>{
        const month=i+1, hasData=recordedMonths.has(monthKey(draft.year,month))
        return <button key={month} aria-label={`${month} 月${hasData?'，有紀錄':''}`} aria-pressed={draft.month===month} className={hasData?'has-records':''} onClick={()=>setDraft({...draft,month})}>{month} 月</button>
      })}</div><p className="muted small">圓點表示有紀錄</p></>}
    </section>}
    {loading && <p role="status" className="notice">正在換算每月匯率…</p>}
    {needsFx && current?.error && <div role="alert" className="notice"><p>無法完成 TWD 換算：{current.error}。未顯示部分合計。</p><button onClick={()=>setAttempt(attempt+1)}>重試匯率</button></div>}
    {!rawGroups.length ? <div className="cashflow-no-record"><p className="muted">這段期間無紀錄，不代表收支為零。</p>
      {latestMonth && <button onClick={()=>setSelection(monthSelection(latestMonth))}>查看 {Number(latestMonth.slice(0,4))} 年 {Number(latestMonth.slice(5,7))} 月</button>}
    </div>:groups.map(group=><section className="cashflow-currency" key={group.currency} aria-label={`${group.currency} 收支`}>
      <div className="cashflow-currency-heading"><strong>{group.currency}</strong><span className="muted small">{group.coverage.recordCount} 筆紀錄</span></div>
      {group.pending.count>0 && <p className="notice small cashflow-pending" role="note" data-cashflow-pending><span>{group.pending.count} 筆銀行流水未分類，不計入收入或消費；分類後才會計入。</span>{onGoBankTransactions && <button className="link" onClick={onGoBankTransactions}>前往分類</button>}</p>}
      <CashflowChart group={group}/>
      {group.investmentRecovery.hasRecords && <p className="notice small" role="note">投資回收款：可能包含投入本金，不代表投資收益</p>}
      <details className="cashflow-review"><summary>待確認 {group.pending.count} 筆 · 已排除 {group.excluded.count} 筆</summary>
        <Review label="待確認" total={group.pending} currency={group.currency}/>
        <Review label="已排除" total={group.excluded} currency={group.currency}/>
        {group.exclusions.map(t=><Review key={t.reason} label={t.reason} total={t} currency={group.currency}/>)}
        {onGoBankTransactions && <button className="link" onClick={onGoBankTransactions}>前往銀行流水修正分類</button>}
      </details>
      <details className="cashflow-sources"><summary>查看來源 · 明細分開管理</summary><div><h4>銀行流水 · {group.coverage.bankCount} 筆</h4><p className="muted small">依銀行記帳日；收入沖回從收入扣除，消費退款從消費扣除。待確認與排除只列示，不計入收支。</p>{onGoBankTransactions && <button onClick={onGoBankTransactions}>查看銀行流水明細</button>}</div><div><h4>信用卡消費 · {group.coverage.cardCount} 筆</h4><p className="muted small">依原交易日期與帶符號金額；信用卡退款扣除消費。此入口僅含信用卡，不混入銀行流水。</p>{onGoExpenses && <button onClick={onGoExpenses}>查看信用卡消費明細</button>}</div></details>
    </section>)}
    <p className="cashflow-footnote muted small">依已匯入紀錄，不代表完整月份。{selection.range==='month' && selection.year===date.getFullYear() && selection.month===date.getMonth()+1?'本月尚未結束。':''}收支差額不是帳戶餘額或淨資產；金額統一換算 TWD，依各月月底已完成匯率；本月採最新已完成匯率（最多回溯 7 日）。</p>
  </section>
}
