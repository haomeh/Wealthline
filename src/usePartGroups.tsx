import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { AccessToken } from './google/auth'
import { archiveSummary, ledgerCashflow, ledgerScope, mergeParts, missingParts, readGroup, recentLedgerFrom, type DriveState, type PartGroup } from './google/driveStore'
import { ledgerPart } from './dataParts'
import { parseWealthData, type WealthData } from './model'
import { localDate } from './history'
import type { LedgerReadiness } from './cashflowQuery'
import type { Route } from './routes'

export const GROUP_NAMES: Record<PartGroup, string> = { ledger: '消費明細與銀行流水', history: '往年歷史' }

// The open session as the part loads need it: App owns these and passes them each render.
export interface PartSession {
  driveState: RefObject<DriveState | null>
  localMode: RefObject<boolean>
  sessionVersion: RefObject<number>
  // The version last read from or written to Drive.
  saved: RefObject<WealthData | null>
  setData: Dispatch<SetStateAction<WealthData | null>>
  measureStored: (file: WealthData | null) => void
  validToken: () => Promise<AccessToken>
}

// Drive: transactions and earlier years of history are read when a page needs them
// (driveStore.ts). Which parts the current page needs, their loads, and what the pages show meanwhile.
export function usePartGroups(session: PartSession, data: WealthData | null, local: boolean, route: Route, summaryVersion: number) {
  const { driveState, localMode, sessionVersion, saved, setData, measureStored, validToken } = session
  const tab = route.tab
  // A load in progress, or the message of a failed one.
  const [groupLoad, setGroupLoad] = useState<Partial<Record<PartGroup, string>>>({})
  const groupLoads = useRef(new Map<PartGroup, Promise<void>>())
  // The oldest transaction part the bank page asked for with 載入更早的 ('' for all);
  // null until then, when it reads the last three months (recentLedgerFrom).
  const [bankFrom, setBankFrom] = useState<string | null>(null)

  // A new session or a sign-out starts with nothing loaded.
  const resetGroups = () => {
    setGroupLoad({})
    setBankFrom(null)
  }

  // Reads the parts of `group` the data does not hold yet, or only the parts named in `only`, and
  // adds their records. Edits not saved yet are kept over the records read (mergeParts).
  function loadGroup(group: PartGroup, only?: readonly string[]): Promise<void> {
    const state = driveState.current
    const running = groupLoads.current.get(group)
    if (running) return running.then(() => loadGroup(group, only))
    if (localMode.current || !state || only?.length === 0) return Promise.resolve()
    const version = sessionVersion.current
    setGroupLoad((s) => ({ ...s, [group]: 'loading' }))
    const task = (async () => {
      try {
        const parts = await readGroup(await validToken(), state, group, only)
        if (version !== sessionVersion.current) return
        const base = saved.current ?? undefined
        if (saved.current) saved.current = mergeParts(saved.current, parts, parseWealthData)
        setData((d) => d && mergeParts(d, parts, parseWealthData, base))
        measureStored(saved.current)
        setGroupLoad((s) => ({ ...s, [group]: undefined }))
      } catch (e) {
        if (version === sessionVersion.current) setGroupLoad((s) => ({ ...s, [group]: `無法載入${GROUP_NAMES[group]}：${e instanceof Error ? e.message : String(e)}` }))
      } finally {
        groupLoads.current.delete(group)
      }
    })()
    groupLoads.current.set(group, task)
    return task
  }

  // Drive parts the current page needs. The overview uses the stored summaries and reads the
  // parts only when a summary is missing.
  const state = !local ? driveState.current : null
  const missing = (group: PartGroup) => !!state && !!data && missingParts(state, data, group).length > 0
  const archive = state && missing('history') ? archiveSummary(state) : null
  // Transactions: the monthly totals while some parts are not loaded, from the records loaded
  // and the summary of the rest (ledgerCashflow); undefined once all are loaded.
  const ledgerMissing = state && data ? missingParts(state, data, 'ledger') : []
  const ledgerReadiness: LedgerReadiness = !ledgerMissing.length ? 'ready' : groupLoad.ledger === 'loading' ? 'loading' : groupLoad.ledger ? 'error' : 'not-loaded'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ledgerMonths = useMemo(() => state && data && ledgerMissing.length ? ledgerCashflow(state, data) : undefined, [state, data, summaryVersion])
  const ledger = state && data ? ledgerScope(state, data) : null
  // The bank page shows once the parts of the last three months are loaded; earlier quarters
  // load when it asks (bankFrom). The expense and cashflow pages read every part.
  const recentFrom = state ? recentLedgerFrom(state, localDate(new Date().toISOString())) : ''
  const bankFocused = route.tab === 'bank-transactions' && !!route.recordId
  const bankShown = bankFocused ? !ledgerMissing.length : !ledgerMissing.some((name) => name >= recentFrom)
  // A record dated in a part not loaded (an edit or a new record) loads that part, so every
  // record shown belongs to a loaded part and a later save rewrites that part as a whole.
  const recordParts = ledgerMissing.length && data ? new Set([...(data.bankTransactions ?? []), ...(data.expenses ?? [])].map((r) => ledgerPart(r.date))) : null
  const ledgerWanted = !ledgerMissing.length ? []
    : tab === 'expenses' || tab === 'cashflow' || bankFocused || (tab === 'overview' && !ledgerMonths) ? ledgerMissing
      : ledgerMissing.filter((name) => (tab === 'bank-transactions' && name >= (bankFrom ?? recentFrom)) || recordParts?.has(name))
  const needsHistory = missing('history') && (route.tab === 'history' || (route.tab === 'accounts' && route.page === 'detail') || (tab === 'overview' && !archive))
  useEffect(() => {
    if (ledgerWanted.length && !groupLoad.ledger) void loadGroup('ledger', ledgerWanted)
    if (needsHistory && !groupLoad.history) void loadGroup('history')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerWanted.join(), needsHistory])
  const loadEarlier = (from: string) => {
    setBankFrom(from)
    void loadGroup('ledger', ledgerMissing.filter((name) => name >= from))
  }
  // What a page that needs `group` shows until it is loaded, or the failed load with 重試.
  const waiting = (group: PartGroup, only?: readonly string[]) => {
    const failed = groupLoad[group] && groupLoad[group] !== 'loading' ? groupLoad[group] : ''
    return <section className="panel" aria-busy={!failed}>{failed
      ? <div className="banner error" role="alert"><p>{failed}</p><button onClick={() => void loadGroup(group, only)}>重試</button></div>
      : <p className="muted">正在載入{GROUP_NAMES[group]}…</p>}</section>
  }

  return { groupLoad, resetGroups, loadGroup, missing, archive, ledgerReadiness, ledgerMonths, ledger, bankShown, ledgerWanted, loadEarlier, waiting }
}
