import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, cashflow
before(async () => {
  server = await createServer({configFile:false,envDir:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false}})
  cashflow = await server.ssrLoadModule('/src/cashflow.ts')
})
after(() => server?.close())
const bank = (overrides={}) => ({id:'bank-row',accountId:'ledger-1',date:'2026-01-12',description:'Example',currency:'TWD',direction:'credit',amount:100,...overrides})
const card = (amount,overrides={}) => ({id:'card-row',date:'2026-01-12',description:'Example',currency:'TWD',card:'Test card',amount,...overrides})
const income = category => ({kind:'income',category})
const expense = category => ({kind:'expense',category})
const excluded = reason => ({kind:'excluded',reason})
const summarize = (input={},endMonth='2026-01',period=1) => cashflow.cashflowSummary(input,endMonth,period)
const categoryNet = (rows,category) => rows.find(row=>row.category===category)?.net

function freeze(value) {
  if (value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

test('combines signed card and bank consumption once, leaving excluded/pending visible and inputs unchanged', () => {
  const input = {
    expenses:[card(200,{category:'購物'}),card(-10,{id:'refund',category:'購物'})],expenseRules:[],bankRules:[],
    bankTransactions:[
      bank({id:'salary',amount:1000,classification:income('薪資')}),
      bank({id:'groceries',direction:'debit',amount:100,classification:expense('購物')}),
      bank({id:'refund',amount:20,classification:expense('購物')}),
      bank({id:'payment',direction:'debit',amount:200,description:'信用卡繳款'}),
      bank({id:'unknown',amount:500,classification:{kind:'pending'}}),
    ],
  }
  const before = structuredClone(input)
  const [g] = summarize(freeze(input))
  assert.equal(g.income,1000); assert.equal(g.consumption,270); assert.equal(g.difference,730)
  assert.deepEqual(g.pending,{count:1,debitCount:0,creditCount:1,debitAmount:0,creditAmount:500})
  assert.deepEqual(g.excluded,{count:1,debitCount:1,creditCount:0,debitAmount:200,creditAmount:0})
  assert.equal(g.exclusions[0].reason,'信用卡繳款')
  assert.equal(categoryNet(g.consumptionCategories,'購物'),270)
  assert.deepEqual(g.coverage,{cardCount:2,bankCount:5,recordCount:7,recordedMonths:1,complete:false})
  assert.deepEqual(g.months[0].coverage,{cardCount:2,bankCount:5,recordCount:7,complete:false})
  assert.deepEqual(input,before)
  g.consumptionCategories[0].net = -999
  assert.equal(summarize(input)[0].consumption,270)
})

test('income reversals and excess refunds retain signed categories; whole investment recovery carries warning', () => {
  const [g] = summarize({bankTransactions:[
    bank({classification:income('薪資'),amount:1000}),
    bank({id:'reversal',direction:'debit',amount:1200,classification:income('薪資')}),
    bank({id:'recovery',amount:600,classification:income('投資回收款')}),
    bank({id:'recovery-reversal',direction:'debit',amount:50,classification:income('投資回收款')}),
    bank({id:'purchase',direction:'debit',amount:10,classification:expense('餐飲')}),
    bank({id:'refund',amount:30,classification:expense('餐飲')}),
  ]})
  assert.equal(g.income,350); assert.equal(g.consumption,-20); assert.equal(g.difference,370)
  assert.equal(categoryNet(g.incomeCategories,'薪資'),-200)
  assert.equal(categoryNet(g.incomeCategories,'投資回收款'),550)
  assert.equal(categoryNet(g.consumptionCategories,'餐飲'),-20)
  assert.deepEqual(g.investmentRecovery,{count:2,net:550,hasRecords:true})
  assert.deepEqual(g.months[0].investmentRecovery,g.investmentRecovery)
  const [negative] = summarize({bankTransactions:[bank({direction:'debit',classification:income('投資回收款')})]})
  assert.equal(negative.income,-100); assert.equal(negative.investmentRecovery.hasRecords,true)
})

test('month/date/period validation and calendar generation handle all periods across years', () => {
  const data = {expenses:[card(1,{date:'2026-01-31'})]}
  for (const period of [1,3,6,12]) {
    const [g] = summarize(data,'2026-01',period)
    assert.equal(g.months.length,period)
    assert.equal(g.months.at(-1).month,'2026-01')
    assert.equal(g.months[0].month,({1:'2026-01',3:'2025-11',6:'2025-08',12:'2025-02'})[period])
    assert.equal(g.coverage.recordedMonths,1)
    assert.equal(g.income,0); assert.equal(g.consumption,1)
  }
  for (const endMonth of ['2026-00','2026-13','26-01','2026-1','0000-01','2026-01-01','bad',null]) assert.throws(()=>summarize({},endMonth))
  for (const period of [0,2,4,13,1.5,'3',NaN]) assert.throws(()=>summarize({},'2026-01',period))
  assert.throws(()=>summarize({},'0001-01',12))
  assert.equal(summarize({expenses:[card(1,{date:'0099-01-01'})]},'0099-01',1)[0].months[0].month,'0099-01')
  for (const date of ['2026-02-29','2026-01','2026-04-31','bad']) {
    assert.throws(()=>summarize({expenses:[card(1,{date})]}))
    assert.throws(()=>summarize({bankTransactions:[bank({date})]}))
  }
})

test('currency-local coverage distinguishes missing months, pending-only zero, and recorded zero amounts', () => {
  const groups = summarize({
    expenses:[card(0,{currency:'USD',date:'2025-12-01'}),card(90,{currency:'EUR',date:'2025-10-01'})],
    bankTransactions:[bank({amount:500,date:'2026-01-01',classification:{kind:'pending'}})],
  },'2026-01',3)
  assert.deepEqual(groups.map(g=>g.currency),['TWD','USD'])
  const [twd,usd] = groups
  assert.deepEqual(twd.months.map(m=>m.income),[null,null,0])
  assert.deepEqual(twd.months.map(m=>m.consumption),[null,null,0])
  assert.deepEqual(twd.months.map(m=>m.difference),[null,null,0])
  assert.equal(twd.months[2].pending.creditAmount,500)
  assert.equal(twd.coverage.recordedMonths,1)
  assert.equal(twd.months[0].coverage.recordCount,0)
  assert.deepEqual(usd.months.map(m=>m.consumption),[null,0,null])
  assert.equal(usd.coverage.cardCount,1); assert.equal(usd.coverage.bankCount,0)
  assert.deepEqual(summarize(),[])
  assert.deepEqual(summarize({expenses:[card(10,{date:'2025-01-01'})]}),[])
})

test('manual classification, first-match directed rules and builtins recompute without cached or persisted changes', () => {
  const rows = freeze([
    bank({id:'manual',description:'Salary',classification:{kind:'pending'}}),
    bank({id:'rule',description:'Example refund',direction:'credit'}),
    bank({id:'builtin',description:'薪資入帳',amount:1000}),
    bank({id:'generic-transfer',description:'轉帳',direction:'debit',amount:20}),
  ])
  const input = freeze({bankTransactions:rows,bankRules:[
    {keyword:'example',direction:'debit',target:income('利息')},
    {keyword:'example',direction:'credit',target:expense('購物')},
    {keyword:'example',target:income('其他收入')},
    {keyword:'salary',target:income('薪資')},
  ],expenses:[card(200,{category:'醫療',description:'Example'}),card(-10,{description:'Example'})],expenseRules:[{keyword:'example',category:'購物'}]})
  const before = structuredClone(input), [g] = summarize(input)
  assert.equal(g.income,1000); assert.equal(g.consumption,90)
  assert.equal(categoryNet(g.consumptionCategories,'醫療'),200)
  assert.equal(categoryNet(g.consumptionCategories,'購物'),-110)
  assert.equal(g.pending.count,2)
  const [changed] = summarize({...input,bankRules:[{keyword:'example',target:income('其他收入')}],expenseRules:[{keyword:'example',category:'交通'}]})
  assert.equal(changed.income,1100); assert.equal(changed.consumption,190)
  assert.equal(categoryNet(changed.consumptionCategories,'交通'),-10)
  assert.deepEqual(input,before)
})

test('two-account transfer counterparts and principal movements remain excluded, not netted or deleted', () => {
  const input = freeze({bankTransactions:[
    bank({id:'out',direction:'debit',amount:500,classification:excluded('自有帳戶轉帳')}),
    bank({id:'in',accountId:'ledger-2',amount:500,classification:excluded('自有帳戶轉帳')}),
    bank({id:'principal',direction:'debit',amount:200,classification:excluded('投資本金移動')}),
    bank({id:'other',amount:10,classification:excluded('其他不計收支')}),
  ]})
  const [g] = summarize(input)
  assert.equal(g.income,0); assert.equal(g.consumption,0)
  assert.deepEqual(g.excluded,{count:4,debitCount:2,creditCount:2,debitAmount:700,creditAmount:510})
  assert.deepEqual(g.exclusions.find(r=>r.reason==='自有帳戶轉帳'),{reason:'自有帳戶轉帳',count:2,debitCount:1,creditCount:1,debitAmount:500,creditAmount:500})
  assert.equal(input.bankTransactions.length,4)
})

test('period totals sum observed monthly categories and review amounts without currency mixing or rounding', () => {
  const groups = summarize({expenses:[
    card(0.1,{date:'2025-12-31',category:'未分類'}),
    card(0.2,{date:'2026-01-01',category:'未分類'}),
    card(70,{date:'2026-01-01',currency:'USD',category:'餐飲'}),
  ],bankTransactions:[
    bank({id:'nov',date:'2025-11-01',amount:100,classification:income('利息')}),
    bank({id:'dec',date:'2025-12-01',amount:50,classification:income('未分類')}),
    bank({id:'jan',amount:50,direction:'debit',classification:income('未分類')}),
    bank({id:'zero-investment',amount:0,classification:income('投資回收款')}),
    bank({id:'pending-debit',date:'2025-12-01',direction:'debit',amount:20}),
    bank({id:'pending-credit',amount:30}),
  ]},'2026-01',3)
  const [twd,usd] = groups
  assert.equal(twd.income,100)
  assert.equal(twd.consumption,0.1+0.2)
  assert.equal(twd.income,twd.months.reduce((sum,m)=>sum+(m.income ?? 0),0))
  assert.equal(twd.consumption,twd.months.reduce((sum,m)=>sum+(m.consumption ?? 0),0))
  assert.equal(categoryNet(twd.incomeCategories,'未分類'),0)
  assert.equal(twd.incomeCategories.find(c=>c.category==='未分類').count,2)
  assert.equal(twd.investmentRecovery.hasRecords,true)
  assert.deepEqual(twd.pending,{count:2,debitCount:1,creditCount:1,debitAmount:20,creditAmount:30})
  assert.equal(twd.coverage.recordedMonths,3)
  assert.equal(usd.consumption,70); assert.equal(usd.income,0)
  assert.equal(usd.pending.count,0)
})

test('bank-only/card-only sources, booked bank date and card date stay independent; invalid numbers cannot emit NaN', () => {
  const [bankOnly] = summarize({bankTransactions:[bank({classification:income('未分類'),date:'2026-01-31'})]})
  assert.equal(bankOnly.income,100); assert.equal(bankOnly.coverage.cardCount,0)
  const [cardOnly] = summarize({expenses:[card(-100,{date:'2025-12-31'})]},'2026-01',3)
  assert.equal(cardOnly.consumption,-100); assert.equal(cardOnly.coverage.bankCount,0)
  assert.deepEqual(cardOnly.months.map(m=>m.consumption),[null,-100,null])
  for (const amount of [NaN,Infinity,-Infinity,1e12+1]) {
    assert.throws(()=>summarize({expenses:[card(amount)]}))
    assert.throws(()=>summarize({bankTransactions:[bank({amount})]}))
  }
  assert.throws(()=>summarize({bankTransactions:[bank({amount:-1})]}))
  assert.throws(()=>summarize({bankTransactions:[bank({direction:'unknown'})]}))
  assert.throws(()=>summarize({expenses:[card(1,{currency:'bad'})]}))
})

test('all periods include distant observed months and retain validation and currency coverage',()=>{
 const input={expenses:[card(12,{date:'2001-01-01'}),card(-2,{date:'2026-12-31'}),card(0,{currency:'USD',date:'2025-05-05'})]}
 const groups=summarize(input,'2026-01','all')
 assert.deepEqual(groups.map(g=>g.currency),['TWD','USD'])
 assert.equal(groups[0].consumption,10)
 assert.deepEqual(groups[0].months.map(m=>m.month),['2001-01','2025-05','2026-12'])
 assert.deepEqual(groups[0].months.map(m=>m.consumption),[12,null,-2])
 assert.equal(groups[1].consumption,0)
 assert.deepEqual(summarize({},'2026-01','all'),[])
 assert.throws(()=>summarize({expenses:[card(1,{date:'2026-02-30'})]},'2026-01','all'))
 assert.throws(()=>summarize(input,'bad','all'))
})

test('precomputed split summaries match raw month, calendar-year and all-period totals without mutation',()=>{
 const input={expenses:[card(12,{date:'2025-01-01',category:'餐飲'}),card(-2,{date:'2026-01-01',category:'餐飲'}),card(7,{currency:'USD',date:'2026-02-01'})],bankTransactions:[bank({classification:income('投資回收款'),amount:50}),bank({id:'pending',classification:{kind:'pending'},amount:20})]}
 const months=[...cashflow.cashflowMonths({expenses:input.expenses}),...cashflow.cashflowMonths({bankTransactions:input.bankTransactions})]
 const original=structuredClone(months)
 for(const [end,period] of [['2026-01',1],['2026-12',12],['2026-01','all']]) assert.deepEqual(summarize({months},end,period),summarize(input,end,period))
 assert.deepEqual(cashflow.cashflowMonthList({months}),['2026-02','2026-01','2025-01'])
 assert.deepEqual(months,original)
 assert.deepEqual(summarize({months:[],expenses:input.expenses},'2026-01','all'),[])
})
