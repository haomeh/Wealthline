import type { CashflowCategoryTotal, CashflowCurrencySummary } from '../cashflow'
import { fmt } from '../format'
import { INCOME_CATEGORIES } from '../bankTransactions'
import { EXPENSE_CATEGORIES } from '../expenses'

function color(category:string, income:boolean) {
  const categories:readonly string[]=income?INCOME_CATEGORIES:EXPENSE_CATEGORIES
  const index=categories.indexOf(category)
  const palette=income?[1,3,7,6]:[2,5,4,8]
  const base=`var(--s${palette[index%4]})`
  return index<4?base:`color-mix(in srgb, ${base} ${index<8?65:40}%, var(--ink-2))`
}
const positiveTotal = (categories:readonly CashflowCategoryTotal<string>[])=>categories.reduce((sum,c)=>sum+Math.max(0,c.net),0)

export function CashflowChart({group}: {group:CashflowCurrencySummary}) {
  const rings=[{key:'income',label:'收入',position:'內圈',radius:78,categories:group.incomeCategories,total:group.income},{key:'consumption',label:'實際消費',position:'外圈',radius:108,categories:group.consumptionCategories,total:group.consumption}] as const
  const difference=`${group.difference>0?'+':''}${fmt(group.difference)}`
  return <div className="cashflow-nested">
    <figure className="cashflow-chart-stack">
      <div className="cashflow-ring-chart">
        <svg viewBox="0 0 260 260" role="img" aria-label={`${group.currency} 內圈收入 ${fmt(group.income)}；外圈實際消費 ${fmt(group.consumption)}。各圈正值分類各自合計 100%；完整淨額見分類清單。`}>
          {rings.map(ring=>{
            const denominator=positiveTotal(ring.categories)
            let offset=0
            return <g key={ring.key} data-cashflow-ring={ring.key} data-positive-total={denominator}>
              <circle cx="130" cy="130" r={ring.radius} fill="none" stroke="var(--hairline)" strokeWidth="19"/>
              {ring.categories.map(c=>{
                if(c.net<=0) return null
                const fraction=c.net/denominator, start=offset
                offset+=fraction
                return <circle key={c.category} data-cashflow-slice={c.category} cx="130" cy="130" r={ring.radius} fill="none" stroke={color(c.category,ring.key==='income')} strokeWidth="19" pathLength="100" strokeDasharray={`${fraction*100} ${100-fraction*100}`} strokeDashoffset={-start*100} transform="rotate(-90 130 130)"><title>{ring.position} · {c.category} {group.currency} {fmt(c.net)} · {(fraction*100).toFixed(1)}%</title></circle>
              })}
            </g>
          })}
        </svg>
        <div className="cashflow-ring-center"><span>收支差額</span><strong style={{fontSize:`${Math.min(26,170/difference.length)}px`}} data-cashflow-metric="difference" data-sign={Math.sign(group.difference)}>{difference}</strong><small>{group.currency}</small><span>收入 − 實際消費</span></div>
      </div>
      <figcaption>內圈收入 · 外圈消費<br/>各圈各自為 100%，不比較金額大小</figcaption>
    </figure>
    <div className="cashflow-category-lists">{rings.map(ring=>{
      const denominator=positiveTotal(ring.categories)
      return <section className="cashflow-ring-group" key={ring.key} aria-label={`${group.currency} ${ring.label}分類`}>
        <div className="cashflow-ring-heading"><h4><small>{ring.position}</small>{ring.label}</h4><strong data-cashflow-metric={ring.key}>{fmt(ring.total)}</strong></div>
        <ul>{ring.categories.map(c=><li key={c.category}><span><i aria-hidden="true" style={{background:color(c.category,ring.key==='income')}}/>{c.category}<small> · {c.count} 筆</small></span><span>{fmt(c.net)}</span><small aria-label={c.net>0?'正值占比':'不計入圓環'}>{c.net>0?`${(c.net/denominator*100).toFixed(1)}%`:'—'}</small></li>)}</ul>
        {!ring.categories.length && <p className="muted small">沒有這類紀錄</p>}
        {!!ring.categories.length && denominator===0 && <p className="muted small">沒有正值分類</p>}
      </section>
    })}
    {rings.some(ring=>ring.categories.some(c=>c.net<=0)) && <p className="muted small">圓環僅顯示正值占比；零值、退款及沖回後的負淨額保留於清單。</p>}
    </div>
  </div>
}
