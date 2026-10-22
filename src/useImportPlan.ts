import { useEffect, useRef, useState } from 'react'
import { navigate } from './site'
import { routePath, tabPath, type Route, type Tab } from './routes'
import type { ImportPlan } from './views/StatementImportEntry'
import type { BatchResults } from './views/StatementImportBatch'

// Card and bank statements share one import entry, /cashflow/import, which detects each file's kind.
// The card and bank pages open it too; cancelling returns to the page it was opened from.
// /expenses/import and /bank-transactions/import still open a kind's own screen, for old links.
export function useImportPlan(route: Route) {
  const tab = route.tab
  const go = (r: Route, replace = false) => navigate(routePath(r), { replace })
  // A detected statement batch (import entry): files by kind, the typed password and the detection report. Memory only.
  const [importPlan, setImportPlan] = useState<(ImportPlan & { results: BatchResults }) | null>(null)
  const goImport = (kind: 'expenses' | 'bank-transactions', importing = true, replace = true) => go({ tab: kind, importing }, replace)
  const importFrom = useRef<Tab>('cashflow')
  const openImportFrom = (from: Tab) => { importFrom.current = from; go({ tab: 'cashflow', importing: true }) }
  // Cancelling the entry goes back to the page that opened it.
  const cancelEntry = () => { const from = importFrom.current; importFrom.current = 'cashflow'; navigate(tabPath(from), { replace: true }) }
  // A detected batch stays on the entry's URL: its card and bank statements import side by side, one tab each.
  const startPlan = (plan: ImportPlan) => setImportPlan({ ...plan, results: {} })
  const finishPlan = (kind: 'card' | 'bank' | 'securities', result: string) => setImportPlan((p) => p && { ...p, results: { ...p.results, [kind]: result } })
  const importingStatements = (route.tab === 'expenses' || route.tab === 'bank-transactions') && !!route.importing
  // Files and the typed password of a detected batch stay in memory only while one of its import screens is open.
  const inImport = importingStatements || (route.tab === 'cashflow' && !!route.importing)
  // The route is the browser's URL, which links, back and forward change outside this hook.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (!inImport) { setImportPlan(null); importFrom.current = 'cashflow' } }, [inImport])
  const goTab = (t: Tab) => { if (t !== tab || !importingStatements) navigate(tabPath(t)) }
  // The one statement import entry (/cashflow/import), fixed in the sidebar and the phone's 收支 tabs.
  // An import already open keeps its screen; its kind switch offers 自動判斷.
  const importEntry = route.tab === 'cashflow' && !!route.importing
  const openImportEntry = () => { if (!inImport) go({ tab: 'cashflow', importing: true }) }

  return { importPlan, goImport, openImportFrom, cancelEntry, startPlan, finishPlan, importingStatements, goTab, importEntry, openImportEntry }
}
