import { useEffect, useRef, useState } from 'react'
import { expenseMonthSummary, expenseCategory, type Expense, type ExpenseCategoryRule } from '../expenses'
import { fmt } from '../format'
import { ActionIcon } from './ActionIcon'

export function ExpenseSummary({expenses,now,onGoExpenses,rules = []}: {expenses:Expense[];now:string;onGoExpenses?:()=>void;rules?:ExpenseCategoryRule[]}) {
  const [selectedMonth,setSelectedMonth] = useState('')
  const date = new Date(now)
  const currentMonth = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
  const month = selectedMonth || currentMonth
  const months = [...new Set([currentMonth,month,...expenses.map(e=>e.date.slice(0,7))])].sort().reverse()
  const groups = expenseMonthSummary(expenses,month,rules)
  const rows = expenses.filter(e=>e.date.slice(0,7)===month).sort((a,b)=>b.date.localeCompare(a.date))
  const timeline = [...months].reverse()
  const index = timeline.indexOf(month)
  const timelineRef = useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const container = timelineRef.current
    const active = container?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if(container && active) container.scrollLeft += active.getBoundingClientRect().left - container.getBoundingClientRect().left
  },[month,months.length])
  return <section className="panel span-2 expense-summary" aria-label="消費統計">
    <div className="panel-head"><div><span className="eyebrow">每月消費總覽 · {rows.length} 筆交易</span><h3>支出儀表板</h3></div><div className="row"><span className="expense-month-picker"><select aria-label="消費統計月份" value={month} onChange={e=>setSelectedMonth(e.target.value)}>{months.map(m=><option key={m} value={m}>{m.replace('-', ' / ')}</option>)}</select><ActionIcon name="next"/></span>{onGoExpenses && <button onClick={onGoExpenses}>查看消費明細</button>}</div></div>
    <nav className="expense-timeline" aria-label="消費月份時間線">
      <button className="timeline-arrow" aria-label="上一個消費月份" disabled={index===0} onClick={()=>setSelectedMonth(timeline[index-1])}><ActionIcon name="previous"/></button>
      <div className="expense-month-nodes" ref={timelineRef}>{timeline.map(m=><button key={m} aria-pressed={m===month} onClick={()=>setSelectedMonth(m)}><span aria-hidden="true"/>{m.replace('-', '.')}</button>)}</div>
      <button className="timeline-arrow" aria-label="下一個消費月份" disabled={index===timeline.length-1} onClick={()=>setSelectedMonth(timeline[index+1])}><ActionIcon name="next"/></button>
    </nav>
    {!groups.length ? <p className="muted">{expenses.length?'這個月尚無消費紀錄，可切換月份查看。':'尚未匯入消費明細。'}</p> : <div className="expense-dashboard-currencies">{groups.map(g=><div className="expense-currency-summary" key={g.currency} aria-label={`${g.currency} 消費統計`}>
      <div className="expense-currency-title"><strong>{g.currency}</strong><span className="muted small">{g.count} 筆交易</span></div>
      <dl className="expense-metrics"><div><dt>消費</dt><dd>{fmt(g.spending)}</dd></div><div><dt>退款</dt><dd>{fmt(g.refunds)}</dd></div><div><dt>淨支出</dt><dd>{fmt(g.net)}</dd></div></dl>
      <details className="expense-dashboard-breakdown"><summary>查看分類與卡片分析</summary>
      <h4 className="expense-breakdown-title">消費分類</h4>
      {g.spending>0 ? <ul className="expense-category-bars">{g.categories.filter(c=>c.spending>0).map(c=><li key={c.category}>
        <div><span>{c.category}</span><span>{fmt(c.spending)} <small className="muted">{Math.round(c.spending/g.spending*100)}%</small></span></div>
        <div className="expense-category-track" aria-hidden="true"><span style={{width:`${c.spending/g.spending*100}%`}}/></div>
      </li>)}</ul> : <p className="muted small">只有退款，沒有消費分類佔比。</p>}
      <h4 className="expense-breakdown-title">銀行／卡片</h4>
      <div className="table-wrap"><table className="data"><thead><tr><th>銀行／卡片</th><th className="num">筆數</th><th className="num">淨支出（{g.currency}）</th></tr></thead><tbody>{g.cards.map(c=><tr key={c.card}><td>{c.card}</td><td className="num">{c.count}</td><td className="num">{fmt(c.net)}</td></tr>)}</tbody></table></div>
      </details>
    </div>)}</div>}
    {!!rows.length && <details className="expense-period-details"><summary>{month.replace('-', ' / ')} 交易明細 · {rows.length} 筆</summary><div className="table-wrap"><table className="data expense-table"><thead><tr><th>日期</th><th>銀行／卡片</th><th>商家／說明</th><th>類別</th><th className="num">金額</th></tr></thead><tbody>{rows.map(e=><tr key={e.id}><td>{e.date}</td><td>{e.card}</td><td>{e.description}</td><td>{expenseCategory(e,rules)}</td><td className="num">{e.currency} {fmt(e.amount)}</td></tr>)}</tbody></table></div></details>}
    <p className="muted small">依交易日期統計，退款扣除後為淨支出。分類依自訂規則與商家關鍵字初判，可在明細修改；分類圖不含退款。不同幣別分開計算，消費不扣除資產餘額。</p>
  </section>
}
