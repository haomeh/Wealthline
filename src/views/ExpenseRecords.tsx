import { expenseCategory, type Expense, type ExpenseCategoryRule } from '../expenses'
import { fmt } from '../format'
import { ActionIcon } from './ActionIcon'
import { CategoryRuleButton } from './ExpenseCategoryRules'
import { DetailRecord } from './DetailRecord'

// `showCategory`: the category under each description (the overview lists rows without it otherwise).
export function ExpenseRecords({ expenses, rules, busy = false, showCategory = false, onEdit, onRule }: {
  expenses: Expense[]; rules: ExpenseCategoryRule[]; busy?: boolean; showCategory?: boolean;
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
    {group.rows.map(expense => <DetailRecord key={expense.id} className="expense-record" title={expense.description}
      subtitle={showCategory && <span className={`tag${expenseCategory(expense, rules) === '未分類' ? ' warn' : ''}`}>{expenseCategory(expense, rules)}</span>}
      label={`查看消費 ${expense.date} ${expense.description}`}
      value={<span className="record-money" data-refund={expense.amount < 0 || undefined} aria-label={`${expense.amount < 0 ? '退款' : '消費'} ${expense.currency} ${fmt(Math.abs(expense.amount))}`}><small>{expense.currency}</small><strong>{expense.amount < 0 ? '+' : ''}{fmt(Math.abs(expense.amount))}</strong></span>}
      actions={onEdit && <>
        {onRule && <CategoryRuleButton expense={expense} rules={rules} busy={busy} onClick={index => onRule(expense, index)} />}
        <button type="button" disabled={busy} title="編輯消費" aria-label={`編輯消費 ${expense.date} ${expense.description}`} onClick={() => onEdit(expense)}><ActionIcon name="edit" /></button>
      </>}>
      <p>{expense.description}</p>
      <dl className="record-evidence"><dt>銀行／卡片</dt><dd>{expense.card || '未命名卡片'}</dd><dt>日期</dt><dd>{expense.date}</dd><dt>分類</dt><dd>{expenseCategory(expense, rules)}</dd><dt>類型</dt><dd>{expense.amount < 0 ? '退款' : '消費'}</dd></dl>
    </DetailRecord>)}
  </section>)}</div>
}
