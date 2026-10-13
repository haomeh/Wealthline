import { useState } from 'react'
import { isUnrecognizedMerchant, parseExpense, expenseCategory, EXPENSE_CATEGORIES, type ExpenseCategoryRule, type ExpenseCategory, type Expense } from '../expenses'

export function ExpenseEditor({expense,busy,onSave,onCancel,onRemove,rules}: {rules:ExpenseCategoryRule[];expense:Expense;busy:boolean;onSave:(e:Expense)=>void;onCancel:()=>void;onRemove:()=>void}) {
  const [draft,setDraft] = useState(expense)
  const [amount,setAmount] = useState(String(expense.amount))
  const [error,setError] = useState('')
  return <form className="panel form" onSubmit={e=>{e.preventDefault();try {if(isUnrecognizedMerchant(draft.description)) throw new Error('請補上可辨識的商家，並核對是否為繳款');if(!amount.trim()) throw new Error('請填寫金額');onSave(parseExpense({...draft,amount:Number(amount)}))} catch(e){setError(e instanceof Error?e.message:'資料無效')}}}>
    <h2>編輯消費明細</h2>
    <fieldset disabled={busy} className="expense-fields">
      <label className="field"><span>消費日期</span><input type="date" required value={draft.date} onChange={e=>setDraft({...draft,date:e.target.value})}/></label>
      <label className="field"><span>銀行／卡片名稱</span><input required maxLength={100} value={draft.card} onChange={e=>setDraft({...draft,card:e.target.value})}/></label>
      <label className="field"><span>商家／說明</span><input required maxLength={500} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})}/></label>
      <label className="field"><span>金額（退款填負數）</span><input required type="number" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <label className="field"><span>消費類別</span><select value={draft.category ?? ''} onChange={e=>setDraft({...draft,category:e.target.value ? e.target.value as ExpenseCategory : undefined})}><option value="">自動判斷（{expenseCategory({description:draft.description},rules)}）</option>{EXPENSE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
      <label className="field"><span>幣別</span><input required pattern="[A-Z]{3}" value={draft.currency} onChange={e=>setDraft({...draft,currency:e.target.value.toUpperCase()})}/></label>
    </fieldset>
    {error && <p role="alert" className="banner error">{error}</p>}
    <div className="row"><button className="primary" disabled={busy}>套用修改</button><button type="button" onClick={onCancel}>取消</button><button type="button" className="danger" disabled={busy} onClick={()=>{if(confirm(`移除「${expense.description}」這筆消費？按「儲存變更」後才會保存。`)) onRemove()}}>移除這筆消費</button></div>
  </form>
}
