import { useState } from 'react'
import { fmt } from '../format'
import { importPositionCsv, importSheet, type ImportResult } from '../importSheet'
import { CSV_MAX_BYTES, CsvError, csvErrorText, decodeCsv, hasCsvHeader } from '../csvImport'
import { REPO_URL } from '../site'
import { ACCOUNT_KINDS, accountBaseValue, breakdown, cashCurrencies, type Account, type AccountKind, type Position, type Slice, type WealthData } from '../model'
import { accountChange } from '../accountTrend'
import { createStatementAssets, missingStatementAssets } from '../bankStatementAssets'
import { displaySymbol } from '../quotes'
import { useCalendarNow } from '../useCalendarNow'
import { AccountDetail } from './AccountDetail'
import { AccountForm } from './AccountForm'
import { CsvGuide } from './CsvGuide'

interface Props {
  data: WealthData
  onChange: (d: WealthData) => void
}

export type AccountsView =
  | { page: 'list'; importing?: boolean }
  | { page: 'new' }
  | { page: 'edit'; id: string }
  | { page: 'detail'; id: string }

interface AccountsProps extends Props {
  view: AccountsView
  // `replace` swaps the current history entry instead of adding one, for pages the back button should skip.
  setView: (v: AccountsView, replace?: boolean) => void
  onBack: (fallback: AccountsView) => void
  onRefreshPrices: () => Promise<void>
  priceError: string
  // The last saved data, to mark unsaved edits.
  saved?: WealthData | null
}

export function Accounts({ data, onChange, view, setView, onBack, onRefreshPrices, priceError, saved }: AccountsProps) {
  const now = useCalendarNow()
  const showImport = view.page === 'list' && !!view.importing
  // Phone only: which kind of account the list shows. Wide screens show both tables.
  const [filter, setFilter] = useState<AccountKind | 'all'>('all')
  const setShowImport = (importing: boolean) => setView({ page: 'list', importing }, true)

  const saveAccount = (next: Account) => {
    const exists = data.accounts.some((a) => a.id === next.id)
    onChange({ ...data, accounts: exists ? data.accounts.map((a) => (a.id === next.id ? next : a)) : [...data.accounts, next] })
  }
  const current = 'id' in view ? data.accounts.find((a) => a.id === view.id) : undefined

  if (view.page === 'new' || (view.page === 'edit' && current)) {
    return (
      <AccountForm
        account={current}
        accounts={data.accounts}
        onSave={(a) => {
          saveAccount(a)
          // Editing returns to the account it came from; a new account's page takes the form's place.
          if (current) onBack({ page: 'detail', id: a.id })
          else setView({ page: 'detail', id: a.id }, true)
        }}
        onCancel={() => onBack(current ? { page: 'detail', id: current.id } : { page: 'list' })}
        onDelete={
          current &&
          (() => {
            if (!confirm(`刪除帳戶「${current.name}」以及其中所有餘額與持倉？`)) return
            onChange({ ...data, accounts: data.accounts.filter((a) => a.id !== current.id) })
            setView({ page: 'list' }, true)
          })
        }
      />
    )
  }

  if (view.page === 'detail' && current) {
    return (
      <AccountDetail
        data={data}
        account={current}
        onChange={saveAccount}
        onEdit={() => setView({ page: 'edit', id: current.id })}
        onBack={() => onBack({ page: 'list' })}
        onRefreshPrices={onRefreshPrices}
        priceError={priceError}
        saved={saved?.accounts.find((x) => x.id === current.id)}
      />
    )
  }

  const total = data.accounts.reduce((sum, a) => sum + accountBaseValue(data, a), 0)
  const byKind = (kind: AccountKind) => data.accounts
    .filter((a) => a.kind === kind)
    .map((a) => ({ a, value: accountBaseValue(data, a), change: accountChange(data, a, now) }))
    .sort((x, y) => y.value - x.value)
  const kinds = (['investment', 'bank'] as AccountKind[]).map((kind) => ({ kind, list: byKind(kind) }))
  const countries = breakdown(data, (a) => a.country)

  return (
    <>
      <div className="page-head">
        <h2>帳戶</h2>
        <div className="row">
          <button className="desktop-only" onClick={() => setShowImport(!showImport)}>從試算表或 CSV 匯入</button>
          <button className="primary add-account" aria-label="新增帳戶" onClick={() => setView({ page: 'new' })}>
            ＋<span className="desktop-only"> 新增帳戶</span>
          </button>
        </div>
      </div>
      {data.accounts.length > 0 && kinds.every(({ list }) => list.length) && <div className="segmented account-filter mobile-only" role="group" aria-label="帳戶類型">
        {([['all', '全部', data.accounts.length], ...kinds.map(({ kind, list }) => [kind, ACCOUNT_KINDS[kind].replace('帳戶', ''), list.length])] as [AccountKind | 'all', string, number][]).map(([k, label, n]) =>
          <button key={k} className={k === filter ? 'on' : ''} aria-pressed={k === filter} onClick={() => setFilter(k)}>{label} {n}</button>)}
      </div>}
      {showImport && <ImportPanel data={data} onChange={onChange} onDone={() => setShowImport(false)} />}
      {!showImport && <StatementAssets data={data} onChange={onChange} />}
      {data.accounts.length === 0 && !showImport && (
        <section className="panel empty">
          <p className="muted">還沒有帳戶。先建立一個銀行或投資帳戶，再點進去填餘額或持倉。</p>
          <div className="row">
            <button className="primary" onClick={() => setView({ page: 'new' })}>建立第一個帳戶</button>
            <button onClick={() => setShowImport(true)}>從試算表或 CSV 匯入</button>
          </div>
        </section>
      )}
      {data.accounts.length > 0 && <div className="tiles desktop-only">
        <section className="panel deep tile-stat"><span>全部 {data.accounts.length} 個帳戶</span><strong>{fmt(total, 0)}</strong></section>
        {kinds.map(({ kind, list }) => (
          <section key={kind} className="panel tile-stat"><span>{ACCOUNT_KINDS[kind]} · {list.length}</span><strong>{fmt(list.reduce((n, x) => n + x.value, 0), 0)}</strong></section>
        ))}
        <section className="panel tile-stat" aria-label="國家分布">
          <span>國家</span>
          <ShareBar slices={countries.slices} />
          <small>{countries.slices.slice(0, 3).map((x) => `${x.label} ${(x.share * 100).toFixed(1)}%`).join(' · ')}{countries.slices.length > 3 ? ' · 其他' : ''}</small>
        </section>
      </div>}
      {kinds.map(({ kind, list }) => list.length > 0 && (
        <section key={kind} className={`panel account-table ${filter !== 'all' && filter !== kind ? 'filtered-out' : ''}`} data-kind={kind} aria-label={ACCOUNT_KINDS[kind]}>
          <div className="account-group-head mobile-only"><span>{ACCOUNT_KINDS[kind]}</span><span className="num-serif">NT$ {fmt(list.reduce((n, x) => n + x.value, 0), 0)}</span></div>
          <div className="account-row head" aria-hidden>
            <span>{ACCOUNT_KINDS[kind]}</span><span>國家</span><span>類別</span><span>{kind === 'bank' ? '幣別' : '內容'}</span><span className="num">台幣價值</span><span className="num">占比</span><span className="num">30 天</span>
          </div>
          <ul className="account-list">
            {list.map(({ a, value, change }) => (
              <li key={a.id}>
                <button className="account-row" onClick={() => setView({ page: 'detail', id: a.id })}>
                  <strong className="name">{a.name}</strong>
                  <span className={a.country ? 'country' : 'country muted'}>{a.country || '未設定'}</span>
                  <span className="category muted">{a.category}</span>
                  <span className="holdings-summary muted">{contentOf(data, a)}</span>
                  <span className="sub muted mobile-only">{subtitleOf(data, a)}</span>
                  <span className="num value num-serif">{fmt(value, 0)}</span>
                  <span className="num share muted">{total ? `${(value / total * 100).toFixed(1)}%` : ''}</span>
                  <span className={`num change ${change === null ? 'muted' : change > 0.0005 ? 'up' : change < -0.0005 ? 'down' : 'muted'}`} title="與 30 天前的每日紀錄比較">
                    {change === null ? '—' : `${change > 0.0005 ? '+' : change < -0.0005 ? '−' : ''}${Math.abs(change * 100).toFixed(1)}%`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data.accounts.length > 0 && !showImport && <button className="link import-link mobile-only" onClick={() => setShowImport(true)}>從試算表或 CSV 匯入</button>}
    </>
  )
}

// The phone row's second line: where the account is and what it holds, in a few words.
function subtitleOf(data: WealthData, a: Account) {
  const symbols = a.positions.filter((p) => p.type === 'holding').map((p) => displaySymbol(p.symbol))
  const cash = cashCurrencies(a)
  const holdings = symbols.length > 2 ? `${symbols.length} 個標的` : symbols.join('、')
  const money = cash.length > 2 ? `${cash.length} 種幣別` : cash.join('、')
  const parts = symbols.length ? [a.country || a.category, holdings, money && `現金 ${money}`] : [a.country, money || a.category]
  if (cash.some((c) => data.fxManual.includes(c))) parts.push('匯率手動')
  return parts.filter(Boolean).join(' · ')
}

// What a row lists: holdings and the cash currencies, or a bank account's currencies.
function contentOf(data: WealthData, a: Account) {
  const symbols = a.positions.filter((p) => p.type === 'holding').map((p) => displaySymbol(p.symbol))
  const cash = cashCurrencies(a)
  const pinned = cash.some((c) => data.fxManual.includes(c)) ? ' · 匯率手動' : ''
  if (!symbols.length) return cash.join('、') + pinned || '—'
  return `${symbols.slice(0, 3).join('、')}${symbols.length > 3 ? ' 等' : ''}${cash.length ? ` · ${cash.join('、')}` : ''}`
}

function ShareBar({ slices }: { slices: Slice[] }) {
  const shown = slices.slice(0, 3)
  const rest = slices.slice(3).reduce((n, x) => n + x.share, 0)
  return <div className="tile-bar" aria-hidden>
    {shown.map((x, i) => <span key={x.label} style={{ flex: x.share, background: `var(--s${[1, 4, 2][i]})` }} />)}
    {rest > 0 && <span style={{ flex: rest, background: 'var(--other)' }} />}
  </div>
}

// One position of the import preview: a cash balance, or a holding's quantity (and price when the sheet gives one).
function positionLine(p: Position) {
  if (p.type === 'cash') return `現金 · ${p.currency} ${fmt(p.quantity, 8)}`
  return `${p.symbol} · 數量 ${fmt(p.quantity, 8)}${p.price ? ` · 單價 ${fmt(p.price, 8)} ${p.currency}` : ''}`
}

function ImportPanel({ data, onChange, onDone }: Props & { onDone: () => void }) {
  const [text, setText] = useState('')
  const [fileError, setFileError] = useState('')
  const [preview, setPreview] = useState<{ source: WealthData; result: ImportResult } | null>(null)
  // A header row with a type column is the CSV format (docs/csv-import.md); anything else is pasted sheet rows.
  const isCsv = hasCsvHeader(text)
  const unpriced = preview && !preview.result.errors.length ? preview.result.data.accounts.flatMap((a) => a.positions).filter((p) => p.type === 'holding' && !p.price && !p.priceManual).length : 0
  return (
    <section className="panel">
      <h3>從試算表或 CSV 匯入</h3>
      <p className="muted small">
        貼上 Google 試算表或 Excel 的資料列（不含標題列），或選擇 CSV 檔。匯入會把同名帳戶的持倉整批換成新的內容，確認前會先顯示預覽。
      </p>
      <details className="muted small">
        <summary>試算表欄位順序</summary>
        <p>機構、類別、子類別、幣別、數量、單價、原幣市值、匯率、台幣市值、佔比。試算表的匯率會一併更新；有錯誤時整批不匯入。CSV 欄位見 <a href={`${REPO_URL}/blob/main/docs/csv-import.md`} target="_blank" rel="noreferrer">CSV 匯入格式</a>。</p>
      </details>
      <textarea aria-label="匯入資料" value={text} onChange={(e) => { setText(e.target.value); setPreview(null) }} rows={8} placeholder="在這裡貼上…" />
      <label className="field"><span>或選擇 CSV 檔（只在此瀏覽器讀取）</span><input aria-label="帳戶 CSV" type="file" accept=".csv,text/csv" onChange={async (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        setPreview(null); setFileError('')
        if (!file) return
        try {
          if (file.size > CSV_MAX_BYTES) throw new CsvError('CSV 超過 5 MB，請拆分後再匯入。')
          setText(decodeCsv(new Uint8Array(await file.arrayBuffer())))
        } catch (error) {
          setFileError(csvErrorText(error))
        }
      }} /></label>
      {fileError && <p role="alert" className="banner error">{fileError}</p>}
      <CsvGuide kinds={['position']} where="在上方「CSV 檔」選擇檔案，按「預覽 CSV 匯入」" />
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            setPreview({ source: data, result: isCsv ? importPositionCsv(data, text) : importSheet(data, text) })
          }}
          disabled={!text.trim()}
        >
          {isCsv ? '預覽 CSV 匯入' : '預覽匯入'}
        </button>
        <button onClick={onDone}>取消</button>
      </div>
      {preview && <div aria-live="polite">
        <h4>匯入預覽：{preview.result.rows} 列、{preview.result.accounts} 個帳戶</h4>
        {preview.source !== data && <p role="alert">資料已變更，請重新預覽後再確認。</p>}
        {preview.result.errors.length > 0 && <div role="alert">
          <p>以下錯誤必須全部修正，尚未套用任何資料：</p>
          <ul>{preview.result.errors.map((e, i) => <li key={i}>{e.line ? `第 ${e.line} 列：` : ''}{e.message}</li>)}</ul>
        </div>}
        {preview.result.replaced.map((a) => <div key={a.id}>
          <strong>將取代「{a.name}」，刪除以下 {a.positions.length} 筆原持倉：</strong>
          <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
        </div>)}
        {!preview.result.errors.length && preview.result.data.accounts.filter((a) => !preview.source.accounts.includes(a)).map((a) => <div key={a.id}>
          <strong>匯入後：{a.name} · {a.kind === 'bank' ? '銀行帳戶' : '投資帳戶'} · {a.category} · {a.country || '未設定國家'}</strong>
          <ul>{a.positions.map((p) => <li key={p.id}>{positionLine(p)}</li>)}</ul>
        </div>)}
        <ul>{preview.result.rateChanges.map((r) => <li key={r.currency}>匯率 {r.currency}：{r.before ?? '未設定'} → {r.after}</li>)}</ul>
        {unpriced > 0 && <p className="muted small">{unpriced} 個標的的價格會在確認後自動查詢。</p>}
        <p className="muted small">確認後還要按「儲存變更」才會保存。</p>
        <button className="primary" disabled={preview.source !== data || !!preview.result.errors.length || !preview.result.rows} onClick={() => {
          if (preview.source !== data || preview.result.errors.length || !preview.result.rows) return
          onChange(preview.result.data)
          onDone()
        }}>{preview.result.replaced.length ? '確認匯入並取代上述資料' : '確認匯入'}</button>
      </div>}
    </section>
  )
}

// Banks whose imported statement balances have no asset account: history counts them, today's total does not.
function StatementAssets({ data, onChange }: Props) {
  const missing = missingStatementAssets(data)
  if (!missing.length) return null
  return (
    <section className="notice statement-assets" aria-label="尚未建立的資產帳戶">
      <p><strong>已匯入的銀行帳單有 {missing.length} 個帳戶還沒有資產帳戶。</strong>它們的期末餘額只出現在資產歷史，目前總資產沒有算進去。</p>
      <ul>
        {missing.map((m) => (
          <li key={m.accountId}>
            <strong>{m.label}</strong>
            {m.balances.length ? m.balances.map((b) => ` · ${b.currency} ${fmt(b.quantity, 2)}（${b.date.replace(/-/g, '/')}）`).join('') : ' · 沒有正數餘額，建立空帳戶'}
          </li>
        ))}
      </ul>
      <p className="muted small">建立後目前餘額先用最新一期帳單的期末餘額，可再點進帳戶修改。變更後請按「儲存變更」。</p>
      <button className="primary" onClick={() => onChange(createStatementAssets(data))}>建立 {missing.length} 個資產帳戶</button>
    </section>
  )
}
