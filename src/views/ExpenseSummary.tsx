import { useState } from 'react'
import { expenseMonthSummary, type Expense } from '../expenses'
import { fmt } from '../format'

export function ExpenseSummary({expenses,now,onGoExpenses}: {expenses:Expense[];now:string;onGoExpenses?:()=>void}) {
  const [selectedMonth,setSelectedMonth] = useState('')
  const date = new Date(now)
  const currentMonth = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
  const month = selectedMonth || currentMonth
  const months = [...new Set([currentMonth,month,...expenses.map(e=>e.date.slice(0,7))])].sort().reverse()
  const groups = expenseMonthSummary(expenses,month)
  return <section className="panel span-2 expense-summary" aria-label="消費統計">
    <div className="panel-head"><div><span className="eyebrow">消費明細</span><h3>每月支出</h3></div><div className="row"><select aria-label="消費統計月份" value={month} onChange={e=>setSelectedMonth(e.target.value)}>{months.map(m=><option key={m} value={m}>{m.replace('-', ' / ')}</option>)}</select>{onGoExpenses && <button onClick={onGoExpenses}>查看消費明細</button>}</div></div>
    {!groups.length ? <p className="muted">{expenses.length?'這個月尚無消費紀錄，可切換月份查看。':'尚未匯入消費明細。'}</p> : groups.map(g=><div className="expense-currency-summary" key={g.currency} aria-label={`${g.currency} 消費統計`}>
      <div className="expense-currency-title"><strong>{g.currency}</strong><span className="muted small">{g.count} 筆交易</span></div>
      <dl className="expense-metrics"><div><dt>消費</dt><dd>{fmt(g.spending)}</dd></div><div><dt>退款</dt><dd>{fmt(g.refunds)}</dd></div><div><dt>淨支出</dt><dd>{fmt(g.net)}</dd></div></dl>
      <div className="table-wrap"><table className="data"><thead><tr><th>銀行／卡片</th><th className="num">筆數</th><th className="num">淨支出（{g.currency}）</th></tr></thead><tbody>{g.cards.map(c=><tr key={c.card}><td>{c.card}</td><td className="num">{c.count}</td><td className="num">{fmt(c.net)}</td></tr>)}</tbody></table></div>
    </div>)}
    <p className="muted small">依交易日期統計，退款扣除後為淨支出。不同幣別分開計算；消費紀錄不會扣除資產餘額。</p>
  </section>
}
