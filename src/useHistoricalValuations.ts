import { expandPeriodDays } from './holdingPeriods'
import { useCalendarNow } from './useCalendarNow'
import { localDate } from './history'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { WealthData } from './model'
import { clearHistoryCache, fetchHistory } from './priceHistory'
import { isUnrecordedPartialDay, repriceEntry, valueDays, type QuantityDay } from './quantityHistory'

// Include the evidence/identities used by projection, not present-day prices, FX,
// debt or save timestamps. This also works when immutable parents recreate objects.
export function historicalProjectionKey(data: WealthData, today: string) {
  return JSON.stringify({today,data:{
    accounts:data.accounts.map(a=>({id:a.id,name:a.name,category:a.category,country:a.country,
      positions:a.positions.map(p=>({type:p.type,symbol:p.symbol,currency:p.currency}))})),
    history:{holdingPeriods:data.history.holdingPeriods,quantityDays:data.history.quantityDays,
      snapshots:data.history.snapshots.map(s=>({date:s.date})),
      changes:data.history.changes.map(c=>({accountId:c.accountId,account:c.account,type:c.type,symbol:c.type==='cash'?'':c.symbol,currency:c.currency,at:c.at,
        before:c.before ? {quantity:c.before.quantity,price:0}:null,after:c.after ? {quantity:c.after.quantity,price:0}:null}))}
  }})
}

// Query-only values. Never retain an old instrument/quantity's valuation for a new key.
// `from`: only days from this date on are valued (earlier history is not loaded).
export function useHistoricalValuations(data: WealthData, from = '') {
  const now = useCalendarNow()
  const today = localDate(now)
  const key = JSON.stringify([historicalProjectionKey(data,today), from])
  const source = useMemo(() => {
    const [projectionKey, start] = JSON.parse(key) as [string, string]
    const projection=JSON.parse(projectionKey) as {today:string;data:WealthData}
    try { return { days: expandPeriodDays(projection.data, `${projection.today}T12:00:00`).filter(d => d.date >= start), error: '' } }
    catch (e) { return { days: [] as QuantityDay[], error: e instanceof Error ? e.message : '期間資料無法估值' } }
    // key represents all inputs used by expansion; unrelated data must keep identity.
  }, [key])
  const days = source.days
  const [generation, setGeneration] = useState(0)
  const reload = useRef(false)
  const [loaded, setLoaded] = useState<{ key: string; generation: number; values: QuantityDay[]; error:string }>()
  useEffect(() => {
    if (!days.length) return
    let active = true
    const fresh = reload.current
    reload.current = false
    void valueDays(days, (symbol, from) => fetchHistory(symbol, from, fresh))
      .then(values => { if (active) setLoaded({ key, generation, values, error:values.some(d=>d.entries.some(e=>e.error)) ? '部分歷史行情無法取得；缺價或缺匯率的估值保持未知。' : '' }) })
    return () => { active = false }
  }, [days, key, generation])
  const same = loaded?.key === key
  const ready = same && loaded?.generation === generation
  const loading = !!days.length && !ready
  // On explicit refresh retain this exact projection's last successful values until
  // completion; failed refreshes replace missing values with unknown, never fallback.
  const values = useMemo(() => same ? loaded!.values : days.map(day => ({ ...day, entries: day.entries.map(e => repriceEntry(e, day.date, null, null)) })), [same, days, loaded])
  return {
    data: { ...data, history: { ...data.history, valuedQuantityDays: values } },
    error: source.error,
    omittedDays: values.filter(isUnrecordedPartialDay).length,
    status: loading ? (same ? '更新行情中，暫顯示上次估值。' : '正在查詢此組歷史資料。') : same ? loaded!.error : '',
    loading,
    refresh: () => { clearHistoryCache(); reload.current = true; setGeneration(g => g + 1) },
  }
}
