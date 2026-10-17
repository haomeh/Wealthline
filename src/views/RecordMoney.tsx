import { amountParts } from '../format'

// A list amount: currency, sign and figure, with the decimal point in a fixed column so the
// digits of every row line up. `tone`: credit is green; callers leave it out for rows that
// count in neither income nor consumption (不計收支), so those never read as money coming in.
export function RecordMoney({ currency, amount, sign = '', tone, label }: {
  currency: string; amount: number; sign?: '' | '+' | '−'; tone?: 'credit'; label?: string
}) {
  const { whole, fraction } = amountParts(amount)
  return <span className="record-money" data-tone={tone} aria-label={label}>
    <small>{currency}</small>
    <strong><span>{sign}{whole}</span><span className="record-money-fraction">{fraction}</span></strong>
  </span>
}
