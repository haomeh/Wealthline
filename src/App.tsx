import { dataVersion } from './dataVersion'
import { Fragment, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  clearSession,
  fetchProfile,
  isFresh,
  loadSession,
  peekRedirectResult,
  preloadGis,
  renewAccessToken,
  revokeAccessToken,
  startRedirectSignIn,
  storeSession,
  takeRedirectResult,
  type AccessToken,
  type UserProfile,
} from './google/auth'
import { DATA_FILE_NAME, FOLDER_NAME, HISTORY_FOLDER_NAME, LEDGER_FOLDER_NAME } from './google/drive'
import { archiveSummary, emptyDriveState, ledgerCashflow, ledgerScope, loadDrive, mergeParts, missingParts, readGroup, recentLedgerFrom, saveDrive, storedSizes, withHeldParts, type DriveState, type PartGroup } from './google/driveStore'
import { ledgerPart } from './dataParts'
import { applyFetchedRates, emptyData, missingRates, parseWealthData, ratesStale, usedCurrencies, type WealthData } from './model'
import { finishSave } from './saveState'
import { classifyBankTransaction } from './bankTransactions'
import { clearLocal, downloadDataFile, hasLocalData, loadLocal, opensLocal, readDataFile, readLocalPreview, replaceLocal, saveLocal, setLocalActive, storageEstimate, LocalConflictError, type LocalFile, type LocalPreview } from './localStore'
import { localDate, pendingChanges, pendingLiabilityChanges, recordSave, revertChange, revertLiabilityChange } from './history'
import { applyQuotes, fetchHoldingQuotes } from './quotes'
import { fetchRates } from './rates'
import { Accounts, type AccountsView } from './views/Accounts'
import { Liabilities } from './views/Liabilities'
import { Expenses } from './views/Expenses'
import { BankTransactions } from './views/BankTransactions'
import { Overview } from './views/Overview'
import { Cashflow } from './views/Cashflow'
import { HistoryView } from './views/History'
import { Rates } from './views/Rates'
import { SaveReview } from './views/SaveReview'
import { More } from './views/More'
import { Landing } from './views/Landing'
import { Opening, type OpeningStep } from './views/Opening'
import { LegalPage } from './views/Legal'
import { PAGES, goBack, navigate, usePage, usePath } from './site'
import { MOBILE_TABS, NAV_GROUPS, TABS, parseRoute, routePath, tabPath, type Route, type Tab } from './routes'
import { Link, Logo, PrivacyNotice, SiteFooter } from './views/Site'
import { DeviceIcon, UploadButton } from './views/LocalData'
import { StorageMeter, StorageNotice } from './views/StorageMeter'
import { DataPrivacy } from './views/DataPrivacy'
import { summarizeBackup } from './backupPreview'
import { BackupRestore } from './views/BackupRestore'
import { byteSize, serializeData } from './storageLimits'

// When the data was last saved, as the sidebar shows it: the time today, else the date.
function savedLabel(iso: string) {
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return ''
  return localDate(iso) === localDate(new Date().toISOString())
    ? `今天 ${at.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`
    : at.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
}

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'error'; text: string }

const GROUP_NAMES: Record<PartGroup, string> = { ledger: '消費明細與銀行流水', history: '往年歷史' }

// This page load is the return from Google's sign-in page with a token.
function hasRedirectToken(): boolean {
  const r = peekRedirectResult()
  return !!r && 'token' in r
}

export default function App() {
  const token = useRef<AccessToken | null>(null)
  // What this session last read from or wrote to Drive (driveStore.ts).
  const driveState = useRef<DriveState | null>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const editVersion = useRef(0)
  const sessionVersion = useRef(0)
  // The version last read from or written to Drive; each save records what changed since it.
  const saved = useRef<WealthData | null>(null)
  const [user, setUser] = useState<UserProfile | null>(null)
  // Local mode: no sign-in, the data file is kept in this browser (localStore.ts). The ref is for
  // background tasks started before the state re-renders; `localRaw` is the stored text this tab last read or wrote.
  // A tab keeps the mode it chose itself; otherwise a live Google session in the tab wins over
  // the flag other tabs share (see opensLocal).
  const [local, setLocal] = useState(() => opensLocal(!!loadSession()?.token || hasRedirectToken()))
  const localMode = useRef(local)
  const localRaw = useRef<string | null>(null)
  // The home page reads whether local data exists on render; this re-renders it after a delete.
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [data, setData] = useState<WealthData | null>(null)
  // Size of the stored data file (0: nothing stored yet), for the size limit notices.
  const [storedBytes, setStoredBytes] = useState(0)
  // Drive: how many files the data takes and their total size.
  const [storedTotal, setStoredTotal] = useState({ files: 0, bytes: 0 })
  // Drive: transactions and earlier years of history are read when a page needs them
  // (driveStore.ts). A load in progress, or the message of a failed one.
  const [groupLoad, setGroupLoad] = useState<Partial<Record<PartGroup, string>>>({})
  const groupLoads = useRef(new Map<PartGroup, Promise<void>>())
  // Drive: the oldest transaction part the bank page asked for with 載入更早的 ('' for all);
  // null until then, when it reads the last three months (recentLedgerFrom).
  const [bankFrom, setBankFrom] = useState<string | null>(null)
  const [summaryVersion, setSummaryVersion] = useState(0)
  // Local mode: how much of this browser's storage the site uses, when the browser says.
  const [browserStorage, setBrowserStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [dialogError, setDialogError] = useState<{ scope: 'privacy' | 'restore'; text: string } | null>(null)
  const [dataPrivacyOpen, setDataPrivacyOpen] = useState(false)
  const [restorePreview, setRestorePreview] = useState<{ uploaded: WealthData; destination: LocalPreview; summary: ReturnType<typeof summarizeBackup>; session: number; selection: number } | null>(null)
  const restoreSelection = useRef(0)
  const returnToDataControl = useRef<HTMLElement | null>(null)
  // Edits to balances or holdings are shown for review before they become history.
  const [reviewing, setReviewing] = useState(false)
  const [ratesError, setRatesError] = useState('')
  const [priceError, setPriceError] = useState('')
  // A previous session whose token has expired: offer one-click resume as this account.
  const [returning, setReturning] = useState<UserProfile | null>(() => loadSession()?.profile ?? null)
  // Between getting a token and showing the app. A reload with a live token starts here,
  // so the signed-out page never flashes before the app.
  const [opening, setOpening] = useState<{ step: OpeningStep; profile?: UserProfile } | null>(() =>
    (loadSession()?.token || hasRedirectToken()) && !opensLocal(true) ? { step: 'auth' } : null,
  )
  // Prices and rates being fetched after the data file has loaded.
  const [refreshing, setRefreshing] = useState(false)
  // The notice pages are open to everyone; the app's own state stays mounted behind them.
  const page = usePage()
  // Every page of the signed-in app has its own URL, so back and forward move between them.
  const path = usePath()
  const route = parseRoute(path)
  const tab = route.tab

  // Warn before closing the tab with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Renew on save, verifying the account before any Drive write.
  async function validToken(): Promise<AccessToken> {
    if (!token.current || !isFresh(token.current)) {
      if (!user) throw new Error('請先登入')
      token.current = await renewAccessToken(user)
      storeSession({ profile: user, token: token.current })
    }
    return token.current
  }

  async function run(text: string, task: () => Promise<void>, onError?: (message: string) => void) {
    setStatus({ kind: 'busy', text })
    try {
      await task()
      setStatus({ kind: 'idle' })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setStatus({ kind: 'error', text: message })
      onError?.(message)
    }
  }

  async function openSession(t: AccessToken) {
    setOpening({ step: 'auth' })
    let p: UserProfile
    let file: Awaited<ReturnType<typeof loadDrive>>
    try {
      p = await fetchProfile(t)
      setOpening({ step: 'drive', profile: p })
      file = await loadDrive(t, parseWealthData)
    } finally {
      setOpening(null)
    }
    token.current = t
    storeSession({ profile: p, token: t })
    setUser(p)
    driveState.current = file?.state ?? emptyDriveState()
    setGroupLoad({})
    setBankFrom(null)
    startSession(file?.data ?? null)
  }

  // Opens local mode with the data stored in this browser, or with `file` (an upload just
  // stored). Throws, without entering local mode, when the stored data does not parse.
  async function openLocal(given?: LocalFile | null) {
    const file = given === undefined ? await loadLocal() : given
    setLocalActive(true)
    localMode.current = true
    localRaw.current = file?.raw ?? null
    setLocal(true)
    startSession(file?.data ?? null)
  }

  // Shows the loaded data file (null: none yet) and refreshes its prices and rates.
  function startSession(file: WealthData | null) {
    const version = ++sessionVersion.current
    setDataPrivacyOpen(false)
    returnToDataControl.current = null
    saved.current = file
    measureStored(file)
    measureBrowser()
    const loaded = file ?? emptyData()
    setData(loaded)
    setDirty(false)
    setRefreshing(true)
    void refreshMarket(loaded)
      .then((market) => {
        if (version === sessionVersion.current) setRefreshing(false)
        return market && recordToday(market)
      })
      .catch(() => version === sessionVersion.current && setRefreshing(false))
  }

  // Updates holding prices, then exchange rates (new quotes can bring new currencies).
  // Like rates, prices stay in memory until the next save. Returns `from` with the
  // new prices and rates, or null when the user signed out meanwhile.
  async function refreshMarket(from: WealthData): Promise<WealthData | null> {
    const version = sessionVersion.current
    const { quotes, failed } = await fetchHoldingQuotes(from)
    if (version !== sessionVersion.current) return null
    const at = new Date().toISOString()
    setData((d) => (d ? applyQuotes(d, quotes, at) : d))
    setPriceError(failed.length ? `找不到 ${failed.join('、')} 的報價，可以點價格手動輸入。` : '')
    const withQuotes = applyQuotes(from, quotes, at)
    return ratesStale(withQuotes) ? refreshRates(withQuotes) : withQuotes
  }

  // Updates exchange rates in the background. The new rates are kept in memory and
  // written to Drive with the next save (or today's first record), so opening the app never leaves unsaved changes.
  async function refreshRates(from: WealthData): Promise<WealthData | null> {
    const version = sessionVersion.current
    setRatesError('')
    try {
      const r = await fetchRates(usedCurrencies(from))
      if (version !== sessionVersion.current) return null
      setData((d) => (d ? applyFetchedRates(d, r.rates, r.updatedAt) : d))
      if (r.unsupported.length) setRatesError(`找不到 ${r.unsupported.join('、')} 的匯率，請手動輸入。`)
      return applyFetchedRates(from, r.rates, r.updatedAt)
    } catch (e) {
      if (version !== sessionVersion.current) return null
      setRatesError(e instanceof Error ? e.message : String(e))
      return from
    }
  }

  // The first sign-in of the day records that day's values with fresh prices, so the
  // daily history fills in without the user having to save. Only market data changes:
  // `market` is the saved file with new prices and rates, so no edits are logged.
  async function recordToday(market: WealthData) {
    const version = sessionVersion.current
    const at = new Date().toISOString()
    const last = saved.current
    if (!last || (!market.accounts.length && !market.liabilities?.length) || dirtyRef.current || savingRef.current) return
    if (last.history.snapshots.some((s) => s.date === localDate(at)) || last.history.quantityDays?.some(d => d.date === localDate(at))) return
    // A value without its exchange rate would record a wrong day.
    if (missingRates(market).length) return
    const next = recordSave(last, { ...market, updatedAt: at })
    savingRef.current = true
    setSaving(true)
    try {
      const written = await write(next)
      if (version !== sessionVersion.current) return
      saved.current = written
      setData((d) => d ? withHeldParts(finishSave(d, market, written), written) : d)
    } catch (e) {
      if (version === sessionVersion.current) setStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) })
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // How much the stored data takes: the text kept in this browser, or the Drive files
  // (the largest one counts against the per-file limit).
  function measureStored(file: WealthData | null) {
    if (localMode.current || !driveState.current) {
      const bytes = !file ? 0 : byteSize(localRaw.current ?? serializeData(file))
      setStoredBytes(bytes)
      setStoredTotal({ files: bytes ? 1 : 0, bytes })
      return
    }
    const sizes = storedSizes(driveState.current)
    setStoredBytes(Math.max(0, ...sizes))
    setStoredTotal({ files: sizes.length, bytes: sizes.reduce((a, b) => a + b, 0) })
  }

  // Reads the parts of `group` the data does not hold yet, or only the parts named in `only`, and
  // adds their records. Edits not saved yet are kept over the records read (mergeParts).
  function loadGroup(group: PartGroup, only?: readonly string[]): Promise<void> {
    const state = driveState.current
    const running = groupLoads.current.get(group)
    if (running) return running.then(() => loadGroup(group, only))
    if (localMode.current || !state || only?.length === 0) return Promise.resolve()
    const session = sessionVersion.current
    setGroupLoad((s) => ({ ...s, [group]: 'loading' }))
    const task = (async () => {
      try {
        const parts = await readGroup(await validToken(), state, group, only)
        if (session !== sessionVersion.current) return
        const base = saved.current ?? undefined
        if (saved.current) saved.current = mergeParts(saved.current, parts, parseWealthData)
        setData((d) => d && mergeParts(d, parts, parseWealthData, base))
        measureStored(saved.current)
        setGroupLoad((s) => ({ ...s, [group]: undefined }))
      } catch (e) {
        if (session === sessionVersion.current) setGroupLoad((s) => ({ ...s, [group]: `無法載入${GROUP_NAMES[group]}：${e instanceof Error ? e.message : String(e)}` }))
      } finally {
        groupLoads.current.delete(group)
      }
    })()
    groupLoads.current.set(group, task)
    return task
  }

  // The data with every record, for a backup: parts not loaded yet are read first. When they
  // cannot be read, a full backup (`strict`) fails; otherwise the user may take what is loaded.
  async function completeData(from: WealthData, strict = false): Promise<WealthData | null> {
    const state = driveState.current
    if (localMode.current || !state) return from
    try {
      let full = from
      for (const group of ['ledger', 'history'] as const) full = mergeParts(full, await readGroup(await validToken(), state, group), parseWealthData)
      return full
    } catch (e) {
      if (strict) throw new Error(`無法讀取所有消費明細與往年歷史，沒有下載備份：${e instanceof Error ? e.message : String(e)}`)
      return confirm('無法讀取部分消費明細或往年歷史，備份只會包含已載入的資料（其餘仍完整保存在 Google Drive）。要下載嗎？') ? from : null
    }
  }

  // Drive: every record as one file, which local mode can restore (readDataFile).
  const downloadBackup = () =>
    run('準備備份…', async () => {
      setDialogError(null)
      const session = sessionVersion.current
      const full = saved.current && await completeData(saved.current, true)
      if (full && session === sessionVersion.current) downloadDataFile(full)
    }, (text) => setDialogError({ scope: 'privacy', text }))

  const openDataPrivacy = (event: React.MouseEvent<HTMLButtonElement>) => {
    const menu = event.currentTarget.closest('details')
    returnToDataControl.current = menu?.querySelector('summary') ?? event.currentTarget
    menu?.removeAttribute('open')
    setDialogError(null)
    setDataPrivacyOpen(true)
  }
  const closeDataPrivacy = () => { setDialogError(null); setDataPrivacyOpen(false) }
  useEffect(() => {
    if (!dataPrivacyOpen && returnToDataControl.current) {
      returnToDataControl.current.focus()
      returnToDataControl.current = null
    }
  }, [dataPrivacyOpen])

  function measureBrowser() {
    if (!localMode.current) return setBrowserStorage(null)
    const session = sessionVersion.current
    void storageEstimate().then((estimate) => { if (session === sessionVersion.current) setBrowserStorage(estimate) })
  }

  // Writes the data to Drive, or to this browser in local mode. Resolves to the data as stored.
  async function write(next: WealthData): Promise<WealthData> {
    const session = sessionVersion.current
    if (localMode.current) {
      const raw = await saveLocal(next, localRaw.current)
      if (session === sessionVersion.current) {
        localRaw.current = raw
        measureStored(next)
        measureBrowser()
      }
      return next
    }
    const state = driveState.current ?? emptyDriveState()
    driveState.current = state
    try {
      return await saveDrive(await validToken(), next, state)
    } finally {
      // Files written before a failure are recorded in `state` too.
      if (session === sessionVersion.current) {
        measureStored(next)
        setSummaryVersion((v) => v + 1)
      }
    }
  }

  // Renewing an expired token opens Google's popup, which Safari allows only inside the click,
  // so GIS is fetched as soon as the user is signed in rather than when the renewal starts.
  useEffect(() => {
    if (user) preloadGis()
  }, [user])

  // Restore the session after a reload while this tab's token is still valid,
  // or local mode when the user was using it.
  const restored = useRef(false)
  useEffect(() => {
    if (page || restored.current) return
    restored.current = true
    if (localMode.current) {
      void run('載入中…', async () => {
        try {
          await openLocal()
        } catch (e) {
          // Unreadable stored data: back to the home page, which shows why and offers an upload.
          setLocalActive(false)
          localMode.current = false
          setLocal(false)
          throw e
        }
      })
      return
    }
    // Back from Google's sign-in page (see startRedirectSignIn).
    const redirect = takeRedirectResult()
    if (redirect) {
      void run('登入中…', async () => {
        if ('error' in redirect) throw new Error(redirect.error)
        await openSession(redirect.token)
      })
      return
    }
    const stored = loadSession()?.token
    if (!stored) return
    void run('載入中…', async () => {
      try {
        await openSession(stored)
      } catch {
        // Token revoked or rejected: fall back to the one-click resume button.
        token.current = null
        setUser(null)
        setData(null)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  useEffect(() => {
    if ((user || local) && path === '/') navigate('/app', { replace: true })
  }, [user, local, path])

  // Sign-in leaves for Google's page in this tab and comes back with the token (see the restore above).
  const signIn = () =>
    run('前往 Google 登入…', async () => {
      startRedirectSignIn('select_account')
    })

  const resume = () =>
    run('前往 Google 登入…', async () => {
      if (!returning) return
      // The user may pick a different account on Google's page; openSession reads whichever comes back.
      startRedirectSignIn('', returning.email)
    })

  const signOut = () =>
    dirtyRef.current && !confirm('有尚未儲存的修改，登出後會遺失。要繼續嗎？') ? undefined : run('登出中…', async () => {
      const previous = token.current
      sessionVersion.current++
      setRestorePreview(null)
      setDataPrivacyOpen(false)
      returnToDataControl.current = null
      clearSession()
      token.current = null
      driveState.current = null
      saved.current = null
      setGroupLoad({})
      setBankFrom(null)
      setReturning(null)
      setRefreshing(false)
      setUser(null)
      setData(null)
      setDirty(false)
      setReviewing(false)
      navigate('/', { replace: true })
      // Local logout must finish even if Google's revoke request fails or hangs.
      if (previous) void revokeAccessToken(previous).catch(() => {})
    })

  const startLocal = () =>
    run('開啟中…', async () => {
      await openLocal()
      navigate('/app')
    })

  // Restores a downloaded data file into this browser, replacing what is stored here.
  const upload = (file: File) => {
    const selection = ++restoreSelection.current
    const session = sessionVersion.current
    const fromPrivacy = dataPrivacyOpen
    setDialogError(null)
    setRestorePreview(null)
    void run('讀取資料檔…', async () => {
      // Leaving local mode, deleting its data or opening another session meanwhile cancels the upload.
      const current = () => session === sessionVersion.current && selection === restoreSelection.current
      const { data: uploaded, sourceUpdatedAt } = await readDataFile(file)
      if (!current()) return
      const destination = await readLocalPreview()
      if (current()) setRestorePreview({ uploaded, destination, summary: summarizeBackup(uploaded, file, sourceUpdatedAt), session, selection })
    }, (text) => {
      if (fromPrivacy && session === sessionVersion.current && selection === restoreSelection.current) setDialogError({ scope: 'privacy', text })
    })
  }

  const confirmRestore = () => {
    const preview = restorePreview
    if (!preview) return
    setDialogError(null)
    let conflict = false
    void run('還原資料檔…', async () => {
      const current = () => preview.session === sessionVersion.current && preview.selection === restoreSelection.current
      if (!current()) return
      let raw: string | null
      try {
        raw = await replaceLocal(preview.uploaded, preview.destination.version, current)
      } catch (error) {
        if (error instanceof LocalConflictError) {
          conflict = true
          setRestorePreview(null)
          throw new Error('此瀏覽器中的資料已變更；請重新選擇資料檔並預覽後再確認。')
        }
        throw error
      }
      if (raw === null || !current()) return
      setRestorePreview(null)
      await openLocal({ data: preview.uploaded, raw })
      navigate('/app')
    }, (text) => {
      if (preview.session === sessionVersion.current && preview.selection === restoreSelection.current)
        setDialogError({ scope: conflict && dataPrivacyOpen ? 'privacy' : 'restore', text })
    })
  }

  // Leaves local mode, keeping the stored data for next time unless `erase` is set.
  const leaveLocal = (erase = false) => {
    const question = erase
      ? '要刪除此瀏覽器中的財務資料與舊版遷移備份嗎？刪除後無法復原，建議先下載資料檔備份。Google Drive 檔案、已下載的備份及此瀏覽器的密碼加密金鑰不會刪除。'
      : dirtyRef.current ? '有尚未儲存的修改，離開本機模式後會遺失。要繼續嗎？' : ''
    if (question && !confirm(question)) return
    // First, so an upload still being read or waiting to write is dropped (see `upload`).
    sessionVersion.current++
    setRestorePreview(null)
    setDataPrivacyOpen(false)
    returnToDataControl.current = null
    setLocalActive(false)
    localMode.current = false
    localRaw.current = null
    saved.current = null
    setLocal(false)
    setRefreshing(false)
    setData(null)
    setDirty(false)
    setReviewing(false)
    setStatus({ kind: 'idle' })
    navigate('/', { replace: true })
    if (erase) {
      void clearLocal()
        .then(rerender)
        .catch((e) => setStatus({ kind: 'error', text: `資料沒有刪除：${e instanceof Error ? e.message : String(e)}` }))
    }
  }

  const persist = async (submitted: WealthData) => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    const edits = editVersion.current
    const session = sessionVersion.current
    try {
      await run(localMode.current ? '儲存到此瀏覽器…' : '儲存到 Google Drive…', async () => {
        const next = recordSave(saved.current, { ...submitted, updatedAt: new Date().toISOString() })
        const written = await write(next)
        if (session !== sessionVersion.current) return
        saved.current = written
        setData((current) => current ? withHeldParts(finishSave(current, submitted, written), written) : current)
        const stillDirty = edits !== editVersion.current
        dirtyRef.current = stillDirty
        setDirty(stillDirty)
        setReviewing(false)
      })
    } finally {
      savingRef.current = false
      setSaving(false)
      // A failed save must reveal its error and backup action outside the dialog.
      setReviewing(false)
    }
  }

  const save = () => data ? persist(data) : Promise.resolve()

  const requestSave = () => {
    if (data && (pendingChanges(saved.current, data).length || pendingLiabilityChanges(saved.current, data).length)) setReviewing(true)
    else void save()
  }
  const pending = reviewing && data ? pendingChanges(saved.current, data) : []
  const pendingDebts = reviewing && data ? pendingLiabilityChanges(saved.current, data) : []
  useEffect(() => {
    if (reviewing && pending.length === 0 && pendingDebts.length === 0) setReviewing(false)
  }, [reviewing, pending.length, pendingDebts.length])

  function update(next: WealthData) {
    editVersion.current++
    dirtyRef.current = true
    setData({ ...next, version: dataVersion(next, { minimumVersion: 2 }), liabilities: next.liabilities ?? [] })
    setDirty(true)
  }

  // A newly added holding or balance can bring a currency without a rate: fetch it right away.
  const missingAuto = data ? missingRates(data).filter((c) => !data.fxManual.includes(c)).join(',') : ''
  useEffect(() => {
    if (missingAuto && data) void refreshRates(data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingAuto])

  // An account that no longer exists (deleted, or an old link) shows the account list instead.
  const missingAccount = !!data && 'id' in route && !data.accounts.some((a) => a.id === route.id)
  useEffect(() => {
    if (missingAccount) navigate('/accounts', { replace: true })
  }, [missingAccount])

  const busy = saving || status.kind === 'busy'

  // Drive parts the current page needs. The overview uses the stored summaries and reads the
  // parts only when a summary is missing.
  const state = !local ? driveState.current : null
  const missing = (group: PartGroup) => !!state && !!data && missingParts(state, data, group).length > 0
  const archive = state && missing('history') ? archiveSummary(state) : null
  // Transactions: the monthly totals while some parts are not loaded, from the records loaded
  // and the summary of the rest (ledgerCashflow); undefined once all are loaded.
  const ledgerMissing = state && data ? missingParts(state, data, 'ledger') : []
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ledgerMonths = useMemo(() => state && data && ledgerMissing.length ? ledgerCashflow(state, data) : undefined, [state, data, summaryVersion])
  const ledger = state && data ? ledgerScope(state, data) : null
  // The bank page shows once the parts of the last three months are loaded; earlier quarters
  // load when it asks (bankFrom). The expense and cashflow pages read every part.
  const recentFrom = state ? recentLedgerFrom(state, localDate(new Date().toISOString())) : ''
  const bankShown = !ledgerMissing.some((name) => name >= recentFrom)
  // A record dated in a part not loaded (an edit or a new record) loads that part, so every
  // record shown belongs to a loaded part and a later save rewrites that part as a whole.
  const recordParts = ledgerMissing.length && data ? new Set([...(data.bankTransactions ?? []), ...(data.expenses ?? [])].map((r) => ledgerPart(r.date))) : null
  const ledgerWanted = !ledgerMissing.length ? []
    : tab === 'expenses' || tab === 'cashflow' || (tab === 'overview' && !ledgerMonths) ? ledgerMissing
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
  const waiting = (group: PartGroup, only?: readonly string[]) => {
    const failed = groupLoad[group] && groupLoad[group] !== 'loading' ? groupLoad[group] : ''
    return <section className="panel" aria-busy={!failed}>{failed
      ? <div className="banner error" role="alert"><p>{failed}</p><button onClick={() => void loadGroup(group, only)}>重試</button></div>
      : <p className="muted">正在載入{GROUP_NAMES[group]}…</p>}</section>
  }

  // Bank rows still to classify, for the sidebar badge: from the rows, or with the stored monthly totals for parts not loaded.
  const unclassified = !data ? 0 : ledgerMonths
    ? ledgerMonths.reduce((n, m) => n + m.totals.pending.count, 0)
    : (data.bankTransactions ?? []).filter((t) => classifyBankTransaction(t, data.bankCategoryRules ?? []).kind === 'pending').length
  const savedAt = saved.current?.updatedAt ? savedLabel(saved.current.updatedAt) : ''

  const go = (r: Route, replace = false) => navigate(routePath(r), { replace })
  const goAccounts = (view: AccountsView, replace = false) => go({ tab: 'accounts', ...view }, replace)
  // Card and bank statements share one import screen, opened on the page its rows land on. Coming from
  // another page adds a history entry; a page's own button, the kind switch and closing replace it.
  const goImport = (kind: 'expenses' | 'bank-transactions', importing = true, replace = true) => go({ tab: kind, importing }, replace)
  // The nav item of the page already open does nothing while its import is open: the parsed preview
  // lives only in the import screen, and leaving it would discard the preview without asking.
  const importingStatements = (route.tab === 'expenses' || route.tab === 'bank-transactions') && !!route.importing
  const goTab = (t: Tab) => { if (t !== tab || !importingStatements) navigate(tabPath(t)) }

  // The account menu's parts, shared by the sidebar menu and the phone's 更多 page.
  const avatar = user
    ? user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{user.email[0]}</span>
    : <span className="avatar"><DeviceIcon /></span>
  const dataMenu = user ? <>
    <div className="menu-where">
      <span>
        我的雲端硬碟 / {FOLDER_NAME} / {DATA_FILE_NAME}<br />消費明細、銀行流水與往年歷史在「{LEDGER_FOLDER_NAME}」「{HISTORY_FOLDER_NAME}」子資料夾
      </span>
      {storedBytes > 0 && <StorageMeter bytes={storedBytes} total={storedTotal} />}
    </div>
    <button onClick={() => void downloadBackup()} disabled={busy || dirty || !saved.current}>
      下載完整備份
    </button>
    {dirty ? <span className="muted small">請先儲存變更，再下載備份。</span> : <span className="muted small">一個檔案包含所有資料，可在本機模式上傳還原。</span>}
  </> : <>
    <div className="menu-where">
      <span>資料只存在這個瀏覽器。清除網站資料、換瀏覽器或換裝置都看不到，請定期下載資料檔備份。</span>
      {storedBytes > 0 && <StorageMeter bytes={storedBytes} browser={browserStorage} />}
    </div>
    <button onClick={() => saved.current && downloadDataFile(saved.current)} disabled={busy || dirty || !saved.current}>
      下載資料檔
    </button>
    {dirty ? <span className="muted small">請先儲存變更，再下載資料檔。</span> : !saved.current && <span className="muted small">儲存過資料後就能下載。</span>}
    <UploadButton onFile={upload} disabled={busy}>上傳資料檔</UploadButton>
    <button onClick={() => leaveLocal()} disabled={saving}>
      離開本機模式
    </button>
    <button className="danger" onClick={() => leaveLocal(true)} disabled={saving}>
      刪除此瀏覽器中的資料
    </button>
  </>
  const menuFoot = <div className="menu-foot">
    <Link to={PAGES.privacy.path} className="small">
      隱私權政策 Privacy Policy
    </Link>
    {user && <button className="link danger" onClick={signOut} disabled={busy}>
      登出
    </button>}
  </div>
  // The save state in one short line, for the phone's page headers.
  const syncState = dirty ? 'dirty' : refreshing || saving ? 'busy' : status.kind === 'error' ? 'error' : 'ok'
  const syncPill = <span className={`sync-pill ${syncState}`}>
    {syncState === 'dirty' ? '● 有修改未儲存' : syncState === 'busy' ? (saving ? '儲存中…' : '更新報價…') : syncState === 'error' ? '同步未完成' : <><span aria-hidden>✓</span> {local ? '已存在此瀏覽器' : '已同步'}</>}
  </span>
  const unsavedCount = dirty && data ? pendingChanges(saved.current, data).length + pendingLiabilityChanges(saved.current, data).length : 0
  const mobileTab = MOBILE_TABS.find((t) => t.pages.includes(tab))?.tab

  if (page) return <LegalPage page={page} signedIn={!!user || local} />

  if (!user && !local) {
    if (opening) return <Opening step={opening.step} profile={opening.profile} />
    return (<>
      <Landing
        returning={returning}
        hasLocal={hasLocalData()}
        busy={busy}
        message={status.kind === 'idle' ? null : status}
        onSignIn={signIn}
        onResume={resume}
        onLocal={startLocal}
        onUpload={upload}
      />
      {restorePreview && <BackupRestore source={restorePreview.summary} destination={restorePreview.destination.data} destinationInvalid={restorePreview.destination.invalid} dirty={dirty} busy={busy} error={dialogError?.scope === 'restore' ? dialogError.text : ''} onConfirm={confirmRestore} onCancel={() => { setDialogError(null); setRestorePreview(null) }} onUpload={upload} />}
    </>)
  }

  return (
    <div className="app-enter shell">
      <aside className="sidebar" aria-label="導覽">
        <div className="brand">
          <Logo size={32} />
          <span className="brand-name">Wealthline</span>
        </div>
        <nav className="side-nav" aria-label="分頁">
          {NAV_GROUPS.map((g) => (
            <Fragment key={g.label}>
              <span className="nav-group">{g.label}</span>
              {g.tabs.map((t) => (
                <button
                  key={t}
                  className={t === tab ? 'active' : ''}
                  aria-current={t === tab ? 'page' : undefined}
                  onClick={() => goTab(t)}
                >
                  {TABS[t]}
                  {t === 'bank-transactions' && unclassified > 0 && <span className="nav-badge" title={`${unclassified} 筆銀行流水未分類`}>{unclassified}</span>}
                </button>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="side-foot">
          {dirty ? (
            <div className="sync-card dirty" role="status">
              <strong>● 有修改未儲存</strong>
              <span>關閉分頁前會提醒你</span>
              <button className="primary save" onClick={requestSave} disabled={busy}>
                {busy ? '儲存中…' : '儲存變更'}
              </button>
            </div>
          ) : refreshing || saving ? (
            <div className="sync-card refreshing" role="status">
              <strong><span className="spinner" aria-hidden /> {saving ? '儲存中…' : '更新報價'}</strong>
            </div>
          ) : status.kind === 'error' ? (
            <div className="sync-card"><strong className="muted">同步未完成</strong></div>
          ) : (
            <div className="sync-card" title={local ? '資料存在這個瀏覽器的儲存空間（IndexedDB）' : `我的雲端硬碟 / ${FOLDER_NAME}`}>
              <strong className="synced"><span aria-hidden>✓</span> {local ? '已存在此瀏覽器' : '已同步 Google Drive'}</strong>
              {savedAt && <span>{savedAt} 儲存</span>}
            </div>
          )}
          <details className="account-menu">
            <summary aria-label={user ? '帳號選單' : '本機模式選單'}>
              {avatar}
              <span className="who"><span>{user ? user.name : '本機模式'}</span><small>{user ? '帳號與備份' : '資料與備份'}</small></span>
            </summary>
            <div className="menu">
              {user ? <div className="menu-who">
                {avatar}
                <div><strong>{user.name}</strong><span className="muted small">{user.email}</span></div>
              </div> : <strong>本機模式（未登入）</strong>}
              <button onClick={openDataPrivacy}>資料與隱私</button>
              {dataMenu}
              {menuFoot}
            </div>
          </details>
        </div>
      </aside>

      {dataPrivacyOpen && (user || local) && <DataPrivacy
        mode={local ? 'local' : 'google'}
        email={user?.email}
        busy={busy}
        saving={saving}
        dirty={dirty}
        hasSaved={!!saved.current}
        error={dialogError?.scope === 'privacy' ? dialogError.text : ''}
        onDownload={local ? () => { if (saved.current) downloadDataFile(saved.current) } : () => void downloadBackup()}
        onUpload={upload}
        onSignOut={signOut}
        onLeaveLocal={() => leaveLocal()}
        onDeleteLocal={() => leaveLocal(true)}
        onClose={closeDataPrivacy}
      />}

      {restorePreview && <BackupRestore source={restorePreview.summary} destination={restorePreview.destination.data} destinationInvalid={restorePreview.destination.invalid} dirty={dirty} busy={busy} error={dialogError?.scope === 'restore' ? dialogError.text : ''} onConfirm={confirmRestore} onCancel={() => { setDialogError(null); setRestorePreview(null) }} onUpload={upload} />}

      {reviewing && data && (pending.length > 0 || pendingDebts.length > 0) && (
        <SaveReview
          changes={pending}
          liabilityChanges={pendingDebts}
          onRevertLiability={(id) => update(revertLiabilityChange(saved.current, data, id))}
          busy={busy}
          canRevert={(c) => data.accounts.some((a) => a.id === c.accountId)}
          onRevert={(c) => {
            const next = revertChange(saved.current, data, c)
            if (next) update(next)
          }}
          onConfirm={save}
          onCancel={() => { if (!savingRef.current) setReviewing(false) }}
        />
      )}

      <div className="shell-main">
      <main className="content view-enter" key={tab}>
        <PrivacyNotice />
        {status.kind === 'busy' && !data && <p className="muted">{status.text}</p>}
        {status.kind === 'error' && <div className="banner error" role="alert">
          <p>{status.text}</p>
          {data && <button onClick={() => void completeData(data).then((full) => full && downloadDataFile(full, 'wealthline-local-backup.json'))}>下載本機資料備份</button>}
        </div>}
        {(tab === 'overview' || tab === 'cashflow' || tab === 'expenses' || tab === 'bank-transactions') && <StorageNotice bytes={storedBytes} browser={local ? browserStorage : undefined} />}

        {data && (tab === 'cashflow' || tab === 'expenses' || tab === 'bank-transactions') && <div className="segmented cashflow-tabs mobile-only" role="group" aria-label="收支分頁">
          {([['cashflow', '總覽'], ['expenses', '信用卡'], ['bank-transactions', '銀行流水']] as const).map(([t, label]) => <button key={t} className={t === tab ? 'on' : ''} aria-pressed={t === tab} onClick={() => goTab(t)}>{label}{t === 'bank-transactions' && unclassified > 0 && <span className="nav-badge" title={`${unclassified} 筆銀行流水未分類`}>{unclassified}</span>}</button>)}
        </div>}
        {data && tab === 'more' && <More
          who={<>{avatar}<div><strong>{user ? user.name : '本機模式'}</strong><span className="muted small">{user ? user.email : '資料只存在這個瀏覽器'}</span></div>{syncPill}</>}
          links={[
            { label: '負債', detail: `${data.liabilities?.length ?? 0} 筆`, onClick: () => go({ tab: 'liabilities' }) },
            { label: '歷史明細', detail: missing('history') ? undefined : `${data.history.snapshots.length} 天`, onClick: () => go({ tab: 'history' }) },
            { label: '匯率', detail: `${usedCurrencies(data).length} 種${data.fxManual.length ? ` · ${data.fxManual.length} 筆手動` : ''}`, onClick: () => go({ tab: 'rates' }) },
          ]}
          data={<><button onClick={openDataPrivacy}>資料與隱私</button>{dataMenu}</>}
          foot={menuFoot}
        />}
        {data && tab === 'overview' && (
          <Overview
            data={data}
            onGoHistory={(date) => go(date ? { tab: 'history', date } : { tab: 'history' })}
            onGoLiabilities={() => go({ tab: 'liabilities' })}
            onGoRates={() => go({ tab: 'rates' })}
            onGoExpenses={() => go({ tab: 'expenses' })}
            onGoBankTransactions={() => go({ tab: 'bank-transactions' })}
            onNewAccount={() => goAccounts({ page: 'new' })}
            onImport={() => goAccounts({ page: 'list', importing: true })}
            onOpenAccount={(id) => goAccounts({ page: 'detail', id })}
            onGoAccounts={() => goAccounts({ page: 'list' })}
            onGoCashflow={() => go({ tab: 'cashflow' })}
            status={syncPill}
            cashflowMonths={ledgerMonths}
            archive={archive ?? undefined}
            onLoadHistory={() => void loadGroup('history')}
            loadingHistory={groupLoad.history === 'loading'}
          />
        )}
        {/* The cashflow page shows the stored totals while the records load; a failed load still needs its 重試. */}
        {data && tab === 'cashflow' && missing('ledger') && groupLoad.ledger && groupLoad.ledger !== 'loading' && waiting('ledger')}
        {data && tab === 'cashflow' && (
          <Cashflow
            data={data}
            months={ledgerMonths}
            onGoExpenses={() => go({ tab: 'expenses' })}
            onGoBankTransactions={() => go({ tab: 'bank-transactions' })}
            onImport={() => goImport('expenses', true, false)}
          />
        )}
        {data && route.tab === 'history' && missing('history') && waiting('history')}
        {data && route.tab === 'history' && !missing('history') && <HistoryView key={route.date ?? 'history'} initialDate={route.date} data={data} dirty={dirty} busy={busy || dirty} onSave={requestSave}
          onChange={(next) => {
            if (savingRef.current) throw new Error('背景儲存中，請稍後再儲存歷史修改。')
            if (dirtyRef.current) throw new Error('請先儲存或捨棄其他未儲存修改，再儲存歷史。')
            update(next); void persist(next)
          }} onOpenAccount={(id) => goAccounts({ page: 'detail', id })} />}
        {data && route.tab === 'accounts' && route.page === 'detail' && missing('history') && waiting('history')}
        {data && route.tab === 'accounts' && !(route.page === 'detail' && missing('history')) && (
          <Accounts
            data={data}
            onChange={update}
            view={route}
            setView={goAccounts}
            onBack={(fallback) => goBack(routePath({ tab: 'accounts', ...fallback }))}
            onRefreshPrices={async () => void (await refreshMarket(data))}
            priceError={priceError}
            saved={saved.current}
          />
        )}
        {data && tab === 'liabilities' && <Liabilities data={data} onChange={update} />}
        {data && tab === 'expenses' && missing('ledger') && waiting('ledger')}
        {data && tab === 'bank-transactions' && !bankShown && waiting('ledger', ledgerWanted)}
        {data && tab === 'expenses' && !missing('ledger') && <Expenses key={local?'local':user?.sub} passwordScope={local?'local':user?`google:${user.sub}`:undefined} data={data} onChange={update} busy={busy}
          importing={route.tab === 'expenses' && !!route.importing} onImporting={(open) => goImport('expenses', open)} onImportBank={() => goImport('bank-transactions')} />}
        {data && tab === 'bank-transactions' && bankShown && <BankTransactions key={local?'local':user?.sub} passwordScope={local?'local':user?`google:${user.sub}`:undefined} data={data} onChange={update} busy={busy} historyReady={!missing('history')} historyStatus={groupLoad.history} onLoadHistory={()=>void loadGroup('history')}
          importing={route.tab === 'bank-transactions' && !!route.importing} onImporting={(open) => goImport('bank-transactions', open)} onImportCard={() => goImport('expenses')}
          ledger={ledger ? { ...ledger, status: groupLoad.ledger, onLoadEarlier: () => loadEarlier(ledger.next), onLoadAll: () => loadEarlier(''), onLoadMonth: (month) => void loadGroup('ledger', [ledgerPart(`${month}-01`)]) } : undefined} />}
        {data && tab === 'rates' && <Rates data={data} onChange={update} onRefresh={async () => void (await refreshRates(data))} error={ratesError} />}
      </main>
      <SiteFooter />
      </div>
      {dirty && <div className="save-bar">
        <span>{unsavedCount ? `${unsavedCount} 筆修改未儲存` : '有修改未儲存'}</span>
        <button className="primary" onClick={requestSave} disabled={busy}>{saving ? '儲存中…' : '檢查並儲存'}</button>
      </div>}
      <nav className="tab-bar" aria-label="主要分頁">
        {MOBILE_TABS.map((t) => (
          <button key={t.tab} className={t.tab === mobileTab ? 'active' : ''} aria-current={t.tab === mobileTab ? 'page' : undefined} onClick={() => navigate(tabPath(t.tab))}>
            <span className={`tab-icon ${t.tab}`} aria-hidden />
            {t.label}
            {t.tab === 'cashflow' && unclassified > 0 && <span className="nav-badge" title={`${unclassified} 筆銀行流水未分類`}>{unclassified}</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}
