import { cashflowQueryString, categoryToken, type CashflowQuery } from '../cashflowQuery'
import { navigate } from '../site'
import type { CashflowInput, CashflowReviewTotals } from '../cashflow'
import { fmt } from '../format'
import { CashflowChart } from './CashflowChart'
import { useCashflowPeriod, useTwdCashflow } from '../cashflowPeriod'
import { CashflowPeriodControls } from './CashflowPeriodControls'
import type { WealthData } from '../model'
import type { LedgerReadiness } from '../cashflowQuery'
import { CashflowDataStatus } from './CashflowDataStatus'
import { CurrencyTotals } from './CurrencyTotals'

export interface CashflowSummaryProps extends CashflowInput {
  now: string
  reviewData?: WealthData
  readiness?: LedgerReadiness
  onGoExpenses?: () => void
  onGoBankTransactions?: () => void
}
function Review({label,total,currency}: {label:string;total:CashflowReviewTotals;currency:string}) {
  return <div className="cashflow-review-item"><strong>{label} · {total.count} 筆</strong><span>支出方向 {total.debitCount} 筆 · {currency} {fmt(total.debitAmount)}</span><span>入帳方向 {total.creditCount} 筆 · {currency} {fmt(total.creditAmount)}</span></div>
}
export function CashflowSummary({now,reviewData,readiness,onGoExpenses,onGoBankTransactions,...input}: CashflowSummaryProps) {
  const period=useCashflowPeriod(input,now)
  const {rawGroups,groups,needsFx,loading,error,retry}=useTwdCashflow(input,period.endMonth,period.period,period.today)
  const {latestMonth}=period
  const drill=(metric:CashflowQuery['metric'],category?:string)=>navigate('/cashflow'+cashflowQueryString({range:period.selection.range,month:period.selection.range==='month'?period.endMonth:undefined,year:period.selection.range==='year'?period.selection.year:undefined,metric,category:category?categoryToken(category):undefined,source:'all',panel:'records',page:1}))
  return <section className="panel span-2 cashflow-summary" aria-label="統一收支總覽">
    <div className="panel-head"><h3>收支總覽</h3><div className="row cashflow-source-links">
      {onGoBankTransactions && <button onClick={onGoBankTransactions}>銀行流水</button>}
      {onGoExpenses && <button onClick={onGoExpenses}>信用卡消費</button>}
    </div></div>
    <CashflowPeriodControls state={period}/>
    <CashflowDataStatus data={reviewData} readiness={input.months && readiness !== 'error' ? 'loading' : readiness ?? (reviewData ? 'ready' : 'not-loaded')} period={period} group={groups[0]} reliableTotals={!loading&&!error&&!input.months} onReview={()=>navigate('/cashflow'+cashflowQueryString({range:'month',month:period.endMonth,panel:'review',source:'all',metric:'all',page:1}))}/>
    {loading && <p role="status" className="notice">正在換算每月匯率…</p>}
    {needsFx && error && <div role="alert" className="notice"><p>無法完成 TWD 換算：{error}。未顯示部分合計。</p>{rawGroups.length > 0 && <CurrencyTotals groups={rawGroups} label={period.label} />}<button onClick={retry}>重試匯率</button></div>}
    {!rawGroups.length ? <div className="cashflow-no-record"><p className="muted">這段期間無紀錄，不代表收支為零。</p>
      {latestMonth && <button onClick={()=>period.showMonth(latestMonth)}>查看 {Number(latestMonth.slice(0,4))} 年 {Number(latestMonth.slice(5,7))} 月</button>}
    </div>:groups.map(group=><section className="cashflow-currency" key={group.currency} aria-label={`${group.currency} 收支`}>
      <div className="cashflow-currency-heading"><strong>{group.currency}</strong><span className="muted small">{group.coverage.recordCount} 筆紀錄</span></div>
      {group.pending.count>0 && <p className="notice small cashflow-pending" role="note" data-cashflow-pending><span>{group.pending.count} 筆銀行流水未分類，已依入帳／支出計入收支；轉帳或繳卡費請設為不計收支。</span>{onGoBankTransactions && <button className="link" onClick={onGoBankTransactions}>前往分類</button>}</p>}
      <CashflowChart group={group} onSelect={drill}/>
      {group.investmentRecovery.hasRecords && <p className="notice small" role="note">投資回收款：可能包含投入本金，不代表投資收益</p>}
      <details className="cashflow-review"><summary>未分類 {group.pending.count} 筆 · 不計收支 {group.excluded.count} 筆</summary>
        <Review label="未分類" total={group.pending} currency={group.currency}/>
        <Review label="不計收支" total={group.excluded} currency={group.currency}/>
        {group.exclusions.map(t=><Review key={t.reason} label={t.reason} total={t} currency={group.currency}/>)}
        {onGoBankTransactions && <button className="link" onClick={onGoBankTransactions}>前往銀行流水修正分類</button>}
      </details>
      <details className="cashflow-sources"><summary>查看來源 · 明細分開管理</summary><div><h4>銀行流水 · {group.coverage.bankCount} 筆</h4><p className="muted small">依銀行記帳日；收入沖回從收入扣除，消費退款從消費扣除。未分類依入帳／支出計入收支；不計收支的只列示。</p>{onGoBankTransactions && <button onClick={onGoBankTransactions}>查看銀行流水明細</button>}</div><div><h4>信用卡消費 · {group.coverage.cardCount} 筆</h4><p className="muted small">依原交易日期與帶符號金額；信用卡退款扣除消費。此入口僅含信用卡，不混入銀行流水。</p>{onGoExpenses && <button onClick={onGoExpenses}>查看信用卡消費明細</button>}</div></details>
    </section>)}
    <details className="cashflow-footnote muted small"><summary>金額怎麼算</summary><p>依已匯入紀錄，不代表完整月份。{period.isCurrentMonth?'本月尚未結束。':''}收支差額不是帳戶餘額或淨資產；金額統一換算 TWD，依各月月底已完成匯率；本月採最新已完成匯率（最多回溯 7 日）。</p></details>
  </section>
}
