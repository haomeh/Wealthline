import { useMemo, useState } from 'react'
import { CARD_CATEGORIES, cardCategoryOption, expenseCategory, isUnrecognizedMerchant, parseExpense, type CardCategory, type Expense, type ExpenseCategoryRule } from '../expenses'
import { fmt } from '../format'
import type { QuickAdd } from '../quickAdd'

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86400_000

// The form an Apple Shortcut link opens (/expenses/add?...). The values come from the URL and
// are only starting values: nothing is added until the user confirms.
export function QuickAddExpense({ initial, expenses, rules, busy, canSave, onAdd, onCancel }: {
  initial: QuickAdd; expenses: Expense[]; rules: ExpenseCategoryRule[]; busy: boolean
  // Whether confirming also saves: only when nothing else is waiting to be saved.
  canSave: boolean
  onAdd: (expense: Expense) => void; onCancel: () => void
}) {
  const [draft, setDraft] = useState({ date: initial.date, description: initial.description, currency: initial.currency, card: initial.card, category: undefined as CardCategory | undefined })
  const [amount, setAmount] = useState(initial.amountText)
  const [error, setError] = useState('')
  const cards = useMemo(() => [...new Set(expenses.map(e => e.card))].sort(), [expenses])
  // The same purchase may already be here: the shortcut ran twice, or the statement came first.
  const similar = expenses.filter(e => e.currency === draft.currency && e.amount === Number(amount) && amount.trim() !== '' && Math.abs(dayOf(e.date) - dayOf(draft.date)) <= 3)
  return <form className="panel form quick-add" onSubmit={e => {
    e.preventDefault()
    try {
      if (isUnrecognizedMerchant(draft.description)) throw new Error('請填寫商家／說明')
      if (!amount.trim()) throw new Error('請填寫金額')
      onAdd(parseExpense({ ...draft, id: crypto.randomUUID(), amount: Number(amount) }))
    } catch (e) { setError(e instanceof Error ? e.message : '資料無效') }
  }}>
    <h2>新增一筆消費</h2>
    <p className="muted small">由連結（例如 Apple 捷徑）帶入的內容，確認無誤後再新增。之後匯入信用卡帳單時，金額與幣別相同、日期相差 3 天內的帳單明細會取代這筆。</p>
    <fieldset disabled={busy} className="expense-fields">
      <label className="field"><span>消費日期</span><input type="date" required value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} /></label>
      <label className="field"><span>銀行／卡片名稱</span><input required maxLength={100} list="quick-add-cards" value={draft.card} onChange={e => setDraft({ ...draft, card: e.target.value })} /><datalist id="quick-add-cards">{cards.map(c => <option key={c} value={c} />)}</datalist><small className="muted">建議與帳單匯入時的名稱相同。</small></label>
      <label className="field"><span>商家／說明</span><input required maxLength={500} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label className="field"><span>金額（退款填負數）</span><input required type="number" step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="field"><span>消費類別</span><select value={draft.category ?? ''} onChange={e => setDraft({ ...draft, category: e.target.value ? e.target.value as CardCategory : undefined })}><option value="">自動判斷（{expenseCategory({ description: draft.description }, rules)}）</option>{CARD_CATEGORIES.map(c => <option key={c} value={c}>{cardCategoryOption(c)}</option>)}</select></label>
      <label className="field"><span>幣別</span><input required pattern="[A-Z]{3}" maxLength={3} value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} /></label>
    </fieldset>
    {similar.length > 0 && <div className="notice" role="status"><p>已有 {similar.length} 筆相同金額、日期相近的消費，可能重複：</p><ul>{similar.slice(0, 3).map(e => <li key={e.id}>{e.date} · {e.card} · {e.description} · {e.currency} {fmt(e.amount, 2)}</li>)}</ul></div>}
    {error && <p role="alert" className="banner error">{error}</p>}
    <div className="row"><button className="primary" disabled={busy}>{canSave ? '新增並儲存' : '新增'}</button><button type="button" onClick={onCancel}>取消</button></div>
    {!canSave && <p className="muted small">還有其他未儲存的修改，新增後請按「儲存變更」一起保存。</p>}
  </form>
}
