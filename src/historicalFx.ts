import { CRYPTO_IDS } from './currencies'
import { fetchHistory, fxSymbol, type PriceHistory } from './priceHistory'
import { quoteOn, type HistoricalQuote } from './quantityHistory'

export const USD_TWD_HISTORY = 'TWD=X'
export type HistoryFetcher = (symbol:string, from:string) => Promise<PriceHistory|null>
export const isCryptoCurrency = (currency:string) => Object.hasOwn(CRYPTO_IDS,currency)

// Yahoo can return TWD=X for the same USD/TWD pair requested as USDTWD=X.
// This exception does not apply to another currency or to an inverse pair.
export const matchesHistoricalFxSymbol = (currency:string,symbol:string|undefined) =>
  symbol===fxSymbol(currency) || (currency==='USD' && symbol===USD_TWD_HISTORY)

// Internal conversion container, never a claim that Yahoo lists CRYPTOTWD=X.
// Only public symbols/date leave the client; each leg retains its actual quote date.
export async function fetchHistoricalFx(currency:string, from:string, fetcher:HistoryFetcher=fetchHistory):Promise<PriceHistory|null> {
  if(currency==='TWD') return null
  if(!isCryptoCurrency(currency)) return fetcher(fxSymbol(currency),from)
  const [asset,usd]=await Promise.all([fetcher(`${currency}-USD`,from),fetcher(USD_TWD_HISTORY,from)].map(p=>p.catch(()=>null)))
  return {symbol:fxSymbol(currency),currency:'TWD',asTraded:true,splits:[],points:[],conversion:{currency,asset,usd}}
}

export function historicalFxError(currency:string,date:string,history:PriceHistory|null):string {
  if(currency==='TWD') return ''
  const legError=(history:PriceHistory|null,expectedCurrency:string,label:string,expectedSymbol?:string) => {
    if(history?.failure==='invalid_response') return `${label}：行情 API 未回傳有效 JSON；請確認 API 路由，本機開發請重啟伺服器後重新查詢`
    if(history?.failure==='provider_error') return `${label}：行情來源暫時異常，請稍後重新查詢`
    if(history?.failure==='not_found') return `${label}：來源查無行情`
    if(!history) return `${label}：缺少歷史行情`
    if(expectedSymbol && history.symbol!==expectedSymbol) return `${label}：來源行情代號不符`
    if(history.currency!==expectedCurrency) return `${label}：來源報價幣別不符`
    if(!quoteOn(history,date)) return `${label}：缺少當日或前 7 日內已完成行情（不使用未來價）`
    return ''
  }
  if(history?.conversion) return [legError(history.conversion.asset,'USD',`${currency}/USD`,`${currency}-USD`),legError(history.conversion.usd,'TWD','USD/TWD',USD_TWD_HISTORY)].filter(Boolean).join('；')
  if(history && !matchesHistoricalFxSymbol(currency,history.symbol)) return '來源行情代號不符'
  return quoteOn(history,date) && history?.currency==='TWD' ? '' : `缺少歷史匯率；${legError(history,'TWD',`${currency}/TWD`)}`
}

// Stored FX evidence uses the logical pair ID enforced by existing saved readers.
// Validate the original provider identity first; never rewrite the raw history.
export function historicalFxQuote(currency:string,date:string,history:PriceHistory|null):HistoricalQuote|undefined {
  if(currency==='TWD' || historicalFxError(currency,date,history)) return undefined
  const quote=quoteOn(history,date)
  return quote?.source==='Yahoo' ? {...quote,symbol:fxSymbol(currency)} : quote
}
