import { useState } from 'react'
import { cashflowMonthList, cashflowSummary, type CashflowInput, type CashflowPeriod, type CashflowReviewTotals } from '../cashflow'
import { fmt } from '../format'
import { CashflowChart, CashflowCategories } from './CashflowChart'

export interface CashflowSummaryProps extends CashflowInput {
  now: string
  onGoExpenses?: () => void
  onGoBankTransactions?: () => void
}
function Review({label,total,currency}: {label:string;total:CashflowReviewTotals;currency:string}) {
  return <div className="cashflow-review-item"><strong>{label} · {total.count} 筆</strong><span>支出方向 {total.debitCount} 筆 · {currency} {fmt(total.debitAmount)}</span><span>入帳方向 {total.creditCount} 筆 · {currency} {fmt(total.creditAmount)}</span></div>
}

export function CashflowSummary({now,onGoExpenses,onGoBankTransactions,...input}: CashflowSummaryProps) {
  const date=new Date(now)
  const currentMonth=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
  const [endMonth,setEndMonth]=useState(currentMonth)
  const [period,setPeriod]=useState<CashflowPeriod>(3)
  const [currency,setCurrency]=useState('')
  const [mode,setMode]=useState<'trend'|'income'|'expense'>('trend')
  const [selectedMonth,setSelectedMonth]=useState('')
  const monthOptions=[...new Set([currentMonth,endMonth,...cashflowMonthList(input)])].sort().reverse()
  const groups=cashflowSummary(input,endMonth,period)
  const group=groups.find(g=>g.currency===currency)??groups[0]
  const selected=group?.months.find(m=>m.month===selectedMonth)??group?.months.at(-1)
  const selectMonth=(month:string)=>{setSelectedMonth(month);setEndMonth(month)}
  return <section className="panel span-2 cashflow-summary" aria-label="統一收支總覽">
    <div className="panel-head"><div><span className="eyebrow">銀行流水 × 信用卡消費</span><h3>收支總覽</h3></div><div className="row cashflow-source-links">
      {onGoBankTransactions && <button onClick={onGoBankTransactions}>銀行流水</button>}
      {onGoExpenses && <button onClick={onGoExpenses}>信用卡消費</button>}
    </div></div>
    <div className="cashflow-controls">
      <label className="field"><span>截止月份</span><select aria-label="收支截止月份" value={endMonth} onChange={e=>{setEndMonth(e.target.value);setSelectedMonth(e.target.value)}}>{monthOptions.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
      <div className="field"><span>分析期間</span><div className="segmented" role="group" aria-label="收支分析期間">{([1,3,6,12] as const).map(n=><button key={n} aria-pressed={period===n} className={period===n?'on':''} onClick={()=>setPeriod(n)}>近 {n} 月</button>)}</div></div>
      {!!groups.length && <label className="field"><span>幣別（各自計算）</span><select aria-label="收支幣別" value={group.currency} onChange={e=>setCurrency(e.target.value)}>{groups.map(g=><option key={g.currency}>{g.currency}</option>)}</select></label>}
    </div>
    <p className="muted small">收入 − 實際消費為收支差額，不是帳戶餘額或淨資產，也不保證完整現金流。幣別分開計算，不換算為單一總額。</p>
    {!group ? <p className="cashflow-no-record muted">這段期間無紀錄。可切換截止月份或期間；無紀錄不代表收支為零。</p>:<>
      <div className="cashflow-currency-heading"><strong>{group.currency}</strong><span className="muted small">截至 {endMonth} · {period} 個月 · {group.coverage.recordCount} 筆已匯入紀錄</span></div>
      <dl className="cashflow-metrics">{([['income','收入',group.income],['consumption','實際消費',group.consumption],['difference','收支差額',group.difference]] as const).map(([key,label,value])=><div key={key}><dt>{label}</dt><dd data-cashflow-metric={key}>{fmt(value)}</dd></div>)}</dl>
      <p className="notice small">資料覆蓋：{group.coverage.recordedMonths} / {period} 個月有紀錄；有紀錄或零值不代表完整月份。無紀錄月份以「無紀錄」表示。{endMonth===currentMonth?'本月尚未結束，資料可能不完整。':''}</p>
      {group.investmentRecovery.hasRecords && <p className="notice" role="note">投資回收款：可能包含投入本金，不代表投資收益</p>}
      <div className="cashflow-chart-block">
        <div className="segmented" role="group" aria-label="收支圖表模式">{([['trend','趨勢'],['income','收入分類'],['expense','消費分類']] as const).map(([key,label])=><button key={key} className={mode===key?'on':''} aria-pressed={mode===key} onClick={()=>setMode(key)}>{label}</button>)}</div>
        {mode==='trend'?<>
          <CashflowChart months={group.months} currency={group.currency} selectedMonth={selected?.month??endMonth} onSelectMonth={selectMonth}/>
          {selected && <p className="cashflow-month-selection" aria-live="polite">已選 {selected.month} · 收入 {selected.income===null?'無紀錄':fmt(selected.income)} · 實際消費 {selected.consumption===null?'無紀錄':fmt(selected.consumption)} · 差額 {selected.difference===null?'無紀錄':fmt(selected.difference)}（{group.currency}）</p>}
        </>:<CashflowCategories categories={mode==='income'?group.incomeCategories:group.consumptionCategories} total={mode==='income'?group.income:group.consumption} currency={group.currency}/>}
      </div>
      <div className="cashflow-review" aria-label="未計入收支的銀行流水">
        <h4>未計入收支 · 請核對用途</h4>
        <Review label="待確認" total={group.pending} currency={group.currency}/>
        <Review label="已排除" total={group.excluded} currency={group.currency}/>
        {group.exclusions.map(t=><Review key={t.reason} label={t.reason} total={t} currency={group.currency}/>)}
        {onGoBankTransactions && <button className="link" onClick={onGoBankTransactions}>前往銀行流水修正分類</button>}
      </div>
      <details className="cashflow-sources"><summary>查看來源 · 明細分開管理</summary><div><h4>銀行流水 · {group.coverage.bankCount} 筆</h4><p className="muted small">依銀行記帳日；收入沖回從收入扣除，消費退款從消費扣除。待確認與排除只列示，不計入收支。</p>{onGoBankTransactions && <button onClick={onGoBankTransactions}>查看銀行流水明細</button>}</div><div><h4>信用卡消費 · {group.coverage.cardCount} 筆</h4><p className="muted small">依原交易日期與帶符號金額；信用卡退款扣除消費。此入口僅含信用卡，不混入銀行流水。</p>{onGoExpenses && <button onClick={onGoExpenses}>查看信用卡消費明細</button>}</div></details>
    </>}
  </section>
}
