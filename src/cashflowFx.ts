import { cashflowSummary, type CashflowCurrencySummary, type CashflowMonthTotals, type CashflowReviewTotals } from './cashflow'
import { fetchHistoricalFx, historicalFxError, type HistoryFetcher } from './historicalFx'
import { fetchHistory, fxSymbol } from './priceHistory'
import { quoteOn, validDate } from './quantityHistory'

export interface CashflowFxEvidence {
  month: string
  currency: string
  targetDate: string
  rate: number
  legs: { symbol: string; date: string; rate: number }[]
}
export interface CashflowConversion {
  group?: CashflowCurrencySummary
  fx: CashflowFxEvidence[]
}

function targetDate(month:string,today:string):string {
  if(month===today.slice(0,7)) return today
  const end=new Date(`${month}-01T00:00:00Z`)
  end.setUTCMonth(end.getUTCMonth()+1,0)
  return end.toISOString().slice(0,10)
}

/** Local evidence for the hook's immediate TWD-only projection; no quote request is needed. */
export function twdCashflowEvidence(groups:readonly CashflowCurrencySummary[],today:string):CashflowFxEvidence[] {
  return groups.filter(group=>group.currency==='TWD').flatMap(group=>group.months
    .filter(point=>point.coverage.recordCount>0)
    .map(point=>({month:point.month,currency:'TWD',targetDate:targetDate(point.month,today),rate:1,legs:[]})))
}

/** Monthly conversion is a display projection; it never changes stored records or rates. */
export async function cashflowWithFxEvidence(groups:readonly CashflowCurrencySummary[], today:string, fetcher:HistoryFetcher=fetchHistory):Promise<CashflowConversion> {
  if(!validDate(today)) throw new Error('換算日期無效')
  if(!groups.length) return {group:undefined,fx:[]}
  const converted=await Promise.all(groups.map(async group=>{
    const points=group.months.filter(point=>point.coverage.recordCount>0)
    const targets=points.map(point=>{
      if(point.month>today.slice(0,7) && group.currency!=='TWD') throw new Error(`${point.month} ${group.currency}：尚無該月份匯率`)
      return targetDate(point.month,today)
    })
    const history=group.currency==='TWD'?null:await fetchHistoricalFx(group.currency,[...targets].sort()[0],fetcher).catch(()=>null)
    return points.map((point,index)=>{
      const date=targets[index]
      const error=historicalFxError(group.currency,date,history)
      if(error) throw new Error(`${point.month} ${group.currency}：${error}`)
      if(group.currency!=='TWD' && history?.symbol!==fxSymbol(group.currency)) throw new Error(`${point.month} ${group.currency}：來源行情代號不符`)
      const quote=group.currency==='TWD'?undefined:quoteOn(history,date)!
      const rate=quote?.value ?? 1
      const fx:CashflowFxEvidence={month:point.month,currency:group.currency,targetDate:date,rate,
        legs:quote?(quote.legs ?? [quote]).map(leg=>({symbol:leg.symbol,date:leg.date,rate:leg.value})):[]}
      const money=(value:number)=>{
        const result=value*rate
        if(!Number.isFinite(result)) throw new Error('換算金額超出範圍')
        return result
      }
      const review=<T extends CashflowReviewTotals>(value:T):T=>({...value,debitAmount:money(value.debitAmount),creditAmount:money(value.creditAmount)})
      const month:CashflowMonthTotals={currency:'TWD',month:point.month,coverage:{...point.coverage},totals:{
        income:money(point.income!),consumption:money(point.consumption!),difference:money(point.difference!),
        incomeCategories:point.incomeCategories.map(c=>({...c,net:money(c.net)})),
        consumptionCategories:point.consumptionCategories.map(c=>({...c,net:money(c.net)})),
        pending:review(point.pending),excluded:review(point.excluded),exclusions:point.exclusions.map(review),
        investmentRecovery:{...point.investmentRecovery,net:money(point.investmentRecovery.net)},
      }}
      return {month,fx}
    })
  }))
  // Stable accumulation order also keeps rounding independent of request completion order.
  const results=converted.flat()
  return {group:cashflowSummary({months:results.map(result=>result.month)},groups[0].endMonth,groups[0].period)[0],fx:results.map(result=>result.fx)}
}

/** Compatibility projection for callers that only need totals. */
export async function cashflowInTwd(groups:readonly CashflowCurrencySummary[],today:string,fetcher:HistoryFetcher=fetchHistory):Promise<CashflowCurrencySummary|undefined> {
  return (await cashflowWithFxEvidence(groups,today,fetcher)).group
}
