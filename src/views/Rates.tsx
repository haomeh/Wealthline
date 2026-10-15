import { useState } from 'react'
import { BASE_CURRENCY, usedCurrencies, type WealthData } from '../model'
import { NumberInput } from './NumberInput'
import { CRYPTO_IDS } from '../currencies'

interface Props {
  data: WealthData
  onChange: (d: WealthData) => void
  onRefresh: () => Promise<void>
  error: string
}

export function Rates({ data, onChange, onRefresh, error }: Props) {
  const [refreshing, setRefreshing] = useState(false)
  const currencies = usedCurrencies(data)

  // Typing a rate pins it; automatic updates then leave that currency alone.
  const setManual = (c: string, r: number) =>
    onChange({
      ...data,
      fxRates: { ...data.fxRates, [c]: r },
      fxManual: data.fxManual.includes(c) ? data.fxManual : [...data.fxManual, c],
    })
  const unpin = (c: string) => onChange({ ...data, fxManual: data.fxManual.filter((x) => x !== c) })

  // Which accounts and debts each currency's rate is used for.
  const usedBy = (c: string) => [
    ...data.accounts.filter((a) => a.positions.some((p) => p.currency === c)).map((a) => a.name),
    ...(data.liabilities ?? []).filter((d) => d.currency === c).map((d) => d.name),
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h2>匯率</h2>
          <p className="muted">
            每 1 單位兌新臺幣
            {data.fxUpdatedAt && ` · 自動更新於 ${new Date(data.fxUpdatedAt).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <button
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            await onRefresh()
            setRefreshing(false)
          }}
        >
          {refreshing ? '更新中…' : '立即更新'}
        </button>
      </div>
      {error && <p className="banner error">{error}</p>}
      <section className="panel rates-table">
        {currencies.length === 0 ? (
          <p className="muted">目前只有 {BASE_CURRENCY}，不需要匯率。</p>
        ) : (
          <div className="scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>幣別</th>
                  <th>用於</th>
                  <th className="num">兌 {BASE_CURRENCY}</th>
                  <th>來源</th>
                  <th className="num">設定</th>
                </tr>
              </thead>
              <tbody>
                {currencies.map((c) => {
                  const manual = data.fxManual.includes(c)
                  const rate = data.fxRates[c]
                  return (
                    <tr key={c} className={manual ? 'pinned' : ''}>
                      <td>
                        <strong>{c}</strong>
                      </td>
                      <td className="muted ellipsis">{usedBy(c).join(' · ') || '—'}</td>
                      <td className="num">
                        <NumberInput className="cell-input num-serif" digits={4} value={rate ?? 0} onCommit={(v) => setManual(c, v)} aria-label={`${c} 匯率`} />
                      </td>
                      <td className="muted">{manual ? '手動' : c in CRYPTO_IDS ? 'CoinGecko' : 'ExchangeRate-API'}</td>
                      <td className="num">
                        {!(rate > 0) ? (
                          <span className="tag warn">缺少匯率</span>
                        ) : manual ? (
                          <button className="pin-chip" onClick={() => unpin(c)} title="解除固定，改回自動更新">
                            已固定 · 解除
                          </button>
                        ) : (
                          <span className="muted">自動</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {currencies.length > 0 && <div className="tiles">
        <section className="panel span-2">
          <h3>想用自己的匯率？</h3>
          <p className="muted small">直接點表格裡的匯率修改，改過的會固定下來，不被每天的自動更新覆蓋。法幣來自 ExchangeRate-API，穩定幣與加密貨幣來自 CoinGecko。</p>
        </section>
      </div>}
    </>
  )
}
