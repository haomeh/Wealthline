import { useMemo, useState, type FormEvent } from 'react'
import { accountCoverage, type AccountCoverageCell, type TimeNodeSource } from '../accountCoverage'
import { currencyDecimals, fmt, listAmount } from '../format'
import { resolveCompletion } from '../holdingPeriods'
import { localDate } from '../history'
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
import { QuantityEditor } from './QuantityHistory'
import { Sparkline } from './Sparkline'
import { accountChange, accountSeries } from '../accountTrend'
import { useCalendarNow } from '../useCalendarNow'

interface Props {
  data: WealthData
  account: Account
  onChange: (a: Account) => void
  onEdit: () => void
  onBack: () => void
  onRefreshPrices: () => Promise<void>
  priceError: string
  // The account as last saved: holdings whose quantity differs are marked as unsaved.
  saved?: Account
  dirty?: boolean
  busy?: boolean
  onSaveHistory?: (next: WealthData) => void
  onGoHistory?: (date?: string) => void
}

// Where the numbers go: balances per currency, and holdings for investment accounts.
export function AccountDetail({ data, account: a, onChange, onEdit, onBack, onRefreshPrices, priceError, saved, dirty = false, busy = false, onSaveHistory, onGoHistory }: Props) {
  const [refreshing, setRefreshing] = useState(false)
  // The holding whose daily values are shown under its row.
  const [open, setOpen] = useState<string | null>(null)
  const [allChanges, setAllChanges] = useState(false)
  const now = useCalendarNow()
  const setPositions = (positions: Position[]) => onChange({ ...a, positions })
  const setPosition = (p: Position) => setPositions(a.positions.map((x) => (x.id === p.id ? p : x)))
  const cash = a.positions.filter((p) => p.type === 'cash')
  const holdings = a.positions.filter((p) => p.type === 'holding')

  const value = accountBaseValue(data, a)
  const series = accountSeries(data, a, now)
  const change = accountChange(data, a, now)
  const changes = data.history.changes.filter((c) => c.accountId === a.id)
  // Quantity added since the last save; null when unchanged. A holding added since then counts in full.
  const unsaved = (p: Position) => {
    if (!saved) return null
    const before = saved.positions.find((x) => x.id === p.id)?.quantity ?? 0
    return before === p.quantity ? null : p.quantity - before
  }
  const quoted = holdings.map((p) => p.priceUpdatedAt).filter((t): t is string => !!t).sort().at(-1)

  const balances = (
    <section className="panel">
      <h3>{a.kind === 'bank' ? '餘額' : '可用金額'}</h3>
      {cash.length === 0 && <p className="muted">{a.kind === 'bank' ? '還沒有幣別。按「編輯帳戶」選擇這個帳戶持有的幣別。' : '還沒有記錄帳戶裡的現金。需要的話，按「編輯帳戶」加入幣別。'}</p>}
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
  )

  return (
    <>
      <div className="page-head detail-head">
        <div>
          <div className="detail-nav">
            <button className="back-link" onClick={onBack}>‹ 帳戶</button>
            <button className="link mobile-only" onClick={onEdit}>編輯帳戶</button>
          </div>
          <p className="detail-meta muted mobile-only">{[ACCOUNT_KINDS[a.kind], a.country, a.category].filter(Boolean).join(' · ')}</p>
          <h2>{a.name}</h2>
        </div>
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel account-value" aria-label="台幣價值">
            <div className="tile-stat">
              <span>台幣價值</span>
              <strong className="figure">NT$ {fmt(value, 0)}</strong>
              {change !== null && <small className={change > 0.0005 ? 'change up' : change < -0.0005 ? 'change down' : 'muted'}>
                {change > 0.0005 ? '↑' : change < -0.0005 ? '↓' : ''} {Math.abs(change * 100).toFixed(1)}% · 30 天
              </small>}
              {quoted && <small className="muted mobile-only">報價 {quoteTime(quoted)}</small>}
            </div>
            <Sparkline values={series.map((p) => p.value)} label={`${a.name} 每日價值，${series[0].date} 到今天`} />
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
                      {holdings.map((p) => { const diff = unsaved(p); return (
                        <tr key={p.id} className={[open === p.id ? 'open' : '', diff !== null ? 'unsaved' : ''].filter(Boolean).join(' ') || undefined}>
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
                            {diff !== null && <div className="unsaved-mark small">● 數量 {diff > 0 ? '+' : '−'}{fmt(Math.abs(diff))}（未儲存）</div>}
                          </td>
                          <td className="num">
                            <NumberInput className="cell-input" value={p.quantity} onCommit={(v) => setPosition({ ...p, quantity: v })} size={10} />
                          </td>
                          <td className="num">
                            <PriceCell position={p} onChange={setPosition} />
                          </td>
                          <td className="num nowrap">
                            {listAmount(positionValue(p), p.currency)} <span className="muted small">{p.currency}</span>
                          </td>
                          <td className="num num-serif">{fmt(baseValue(data, p), 0)}</td>
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
                      )})}
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

          {balances}

          <AccountHistoryNodes
            data={data}
            account={a}
            now={now}
            dirty={dirty}
            busy={busy}
            onSaveHistory={onSaveHistory}
            onGoHistory={onGoHistory}
          />

          {allChanges && changes.length > 0 && (
            <section className="panel" id="account-changes">
              <div className="panel-head"><h3>異動紀錄</h3><button className="link small" onClick={() => setAllChanges(false)}>收起</button></div>
              <ChangeList changes={changes} showAccount={false} limit={20} />
            </section>
          )}
        </div>

        <div className="detail-side">
          <section className="panel account-facts" aria-label="帳戶設定">
            <dl>
              <dt>類型</dt><dd>{ACCOUNT_KINDS[a.kind]}</dd>
              <dt>國家</dt><dd>{a.country ? countryLabel(a.country) : '未設定'}</dd>
              <dt>類別</dt><dd>{a.category}</dd>
              {quoted && <><dt>報價</dt><dd>{quoteTime(quoted)}</dd></>}
            </dl>
            <button className="link" onClick={onEdit}>編輯帳戶</button>
          </section>
          {changes.length > 0 && (
            <section className="panel recent-changes" aria-label="最近異動">
              <h3>最近異動</h3>
              <ul>
                {[...changes].sort((x, y) => y.at.localeCompare(x.at)).slice(0, 4).map((c, i) => (
                  <li key={`${c.at}-${i}`}>
                    <span className="muted">{shortDate(c.at)}</span>
                    <span>{c.type === 'cash' ? `${c.symbol} 餘額` : displaySymbol(c.symbol)} {c.before ? fmt(c.before.quantity) : '新增'} → {c.after ? fmt(c.after.quantity) : '移除'}</span>
                  </li>
                ))}
              </ul>
              {!allChanges && <button className="link small" onClick={() => setAllChanges(true)}>查看全部 {changes.length} 筆</button>}
            </section>
          )}
        </div>
      </div>
    </>
  )
}

// A unit price keeps its currency's decimals (231.50 USD beside 548.12 USD) and up to four when it has them.
const priceText = (price: number, currency: string) =>
  Number.isFinite(price) ? price.toLocaleString('zh-TW', { minimumFractionDigits: currencyDecimals(currency), maximumFractionDigits: 4 }) : '—'
const quoteTime = (iso: string) => new Date(iso).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })
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
        {priceText(p.price, p.currency)} <span className="muted small">{p.currency}</span>
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

const NODE_SOURCE_LABELS: Record<TimeNodeSource, string> = {
  snapshot: '原始快照',
  statement: '銀行帳單',
  inventory: '完整回補',
  completion: '當日補齊',
  manual: '單日補登',
  period: '期間推算',
  'period-omitted': '期間推算（未顯示於總覽）',
}

const fmtDate = (date: string) => date.replaceAll('-', '/')

function recordedSummary(data: WealthData, accountId: string, date: string, cell: AccountCoverageCell): string {
  const rawDay = data.history.quantityDays?.find((d) => d.date === date)
  if (rawDay) {
    const resolved = resolveCompletion(data, rawDay)
    const entries = resolved.entries.filter((e) => e.accountId === accountId && e.quantity !== null)
    if (entries.length) {
      const nonzero = entries.filter((e) => e.quantity !== 0)
      if (!nonzero.length) return '數量皆為 0'
      return nonzero
        .map((e) => (e.type === 'cash' ? `${e.currency} ${fmt(e.quantity!, 2)}` : `${displaySymbol(e.symbol)} ${fmt(e.quantity!, 6)}`))
        .join(' · ')
    }
  }
  if (cell.recordedValue !== undefined && cell.recordedValue !== null) return `快照 NT$ ${fmt(cell.recordedValue, 0)}`
  return ''
}

function AccountHistoryNodes({
  data,
  account,
  now,
  dirty,
  busy,
  onSaveHistory,
  onGoHistory,
}: {
  data: WealthData
  account: Account
  now: string
  dirty: boolean
  busy: boolean
  onSaveHistory?: (next: WealthData) => void
  onGoHistory?: (date?: string) => void
}) {
  const [onlyGaps, setOnlyGaps] = useState(false)
  const [visible, setVisible] = useState(20)
  const [backfill, setBackfill] = useState<{ date: string; entryKey?: string } | null>(null)

  const rows = useMemo(() => {
    const report = accountCoverage(data, now)
    return report.nodes.flatMap((node) => {
      const cell = node.cells.find((c) => c.account.id === account.id)
      return cell ? [{ node, cell }] : []
    })
  }, [data, now, account.id])

  const gapCount = rows.filter(({ cell }) => cell.status !== 'recorded' && cell.status !== 'confirmed-absent').length
  const shown = onlyGaps ? rows.filter(({ cell }) => cell.status !== 'recorded' && cell.status !== 'confirmed-absent') : rows
  const editDisabled = busy || dirty || !onSaveHistory

  return (
    <section className="panel account-history-nodes" aria-label="歷史時間節點">
      <div className="panel-head">
        <div>
          <h3>歷史時間節點</h3>
          <p className="muted small">
            {rows.length
              ? `共 ${rows.length} 個歷史節點 · ${rows.length - gapCount} 個完整${gapCount ? ` · ${gapCount} 個缺漏或沿用` : ''}`
              : '尚無歷史時間節點紀錄，可先補登過去任意日期的餘額或持倉。'}
          </p>
        </div>
        <div className="row">
          {rows.length > 0 && gapCount > 0 && (
            <div className="segmented" role="group" aria-label="篩選此帳戶時間節點">
              <button type="button" className={!onlyGaps ? 'on' : ''} aria-pressed={!onlyGaps} onClick={() => setOnlyGaps(false)}>
                全部
              </button>
              <button type="button" className={onlyGaps ? 'on' : ''} aria-pressed={onlyGaps} onClick={() => setOnlyGaps(true)}>
                只看缺漏 ({gapCount})
              </button>
            </div>
          )}
          <button
            type="button"
            className="small"
            disabled={editDisabled}
            onClick={() => setBackfill({ date: localDate(now) })}
          >
            ＋ 補登歷史日期
          </button>
        </div>
      </div>

      {dirty && <p className="notice">請先儲存或捨棄其他未儲存修改，再補登歷史數量。</p>}

      {backfill && onSaveHistory && (
        <QuantityEditor
          key={`${backfill.date}:${account.id}:${backfill.entryKey ?? ''}`}
          data={data}
          busy={busy || dirty}
          date={backfill.date}
          accountId={account.id}
          entryKey={backfill.entryKey}
          singleItemOnly
          onCancel={() => setBackfill(null)}
          onApply={(next) => {
            onSaveHistory(next)
            setBackfill(null)
          }}
        />
      )}

      {shown.length > 0 ? (
        <>
          <ul className="account-node-list">
            {shown.slice(0, visible).map(({ node, cell }) => {
              const isGap = cell.status !== 'recorded' && cell.status !== 'confirmed-absent'
              const isCritical = cell.status === 'missing-zero'
              const detail =
                cell.status === 'recorded'
                  ? recordedSummary(data, account.id, node.date, cell)
                  : cell.status === 'partial'
                    ? `缺 ${cell.missingItems?.join('、') || '部分項目'}`
                    : cell.status === 'carried'
                      ? cell.carriedFrom
                        ? `沿用 ${fmtDate(cell.carriedFrom)}`
                        : '沿用更早紀錄'
                      : cell.status === 'no-quote'
                        ? cell.missingItems?.join('、') || '缺少歷史收盤價或匯率'
                        : ''
              const badge =
                cell.status === 'recorded'
                  ? { cls: 'good', text: '有紀錄' }
                  : cell.status === 'confirmed-absent'
                    ? { cls: '', text: '已確認未持有' }
                    : cell.status === 'missing-zero'
                      ? { cls: 'critical', text: '缺少紀錄（以 0 計）' }
                      : cell.status === 'partial'
                        ? { cls: 'warn', text: '部分缺少' }
                        : cell.status === 'carried'
                          ? { cls: 'warn', text: '沿用舊值' }
                          : { cls: 'warn', text: '缺行情' }

              return (
                <li key={node.date} className={`account-node-row${isCritical ? ' is-critical' : ''}`}>
                  <div className="account-node-main">
                    <div className="account-node-head">
                      <time dateTime={node.date}>{fmtDate(node.date)}</time>
                      <span className="tag">{NODE_SOURCE_LABELS[node.source]}</span>
                      <span className={`tag ${badge.cls}`.trim()}>{badge.text}</span>
                    </div>
                    {detail && <div className="muted small account-node-detail">{detail}</div>}
                  </div>
                  <div className="account-node-actions">
                    <button
                      type="button"
                      className={isGap ? 'small' : 'ghost small'}
                      disabled={editDisabled}
                      onClick={() =>
                        setBackfill({
                          date: node.date,
                          entryKey: cell.missingKeys?.length === 1 ? cell.missingKeys[0] : undefined,
                        })
                      }
                    >
                      {isGap ? '補登這天' : '修改數量'}
                    </button>
                    {onGoHistory && (
                      <button type="button" className="link small" onClick={() => onGoHistory(node.date)}>
                        明細 →
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {shown.length > visible && (
            <button type="button" className="ghost small coverage-more" onClick={() => setVisible((n) => n + 30)}>
              顯示更早 30 個節點（尚有 {shown.length - visible} 個）
            </button>
          )}
        </>
      ) : (
        rows.length > 0 && <p className="muted small">此帳戶目前沒有缺漏的時間節點。</p>
      )}
    </section>
  )
}
