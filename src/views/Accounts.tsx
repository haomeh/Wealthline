import { useState } from 'react'
import { fmt } from '../format'
import { importSheet, type ImportResult } from '../importSheet'
import { ACCOUNT_KINDS, accountBaseValue, breakdown, cashCurrencies, type Account, type AccountKind, type Slice, type WealthData } from '../model'
import { accountChange } from '../accountTrend'
import { displaySymbol } from '../quotes'
import { useCalendarNow } from '../useCalendarNow'
import { AccountDetail } from './AccountDetail'
import { AccountForm } from './AccountForm'

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
}

export function Accounts({ data, onChange, view, setView, onBack, onRefreshPrices, priceError }: AccountsProps) {
  const now = useCalendarNow()
  const showImport = view.page === 'list' && !!view.importing
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
          <button onClick={() => setShowImport(!showImport)}>從試算表匯入</button>
          <button className="primary" onClick={() => setView({ page: 'new' })}>
            ＋ 新增帳戶
          </button>
        </div>
      </div>
      {showImport && <ImportPanel data={data} onChange={onChange} onDone={() => setShowImport(false)} />}
      {data.accounts.length === 0 && !showImport && (
        <section className="panel empty">
          <p className="muted">還沒有帳戶。按「新增帳戶」定義你的第一個銀行或投資帳戶，再點進去填餘額或持倉。</p>
        </section>
      )}
      {data.accounts.length > 0 && <div className="tiles">
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
        <section key={kind} className="panel account-table" aria-label={ACCOUNT_KINDS[kind]}>
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
    </>
  )
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

function ImportPanel({ data, onChange, onDone }: Props & { onDone: () => void }) {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<{ source: WealthData; result: ImportResult } | null>(null)
  return (
    <section className="panel">
      <h3>從試算表匯入</h3>
      <p className="muted small">
        從 Google 試算表或 Excel 複製資料列後貼上（不含標題列）。欄位順序：機構、類別、子類別、幣別、數量、單價、原幣市值、匯率、台幣市值、佔比。
        同名帳戶的全部原持倉會被取代，匯率會一併更新。請先預覽並確認刪除差異；有錯誤時整批不匯入。
      </p>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null) }} rows={8} placeholder="在這裡貼上…" />
      <div className="row">
        <button
          className="primary"
          onClick={() => {
            setPreview({ source: data, result: importSheet(data, text) })
          }}
          disabled={!text.trim()}
        >
          預覽匯入
        </button>
        <button onClick={onDone}>取消</button>
      </div>
      {preview && <div aria-live="polite">
        <h4>匯入預覽：{preview.result.rows} 列、{preview.result.accounts} 個帳戶</h4>
        {preview.source !== data && <p role="alert">資料已變更，請重新預覽後再確認。</p>}
        {preview.result.errors.length > 0 && <div role="alert">
          <p>以下錯誤必須全部修正，尚未套用任何資料：</p>
          <ul>{preview.result.errors.map((e) => <li key={e.line}>第 {e.line} 列：{e.message}</li>)}</ul>
        </div>}
        {preview.result.replaced.map((a) => <div key={a.id}>
          <strong>將取代「{a.name}」，刪除以下 {a.positions.length} 筆原持倉：</strong>
          <ul>{a.positions.map((p) => <li key={p.id}>{p.symbol || '現金'} · {p.currency} · 數量 {p.quantity} · 單價 {p.price}</li>)}</ul>
        </div>)}
        {!preview.result.errors.length && preview.result.data.accounts.filter((a) => !preview.source.accounts.includes(a)).map((a) => <div key={a.id}>
          <strong>匯入後：{a.name} · {a.kind === 'bank' ? '銀行帳戶' : '投資帳戶'} · {a.category} · {a.country || '未設定國家'}</strong>
          <ul>{a.positions.map((p) => <li key={p.id}>{p.symbol || '現金'} · {p.currency} · 數量 {p.quantity} · 單價 {p.price}</li>)}</ul>
        </div>)}
        <ul>{preview.result.rateChanges.map((r) => <li key={r.currency}>匯率 {r.currency}：{r.before ?? '未設定'} → {r.after}</li>)}</ul>
        <p className="muted small">確認後只更新本機資料，仍需按「儲存變更」才會寫入 Drive。</p>
        <button className="primary" disabled={preview.source !== data || !!preview.result.errors.length || !preview.result.rows} onClick={() => {
          if (preview.source !== data || preview.result.errors.length || !preview.result.rows) return
          onChange(preview.result.data)
          onDone()
        }}>確認匯入並取代上述資料</button>
      </div>}
    </section>
  )
}
