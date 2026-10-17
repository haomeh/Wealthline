import { amountParts } from '../format'

// A list amount: currency, sign and figure. The currency sits in a fixed slot on the left and the
// figure is right-aligned in a fixed minimum width, so the codes and the right edges of every row
// line up; each currency keeps one number of decimals (format.ts), so its decimal points line up too.
// `tone`: credit is green; callers leave it out for rows that count in neither income nor
// consumption (不計收支), so those never read as money coming in.
export function RecordMoney({ currency, amount, sign = '', tone, label }: {
  currency: string; amount: number; sign?: '' | '+' | '−'; tone?: 'credit'; label?: string
}) {
  const { whole, fraction } = amountParts(amount, currency)
  return <span className="record-money" data-tone={tone} aria-label={label}>
    <small>{currency}</small>
    <strong>{sign}{whole}{fraction}</strong>
  </span>
}
