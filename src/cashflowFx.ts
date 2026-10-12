import { cashflowSummary, type CashflowCurrencySummary, type CashflowMonthTotals, type CashflowReviewTotals } from './cashflow'
import { fetchHistoricalFx, historicalFxError, type HistoryFetcher } from './historicalFx'
import { fetchHistory, fxSymbol } from './priceHistory'
import { quoteOn, validDate } from './quantityHistory'

/** Monthly conversion is a display projection; it never changes stored records or rates. */
export async function cashflowInTwd(groups:readonly CashflowCurrencySummary[], today:string, fetcher:HistoryFetcher=fetchHistory):Promise<CashflowCurrencySummary|undefined> {
  if(!validDate(today)) throw new Error('換算日期無效')
  if(!groups.length) return undefined
  const converted=await Promise.all(groups.map(async group=>{
    const points=group.months.filter(point=>point.coverage.recordCount>0)
    const targets=points.map(point=>{
      if(point.month>today.slice(0,7) && group.currency!=='TWD') throw new Error(`${point.month} ${group.currency}：尚無該月份匯率`)
      const end=new Date(`${point.month}-01T00:00:00Z`)
      end.setUTCMonth(end.getUTCMonth()+1,0)
      return point.month===today.slice(0,7)?today:end.toISOString().slice(0,10)
    })
    const history=group.currency==='TWD'?null:await fetchHistoricalFx(group.currency,[...targets].sort()[0],fetcher).catch(()=>null)
    return points.map((point,index):CashflowMonthTotals=>{
      const date=targets[index]
      const error=historicalFxError(group.currency,date,history)
      if(error) throw new Error(`${point.month} ${group.currency}：${error}`)
      if(group.currency!=='TWD' && history?.symbol!==fxSymbol(group.currency)) throw new Error(`${point.month} ${group.currency}：來源行情代號不符`)
      const rate=group.currency==='TWD'?1:quoteOn(history,date)!.value
      const money=(value:number)=>{
        const result=value*rate
        if(!Number.isFinite(result)) throw new Error('換算金額超出範圍')
        return result
      }
      const review=<T extends CashflowReviewTotals>(value:T):T=>({...value,debitAmount:money(value.debitAmount),creditAmount:money(value.creditAmount)})
      return {currency:'TWD',month:point.month,coverage:{...point.coverage},totals:{
        income:money(point.income!),consumption:money(point.consumption!),difference:money(point.difference!),
        incomeCategories:point.incomeCategories.map(c=>({...c,net:money(c.net)})),
        consumptionCategories:point.consumptionCategories.map(c=>({...c,net:money(c.net)})),
        pending:review(point.pending),excluded:review(point.excluded),exclusions:point.exclusions.map(review),
        investmentRecovery:{...point.investmentRecovery,net:money(point.investmentRecovery.net)},
      }}
    })
  }))
  // Stable accumulation order also keeps rounding independent of request completion order.
  return cashflowSummary({months:converted.flat()},groups[0].endMonth,groups[0].period)[0]
}
