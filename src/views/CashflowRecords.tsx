import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WealthData } from '../model'
import type { BankTransaction, BankTransactionAccount } from '../bankTransactions'
import type { CashflowPeriodState } from '../cashflowPeriod'
import { cashflowEntries } from '../cashflowEntries'
import type { CashflowFxEvidence } from '../cashflowFx'
import { filterCashflowEntries, cashflowQueryString, type CashflowQuery, type LedgerReadiness } from '../cashflowQuery'
import { navigate } from '../site'
import { routePath } from '../routes'

import { ExpenseRecords } from './ExpenseRecords'
import { BankRecord } from './BankTransactions'
import type { RecordEditing } from './useRecordEditing'

const evidenceFormat = (n:number) => n.toLocaleString('zh-TW',{minimumFractionDigits:2,maximumFractionDigits:2})
// Match Intl display rounding, including negative half-cent ties.
const displayedNumber = (n:number) => Number(n.toLocaleString('en-US',{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2}))

function bankRecordGroups(rows: readonly BankTransaction[], accounts: readonly BankTransactionAccount[]) {
  const label = (id: string) => accounts.find((a) => a.id === id)?.label ?? '未知帳戶'
  const groups = new Map<string, { key: string; date: string; account: string; rows: BankTransaction[] }>()
  for (const row of [...rows].sort((a, b) => b.date.localeCompare(a.date))) {
    const key = JSON.stringify([row.date, row.accountId])
    const group = groups.get(key) ?? { key, date: row.date, account: label(row.accountId), rows: [] }
    group.rows.push(row)
    groups.set(key, group)
  }
  return [...groups.values()]
}

// The records behind the totals, listed under the tiles: the chosen month, or each month of the year,
// one open at a time; 全部期間 groups the months by year, the latest year open at first.
export function CashflowRecords({ editing, period, data: originalData, loading, query, fx, readiness, ledgerError, onRetry, onQuery, focusSelection, onGoExpenses, onGoBankTransactions }: { editing?: RecordEditing; period: CashflowPeriodState; data: WealthData; loading: boolean; query: CashflowQuery; fx: CashflowFxEvidence[]; readiness: LedgerReadiness; ledgerError?: string; onRetry?: () => void; onQuery: (q: CashflowQuery, replace?: boolean) => void; focusSelection?: number; onGoExpenses: () => void; onGoBankTransactions: () => void }) {
  const evidence = filterCashflowEntries(cashflowEntries({expenses: originalData.expenses, expenseRules: originalData.expenseCategoryRules, bankTransactions: originalData.bankTransactions, bankRules: originalData.bankCategoryRules}), query).sort((a,b)=>b.date.localeCompare(a.date)||a.source.kind.localeCompare(b.source.kind)||a.recordId.localeCompare(b.recordId))
  const pages = Math.max(1, Math.ceil(evidence.length / 100)), page = Math.min(query.page, pages)
  const visible = evidence.slice((page-1)*100,page*100)
  const ids = new Set(visible.map(e=>`${e.source.kind}:${e.recordId}`))
  const data = {...originalData, expenses: (originalData.expenses??[]).filter(e=>ids.has(`card:${e.id}`)), bankTransactions: (originalData.bankTransactions??[]).filter(e=>ids.has(`bank:${e.id}`))}
  const heading = useRef<HTMLHeadingElement>(null)
  // Consume the explicit source-editor return intent once. Background data/FX
  // renders and ordinary deep links must not move the user's focus.
  useEffect(() => {
    if (window.history.state?.focus !== 'cashflow-records') return
    const state = { ...window.history.state }
    delete state.focus
    window.history.replaceState(state, '')
    heading.current?.focus()
  }, [])
  useEffect(()=>{if(focusSelection)heading.current?.focus()},[focusSelection])
  useEffect(()=>{if(readiness==='ready'&&query.page>pages)onQuery({...query,page:pages},true)},[readiness,query,pages,onQuery])
  const rates = new Map(fx.map(f=>[`${f.month}:${f.currency}`,f.rate]))
  const rate = (e: typeof evidence[number]) => rates.get(`${e.date.slice(0,7)}:${e.currency}`)
  const converted = readiness==='ready' && evidence.every(e=>rate(e)!==undefined)
  const total = (key:'income'|'consumption'|'difference')=>evidence.reduce((n,e)=>n+e[key]*(rate(e)??0),0)
  const rounding = (key:'income'|'consumption'|'difference') => displayedNumber(total(key)) - evidence.reduce((n,e)=>n+displayedNumber(e[key]*(rate(e)??0)),0)
  const edit = (kind:'card'|'bank', id:string)=>navigate(routePath({tab:kind==='card'?'expenses':'bank-transactions',recordId:id,returnTo:'/cashflow'+cashflowQueryString(query)}))
  const { range, year } = period.selection
  const yearPrefix = `${String(year).padStart(4, '0')}-`
  const recordMonths = range === 'month' ? [period.endMonth] : period.monthList.filter((m) => range === 'all' || m.startsWith(yearPrefix))
  const recordYears = [...new Set(recordMonths.map((m) => m.slice(0, 4)))]
  const selectionKey=cashflowQueryString(query)
  const [disclosure,setDisclosure]=useState<{key:string;month:string;year:string|null}>({key:'',month:'',year:null})
  const reveal=query.metric!=='all'||!!query.category||query.source!=='all'||query.page>1
  const initialMonth=reveal ? visible[0]?.date.slice(0,7)??'' : ''
  const current=disclosure.key===selectionKey?disclosure:{key:selectionKey,month:initialMonth,year:initialMonth.slice(0,4)||null}
  const openMonth=current.month,openYear=current.year
  const setOpenMonth=(month:string)=>setDisclosure({...current,month})
  const setOpenYear=(year:string)=>setDisclosure({...current,year})
  const count = (prefix: string) => loading ? null : <span className="muted small">信用卡 {evidence.filter(e=>e.source.kind==='card'&&e.date.startsWith(prefix)).length} 筆 · 銀行 {evidence.filter(e=>e.source.kind==='bank'&&e.date.startsWith(prefix)).length} 筆</span>
  const contribution=(kind:'card'|'bank',id:string)=>{
    const e=visible.find(e=>e.source.kind===kind&&e.recordId===id)
    if(!e)return null
    return <div className="cashflow-evidence" data-entry={`${kind}:${id}`}><span>原幣 {e.currency} {evidenceFormat(e.amount)}{e.direction ? ` · ${e.direction==='credit'?'入帳':'支出'}`:''}</span><span> TWD 收入 {rate(e)===undefined?'—':evidenceFormat(e.income*rate(e)!)} · 消費 {rate(e)===undefined?'—':evidenceFormat(e.consumption*rate(e)!)}</span><button type="button" onClick={()=>edit(kind,id)}>前往原始紀錄</button></div>
  }
  const records = (month: string) => <MonthRecords editing={editing} key={`${selectionKey}:${month}`} month={month} data={data} loading={loading} evidence={contribution} onGoExpenses={onGoExpenses} onGoBankTransactions={onGoBankTransactions} onEdit={edit} direct={!!focusSelection || reveal} />

  return <section className="panel span-4 cashflow-records-tile" aria-label={`${period.label}明細`}>
    <div className="row"><button onClick={()=>onQuery({...query,metric:'all',category:undefined,source:'all',page:1})}>清除篩選</button><label>來源 <select aria-label="明細來源" value={query.source} onChange={e=>onQuery({...query,source:e.target.value as CashflowQuery['source'],page:1})}><option value="all">全部來源</option><option value="card">信用卡</option><option value="bank">銀行</option></select></label><button onClick={()=>onQuery({...query,metric:'pending',category:undefined,page:1})}>未分類流水</button><button onClick={()=>onQuery({...query,metric:'excluded',category:undefined,page:1})}>不計收支</button></div>
    <h3 ref={heading} tabIndex={-1}>收支明細</h3>
    {readiness==='error' ? <div role="alert">{ledgerError || '無法載入明細'}<button onClick={onRetry}>重試明細</button></div> : readiness!=='ready' ? <p role="status">正在載入明細…</p> : <>
      <p role="status">已載入 {visible.length} 筆 · 符合篩選 {evidence.length} 筆</p>
      {converted && evidence.length>0 && <p data-filtered-total>篩選合計 TWD：收入 {evidenceFormat(total('income'))} · 消費 {evidenceFormat(total('consumption'))} · 差額 {evidenceFormat(total('difference'))}</p>}
      {converted && (['income','consumption','difference'] as const).some(k=>Math.abs(rounding(k))>.000001) && <p>顯示四捨五入調整 TWD：收入 {evidenceFormat(rounding('income'))} · 消費 {evidenceFormat(rounding('consumption'))} · 差額 {evidenceFormat(rounding('difference'))}</p>}
      {!converted && evidence.length>0 && <p>等待完整匯率；未顯示部分合計。</p>}

      {pages>1 && <nav aria-label="明細分頁"><button disabled={page===1} onClick={()=>onQuery({...query,page:page-1})}>上一頁</button><span>{page} / {pages}</span><button disabled={page===pages} onClick={()=>onQuery({...query,page:page+1})}>下一頁</button></nav>}
    </>}
    {range === 'month' ? records(period.endMonth) : recordYears.map((y) => {
      const yearOpen = range === 'year' || (openYear ?? recordYears[0]) === y
      return <div key={y} className="cashflow-year-records">
        {range === 'all' && <button className="cashflow-month-toggle cashflow-year-toggle" aria-expanded={yearOpen} onClick={() => setOpenYear(yearOpen ? '' : y)}>
          <strong>{Number(y)} 年</strong><span className="muted small">{recordMonths.filter((m) => m.startsWith(y)).length} 個月有紀錄</span>
        </button>}
        {yearOpen && recordMonths.filter((m) => m.startsWith(y)).map((m) => {
          const open = openMonth === m
          return <div key={m} className="cashflow-month-records">
            <button className="cashflow-month-toggle" aria-expanded={open} onClick={() => setOpenMonth(open ? '' : m)}><strong>{Number(m.slice(5, 7))} 月</strong>{count(m)}</button>
            {open && records(m)}
          </div>
        })}
      </div>
    })}
  </section>
}

// One month's card and bank records, each behind a disclosure.
function MonthRecords({ editing, month, data, loading, onGoExpenses, onGoBankTransactions, onEdit, direct, evidence }: { editing?: RecordEditing; evidence:(kind:'card'|'bank',id:string)=>ReactNode; onEdit:(kind:'card'|'bank',id:string)=>void; direct:boolean; month: string; data: WealthData; loading: boolean; onGoExpenses: () => void; onGoBankTransactions: () => void }) {
  const cardRows = (data.expenses ?? []).filter((e) => e.date.startsWith(month))
  const bankGroups = bankRecordGroups((data.bankTransactions ?? []).filter((t) => t.date.startsWith(month)), data.bankTransactionAccounts ?? [])
  const bankCount = bankGroups.reduce((n, g) => n + g.rows.length, 0)
  const count = (n: number) => loading ? '' : ` · ${n} 筆`
  return <>
    <details className="cashflow-records" open={direct || undefined}>
      <summary><strong>信用卡消費{count(cardRows.length)}</strong><span className="muted small">依原交易日期；退款扣除消費</span></summary>
      {loading ? <p className="muted small">正在載入明細…</p> : cardRows.length
        ? <ExpenseRecords evidence={e=>evidence('card',e.id)} busy={editing?.busy} showCategory={editing?.on} onRule={editing?.on ? editing.editExpenseRule : undefined} onEdit={editing?.on ? editing.editExpense : editing ? undefined : e=>onEdit('card',e.id)} expenses={cardRows} rules={data.expenseCategoryRules ?? []} />
        : <p className="muted small">此頁沒有符合篩選的信用卡消費</p>}
      <button className="link" onClick={onGoExpenses}>前往信用卡消費頁編輯 →</button>
    </details>
    <details className="cashflow-records" open={direct || undefined}>
      <summary><strong>銀行流水{count(bankCount)}</strong><span className="muted small">依銀行記帳日；不計收支的只列示</span></summary>
      {loading ? <p className="muted small">正在載入明細…</p> : bankGroups.length
        ? <div className="bank-records record-groups">{bankGroups.map((g) => <section key={g.key} className="bank-record-group">
          <header className="record-group-head"><time dateTime={g.date}>{g.date}</time><span title={g.account}>{g.account}</span></header>
          {g.rows.map((row) => <BankRecord evidence={evidence('bank',row.id)} busy={editing?.busy} showTag={editing?.on} {...(editing?.on ? {revealed:editing.revealed===row.id,onReveal:(open:boolean)=>editing.setRevealed(open?row.id:null),onRule:()=>editing.editBankRule(row),onEdit:()=>editing.editBank(row)} : editing ? {} : {onEdit:()=>onEdit('bank',row.id)})} key={row.id} row={row} account={g.account} rules={data.bankCategoryRules ?? []} />)}
        </section>)}</div>
        : <p className="muted small">此頁沒有符合篩選的銀行流水</p>}
      <button className="link" onClick={onGoBankTransactions}>前往銀行流水頁編輯 →</button>
    </details>
  </>
}
