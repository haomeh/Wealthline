import { useMemo, useState } from 'react'
import { accountCoverage, type AccountCoverageCell, type MonthCoverage, type TimeNodeCoverage, type TimeNodeSource } from '../accountCoverage'
import { fmt } from '../format'
import type { WealthData } from '../model'
import type { ArchiveSummary } from './Overview'
import { QuantityEditor } from './QuantityHistory'

interface Props {
  data: WealthData
  now: string
  dirty?: boolean
  busy?: boolean
  onSaveHistory?: (next: WealthData) => void
  onGoHistory?: (date?: string) => void
  archive?: ArchiveSummary
  onLoadHistory?: () => void
  loadingHistory?: boolean
}

interface BackfillRequest {
  date: string
  accountId: string
  entryKey?: string
}

const SOURCE_LABELS: Record<TimeNodeSource, string> = {
  snapshot: '原始快照',
  statement: '銀行帳單',
  inventory: '完整回補',
  completion: '當日補齊',
  manual: '單日補登',
  period: '期間推算',
  'period-omitted': '期間推算（未顯示於總覽）',
}

const fmtDate = (date: string) => date.replaceAll('-', '/')
const fmtMonth = (month: string) => month.replace('-', '/')

function AccountBackfillButton({
  cell,
  date,
  disabled,
  onBackfill,
}: {
  cell: AccountCoverageCell
  date: string
  disabled?: boolean
  onBackfill: (date: string, cell: AccountCoverageCell) => void
}) {
  const label = cell.account.isCurrent ? cell.account.label : `${cell.account.label}（歷史帳戶）`
  return (
    <button
      type="button"
      className="link coverage-account-link"
      disabled={disabled}
      title={`補登 ${fmtDate(date)} ${label}`}
      onClick={() => onBackfill(date, cell)}
    >
      {label}
    </button>
  )
}

function GapGroup({
  title,
  tone,
  date,
  cells,
  describe,
  disabled,
  onBackfill,
}: {
  title: string
  tone: 'critical' | 'warn' | 'muted'
  date: string
  cells: AccountCoverageCell[]
  describe: (cell: AccountCoverageCell) => string
  disabled?: boolean
  onBackfill: (date: string, cell: AccountCoverageCell) => void
}) {
  if (!cells.length) return null
  return (
    <div className={`coverage-group coverage-group-${tone}`}>
      <h4>{title}（{cells.length}）</h4>
      <ul>
        {cells.map((cell) => (
          <li key={cell.account.id}>
            <span className="coverage-account-main">
              <AccountBackfillButton cell={cell} date={date} disabled={disabled} onBackfill={onBackfill} />
              <span className="muted small">{cell.account.category}</span>
            </span>
            <span className="coverage-account-meta small">{describe(cell)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function NodeCard({
  node,
  disabled,
  onBackfill,
  onGoHistory,
}: {
  node: TimeNodeCoverage
  disabled?: boolean
  onBackfill: (date: string, cell: AccountCoverageCell) => void
  onGoHistory?: (date?: string) => void
}) {
  const gapSummary = [
    node.missingZero.length && `缺 ${node.missingZero.length} 個（以 0 計）`,
    node.partial.length && `${node.partial.length} 個部分缺少`,
    node.carried.length && `${node.carried.length} 個沿用舊值`,
    node.noQuote.length && `${node.noQuote.length} 個缺行情`,
  ].filter(Boolean)

  return (
    <li className={`coverage-node${node.hasZeroImpact ? ' has-zero' : node.hasGaps ? ' has-gap' : ''}`}>
      <div className="coverage-node-head">
        <div className="coverage-node-title">
          <time dateTime={node.date}>{fmtDate(node.date)}</time>
          <span className="tag">{SOURCE_LABELS[node.source]}</span>
          {node.hasGaps ? (
            <span className={`tag ${node.hasZeroImpact ? 'critical' : 'warn'}`}>{gapSummary.join(' · ')}</span>
          ) : (
            <span className="tag good">齊全 · {node.recordedCount}/{node.expectedCount}</span>
          )}
        </div>
        <div className="coverage-node-actions">
          <span className="muted small">
            已記錄 {node.recordedCount}/{node.expectedCount} 個帳戶
            {node.recordedTotal !== null && ` · 快照 NT$ ${fmt(node.recordedTotal, 0)}`}
          </span>
          {onGoHistory && (
            <button type="button" className="link small" onClick={() => onGoHistory(node.date)}>
              {node.hasGaps ? '前往歷史頁 →' : '查看明細 →'}
            </button>
          )}
        </div>
      </div>
      {node.hasGaps && (
        <div className="coverage-node-details">
          {node.missingZero.length > 0 && (
            <p className="small">
              <strong className="coverage-label-critical">缺少紀錄（以 0 計）：</strong>
              {node.missingZero.map((c, i) => (
                <span key={c.account.id}>
                  {i > 0 && '、'}
                  <AccountBackfillButton cell={c} date={node.date} disabled={disabled} onBackfill={onBackfill} />
                  {c.account.referenceValue ? <span className="muted">（目前約 NT$ {fmt(c.account.referenceValue, 0)}）</span> : null}
                </span>
              ))}
            </p>
          )}
          {node.partial.length > 0 && (
            <p className="small">
              <strong className="coverage-label-warn">部分項目缺少：</strong>
              {node.partial.map((c, i) => (
                <span key={c.account.id}>
                  {i > 0 && '、'}
                  <AccountBackfillButton cell={c} date={node.date} disabled={disabled} onBackfill={onBackfill} />
                  {c.missingItems?.length ? <span className="muted">（缺 {c.missingItems.join('、')}）</span> : null}
                </span>
              ))}
            </p>
          )}
          {node.carried.length > 0 && (
            <p className="small">
              <strong className="muted">當日無新紀錄（沿用舊值）：</strong>
              {node.carried.map((c, i) => (
                <span key={c.account.id}>
                  {i > 0 && '、'}
                  <AccountBackfillButton cell={c} date={node.date} disabled={disabled} onBackfill={onBackfill} />
                  {c.carriedFrom ? <span className="muted">（沿用 {fmtDate(c.carriedFrom)}）</span> : null}
                </span>
              ))}
            </p>
          )}
          {node.noQuote.length > 0 && (
            <p className="small">
              <strong className="coverage-label-warn">缺少歷史行情／匯率：</strong>
              {node.noQuote.map((c, i) => (
                <span key={c.account.id}>
                  {i > 0 && '、'}
                  <AccountBackfillButton cell={c} date={node.date} disabled={disabled} onBackfill={onBackfill} />
                  {c.missingItems?.length ? <span className="muted">（{c.missingItems.join('、')}）</span> : null}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function MonthRow({
  month,
  open,
  disabled,
  onToggle,
  onBackfill,
  onGoHistory,
}: {
  month: MonthCoverage
  open: boolean
  disabled?: boolean
  onToggle: () => void
  onBackfill: (date: string, cell: AccountCoverageCell) => void
  onGoHistory?: (date?: string) => void
}) {
  const [showAllNodes, setShowAllNodes] = useState(false)
  const statusParts = [
    month.missingZero.length && `缺 ${month.missingZero.length} 個帳戶（以 0 計）`,
    month.partial.length && `${month.partial.length} 個部分缺少`,
    month.carried.length && `${month.carried.length} 個沿用更早月份`,
    month.noQuote.length && `${month.noQuote.length} 個缺行情`,
  ].filter(Boolean)
  const visibleNodes = showAllNodes ? month.nodes : month.nodes.slice(0, 10)

  return (
    <div className={`coverage-month${month.missingZero.length || month.partial.length ? ' has-zero' : month.hasMonthGaps ? ' has-gap' : ''}`}>
      <button type="button" className="coverage-month-toggle" aria-expanded={open} onClick={onToggle}>
        <strong className="coverage-month-label">{fmtMonth(month.month)}</strong>
        {month.hasMonthGaps ? (
          <span className={`tag ${month.missingZero.length || month.partial.length ? 'critical' : 'warn'}`}>
            {statusParts.join(' · ')}
          </span>
        ) : (
          <span className="tag good">
            齊全 · {month.recordedCount}/{month.expectedCount} 個帳戶
          </span>
        )}
        {month.estimatedMissingTotal > 0 && (
          <span className="coverage-missing-total small">缺漏帳戶目前合計約 NT$ {fmt(month.estimatedMissingTotal, 0)}</span>
        )}
        <span className="muted small coverage-month-meta">
          {month.nodes.length} 個時間節點
          {!month.hasMonthGaps && month.nodeGapCount > 0 && `（其中 ${month.nodeGapCount} 個早期節點有缺漏）`}
        </span>
      </button>

      {open && (
        <div className="coverage-month-body">
          {month.hasMonthGaps ? (
            <div className="coverage-groups">
              <GapGroup
                title="缺少紀錄（無更早紀錄或快照未涵蓋，以 0 計）"
                tone="critical"
                date={month.latest.date}
                cells={month.missingZero}
                describe={(c) =>
                  c.account.referenceValue !== null
                    ? `${c.account.isCurrent ? '目前約' : '最近紀錄'} NT$ ${fmt(c.account.referenceValue, 0)}`
                    : '尚無參考估值'
                }
                disabled={disabled}
                onBackfill={onBackfill}
              />
              <GapGroup
                title="部分項目缺少紀錄"
                tone="warn"
                date={month.latest.date}
                cells={month.partial}
                describe={(c) => `缺 ${c.missingItems?.join('、') || '部分項目'}`}
                disabled={disabled}
                onBackfill={onBackfill}
              />
              <GapGroup
                title="整月未更新（沿用更早月份）"
                tone="muted"
                date={month.latest.date}
                cells={month.carried}
                describe={(c) => (c.carriedFrom ? `沿用 ${fmtDate(c.carriedFrom)}` : '沿用更早紀錄')}
                disabled={disabled}
                onBackfill={onBackfill}
              />
              <GapGroup
                title="缺少歷史行情／匯率"
                tone="warn"
                date={month.latest.date}
                cells={month.noQuote}
                describe={(c) => c.missingItems?.join('、') || '缺行情'}
                disabled={disabled}
                onBackfill={onBackfill}
              />
            </div>
          ) : (
            <p className="muted small">
              本月已涵蓋全部 {month.expectedCount} 個帳戶。
              {month.nodeGapCount > 0 && `其中 ${month.nodeGapCount} 個時間節點曾有部分帳戶缺漏，詳見下方各節點。`}
            </p>
          )}

          <div className="coverage-nodes-section">
            <div className="coverage-nodes-head">
              <span className="muted small">本月時間節點（最新優先；點選缺漏帳戶可直接補登）</span>
              {onGoHistory && (
                <button type="button" className="link small" onClick={() => onGoHistory(month.latest.date)}>
                  到歷史頁檢視 {fmtDate(month.latest.date)} →
                </button>
              )}
            </div>
            <ul className="coverage-node-list">
              {visibleNodes.map((node) => (
                <NodeCard key={node.date} node={node} disabled={disabled} onBackfill={onBackfill} onGoHistory={onGoHistory} />
              ))}
            </ul>
            {month.nodes.length > visibleNodes.length && (
              <button type="button" className="ghost small" onClick={() => setShowAllNodes(true)}>
                顯示本月其餘 {month.nodes.length - visibleNodes.length} 個時間節點
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function AccountCoverage({ data: loaded, now, dirty = false, busy = false, onSaveHistory, onGoHistory, archive, onLoadHistory, loadingHistory }: Props) {
  const data = useMemo(
    () =>
      archive
        ? {
            ...loaded,
            history: {
              ...loaded.history,
              snapshots: [...archive.points, ...loaded.history.snapshots],
              changes: [...archive.carried, ...loaded.history.changes],
            },
          }
        : loaded,
    [loaded, archive],
  )
  const report = useMemo(() => accountCoverage(data, now), [data, now])
  const [mode, setMode] = useState<'month' | 'node'>('month')
  const [onlyGaps, setOnlyGaps] = useState<{ month: boolean; node: boolean }>({ month: false, node: true })
  const [visibleNodes, setVisibleNodes] = useState(30)
  // Auto-open the newest month with gaps until the user explicitly toggles months.
  const [toggledMonths, setToggledMonths] = useState<Record<string, boolean>>({})
  const [backfill, setBackfill] = useState<BackfillRequest | null>(null)
  const [backfillNotice, setBackfillNotice] = useState('')

  if (!report.nodes.length) return null

  const defaultOpenMonth = report.months.find((m) => m.hasMonthGaps)?.month
  const isMonthOpen = (month: string) => toggledMonths[month] ?? month === defaultOpenMonth
  const toggleMonth = (month: string) => setToggledMonths((prev) => ({ ...prev, [month]: !(prev[month] ?? month === defaultOpenMonth) }))

  const openBackfill = (date: string, cell: AccountCoverageCell) => {
    setBackfillNotice('')
    if (dirty) {
      setBackfillNotice('請先儲存或捨棄其他未儲存修改，再補登歷史數量。')
      return
    }
    if (archive && date < archive.from) {
      setBackfillNotice(`${date.slice(0, 4)} 年的完整歷史尚未載入，請先按上方「載入完整歷史」再補登此日期。`)
      return
    }
    setBackfill({
      date,
      accountId: cell.account.id,
      entryKey: cell.missingKeys?.length === 1 ? cell.missingKeys[0] : undefined,
    })
  }

  const activeOnlyGaps = onlyGaps[mode]
  const shownMonths = activeOnlyGaps ? report.months.filter((m) => m.hasMonthGaps || m.nodeGapCount > 0) : report.months
  const filteredNodes = activeOnlyGaps ? report.nodes.filter((n) => n.hasGaps) : report.nodes
  const editDisabled = busy || dirty || !onSaveHistory

  return (
    <section className="panel account-coverage" id="account-coverage" aria-label="歷史帳戶覆蓋與缺漏">
      <div className="panel-head coverage-head">
        <div>
          <h3>歷史帳戶覆蓋與缺漏</h3>
          <p className="muted small">
            {report.gapNodeCount > 0
              ? `共 ${report.months.length} 個月、${report.nodes.length} 個歷史時間節點；其中 ${report.gapMonthCount} 個月（${report.gapNodeCount} 個節點）有帳戶缺漏。點選缺漏帳戶可直接補登該日數量。`
              : `共 ${report.months.length} 個月、${report.nodes.length} 個歷史時間節點，所有節點皆已涵蓋全部帳戶。`}
          </p>
        </div>
        <div className="coverage-controls">
          <div className="segmented" role="group" aria-label="檢視粒度">
            <button type="button" className={mode === 'month' ? 'on' : ''} aria-pressed={mode === 'month'} onClick={() => setMode('month')}>
              按月份
            </button>
            <button type="button" className={mode === 'node' ? 'on' : ''} aria-pressed={mode === 'node'} onClick={() => setMode('node')}>
              依時間節點
            </button>
          </div>
          <div className="segmented" role="group" aria-label="篩選狀態">
            <button
              type="button"
              className={!activeOnlyGaps ? 'on' : ''}
              aria-pressed={!activeOnlyGaps}
              onClick={() => setOnlyGaps((prev) => ({ ...prev, [mode]: false }))}
            >
              全部
            </button>
            <button
              type="button"
              className={activeOnlyGaps ? 'on' : ''}
              aria-pressed={activeOnlyGaps}
              onClick={() => setOnlyGaps((prev) => ({ ...prev, [mode]: true }))}
            >
              只看有缺漏
            </button>
          </div>
        </div>
      </div>

      {dirty && <p className="notice">請先儲存或捨棄其他未儲存修改，再補登歷史數量。</p>}
      {backfillNotice && <p className="notice">{backfillNotice}</p>}
      {archive && onLoadHistory && (
        <p className="muted small coverage-note">
          {archive.from.slice(0, 4)} 年以前目前只依每月最後一筆原始快照檢查，不含往年補登與期間推算。
          <button type="button" className="link" disabled={loadingHistory} onClick={onLoadHistory}>
            {loadingHistory ? '載入中…' : '載入完整歷史'}
          </button>
        </p>
      )}
      {report.periodError && <p className="notice">{report.periodError}</p>}

      {backfill && onSaveHistory && (
        <QuantityEditor
          key={`${backfill.date}:${backfill.accountId}:${backfill.entryKey ?? ''}`}
          data={loaded}
          busy={busy || dirty}
          date={backfill.date}
          accountId={backfill.accountId}
          entryKey={backfill.entryKey}
          singleItemOnly
          onCancel={() => setBackfill(null)}
          onApply={(next) => {
            onSaveHistory(next)
            setBackfill(null)
          }}
        />
      )}

      {mode === 'month' ? (
        shownMonths.length > 0 ? (
          <div className="coverage-month-list">
            {shownMonths.map((month) => (
              <MonthRow
                key={month.month}
                month={month}
                open={isMonthOpen(month.month)}
                disabled={editDisabled}
                onToggle={() => toggleMonth(month.month)}
                onBackfill={openBackfill}
                onGoHistory={onGoHistory}
              />
            ))}
          </div>
        ) : (
          <p className="muted small">目前沒有存在缺漏的月份。</p>
        )
      ) : filteredNodes.length > 0 ? (
        <>
          <ul className="coverage-node-list">
            {filteredNodes.slice(0, visibleNodes).map((node) => (
              <NodeCard key={node.date} node={node} disabled={editDisabled} onBackfill={openBackfill} onGoHistory={onGoHistory} />
            ))}
          </ul>
          {filteredNodes.length > visibleNodes && (
            <button type="button" className="ghost small coverage-more" onClick={() => setVisibleNodes((n) => n + 30)}>
              顯示更早 30 個節點（尚有 {filteredNodes.length - visibleNodes} 個）
            </button>
          )}
        </>
      ) : (
        <p className="muted small">目前沒有存在缺漏的時間節點。</p>
      )}
    </section>
  )
}

