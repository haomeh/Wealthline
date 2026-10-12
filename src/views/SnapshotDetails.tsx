import type { HistoricalPoint, QuantityDay } from '../quantityHistory'
import { entryValue } from '../quantityHistory'
import { fmt } from '../format'
import { accountLabel, baseValue, type WealthData, CATEGORIES, COMMON_CURRENCIES, COUNTRIES, countryLabel, type Slice } from '../model'
import { colorize } from '../chartColors'
import { Allocation } from './charts'
import { filledNote } from './historySeries'

const money = (value: number | null | undefined) => value == null ? '資料不完整' : `NT$ ${fmt(value, 0)}`
function slices(values: Record<string, number | null>): Slice[] | null {
  if (Object.values(values).some(v => v === null)) return null
  const total = Object.values(values).reduce<number>((sum, v) => sum + (v ?? 0), 0)
  return Object.entries(values).map(([label, v]) => ({ label, value: v!, share: total ? v! / total : 0 })).sort((a,b) => b.value-a.value)
}

// Currency or country of each account's value. Accounts the day recorded use their entries;
// the others (an original snapshot, or a filled account) take the country of the account and
// split their value by the currencies of its current holdings, which is an estimate.
function exposure(point: HistoricalPoint, day: QuantityDay | undefined, data: WealthData, key: 'currency' | 'country') {
  if (point.total === null) return null
  const filled = new Set(point.filled?.map(f => f.id))
  const sums: Record<string, number> = Object.create(null)
  const add = (label: string, value: number) => { if (value) sums[label] = (sums[label] ?? 0) + value }
  let estimated = false
  for (const a of point.accounts) {
    if (!a.value) continue
    const entries = filled.has(a.id) ? [] : day?.entries.filter(e => e.accountId === a.id) ?? []
    if (entries.length) {
      for (const e of entries) add(key === 'country' ? countryLabel(e.country) : e.currency, entryValue(e) ?? 0)
      continue
    }
    const account = data.accounts.find(x => x.id === a.id)
    const country = account?.country ?? day?.entries.find(e => e.accountId === a.id)?.country
    if (key === 'country') { add(country ? countryLabel(country) : '未知', a.value); continue }
    estimated = true
    const weights = (account?.positions ?? []).map(p => [p.currency, baseValue(data, p)] as const).filter(([, v]) => Number.isFinite(v) && v > 0)
    const sum = weights.reduce((s, [, v]) => s + v, 0)
    if (!sum) add(account?.positions[0]?.currency ?? '未知', a.value)
    else for (const [currency, v] of weights) add(currency, a.value * v / sum)
  }
  return { slices: slices(sums), estimated }
}

interface Props {
  point: HistoricalPoint
  day?: QuantityDay
  data: WealthData
  onBackfill?: (date: string) => void
}

export function SnapshotDetails({ point, day, data, onBackfill }: Props) {
  const category = point.total === null ? null : slices(point.categories), currency = exposure(point, day, data, 'currency'), country = exposure(point, day, data, 'country')
  const unrecorded = point.filled?.length ?? 0
  return <>
    <section className="panel hero" aria-label="快照總資產">
      <span className="eyebrow">{point.date.replaceAll('-', '/')} · {point.periodDerived ? '期間推算' : point.manual ? '補登快照' : '歷史快照'}</span>
      <div className="hero-figure">{money(point.total)}</div>
      <p className="muted">{point.accounts.length} 個帳戶 · 總資產</p>
    </section>
    <section className="panel stat" aria-label="總負債"><span className="eyebrow">總負債{point.liabilityEstimated && '（預估）'}</span><strong>{point.liabilityAssumed ? '未記錄（以 0 計）' : money(point.liabilityTotal)}</strong></section>
    <section className="panel stat" aria-label="淨資產"><span className="eyebrow">淨資產{point.liabilityEstimated && '（預估）'}</span><strong>{money(point.netWorth)}</strong><span className="muted small">總資產 − 總負債{point.liabilityAssumed && ' · 負債未記錄，以 0 計'}</span></section>
    <section className="panel span-2"><h3>資產配置</h3>{category?.length ? <Allocation slices={colorize(category, CATEGORIES)} /> : <p className="muted">缺少歷史數量或行情，配置尚不完整。</p>}</section>
    <section className="panel" aria-label="快照帳戶"><h3>當時的帳戶餘額</h3>
      <ul className="snapshot-accounts">{point.accounts.map(a => <li key={a.id}><span>{accountLabel({ name: a.name, country: day?.entries.find(e => e.accountId === a.id)?.country ?? data.accounts.find(x => x.id === a.id)?.country })}{filledNote(point, a.id) && <small className="muted"> · {filledNote(point, a.id)}</small>}</span><strong>{money(a.value)}</strong></li>)}</ul>
      {unrecorded > 0 && <p className="muted small">{unrecorded} 個帳戶這天沒有紀錄，沿用之前最近一筆金額；沒有更早紀錄的以 0 計。{onBackfill && <button className="link" onClick={() => onBackfill(point.date)}>補登這天的數量</button>}</p>}
    </section>
    <section className="panel"><h3>幣別曝險</h3>{currency?.slices?.length ? <><Allocation slices={colorize(currency.slices, COMMON_CURRENCIES)} />{currency.estimated && <p className="muted small">部分帳戶沒有這天的幣別明細，依帳戶目前持倉的幣別比例估計。</p>}</> : <p className="muted">這天的資料不足以計算幣別。</p>}</section>

    <section className="panel"><h3>國家</h3>{country?.slices?.length ? <Allocation slices={colorize(country.slices, Object.values(COUNTRIES))} /> : <p className="muted">這天的資料不足以計算國家。</p>}</section>
  </>
}
