import type { ReactNode } from 'react'
import { CARD_TRANSFER, expenseCategory, type Expense, type ExpenseCategoryRule } from '../expenses'
import { fmt } from '../format'
import { RecordMoney } from './RecordMoney'
import { ActionIcon } from './ActionIcon'
import { CategoryRuleButton } from './ExpenseCategoryRules'
import { DetailRecord } from './DetailRecord'

// `showCategory`: the category under each description (the overview lists rows without it otherwise).
export function ExpenseRecords({ expenses, rules, busy = false, showCategory = false, onEdit, onRule, evidence }: {
  expenses: Expense[]; rules: ExpenseCategoryRule[]; busy?: boolean; showCategory?: boolean;
  evidence?: (expense:Expense)=>ReactNode;
  onEdit?: (expense: Expense) => void; onRule?: (expense: Expense, index?: number) => void
}) {
  const groups = new Map<string, { date: string; card: string; rows: Expense[] }>()
  for (const expense of [...expenses].sort((a, b) => b.date.localeCompare(a.date))) {
    const key = JSON.stringify([expense.date, expense.card])
    const group = groups.get(key) ?? { date: expense.date, card: expense.card, rows: [] }
    group.rows.push(expense)
    groups.set(key, group)
  }
  return <div className="expense-records record-groups">{[...groups].map(([key, group]) => <section key={key}>
    <header className="record-group-head"><time dateTime={group.date}>{group.date}</time><span title={group.card}>{group.card || '未命名卡片'}</span></header>
    {group.rows.map(expense => { const category = expenseCategory(expense, rules), transfer = category === CARD_TRANSFER
      const kind = transfer ? '帳戶移轉' : expense.amount < 0 ? '退款' : '消費'
      return <DetailRecord key={expense.id} className="expense-record" title={expense.description}
      subtitle={showCategory && <span className={`tag${category === '未分類' ? ' warn' : ''}`} title={transfer ? '不計收支' : undefined}>{category}</span>}
      label={`查看消費 ${expense.date} ${expense.description}`}
      // A transfer counts in neither income nor consumption, so a credited one is not green.
      value={<RecordMoney currency={expense.currency} amount={expense.amount} sign={expense.amount < 0 ? '+' : ''} tone={expense.amount < 0 && !transfer ? 'credit' : undefined} label={`${kind} ${expense.currency} ${fmt(Math.abs(expense.amount))}`} />}
      actions={onEdit && <>
        {onRule && <CategoryRuleButton expense={expense} rules={rules} busy={busy} onClick={index => onRule(expense, index)} />}
        <button type="button" disabled={busy} title="編輯消費" aria-label={`編輯消費 ${expense.date} ${expense.description}`} onClick={() => onEdit(expense)}><ActionIcon name="edit" /></button>
      </>}>
      <p>{expense.description}</p>
      <dl className="record-evidence"><dt>銀行／卡片</dt><dd>{expense.card || '未命名卡片'}</dd><dt>日期</dt><dd>{expense.date}</dd><dt>分類</dt><dd>{category}</dd><dt>類型</dt><dd>{transfer ? '帳戶移轉（不計收支）' : kind}</dd></dl>
      {evidence?.(expense)}
    </DetailRecord> })}
  </section>)}</div>
}
