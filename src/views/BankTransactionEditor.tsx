import { useState } from 'react'
import { EXPENSE_CATEGORIES } from '../expenses'
import { BANK_EXCLUSION_REASONS, INCOME_CATEGORIES, classifyBankTransaction, parseBankTransactions, type BankTransaction, type BankTransactionAccount, type BankCategoryRule, type Classification } from '../bankTransactions'

import { BANK_TEXT_NOTICE, classificationLabel } from './bankUiHelpers'
export function ClassificationField({value,onChange,label='分類',caption,disabled=false,automatic=false}: {value?:Classification;onChange:(c:Classification|undefined)=>void;label?:string;caption?:string;disabled?:boolean;automatic?:boolean}) {
  const key=value ? value.kind==='income'||value.kind==='expense'?`${value.kind}:${value.category}`:value.kind==='excluded'?`excluded:${value.reason}`:'pending' : ''
  return <label className="field"><span>{caption??label}</span><select aria-label={label} disabled={disabled} value={key} onChange={e=>{const [kind,target]=e.target.value.split(':');onChange(kind==='income'?{kind,category:target as typeof INCOME_CATEGORIES[number]}:kind==='expense'?{kind,category:target as typeof EXPENSE_CATEGORIES[number]}:kind==='excluded'?{kind,reason:target as typeof BANK_EXCLUSION_REASONS[number]}:kind==='pending'?{kind}:undefined)}}>{automatic && <option value="">自動分類</option>}<option value="pending">未分類（依入出帳計入收支）</option><optgroup label="收入">{INCOME_CATEGORIES.map(c=><option key={c} value={`income:${c}`}>{c}</option>)}</optgroup><optgroup label="消費">{EXPENSE_CATEGORIES.map(c=><option key={c} value={`expense:${c}`}>{c}</option>)}</optgroup><optgroup label="不計收支">{BANK_EXCLUSION_REASONS.map(c=><option key={c} value={`excluded:${c}`}>{c}</option>)}</optgroup></select></label>
}
export function BankRowFields({row,onChange,disabled=false,prefix='流水',rules=[]}:{row:BankTransaction;onChange:(row:BankTransaction)=>void;disabled?:boolean;prefix?:string;rules?:BankCategoryRule[]}) {
 const effective=classifyBankTransaction(row,rules)
 return <fieldset className="bank-fields" disabled={disabled}>
 <label className="field bank-date-field"><span>記帳日</span><input aria-label={`${prefix}日期`} type="date" required value={row.date} onChange={e=>onChange({...row,date:e.target.value})}/></label>
 <label className="field bank-description-field"><span>交易摘要</span><input aria-label={`${prefix}摘要`} required maxLength={500} value={row.description} onChange={e=>onChange({...row,description:e.target.value})}/></label>
 <label className="field"><span>方向</span><select aria-label={`${prefix}方向`} value={row.direction} onChange={e=>onChange({...row,direction:e.target.value as 'debit'|'credit'})}><option value="debit">支出</option><option value="credit">入帳</option></select></label>
 <label className="field"><span>金額</span><input aria-label={`${prefix}金額`} type="number" inputMode="decimal" min="0" max="1000000000000" step="any" required value={Number.isNaN(row.amount)?'':row.amount} onChange={e=>onChange({...row,amount:e.target.value.trim()?Number(e.target.value):NaN})}/><small className="bank-field-hint">非負金額；退款請改方向</small></label>
 <label className="field"><span>幣別</span><input aria-label={`${prefix}幣別`} required pattern="[A-Z]{3}" maxLength={3} value={row.currency} onChange={e=>onChange({...row,currency:e.target.value.toUpperCase()})}/></label>
 <ClassificationField automatic caption="分類" label={`${prefix}分類`} value={row.classification} onChange={classification=>onChange({...row,classification})}/>
 {effective.kind==='income' && effective.category==='投資回收款' && <p>投資回收款可能包含投入本金，不代表投資收益。</p>}
 </fieldset>
}
export function BankTransactionEditor({transaction,accounts,rules,busy,onSave,onCancel,onRemove}: {transaction:BankTransaction;accounts:BankTransactionAccount[];rules:BankCategoryRule[];busy:boolean;onSave:(row:BankTransaction)=>void;onCancel:()=>void;onRemove:()=>void}) {
 const [row,setRow]=useState(transaction),[error,setError]=useState('')
 return <form className="panel bank-editor" onSubmit={e=>{e.preventDefault();if(busy)return;try{onSave(parseBankTransactions([row],accounts)[0])}catch{setError('請檢查日期、摘要、方向、幣別及非負金額。')}}}>
 <h2>編輯銀行流水</h2><p className="muted">{BANK_TEXT_NOTICE}</p><p>記帳日：同時有交易日與記帳日時採記帳日。帳戶及原始去重識別保留。</p>
 {!transaction.sourceKey && <label className="field"><span>獨立流水帳戶</span><select aria-label="流水帳戶" disabled={busy} value={row.accountId} onChange={e=>setRow({...row,accountId:e.target.value})}>{accounts.map(a=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label>}<BankRowFields row={row} onChange={setRow} disabled={busy} rules={rules}/><p className="notice">{classificationLabel(row,rules)}</p>
 {error && <p role="alert">{error}</p>}<div className="row"><button className="primary" disabled={busy}>套用修改</button><button type="button" onClick={onCancel}>取消</button><button type="button" className="danger" disabled={busy} onClick={()=>{if(confirm('移除這筆銀行流水？儲存變更後才會保存。'))onRemove()}}>移除流水</button></div></form>
}
