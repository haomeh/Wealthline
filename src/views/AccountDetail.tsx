import { useState, type FormEvent } from 'react'
import { fmt } from '../format'
import {
  ACCOUNT_KINDS,
  BASE_CURRENCY,
  accountBaseValue,
  baseValue,
  cashCurrencies,
  countryLabel,
  newId,
  positionValue,
  type Account,
  type Position,
  type WealthData,
} from '../model'
import { displaySymbol, lookupQuote } from '../quotes'
import { ChangeList } from './History'
import { NumberInput } from './NumberInput'
import { PositionHistory } from './PositionHistory'

interface Props {
  data: WealthData
  account: Account
  onChange: (a: Account) => void
  onEdit: () => void
  onBack: () => void
  onRefreshPrices: () => Promise<void>
  priceError: string
}

// Where the numbers go: balances per currency, and holdings for investment accounts.
export function AccountDetail({ data, account: a, onChange, onEdit, onBack, onRefreshPrices, priceError }: Props) {
  const [refreshing, setRefreshing] = useState(false)
  // The holding whose daily values are shown under its row.
  const [open, setOpen] = useState<string | null>(null)
  const setPositions = (positions: Position[]) => onChange({ ...a, positions })
  const setPosition = (p: Position) => setPositions(a.positions.map((x) => (x.id === p.id ? p : x)))
  const cash = a.positions.filter((p) => p.type === 'cash')
  const holdings = a.positions.filter((p) => p.type === 'holding')

  return (
    <>
      <button className="link back" onClick={onBack}>
        ← 所有帳戶
      </button>
      <section className="panel account-head">
        <div>
          <h2>{a.name}</h2>
          <div className="meta">
            <span className="tag">{ACCOUNT_KINDS[a.kind]}</span>
            {a.country && <span className="tag">{countryLabel(a.country)}</span>}
            <span className="tag">{a.category}</span>
          </div>
        </div>
        <div className="total">
          <span className="eyebrow">合計</span>
          <strong>NT$ {fmt(accountBaseValue(data, a), 0)}</strong>
          <button className="ghost small" onClick={onEdit}>
            編輯帳戶設定
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>{a.kind === 'bank' ? '餘額' : '可用金額'}</h3>
        {cash.length === 0 && <p className="muted">尚未設定幣別，請按「編輯帳戶設定」選擇持有幣別。</p>}
        {cash.map((p) => (
          <div className="balance" key={p.id}>
            <span className="ccy-badge">{p.currency}</span>
            <NumberInput className="amount-input" value={p.quantity} onCommit={(v) => setPosition({ ...p, quantity: v })} aria-label={`${p.currency} 餘額`} />
            <span className="balance-side">
              <span className="muted num">
                {p.currency === BASE_CURRENCY
                  ? ''
                  : Number.isFinite(baseValue(data, p))
                    ? `≈ ${BASE_CURRENCY} ${fmt(baseValue(data, p), 0)}`
                    : '尚未設定匯率'}
              </span>
              <TrendToggle open={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)} />
            </span>
          </div>
        ))}
        {cash
          .filter((p) => p.id === open)
          .map((p) => (
            <PositionHistory key={p.id} data={data} account={a} position={p} onClose={() => setOpen(null)} />
          ))}
      </section>

      {(a.kind === 'investment' || holdings.length > 0) && (
        <section className="panel">
          <div className="panel-head">
            <h3>持有標的</h3>
            {holdings.some((p) => !p.priceManual) && (
              <button
                className="small"
                disabled={refreshing}
                onClick={async () => {
                  setRefreshing(true)
                  await onRefreshPrices()
                  setRefreshing(false)
                }}
              >
                {refreshing ? '更新中…' : '更新報價'}
              </button>
            )}
          </div>
          {priceError && <p className="notice">{priceError}</p>}
          {holdings.length > 0 && (
            <div className="scroll">
              <table className="data holdings">
                <thead>
                  <tr>
                    <th>標的</th>
                    <th className="num">數量</th>
                    <th className="num">價格</th>
                    <th className="num">市值</th>
                    <th className="num">{BASE_CURRENCY}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {holdings.map((p) => (
                    <tr key={p.id} className={open === p.id ? 'open' : ''}>
                      <td>
                        <button
                          className="link symbol"
                          aria-expanded={open === p.id}
                          title={open === p.id ? '收起每日價值' : '查看每日價值'}
                          onClick={() => setOpen(open === p.id ? null : p.id)}
                        >
                          <span className="chevron" aria-hidden>
                            {open === p.id ? '▾' : '▸'}
                          </span>
                          <strong>{displaySymbol(p.symbol)}</strong>
                        </button>
                        {p.name && p.name !== p.symbol && <div className="muted small ellipsis">{p.name}</div>}
                        {p.addedAt && <div className="muted small">{shortDay(p.addedAt)} 加入</div>}
                      </td>
                      <td className="num">
                        <NumberInput className="cell-input" value={p.quantity} onCommit={(v) => setPosition({ ...p, quantity: v })} size={10} />
                      </td>
                      <td className="num">
                        <PriceCell position={p} onChange={setPosition} />
                      </td>
                      <td className="num">
                        {fmt(positionValue(p))} <span className="muted small">{p.currency}</span>
                      </td>
                      <td className="num">{fmt(baseValue(data, p), 0)}</td>
                      <td className="row-actions">
                        <button
                          className="icon"
                          aria-label="刪除"
                          onClick={() => setPositions(a.positions.filter((x) => x.id !== p.id))}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {holdings
            .filter((p) => p.id === open)
            .map((p) => (
              <PositionHistory key={p.id} data={data} account={a} position={p} onClose={() => setOpen(null)} />
            ))}
          <AddHolding account={a} onAdd={(p) => setPositions([...a.positions, p])} />
        </section>
      )}

      {data.history.changes.some((c) => c.accountId === a.id) && (
        <section className="panel">
          <h3>異動紀錄</h3>
          <ChangeList changes={data.history.changes.filter((c) => c.accountId === a.id)} showAccount={false} limit={20} />
        </section>
      )}
    </>
  )
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' })

// Opens or closes a balance's or holding's daily value chart.
function TrendToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className={`ghost small trend-toggle${open ? ' on' : ''}`} aria-expanded={open} onClick={onClick}>
      {open ? '收起走勢' : '每日走勢'}
    </button>
  )
}

// Shows the market price; clicking lets the user type their own, which then stays fixed.
function PriceCell({ position: p, onChange }: { position: Position; onChange: (p: Position) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <span className="price-edit">
        <NumberInput
          className="cell-input"
          value={p.price}
          autoFocus
          onCommit={(v) => {
            if (v !== p.price) onChange({ ...p, price: v, priceManual: true })
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          size={8}
        />
      </span>
    )
  }
  return (
    <span className="price">
      <button className="link" onClick={() => setEditing(true)} title="點一下手動輸入價格">
        {fmt(p.price, 4)} <span className="muted small">{p.currency}</span>
      </button>
      {p.priceManual ? (
        <button className="tag-btn" onClick={() => onChange({ ...p, priceManual: false })} title="改回自動報價">
          手動
        </button>
      ) : (
        p.priceUpdatedAt && <span className="tag good">自動</span>
      )}
    </span>
  )
}

// Only the symbol and quantity are needed; price, currency and name come from the quote.
function AddHolding({ account, onAdd }: { account: Account; onAdd: (p: Position) => void }) {
  const [symbol, setSymbol] = useState('')
  const [quantity, setQuantity] = useState('')
  const [looking, setLooking] = useState(false)
  // Set when no quote was found: the user can then enter price and currency themselves.
  const [manual, setManual] = useState<{ price: string; currency: string } | null>(null)

  function reset() {
    setSymbol('')
    setQuantity('')
    setManual(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const qty = Number(quantity.replace(/,/g, ''))
    if (!symbol.trim() || !Number.isFinite(qty)) return
    if (manual) {
      const price = Number(manual.price.replace(/,/g, ''))
      if (!Number.isFinite(price)) return
      onAdd({ id: newId(), type: 'holding', symbol: symbol.trim().toUpperCase(), quantity: qty, price, currency: manual.currency, priceManual: true })
      return reset()
    }
    setLooking(true)
    const q = await lookupQuote(symbol, account.country, account.category.includes('加密'))
    setLooking(false)
    if (!q) {
      setManual({ price: '', currency: cashCurrencies(account)[0] ?? BASE_CURRENCY })
      return
    }
    onAdd({
      id: newId(),
      type: 'holding',
      symbol: q.symbol,
      name: q.name,
      quantity: qty,
      price: q.price,
      currency: q.currency,
      priceUpdatedAt: new Date().toISOString(),
    })
    reset()
  }

  return (
    <form className="add-holding" onSubmit={submit}>
      <div className="row">
        <input
          value={symbol}
          onChange={(e) => {
            setSymbol(e.target.value)
            setManual(null)
          }}
          placeholder="代號，如 2330、AAPL、BTC"
          aria-label="代號"
          required
          size={18}
        />
        <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="數量" aria-label="數量" inputMode="decimal" required size={10} />
        {manual && (
          <>
            <input
              value={manual.price}
              onChange={(e) => setManual({ ...manual, price: e.target.value })}
              placeholder="單價"
              aria-label="單價"
              inputMode="decimal"
              required
              size={8}
              autoFocus
            />
            <input
              value={manual.currency}
              onChange={(e) => setManual({ ...manual, currency: e.target.value.toUpperCase() })}
              aria-label="幣別"
              size={5}
              maxLength={5}
            />
          </>
        )}
        <button type="submit" className="primary" disabled={looking}>
          {looking ? '查詢報價…' : '＋ 新增'}
        </button>
      </div>
      <p className="muted small hint">
        {manual
          ? `找不到「${symbol.trim()}」的報價，請手動輸入單價和幣別。`
          : '只要填代號和數量，價格與幣別會自動帶入。台股填數字代號即可。'}
      </p>
    </form>
  )
}
