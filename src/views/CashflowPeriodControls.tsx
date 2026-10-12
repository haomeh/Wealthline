import { useId, useRef, useState } from 'react'
import { monthKey, type CashflowPeriodState, type Selection } from '../cashflowPeriod'

// 月份／年度／全部期間, the arrows, and the month or year grid.
export function CashflowPeriodControls({ state }: { state: CashflowPeriodState }) {
  const { selection, setSelection, recordedMonths, monthList, date, label } = state
  // The year the open picker shows; picking a month or year applies it at once.
  const [browseYear, setBrowseYear] = useState(selection.year)
  const [open, setOpen] = useState(false)
  const pickerId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const close = () => { setOpen(false); trigger.current?.focus() }
  const choose = (next: Selection) => { setSelection(next); close() }
  const step = (by: number) => {
    if (selection.range === 'year') { setSelection({ ...selection, year: selection.year + by }); return }
    const value = selection.year * 12 + selection.month - 1 + by
    setSelection({ ...selection, year: Math.floor(value / 12), month: value % 12 + 1 })
  }
  const first = selection.range === 'year' ? selection.year <= 1 : selection.year <= 1 && selection.month <= 1
  const last = selection.year >= 9999 && (selection.range === 'year' || selection.month >= 12)
  const recordedYears = [...new Set([...monthList.map((m) => Number(m.slice(0, 4))), date.getFullYear(), selection.year])].sort((a, b) => b - a)
  return <>
    <div className="cashflow-period">
      <div className="segmented cashflow-range" role="group" aria-label="時間範圍">{([['month', '月份'], ['year', '年度'], ['all', '全部期間']] as const).map(([range, text]) => <button key={range} aria-pressed={selection.range === range} className={selection.range === range ? 'on' : ''} onClick={() => { setSelection({ ...selection, range }); setOpen(false) }}>{text}</button>)}</div>
      {selection.range !== 'all' && <div className="cashflow-stepper">
        <button className="cashflow-step" aria-label={selection.range === 'month' ? '上個月' : '前一年'} disabled={first} onClick={() => step(-1)}>‹</button>
        <button ref={trigger} className="cashflow-period-trigger" aria-label={`選擇收支期間：${label}`} aria-expanded={open} aria-controls={pickerId} onClick={() => { if (open) { close(); return } setBrowseYear(selection.year); setOpen(true) }}>{label}<span aria-hidden="true">▾</span></button>
        <button className="cashflow-step" aria-label={selection.range === 'month' ? '下個月' : '後一年'} disabled={last} onClick={() => step(1)}>›</button>
      </div>}
    </div>
    {open && selection.range !== 'all' && <section id={pickerId} className="cashflow-picker" aria-label="時間選擇" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close() } }}>
      <div className="cashflow-picker-head"><strong>{selection.range === 'month' ? '選擇月份' : '選擇年度'}</strong><button autoFocus onClick={close}>關閉</button></div>
      {selection.range === 'month' ? <>
        <div className="cashflow-picker-year"><button aria-label="前一年" disabled={browseYear <= 1} onClick={() => setBrowseYear(browseYear - 1)}>‹</button><strong>{browseYear} 年</strong><button aria-label="後一年" disabled={browseYear >= 9999} onClick={() => setBrowseYear(browseYear + 1)}>›</button></div>
        <div className="cashflow-month-grid">{Array.from({ length: 12 }, (_, i) => {
          const month = i + 1, hasData = recordedMonths.has(monthKey(browseYear, month))
          return <button key={month} aria-label={`${month} 月${hasData ? '，有紀錄' : ''}`} aria-pressed={selection.year === browseYear && selection.month === month} className={hasData ? 'has-records' : ''} onClick={() => choose({ range: 'month', year: browseYear, month })}>{month} 月</button>
        })}</div><p className="muted small">圓點表示有紀錄</p>
      </> : <div className="cashflow-month-grid">{recordedYears.map((year) => <button key={year} aria-pressed={selection.year === year} className={monthList.some((m) => m.startsWith(`${String(year).padStart(4, '0')}-`)) ? 'has-records' : ''} onClick={() => choose({ ...selection, year })}>{year} 年</button>)}</div>}
    </section>}
  </>
}
