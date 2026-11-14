// One card purchase passed in a URL, so an Apple Shortcut (Wallet transaction automation) can open
// a prefilled form: /expenses/add?amount=NT$1,234&merchant=...&card=...&currency=TWD&date=2026-11-14
// Nothing is saved from the URL alone; the user confirms the form. See docs/apple-shortcuts.md.
import { validDate } from './quantityHistory'

export interface QuickAdd {
  date: string
  description: string
  amountText: string
  currency: string
  card: string
}

export const QUICK_ADD_FIELDS = ['date', 'merchant', 'amount', 'currency', 'card'] as const

// Currency signs as Wallet formats amounts. A bare $ stays ambiguous and uses the fallback.
// "S$" must not match inside "US$" (hence the lookbehind).
const SIGNS: [RegExp, string][] = [
  [/NT\$|NTD|TWD|新臺幣|新台幣|元/i, 'TWD'],
  [/(?<![A-Z])S\$|SGD/i, 'SGD'],
  [/HK\$|HKD/i, 'HKD'],
  [/US\$|USD/i, 'USD'],
  [/(?<![A-Z])A\$|AUD/i, 'AUD'],
  [/(?<![A-Z])C\$|CAD/i, 'CAD'],
  [/JP¥|JPY|円/i, 'JPY'],
  [/CN¥|RMB|CNY/i, 'CNY'],
  [/€|EUR/i, 'EUR'],
  [/£|GBP/i, 'GBP'],
  [/₩|KRW/i, 'KRW'],
  [/฿|THB/i, 'THB'],
]

// "NT$1,234.50" → { amount: "1234.50", currency: "TWD" }. A minus sign or parentheses mean a refund.
export function parseAmount(text: string): { amount: string; currency?: string } {
  const raw = text.normalize('NFKC').trim()
  const currency = SIGNS.find(([re]) => re.test(raw))?.[1]
  const negative = /^\(.*\)$/.test(raw) || /-\s*[^\d\s]*\s*\d/.test(raw) || /^-/.test(raw)
  let digits = raw.replace(/[^\d.,]/g, '')
  // "1.234,50": comma as the decimal mark when it is the last separator with two digits after it.
  if (/,\d{1,2}$/.test(digits) && digits.includes('.')) digits = digits.replace(/\./g, '').replace(',', '.')
  else digits = digits.replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(digits)) return { amount: '', currency }
  return { amount: `${negative ? '-' : ''}${digits}`, currency }
}

// The form's starting values. Unknown or invalid values are left for the user to fill in.
export function parseQuickAdd(search: string, today: string): QuickAdd {
  const q = new URLSearchParams(search)
  const one = (key: string) => (q.getAll(key).length === 1 ? (q.get(key) ?? '').trim() : '')
  const { amount, currency: sign } = parseAmount(one('amount'))
  const given = one('currency').toUpperCase()
  const date = one('date').slice(0, 10)
  return {
    date: validDate(date) ? date : today,
    description: one('merchant').slice(0, 500),
    amountText: amount,
    currency: /^[A-Z]{3}$/.test(given) ? given : sign ?? 'TWD',
    card: one('card').slice(0, 100),
  }
}

export function quickAddQuery(add: QuickAdd): string {
  const p = new URLSearchParams()
  if (add.date) p.set('date', add.date)
  if (add.description) p.set('merchant', add.description)
  if (add.amountText) p.set('amount', add.amountText)
  if (add.currency) p.set('currency', add.currency)
  if (add.card) p.set('card', add.card)
  return p.size ? `?${p}` : ''
}

// Kept across the Google sign-in redirect, which returns to "/": a shortcut opened in a tab
// without a session still reaches its form after signing in.
const PENDING_KEY = 'wealthline.pending-path'
export function rememberPendingPath(path: string) {
  try { sessionStorage.setItem(PENDING_KEY, path) } catch { /* storage blocked: the form is lost after sign-in */ }
}
export function takePendingPath(): string | null {
  try {
    const path = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    return path?.startsWith('/expenses/add') ? path : null
  } catch {
    return null
  }
}
