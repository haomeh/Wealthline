# Monthly Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve the user's existing execution preference; do not ask them to select it again. Implementation, tests, and independent review were authorized by the user in this chat.

**Goal:** Connect cashflow numbers to records, persist monthly human review, and export reproducible monthly reports.

**Architecture:** Share immutable contribution and FX-evidence projections between the existing charts, filtered records, and reports. Persist only review metadata in the current data store; keep exported reports self-contained and separate from wealth-data restoration. Extend the PR #65 inline records instead of replacing them.

**Tech Stack:** Existing React 19, TypeScript 6, Vite, Node test runner, jsdom, browser Web Crypto/Blob APIs, IndexedDB, and Google Drive split-file storage. No new packages.

**Spec:** `docs/superpowers/specs/2026-10-13-monthly-review-design.md`

**Status:** Implementation in progress in the existing project-local worktree. User authorized implementation, tests, and independent review; commits, pushes, and deployment remain unauthorized. Detailed execution evidence is in this plan's local SDD workspace.

## Global Constraints

- Keep `coverage.complete: false`; human review is separate from inferred coverage.
- Keep card transaction dates and bank booked dates; do not substitute statement months.
- Keep current signed income, refund, reversal, pending, and exclusion semantics.
- Do not change current assets, liabilities, or historical holdings through these features.
- No new dependencies or edits to `package.json` or lockfiles without explicit approval.
- Do not read secrets or modify agent policy. Git changes require the user's applicable authorization.
- Do not commit, push, deploy, or change services without explicit user approval.
- Preserve PR #65 and any integrated PR #64 pagination/loading behavior.
- Use `wealthline_validate` when available; honor its three-failure stop and never bypass it with shell checks.
- UI copy and user reports use Traditional Chinese; internal implementation handoffs use concise English.

## Review Focus

1. Old v15 data and an unread Drive ledger: review-only saves must preserve all parts and new metadata (Task 4).
2. An edit/rule change/restore during hashing or report generation: stale work must not certify or export another revision (Tasks 5 and 6).
3. A source rename, zero-value record, no records, or newly observed source: these must not create false completion or disappear from evidence (Tasks 1 and 5).
4. Foreign refunds, mixed months, and two-leg crypto: row totals must use the exact rates used by the chart and remain explainable (Tasks 2 and 6).
5. A malformed query or imported report: normalize navigation safely; reject invalid reports without changing user data or making network requests (Tasks 3 and 6).

## Baseline and execution rules

The planning worktree is `/Users/zh/Documents/github/haomeh/wealthline/.worktrees/monthly-review-plan`, on `codex/monthly-review-plan`, based on `0c9b016`. PR #65 is included. PR #64 is represented locally by bank-performance commit `781f333` but is not included in this base. Remote freshness is unverified after DNS failure. Do not interpret the older root checkout as the intended UI baseline.

At implementation start, inspect the then-current base and PR #64 integration. If code or schema allocation changed, revise the affected contracts here first. Do not automatically merge/cherry-pick branches or change the planning worktree base. Only the user's worktree request authorized Git metadata writes for its creation.

One implementer owns each task. Shared calculation, router, and schema tasks execute sequentially. Add independent review for Task 4 and the final integration. Every worker receives the spec, its task, relevant paths, and the instruction: you are not alone in this codebase; preserve other agents' edits and adapt to them.

Each task follows red test -> minimal implementation -> green test -> relevant checks -> review. Use `wealthline_validate` for supported checks and targeted tests if supported. If it is unavailable, report that limitation and use only an approved validation path that preserves failure accounting. Do not run the raw shell validator as a workaround for a stopped validator. Expected red-phase failures are intentional, but do not invent exemptions from the active tool's failure policy.

No task ends with an automatic commit. Leave a reviewed diff and report verification; commit/push/deploy require separate authorization.

## File ownership

| Task | New files | Existing files to modify |
| --- | --- | --- |
| 1: Contributions | `src/cashflowEntries.ts`, `tests/cashflow-entries.test.mjs` | `src/cashflow.ts`, `src/expenses.ts`, `src/bankTransactions.ts`, `tests/cashflow.test.mjs` |
| 2: FX evidence | `tests/cashflow-evidence-fx.test.mjs` | `src/cashflowFx.ts`, `src/cashflowPeriod.ts`, `tests/cashflow-fx.test.mjs` |
| 3: Drilldown | `src/cashflowQuery.ts`, `src/views/CashflowRecords.tsx`, `tests/cashflow-drilldown-ui.test.mjs` | `src/routes.ts`, `src/site.ts`, `src/App.tsx`, `src/views/Cashflow.tsx`, `src/views/CashflowSummary.tsx`, `src/views/CashflowChart.tsx`, `src/views/Expenses.tsx`, `src/views/BankTransactions.tsx`, `src/index.css`, `tests/routes.test.mjs`, `tests/cashflow-ui.test.mjs`, `tests/lazy-pages-ui.test.mjs` |
| 4: Review storage | `src/monthlyReview.ts`, `src/cashflowFingerprint.ts`, `tests/monthly-review-storage.test.mjs` | `src/model.ts`, `src/dataVersion.ts`, `src/dataParts.ts`, `src/google/driveStore.ts`, `src/localStore.ts`, `src/backupPreview.ts`, `src/views/BackupRestore.tsx`, `tests/drive-split.test.mjs`, `tests/local-mode.test.mjs`, `tests/backup-restore-preview.test.mjs` |
| 5: Review UI | `src/views/MonthlyReviewPanel.tsx`, `tests/monthly-review-ui.test.mjs` | `src/monthlyReview.ts`, `src/App.tsx`, `src/views/Cashflow.tsx`, `src/index.css` |
| 6: Reports | `src/monthlyReport.ts`, `src/monthlyReportExport.ts`, `src/views/MonthlyReport.tsx`, `tests/monthly-report.test.mjs`, `tests/monthly-report-ui.test.mjs` | `src/App.tsx`, `src/views/Cashflow.tsx`, `src/index.css` |
| 7: Integration | `docs/monthly-review.md`, `tests/monthly-review-integration.test.mjs` | `README.md`, `docs/data-safety-validation.md`, targeted tests above as defects require |

Files are relative to the implementation worktree. Do not create placeholder modules before their task. Each new `.test.mjs` uses the repository's Vite SSR test harness so extensionless TypeScript imports work without package changes.

## Shared contracts

These are planned contracts, not current exports. Add them in the owning task. Existing types come from `cashflow.ts`, `expenses.ts`, `bankTransactions.ts`, `model.ts`, and `historicalFx.ts`.

### Contributions — Task 1

```ts
export type CashflowSource =
  | { kind: 'bank'; accountId: string }
  | { kind: 'card'; card: string }
export type ClassifiedKind = 'income' | 'consumption' | 'pending' | 'excluded'
export interface ClassificationEvidence {
  basis: 'manual' | 'custom-rule' | 'builtin' | 'unclassified'
  rule?: { keyword: string; direction?: 'credit' | 'debit' }
}
export interface CashflowEntry {
  source: CashflowSource
  recordId: string
  date: string
  description: string
  currency: string
  amount: number
  direction?: 'credit' | 'debit'
  classification: ClassifiedKind
  category?: string
  exclusionReason?: string
  evidence: ClassificationEvidence
  income: number
  consumption: number
  difference: number
  metric: 'income' | 'consumption' | 'excluded'
  sourceKey?: string
  importKey?: string
}
export function cashflowEntries(input: CashflowInput): CashflowEntry[]
```

Card `amount` remains signed; bank `amount` remains a nonnegative magnitude plus direction. `metric` retains membership even when the contribution is zero. Pending remains `classification:'pending'`; its `metric` follows direction and its effective category is `未分類`. Card unclassified has `classification:'consumption'`, category `未分類`.

### FX — Task 2

```ts
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
export function cashflowWithFxEvidence(
  groups: readonly CashflowCurrencySummary[], today: string,
  fetcher?: HistoryFetcher,
): Promise<CashflowConversion>
```

Keep `cashflowInTwd` as a compatibility wrapper returning `conversion.group`. `useTwdCashflow` adds `fx` to its current return shape; it shares the existing request and stale-result guard. Summary-only callers remain supported. The empty case returns `{group:undefined,fx:[]}`. TWD records receive rate-1 evidence.

### Query — Task 3

```ts
export interface CashflowQuery {
  range: 'month' | 'year' | 'all'
  year?: number
  month?: string
  metric: 'all' | 'income' | 'consumption' | 'difference' | 'pending' | 'excluded'
  category?: string // stable token, never a free-text label
  source: 'all' | 'bank' | 'card'
  panel: 'records' | 'review' | 'report'
  page: number
}
export function parseCashflowQuery(search: string): {
  query: CashflowQuery; corrected: boolean
}
export function cashflowQueryString(query: CashflowQuery): string
export function filterCashflowEntries(
  entries: readonly CashflowEntry[], query: CashflowQuery,
): CashflowEntry[]
```

Category tokens: `salary=薪資`, `dividends=股利`, `interest=利息`, `investment-recovery=投資回收款`, `other-income=其他收入`, `unclassified=未分類`, `dining=餐飲`, `transport=交通`, `shopping=購物`, `travel=旅遊住宿`, `entertainment=娛樂`, `digital=數位服務`, `utilities=生活繳費`, `medical=醫療`, `government=政府規費`. Defaults are `range=month`, `metric=all`, `source=all`, `panel=records`, and `page=1`. A month-range query uses a validated `month`, a year-range query uses a year from 1 through 9999, and all-range uses neither. Reject contradictory period fields. An initially absent month resolves through the existing latest-recorded-month default and then replaces the URL. Review/report panels require a concrete month. Year/all filters use the same selected scope as their summary totals. Filter membership uses effective category/metric, not the sign of a contribution. A category valid for both sides requires an explicit metric or `all`.

### Review — Tasks 4 and 5

```ts
export interface SourceReview {
  source: CashflowSource
  decision: 'reviewed' | 'no-activity'
  confirmedAt: string
  fingerprint: string
  exceptionNote?: string
}
export interface MonthlyReview {
  month: string
  expectedSources: CashflowSource[]
  confirmations: SourceReview[]
}
export type LedgerReadiness = 'not-loaded' | 'loading' | 'ready' | 'error'
export interface MonthlyReviewState {
  status: 'unreviewed' | 'in-progress' | 'reviewed' | 'stale'
  currentMonth: boolean
  sources: {
    source: CashflowSource; count: number; unclassifiedCount: number
    fingerprint: string; current: boolean
  }[]
}
export function parseMonthlyReviews(raw: unknown): MonthlyReview[]
export function cashflowFingerprint(value: unknown): Promise<string>
export function reviewFingerprint(
  entries: readonly CashflowEntry[], review: MonthlyReview,
  source: CashflowSource, bankLabels: Readonly<Record<string, string>>,
): Promise<string>
export function monthlyReviewState(
  entries: readonly CashflowEntry[], review: MonthlyReview, today: string,
  bankLabels: Readonly<Record<string, string>>,
): Promise<MonthlyReviewState>
```

`monthlyReviewState` receives complete entries; readiness is enforced by its UI caller. It filters to `review.month` and returns source rows for the union of expected and observed references. Observed sources outside the expected list prevent reviewed status. Compare canonical source references, not object identity. Include the canonical expectation list in each source fingerprint, so changing review scope invalidates prior scope confirmation. Hash row fields/effective evidence and current relevant labels with policy version 1; sort rows by source identity plus record ID. Exclude confirmation times/notes from the input hash. Notes cannot authorize changed inputs. `cashflowFingerprint` hashes canonical JSON: recursively sorted object keys, preserved array order, no undefined/nonfinite values, SHA-256. Callers sort semantically unordered arrays first and omit absent optional fields rather than explicitly setting undefined.

### Report — Task 6

```ts
export interface MonthlyReportEntry extends CashflowEntry {
  sourceLabel: string
  fxKey: string // `${month}:${currency}`
  incomeTwd: number
  consumptionTwd: number
  differenceTwd: number
}
export interface MonthlyReport {
  format: 'wealthline-monthly-report'
  formatVersion: 1
  policyVersion: 1
  month: string
  generatedAt: string
  sourceDataVersion: number
  fingerprint: string
  review: { record: MonthlyReview | null; state: MonthlyReviewState | null }
  entries: MonthlyReportEntry[]
  fx: CashflowFxEvidence[]
  totals: { income: number; consumption: number; difference: number } | null
  categories: { metric: 'income' | 'consumption'; category: string; total: number }[]
  rounding: { income: number; consumption: number; difference: number }
}
export function buildMonthlyReport(args: {
  month: string; asOfDate: string; generatedAt: string; sourceDataVersion: number
  entries: readonly CashflowEntry[]; fx: readonly CashflowFxEvidence[]
  review: MonthlyReport['review']; bankLabels: Readonly<Record<string, string>>
}): Promise<MonthlyReport>
export function parseMonthlyReport(raw: unknown): Promise<MonthlyReport>
export function monthlyReportCsv(report: MonthlyReport): string
```

Policy 1 fixes all classification/FX/rounding behavior described in the spec. Report hash covers the full allowlisted payload except `fingerprint` and `generatedAt`; generated time is metadata, not content identity. Null observed totals are retained for empty months even when manually confirmed inactive. Rounding fields equal rounded aggregate minus the sum of rounded entry contributions. Warnings are derived deterministically from frozen entries/review under policy 1. The parser rejects unsupported policy versions rather than interpreting them using a newer policy.

## Task 1: Shared contribution projection

**Owner:** implementer. **Depends on:** confirmed implementation baseline. **Produces:** `CashflowEntry` contract above and unchanged legacy aggregates.

- [x] Add `tests/cashflow-entries.test.mjs` with the existing no-env Vite harness:

```js
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createServer } from 'vite'
let server, entries
before(async () => {
  server = await createServer({ configFile:false, envDir:false,
    server:{middlewareMode:true,watch:null,hmr:false,ws:false} })
  entries = await server.ssrLoadModule('/src/cashflowEntries.ts')
})
after(() => server?.close())
test('same IDs in separate sources retain signed contributions', () => {
  const rows = entries.cashflowEntries({
    expenses:[{id:'same',date:'2026-09-03',card:'Test card',
      description:'Refund',currency:'TWD',amount:-50,category:'購物'}],
    bankTransactions:[{id:'same',accountId:'bank-a',date:'2026-09-03',
      description:'Salary',currency:'TWD',amount:1000,direction:'credit',
      classification:{kind:'income',category:'薪資'}}],
  })
  assert.equal(rows.length, 2)
  assert.equal(rows.reduce((s,r)=>s+r.income,0), 1000)
  assert.equal(rows.reduce((s,r)=>s+r.consumption,0), -50)
  assert.equal(rows.reduce((s,r)=>s+r.difference,0), 1050)
})
```

- [x] Run the named test through the approved validator; establish the missing-export failure.
- [x] Implement classification evidence by extracting the existing priority logic in `expenses.ts` and `bankTransactions.ts`; keep existing classification functions as wrappers. Use their current enums, normalization, and directed first-match rules. Do not introduce independent regex classifications.
- [x] Implement entries and refactor the record loops of `cashflowMonths` to accumulate those entries. Preserve counts, directional review amounts, investment-recovery warnings, and `input.months` behavior. The core contribution is:

```ts
const difference = income - consumption
const metric = classification === 'excluded' ? 'excluded'
  : classification === 'income' ? 'income'
  : classification === 'consumption' ? 'consumption'
  : direction === 'credit' ? 'income' : 'consumption'
```

- [x] Add tests for zero income/expense membership, excluded transfers, unclassified card versus bank, manual override, first matching custom rule, built-in evidence, duplicate collection IDs, frozen inputs, and mixed currencies.
- [x] Use a fixture with salary 1000, income reversal 100, card spend 200/refund 50, bank expense 100/refund 20, excluded transfer 500, and pending credit 30. Assert income 930, consumption 230, difference 700; transfer remains a visible zero-contribution row.
- [x] Run cashflow and classification regressions. Preserve `dataSummary` counting policy 2 if aggregate semantics are unchanged; any aggregate difference is a regression to fix, not an automatic cache-version bump.

## Task 2: FX evidence from the existing conversion

**Owner:** implementer. **Depends on:** Task 1. **Consumes:** existing summary groups. **Produces:** `CashflowConversion` and hook evidence.

- [x] Add `tests/cashflow-evidence-fx.test.mjs` with the Task 1 Vite harness, loading `cashflow.ts` and `cashflowFx.ts`. Add this test body:

```js
const input = { expenses:[{id:'fx',date:'2026-09-03',card:'Test',
  description:'Refund',currency:'USD',amount:-2,category:'購物'}] }
const groups = cashflow.cashflowSummary(input,'2026-09',1)
const result = await fx.cashflowWithFxEvidence(groups,'2026-10-13',
  async symbol => ({symbol,currency:'TWD',asTraded:true,splits:[],
    points:[{date:'2026-09-30',close:30}]}))
assert.equal(result.group.consumption,-60)
assert.deepEqual(result.fx,[{month:'2026-09',currency:'USD',
  targetDate:'2026-09-30',rate:30,
  legs:[{symbol:'USDTWD=X',date:'2026-09-30',rate:30}]}])
```

- [x] Verify the missing-export failure, then refactor the conversion function to return group plus evidence and keep `cashflowInTwd` compatible. Obtain quote dates from the selected quotes, not target dates. For crypto, retain both underlying selected quotes.
- [x] Return evidence from the same active request in `useTwdCashflow`; clear evidence when currency/month/today/attempt changes until its request completes. Do not display rates belonging to a stale selection.
- [x] Test TWD rate 1, empty input, weekend fallback, missing or wrong-symbol rates, future foreign month, two crypto legs with different quote dates, and cancellation when selection changes.
- [x] Add SGD spending 10 at rate 24 to Task 1's fixture. Assert combined consumption 470 and difference 460. Check summary-only and raw-row totals agree.
- [x] Run existing FX and UI request-race tests, then typecheck. No additional network provider or dependency is needed.

## Task 3: Query-backed drilldown and edit return

**Owner:** implementer. **Depends on:** Tasks 1-2. **Produces:** query helpers and reused inline record view.

- [x] Extend route tests and add `tests/cashflow-drilldown-ui.test.mjs`. Start with a query roundtrip assertion (also add year and all-range roundtrips):

```js
const q = {range:'month',month:'2026-09',metric:'consumption',category:'dining',
  source:'all',panel:'records',page:1}
assert.deepEqual(query.parseCashflowQuery(query.cashflowQueryString(q)),
  {query:q,corrected:false})
assert.equal(query.parseCashflowQuery('?month=2026-99&page=-1').corrected,true)
```

- [x] Implement query parsing with `URLSearchParams`, canonical tokens, validated calendar months, positive safe-integer pages, and explicit duplicate-parameter handling (reject duplicates and use defaults). Preserve existing URLs without new query fields.
- [x] Add `useRouteLocation()` returning `pathname + search` through `useSyncExternalStore`; retain `usePath()` for public routing. Extend cashflow Route with optional query, and source routes with optional `recordId`/allowlisted `returnTo`. Use `URL` parsing before `parseRoute` path matching. Update `navigate` to compare full location and accept `scroll: 'top'|'preserve'`, defaulting to current top behavior.
- [x] Extract PR #65 record sections into `CashflowRecords.tsx`. Keep month/year/all disclosures, stable twelve-month chart, and counts. Apply contribution filters first, then pagination. Show loaded count, filtered total, original currency and TWD contribution. Use `(source kind, ID)` for keys.
- [x] Wire chart totals/category buttons and overview summary links to the normalized query. Keyboard activation and clicks must use the same handler. Filter changes reset page to 1; deletion clamps the last page with replace navigation.
- [x] Add explicit `LedgerReadiness` and error/retry props from App. A stored summary is not proof that raw records are ready. Do not load unrelated asset history merely to show cashflow evidence.
- [x] Extend existing source views to focus/open the requested record after load. Add an explicit return link to the canonical cashflow query. An invalid external `returnTo` is rejected. Missing records show a notice and do not open the first available row.
- [x] Add jsdom interactions: click September then dining; assert only matching card/bank rows and their total; edit one category; return and assert changed rows and preserved query; exercise `popstate`, reload, query-only navigation, record deletion, failed ledger retry, and two pages of matching rows.
- [x] Check mobile keyboard focus and disclosure behavior. Run route, cashflow UI, bank UI, and lazy-page regressions. Do not replace existing record editors or introduce a new bank month route.

## Task 4: Persist reviews with a safe schema migration

**Owner:** implementer; independent storage review before Task 5. **Depends on:** Task 1. Execute after Task 3 to avoid shared-file conflicts. **Produces:** review types/parser, fingerprint helper, optional `WealthData.monthlyReviews`, v16 support.

- [x] Add storage tests with Vite loading `model.ts`, `monthlyReview.ts`, `dataParts.ts`, and `dataVersion.ts`. Begin with:

```js
const base = model.emptyData()
const review = {month:'2026-09',expectedSources:[{kind:'card',card:'Test'}],
  confirmations:[]}
const parsed = model.parseWealthData({...base,version:16,monthlyReviews:[review]})
assert.deepEqual(parsed.monthlyReviews,[review])
const split = parts.splitData(parsed,'test-set','2026-10-13T12:00:00Z')
assert.equal(split.main.version,16)
assert.deepEqual(split.main.monthlyReviews,[review])
assert.equal(version.dataVersion({...base,monthlyReviews:[]}),16)
```

- [x] Verify failure, then add strict review parsing with the spec's bounds and allowlists. Reject duplicate month/source references and unsupported decisions. Permit historical bank IDs that no longer exist so stale reviews remain explainable.
- [x] Implement the canonical hash helper using browser `crypto.subtle.digest('SHA-256', ...)`; normalize object key order, reject nonfinite data, and hex-encode output. Do not treat arbitrary transaction strings as executable content.
- [x] Extend DataVersion and VersionedData; include `monthlyReviews` in `parseWealthData` and version detection. All save paths must preserve the version floor:

```ts
// In split/write paths; do not replace a v16 document with version 15.
const version = dataVersion(data, { minimumVersion: 15 })
// Split detection, also used by raw-main backup rejection.
const supportedSplitVersion = version === 15 || version === 16
```

- [x] Replace hard-coded v15 load/save/split recognition in `dataParts.ts`, `driveStore.ts`, and `localStore.ts`. Retain v15 serialization for data that has no review field. Keep existing part formatVersion and part collections unchanged.
- [x] Extend backup preview with review count; preserve review data through full download/restore. Verify `finishSave` retains review edits made after a save began; change `saveState.ts` only if the existing spread/merge contract does not pass that test.
- [x] Add fake-Drive cases: review-only save with unread parts; reload; full backup restored locally; raw v16 split main rejected; another device conflict; part write failure; existing v1-v15 loads; v16 does not downgrade when reviews become empty; malformed review rejected before writes.
- [x] Run storage/local/backup/version regressions and independent review. Acceptance requires zero record loss, not merely valid JSON. No migration writes occur just from opening old data.

## Task 5: Human review and stale confirmation

**Owner:** implementer. **Depends on:** Tasks 3-4. **Consumes:** ready entries and persisted review metadata. **Produces:** panel and confirmation state machine.

- [x] Implement `reviewFingerprint` and `monthlyReviewState` under the shared contract. Add a pure-state regression before UI work:

```js
const source = {kind:'card',card:'Test'}
const review = {month:'2026-09',expectedSources:[source],confirmations:[]}
const rows = entries.cashflowEntries({expenses:[{id:'a',date:'2026-09-01',
  card:'Test',description:'Meal',currency:'TWD',amount:20,category:'餐飲'}]})
const fingerprint = await reviews.reviewFingerprint(rows,review,source,{})
review.confirmations = [{source,decision:'reviewed',fingerprint,
  confirmedAt:'2026-10-13T12:00:00Z'}]
assert.equal((await reviews.monthlyReviewState(rows,review,'2026-10-13',{})).status,'reviewed')
const changed = rows.map(r=>({...r,amount:21,consumption:21,difference:-21}))
assert.equal((await reviews.monthlyReviewState(changed,review,'2026-10-13',{})).status,'stale')
```

- [x] Add the panel with expected-source selection, copy-previous-scope, source counts/currencies, explicit no-activity confirmation, unclassified drilldown, and a 500-character exception note. Include observed sources missing from expectations as actionable items, not hidden transactions.
- [x] Keep saved confirmation snapshots when stale. The aggregate is reviewed only if every expected source is current, observed sources are covered, and unclassified entries have been resolved or explicitly retained. No expectations means unreviewed even with no rows.
- [x] Capture data/session identity before hashing. Check it after await before calling the existing `onChange`. Use normal Save Changes; show `待儲存` until persisted. Disable confirmation while ledger is not ready, during save, or for future months.
- [x] Add pure tests for row-order stability, unchanged unrelated month, relevant rule changes, irrelevant rules, source rename, added currency, source deletion, cross-month move, zero-value rows, no activity, and notes invalidated by changed entries.
- [x] Add UI tests for loading/error barriers, card-vs-bank unclassified counts, month switch during hashing, restore during hashing, save racing a later edit, and current-month copy `截至目前已核對`. Assert no synthetic transactions and `coverage.complete` remains false.
- [x] Verify reload and backup roundtrip retain confirmation and then correctly mark it stale when a relevant row changes. Run focused review/UI tests and existing save-state tests.

## Task 6: Report generation, export, and isolated viewer

**Owner:** implementer. **Depends on:** Tasks 1-5. **Produces:** shared report contract, CSV/JSON downloads, read-only snapshot view.

- [x] Add report tests with modules loaded via Vite. A minimal empty-observation report must retain unknown totals:

```js
const report = await reports.buildMonthlyReport({month:'2026-09',
  generatedAt:'2026-10-13T12:00:00Z',sourceDataVersion:16,
  entries:[],fx:[],review:{record:null,state:null},bankLabels:{}})
assert.equal(report.totals,null)
assert.deepEqual(await reports.parseMonthlyReport(JSON.parse(JSON.stringify(report))),report)
await assert.rejects(()=>reports.parseMonthlyReport({...report,policyVersion:99}))
```

- [x] Implement `buildMonthlyReport` with defensive copies, only selected-month entries/rates, matched FX references, signed unrounded contributions, exact category membership, and reconciliation rounding. Reject missing required FX even when the foreign row's amount is zero. Generate the fingerprint after canonical sorting.
- [x] Use frozen entries to derive pending/exclusion/recovery warnings. Include review state as captured; do not promote stale/unreviewed data. Source labels are captured so renames after export do not change a report.
- [x] Implement parser allowlists, existing upload-size ceiling, unique source/ID identities, valid month/date/rate/finite values, consistent categories/totals, quote references, and fingerprint verification. Compare numerical recalculation using tolerance `1e-9 * max(1,abs(expected))`; validate display reconciliation separately at two decimals. Reject malformed or unsupported report versions. Do not accept arbitrary HTML or fetch embedded URLs.
- [x] Build MonthlyReport UI and use the same drilldown criteria for live previews. JSON snapshots filter their own frozen entries; current-data links explicitly leave snapshot mode and handle missing/changed rows. Show original and current data as separate contexts.
- [x] Add App orchestration: preview can show unsaved data with a label; export captures `saved.current`, session identity, and the ready ledger revision, obtains FX once, and rechecks identity/readiness after await. Abort if data/account/session changes. Do not call a partial-backup fallback or read asset history solely for monthly reports.
- [x] Implement browser Blob downloads and revoke object URLs. CSV text sanitation is separate from numeric serialization:

```ts
const csvText = (value: string) => {
  const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}
// Numeric fields use validated finite numbers; negative refunds stay numeric.
```

- [x] Add tests for quotes/newlines/formula prefixes, negative numeric refunds, precision tails, null months, all-excluded observed zero, two-leg FX, tampered fingerprint, duplicate IDs within one source, unsupported policy, enormous input, and unknown fields. Use existing byte limits rather than loading the file before checking its size.
- [x] Add UI tests: export with unsaved edits disabled; unreviewed export clearly labelled; ledger/FX failure prevents full report; logout during generation cancels download; open JSON uses no live quote fetch and makes no `onChange`/restore calls; later ledger edits cannot change the snapshot.
- [x] Reopen a fixture report and reconcile every total from the frozen evidence. Run report, cashflow FX, and local-data safety regressions.

## Task 7: Integrated acceptance and documentation

**Owner:** tester for checks; implementer for relevant fixes; reviewer for final independent review. **Depends on:** Tasks 1-6.

- [x] Add `tests/monthly-review-integration.test.mjs` using the existing fake-Drive and jsdom patterns. Combine the September fixture from Tasks 1-2 with October data. Drive initially exposes only summary data. Assert the chart can render while confirmation/report export remain unavailable; then load the ledger and assert readiness.
- [x] Exercise chart -> September consumption -> category -> source edit -> return -> source review -> save -> report export. Check expected totals (income 930, consumption 470, difference 460 before edits), query retention, source membership, and saved review.
- [x] Move a September row to October; assert both relevant reviews become stale while an unrelated August review remains current. Change only a foreign quote; transaction review remains current while newly generated report FX/content changes.
- [x] Restore a full backup into local mode, repeat report generation, reopen the earlier snapshot, and assert the earlier snapshot remains unchanged. Fail the ledger read and prove no confirmation or full export occurs.
- [x] Run test/lint/typecheck through the approved validator. Track actual failures and honor its stop. Fix only task-related regressions. Do not equate synthetic/fake-Drive passes with provider access or real statement completeness.
- [x] Perform a local browser check at 375px and 1280px with explicitly synthetic fixtures: keyboard activation, focus return, long labels, mixed currency/refunds, 1,000 matching rows, and 100-row rendering cap. Use an authorized existing preview or obtain authorization before starting/changing services.
- [x] Update `docs/monthly-review.md`, README feature list, and data-safety validation scope. Explain human review versus completeness, null versus zero, stale confirmations, exact card-label identity, monthly FX basis, report snapshot limitations, and v16 old-client behavior.
- [x] Request independent review of schema/read-write safety, calculation parity, routing state, and snapshot isolation. Record findings and actual checks; close task-related findings before proposing implementation completion.

## Completion criteria and handoff

The implementation is ready for user review only when all applicable task checks pass, the spec's R1-R5 are covered, no product changes escape the stated scope, and verification limits are explicit. This document contains no approval to merge or release.

Planning self-review: R1 -> Tasks 1-2; R2 -> Task 3; R3 -> Tasks 4-5; R4 -> Task 4; R5 -> Task 6; cross-feature acceptance -> Task 7. Review Focus items have corresponding tests. Document authoring does not mark any implementation checkbox complete.

## Latest-main integration - 2026-10-14

User authorized integration after initial implementation. Worktree now uses fetched origin/main f240172; the original baseline above is historical. Preserved upstream inline editing and partial bank loading together with review/report full-ledger gates. Validation:757/757 tests, lint, typecheck, synthetic Chromium375/1280 and independent integration review PASS. No commit/push/deploy. Local evidence: `.superpowers/sdd/2026-10-13-monthly-review-plan/main-integration/verification.md`.
