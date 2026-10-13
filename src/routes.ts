import { validDate } from './quantityHistory'

// The signed-in app's pages and their URLs, so browser back/forward and the mobile back swipe
// move between them. Cloudflare serves index.html for these paths (wrangler.jsonc).

export const TABS = { overview: '總覽', accounts: '帳戶', liabilities: '負債', history: '歷史明細', cashflow: '收支總覽', expenses: '信用卡消費', 'bank-transactions': '銀行流水', rates: '匯率', more: '更多' }
export type Tab = keyof typeof TABS

// The sidebar groups the pages by topic.
export const NAV_GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: '資產', tabs: ['overview', 'accounts', 'liabilities', 'history'] },
  { label: '收支', tabs: ['cashflow', 'expenses', 'bank-transactions'] },
  { label: '設定', tabs: ['rates'] },
]

// The phone's bottom tab bar: four tabs, each also lit for the pages it gathers.
// 更多 is a page of its own there; the desktop sidebar lists those pages directly.
export const MOBILE_TABS: { tab: Tab; label: string; pages: Tab[] }[] = [
  { tab: 'overview', label: '總覽', pages: ['overview'] },
  { tab: 'accounts', label: '帳戶', pages: ['accounts'] },
  { tab: 'cashflow', label: '收支', pages: ['cashflow', 'expenses', 'bank-transactions'] },
  { tab: 'more', label: '更多', pages: ['more', 'liabilities', 'history', 'rates'] },
]

export type Route =
  | { tab: 'overview' }
  | { tab: 'accounts'; page: 'list'; importing?: boolean }
  | { tab: 'accounts'; page: 'new' }
  | { tab: 'accounts'; page: 'edit'; id: string }
  | { tab: 'accounts'; page: 'detail'; id: string }
  | { tab: 'liabilities' }
  | { tab: 'cashflow' }
  | { tab: 'expenses' }
  | { tab: 'bank-transactions' }
  | { tab: 'history'; date?: string }
  | { tab: 'rates' }
  | { tab: 'more' }

export const tabPath = (t: Tab) => (t === 'overview' ? '/app' : `/${t}`)

export function parseRoute(path: string): Route {
  const [first, second, third, ...rest] = path.split('/').filter(Boolean).map(decodeURIComponent)
  if (first === 'liabilities' && !second) return { tab: 'liabilities' }
  if (first === 'cashflow' && !second) return { tab: 'cashflow' }
  if (first === 'expenses' && !second) return { tab: 'expenses' }
  if (first === 'bank-transactions' && !second) return { tab: 'bank-transactions' }
  if (first === 'history' && !third && !rest.length) {
    if (!second) return { tab: 'history' }
    if (validDate(second)) return { tab: 'history', date: second }
  }
  if (first === 'rates' && !second) return { tab: 'rates' }
  if (first === 'more' && !second) return { tab: 'more' }
  if (first === 'accounts' && !rest.length) {
    if (!second) return { tab: 'accounts', page: 'list' }
    if (second === 'import' && !third) return { tab: 'accounts', page: 'list', importing: true }
    if (second === 'new' && !third) return { tab: 'accounts', page: 'new' }
    if (!third) return { tab: 'accounts', page: 'detail', id: second }
    if (third === 'edit') return { tab: 'accounts', page: 'edit', id: second }
  }
  return { tab: 'overview' }
}

export function routePath(r: Route): string {
  switch (r.tab) {
    case 'overview':
      return '/app'
    case 'history':
      return r.date ? `/history/${r.date}` : '/history'
    case 'liabilities':
    case 'cashflow':
    case 'expenses':
    case 'bank-transactions':
    case 'rates':
    case 'more':
      return `/${r.tab}`
    case 'accounts':
      if (r.page === 'list') return r.importing ? '/accounts/import' : '/accounts'
      if (r.page === 'new') return '/accounts/new'
      return `/accounts/${encodeURIComponent(r.id)}${r.page === 'edit' ? '/edit' : ''}`
  }
}
