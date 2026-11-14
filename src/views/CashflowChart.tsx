import { useState } from 'react'
import type { CashflowCategoryTotal, CashflowCurrencySummary } from '../cashflow'
import { fmt } from '../format'
import { cashflowColor } from '../cashflowColor'

const positiveTotal = (categories:readonly CashflowCategoryTotal<string>[])=>categories.reduce((sum,c)=>sum+Math.max(0,c.net),0)

export function CashflowChart({group,onSelect}: {group:CashflowCurrencySummary;onSelect?:(metric:'income'|'consumption'|'difference',category?:string)=>void}) {
  const rings=[{key:'income',label:'收入',position:'內圈',radius:78,categories:group.incomeCategories,total:group.income},{key:'consumption',label:'實際消費',position:'外圈',radius:108,categories:group.consumptionCategories,total:group.consumption}] as const
  const difference=`${group.difference>0?'+':''}${fmt(group.difference)}`
  // Hover (mouse) or tap/keyboard (selected) shows that slice in the ring's center.
  type Slice={ring:'income'|'consumption';category:string}
  const [hover,setHover]=useState<Slice|null>(null)
  const [selected,setSelected]=useState<Slice|null>(null)
  const same=(a:Slice|null,b:Slice)=>a?.ring===b.ring&&a.category===b.category
  const activeKey=hover??selected
  const activeRing=activeKey&&rings.find(r=>r.key===activeKey.ring)
  const activeCategory=activeRing&&activeRing.categories.find(c=>c.category===activeKey.category&&c.net>0)
  const active=activeRing&&activeCategory?{ring:activeRing,category:activeCategory,share:activeCategory.net/positiveTotal(activeRing.categories)}:null
  const toggle=(slice:Slice)=>{setHover(null);setSelected(same(selected,slice)?null:slice)}
  return <div className="cashflow-nested" onKeyDown={e=>{if(e.key==='Escape'){setSelected(null);setHover(null)}}}>
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
                const slice={ring:ring.key,category:c.category}
                const label=`${ring.label} · ${c.category} ${group.currency} ${fmt(c.net)} · ${(fraction*100).toFixed(1)}%`
                return <circle key={c.category} data-cashflow-slice={c.category} className={`cashflow-slice${active&&!same(activeKey,slice)?' dim':''}`}
                  role="button" tabIndex={0} aria-label={label} aria-pressed={same(selected,slice)}
                  onPointerEnter={e=>{if(e.pointerType==='mouse')setHover(slice)}} onPointerLeave={()=>setHover(null)}
                  onClick={()=>toggle(slice)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(slice)}}} cx="130" cy="130" r={ring.radius} fill="none" stroke={cashflowColor(c.category,ring.key==='income')} strokeWidth="19" pathLength="100" strokeDasharray={`${fraction*100} ${100-fraction*100}`} strokeDashoffset={-start*100} transform="rotate(-90 130 130)"/>
              })}
            </g>
          })}
        </svg>
        {active ? <div className="cashflow-ring-center" role="status" data-cashflow-active={active.category.category}>
          <span>{active.ring.label}</span>
          <b style={{color:cashflowColor(active.category.category,active.ring.key==='income')}}>{active.category.category}</b>
          <strong style={{fontSize:`${Math.min(24,150/fmt(active.category.net).length)}px`}}>{fmt(active.category.net)}</strong>
          <small>{group.currency} · {(active.share*100).toFixed(1)}% · {active.category.count} 筆</small>
          {onSelect && <button className="cashflow-ring-detail" onClick={()=>onSelect(active.ring.key,active.category.category)}>查看明細</button>}
        </div> : <div className="cashflow-ring-center"><button onClick={()=>onSelect?.('difference')}>收支差額</button><strong style={{fontSize:`${Math.min(26,170/difference.length)}px`}} data-cashflow-metric="difference" data-sign={Math.sign(group.difference)}>{difference}</strong><small>{group.currency}</small><span>收入 − 實際消費</span></div>}
      </div>
      <figcaption>內圈收入 · 外圈消費<br/>各圈各自為 100%，不比較金額大小<br/>點選色塊查看分類金額</figcaption>
    </figure>
    <div className="cashflow-category-lists">{rings.map(ring=>{
      const denominator=positiveTotal(ring.categories)
      return <section className="cashflow-ring-group" key={ring.key} aria-label={`${group.currency} ${ring.label}分類`}>
        <div className="cashflow-ring-heading"><h4><small>{ring.position}</small>{ring.label}</h4><button onClick={()=>onSelect?.(ring.key)}><strong data-cashflow-metric={ring.key}>{fmt(ring.total)}</strong></button></div>
        <ul>{ring.categories.map(c=><li key={c.category}><span><i aria-hidden="true" style={{background:cashflowColor(c.category,ring.key==='income')}}/><button onClick={()=>onSelect?.(ring.key,c.category)}>{c.category}</button><small> · {c.count} 筆</small></span><span>{fmt(c.net)}</span><small aria-label={c.net>0?'正值占比':'不計入圓環'}>{c.net>0?`${(c.net/denominator*100).toFixed(1)}%`:'—'}</small></li>)}</ul>
        {!ring.categories.length && <p className="muted small">沒有這類紀錄</p>}
        {!!ring.categories.length && denominator===0 && <p className="muted small">沒有正值分類</p>}
      </section>
    })}
    {rings.some(ring=>ring.categories.some(c=>c.net<=0)) && <p className="muted small">圓環僅顯示正值占比；零值、退款及沖回後的負淨額保留於清單。</p>}
    </div>
  </div>
}
