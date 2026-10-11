import { useState } from 'react'
import { EXPENSE_CATEGORIES, parseExpenseCategoryRules, type ExpenseCategory, type ExpenseCategoryRule } from '../expenses'
import { ActionIcon } from './ActionIcon'

export function ExpenseCategoryRules({rules,busy,onChange}: {rules:ExpenseCategoryRule[];busy:boolean;onChange:(rules:ExpenseCategoryRule[])=>void}) {
  const [editing,setEditing] = useState<number|null>(null)
  const [keyword,setKeyword] = useState('')
  const [category,setCategory] = useState<ExpenseCategory>('交通')
  const [error,setError] = useState('')
  const reset = () => {setEditing(null);setKeyword('');setError('')}
  return <details className="panel expense-rules">
    <summary>自訂分類規則 · {rules.length} 條</summary>
    <p className="muted small">說明包含關鍵字就套用類別，不分大小寫。多條符合時依列表順序優先；逐筆手動分類優先於規則。修改後請儲存變更。</p>
    <ul>{rules.map((rule,i)=><li key={i}>
      <span><strong>{rule.keyword}</strong><span aria-hidden="true"> → </span>{rule.category}</span>
      <div className="row">
        <button disabled={busy} aria-label={`編輯分類規則 ${rule.keyword}`} title="編輯規則" onClick={()=>{setEditing(i);setKeyword(rule.keyword);setCategory(rule.category);setError('')}}><ActionIcon name="edit"/></button>
        <button disabled={busy} aria-label={`刪除分類規則 ${rule.keyword}`} title="刪除規則" onClick={()=>{onChange(rules.filter((_,index)=>index!==i));reset()}}><ActionIcon name="delete"/></button>
      </div>
    </li>)}</ul>
    <form onSubmit={e=>{e.preventDefault();try {
      const rule = parseExpenseCategoryRules([{keyword,category}])[0]
      onChange(parseExpenseCategoryRules(editing===null ? [...rules,rule] : rules.map((r,i)=>i===editing?rule:r)))
      reset()
    } catch(e) {setError(e instanceof Error?e.message:'分類規則無效')}}}>
      <fieldset className="expense-rule-fields" disabled={busy}>
        <label className="field"><span>分類關鍵字</span><input required maxLength={100} placeholder="例如 BUS/MRT" value={keyword} onChange={e=>setKeyword(e.target.value)}/></label>
        <label className="field"><span>規則類別</span><select value={category} onChange={e=>setCategory(e.target.value as ExpenseCategory)}>{EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <button className="primary">{editing===null?'新增規則':'套用規則修改'}</button>
        {editing!==null && <button type="button" onClick={reset}>取消</button>}
      </fieldset>
      {error && <p role="alert" className="banner error">{error}</p>}
    </form>
  </details>
}
