import { useId } from 'react'
import type { CashflowMonth, CashflowCategoryTotal } from '../cashflow'
import { fmt } from '../format'

interface TrendProps {
  months: readonly CashflowMonth[]
  currency: string
  selectedMonth: string
  onSelectMonth: (month: string) => void
}
/** The hit rectangle is the plot itself, not the SVG's padded viewport. */
export function CashflowChart({months,currency,selectedMonth,onSelectMonth}: TrendProps) {
  const pattern = useId().replaceAll(':','')
  const values = months.flatMap(m=>[m.income,m.consumption]).filter((v):v is number=>v!==null)
  const min = Math.min(0,...values), max = Math.max(0,...values)
  const range = max-min || 1
  const y = (value:number)=>20+(max-value)/range*160
  const baseline = y(0), step = 560/Math.max(1,months.length)
  return <div className="cashflow-trend">
    <div className="cashflow-legend"><span>● 收入（實心）</span><span>▧ 實際消費（斜線）</span></div>
    <svg viewBox="0 0 624 210" role="img" aria-label={`${currency} 每月收入與實際消費；完整數值見下表`}>
      <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--accent-wash)"/><path d="M-1 1L1-1M0 6L6 0M5 7L7 5" stroke="var(--accent)" strokeWidth="1.5"/></pattern></defs>
      <line x1="32" x2="592" y1={baseline} y2={baseline} stroke="currentColor" opacity=".45"/>
      <text x="28" y={baseline-4} textAnchor="end" fontSize="10" fill="currentColor">0</text>
      {months.map((m,i)=><g key={m.month}>
        {[m.income,m.consumption].map((value,j)=>value===null?null:<rect data-cashflow-bar="" key={j} x={32+i*step+step*(j===0?.18:.52)} y={Math.min(y(value),baseline)} width={step*.28} height={Math.abs(y(value)-baseline)} fill={j===0?'var(--accent)':`url(#${pattern})`} stroke="var(--accent)"><title>{m.month} {j===0?'收入':'實際消費'} {currency} {fmt(value)}</title></rect>)}
        {m.income===null && <text x={32+(i+.5)*step} y="105" textAnchor="middle" fontSize="11" fill="currentColor">—</text>}
        <text x={32+(i+.5)*step} y="202" textAnchor="middle" fontSize="10" fill="currentColor">{m.month.slice(5)}</text>
      </g>)}
      <rect data-cashflow-hit="" x="32" y="20" width="560" height="160" fill="transparent" aria-hidden="true" onClick={e=>{
        const rect=e.currentTarget.getBoundingClientRect()
        if(rect.width<=0 || !months.length) return
        const ratio=(e.clientX-rect.left)/rect.width
        if(ratio<0 || ratio>1) return
        onSelectMonth(months[Math.min(months.length-1,Math.floor(ratio*months.length))].month)
      }}/>
    </svg>
    <div className="cashflow-month-buttons" role="group" aria-label="選擇收支月份">{months.map(m=><button key={m.month} data-cashflow-month={m.month} aria-pressed={selectedMonth===m.month} onClick={()=>onSelectMonth(m.month)} onKeyDown={e=>{if(e.key==='Enter' || e.key===' '){e.preventDefault();onSelectMonth(m.month)}}}>{m.month}</button>)}</div>
    <table className="cashflow-values"><caption>每月完整數值（{currency}）</caption><thead><tr><th>月份</th><th>收入</th><th>實際消費</th><th>差額</th></tr></thead><tbody>{months.map(m=><tr key={m.month} className={m.month===selectedMonth?'cashflow-selected':''}><th scope="row">{m.month}</th>{[m.income,m.consumption,m.difference].map((n,i)=><td key={i}>{n===null?'無紀錄':fmt(n)}</td>)}</tr>)}</tbody></table>
  </div>
}

export function CashflowCategories({categories,currency,total}: {categories:readonly CashflowCategoryTotal<string>[];currency:string;total:number}) {
  const positive=categories.filter(c=>c.net>0)
  const denominator=positive.reduce((sum,c)=>sum+c.net,0)
  return <div className="cashflow-categories">
    {denominator>0 ? <figure data-positive-total={denominator}>
      <svg data-cashflow-donut="" viewBox="0 0 160 160" role="img" aria-label="分類正值占比；完整帶符號淨額見表格">
        {positive.map((c,i)=>{const fraction=c.net/denominator;const start=positive.slice(0,i).reduce((sum,item)=>sum+item.net,0)/denominator;return <circle key={c.category} cx="80" cy="80" r="54" fill="none" stroke={`var(--s${i%8+1})`} strokeWidth="22" pathLength="100" strokeDasharray={`${fraction*100} ${100-fraction*100}`} strokeDashoffset={-start*100} transform="rotate(-90 80 80)"><title>{c.category} 正值占比 {(fraction*100).toFixed(1)}%</title></circle>})}
      </svg><figcaption>圓環僅為正值占比；不包含零與負淨額。</figcaption>
    </figure>:<p className="muted">沒有正值分類，不繪製圓環；退款／沖回超出原額時仍保留負值。</p>}
    <table className="cashflow-values"><caption>完整分類淨額（{currency}）</caption><thead><tr><th>分類</th><th>筆數</th><th>帶符號淨額</th></tr></thead><tbody>{categories.map(c=><tr key={c.category}><th scope="row">{c.category}</th><td>{c.count}</td><td>{fmt(c.net)}</td></tr>)}</tbody><tfoot><tr><th scope="row">淨額合計</th><td>—</td><td>{fmt(total)}</td></tr></tfoot></table>
    {!categories.length && <p className="muted">沒有這類紀錄。</p>}
  </div>
}
