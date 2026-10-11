import { useEffect, useRef, useState } from 'react'
import { EXPENSE_CATEGORIES, expenseCategory, parseExpenseCategoryRules, type Expense, type ExpenseCategory, type ExpenseCategoryRule } from '../expenses'
import { ActionIcon } from './ActionIcon'

function RuleForm({initialKeyword = '',initialCategory = '交通',busy,onSave,onCancel,editing = false}: {initialKeyword?:string;initialCategory?:ExpenseCategory|'';busy:boolean;onSave:(rule:ExpenseCategoryRule)=>void;onCancel?:()=>void;editing?:boolean}) {
  const [keyword,setKeyword] = useState(initialKeyword.slice(0,100))
  const [category,setCategory] = useState<ExpenseCategory|''>(initialCategory)
  const [error,setError] = useState('')
  return <form onSubmit={e=>{e.preventDefault();try {
    onSave(parseExpenseCategoryRules([{keyword,category}])[0])
    setKeyword('');setError('')
  } catch(e) {setError(e instanceof Error?e.message:'分類規則無效')}}}>
    <fieldset className="expense-rule-fields" disabled={busy}>
      <label className="field"><span>分類關鍵字</span><input required autoFocus={!!initialKeyword} maxLength={100} placeholder="例如 BUS/MRT" value={keyword} onChange={e=>setKeyword(e.target.value)}/></label>
      <label className="field"><span>規則類別</span><select required value={category} onChange={e=>setCategory(e.target.value as ExpenseCategory|'')}>{initialCategory==='' && <option value="" disabled>選擇類別</option>}{EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <button className="primary">{editing?'套用規則修改':'新增規則'}</button>
      {onCancel && <button type="button" disabled={busy} onClick={onCancel}>取消</button>}
    </fieldset>
    {error && <p role="alert" className="banner error">{error}</p>}
  </form>
}

export function ExpenseCategoryRules({rules,busy,onChange}: {rules:ExpenseCategoryRule[];busy:boolean;onChange:(rules:ExpenseCategoryRule[])=>void}) {
  const [editing,setEditing] = useState<number|null>(null)
  return <details className="panel expense-rules">
    <summary>自訂分類規則 · {rules.length} 條</summary>
    <p className="muted small">說明包含關鍵字就套用類別，不分大小寫。多條符合時依列表順序優先；逐筆手動分類優先於規則。修改後請儲存變更。</p>
    <ul>{rules.map((rule,i)=><li key={i}>
      <span><strong>{rule.keyword}</strong><span aria-hidden="true"> → </span>{rule.category}</span>
      <div className="row">
        <button disabled={busy} aria-label={`編輯分類規則 ${rule.keyword}`} title="編輯規則" onClick={()=>setEditing(i)}><ActionIcon name="edit"/></button>
        <button disabled={busy} aria-label={`刪除分類規則 ${rule.keyword}`} title="刪除規則" onClick={()=>{onChange(rules.filter((_,index)=>index!==i));setEditing(null)}}><ActionIcon name="delete"/></button>
      </div>
    </li>)}</ul>
    <RuleForm key={editing ?? 'new'} busy={busy} initialKeyword={editing===null?'':rules[editing].keyword} initialCategory={editing===null?'交通':rules[editing].category} editing={editing!==null} onCancel={editing===null?undefined:()=>setEditing(null)} onSave={rule=>{
      onChange(parseExpenseCategoryRules(editing===null ? [...rules,rule] : rules.map((r,i)=>i===editing?rule:r)))
      setEditing(null)
    }}/>
  </details>
}

export function AddCategoryRuleButton({expense,rules,busy,onClick,label}: {expense:Expense;rules:ExpenseCategoryRule[];busy:boolean;onClick:()=>void;label?:string}) {
  if(expense.category!==undefined || expenseCategory(expense,rules)!=='未分類') return null
  return <button type="button" className="add-category-rule" disabled={busy} aria-label={label ?? `新增分類規則 ${expense.date} ${expense.description}`} title="為此商家新增分類規則" onClick={onClick}><ActionIcon name="add"/></button>
}

export function CategoryRuleDialog({expense,busy,onSave,onCancel}: {expense:Expense;busy:boolean;onSave:(rule:ExpenseCategoryRule)=>void;onCancel:()=>void}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(()=>{ref.current?.showModal()},[])
  return <dialog ref={ref} className="review expense-rule-dialog" aria-label="新增分類規則" onCancel={e=>{e.preventDefault();if(!busy)onCancel()}}>
    <h3>將此商家自動分類</h3>
    <p className="muted small">保留商家關鍵字並選擇類別，其他符合的交易也會套用。新增後請儲存變更。</p>
    <RuleForm initialCategory="" initialKeyword={expense.description} busy={busy} onSave={onSave} onCancel={onCancel}/>
  </dialog>
}
