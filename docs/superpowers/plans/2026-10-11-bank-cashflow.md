# Bank Cashflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import bank debit/credit records independently of assets and card expenses, and show categorized income versus actual consumption in one Overview block.

**Architecture:** Independent bank ledger and account-label identities; shared explicitly document-typed PDF lifecycle, format-specific positional parsers, existing browser password vault. A pure cashflow projection combines categorized bank transactions with existing card expenses, without changing source data or positions.

**Tech Stack:** Existing TypeScript/React 19, PDF.js 6.4.299, SVG, Node test runner, Vite SSR/JSDOM; no new runtime dependency.

---

## Status, authorization and evidence gates

Planning draft. User approved the high-level design and requested design/plan creation. No functionality implementation, push, deployment or PR creation is authorized by this document alone. Written spec review and user document approval precede execution.

Spec: `docs/superpowers/specs/2026-10-11-bank-cashflow-design.md`.
Baseline: `c61c4a3` (main after PR33). Existing isolated clone: `/tmp/wealthline-pr33-BpSLYp/repo`, planning branch `feature/bank-cashflow-design`. Before execution choose an isolated feature worktree/branch with clean main baseline; do not code on main or reuse the former PR branch.

Sanitized format evidence is finalized at `docs/superpowers/specs/2026-10-11-bank-format-evidence.md`: HSBC Taiwan cash tables, HSBC SG SGD continuation, Taishin TWD, Fubon TWD/USD supported for observed formats; E.Sun outgoing table conditional/partial; DBS summary-only sample fails closed, not a supported transaction parser. Header/position checks remain mandatory; text-layer availability alone does not prove row completeness. No executor gets real PDFs or `.env` unless their assignment explicitly requires local sample verification. Synthetic fixture evidence goes to implementation workers instead. Never embed passwords/real dates, amounts, account numbers, full customer descriptions or original sensitive filenames into plan, tests, snapshots or Git.

## Responsibility and file map

| File | Responsibility |
|---|---|
| `src/bankTransactions.ts` | bank records/accounts, classification/rules validation, effective classification, provenance merge |
| `src/bankTextPrivacy.ts` | deterministic recognized-identifier masking and contextual text validation shared by parse/edit/load/save |
| `src/dataVersion.ts` | pure schema-version promotion with no runtime model dependency |
| `src/model.ts` | v13 collections and contextual allowlisted JSON loading |
| `src/statementDocument.ts` | shared neutral PDF open/cleanup/resources with document mode |
| `src/statementPdf.ts` | existing card-specific extraction/OCR adapter preserved |
| `src/bankStatements.ts` | format recognition, normalized item/group contract, fail-closed dispatch |
| `src/bankStatements/common.ts` | positional row/cell/date/provenance helpers |
| `src/bankStatements/{hsbcTaiwan,hsbcSingapore,dbs,taishin,fubon,esun}.ts` | one supported bank-format adapter per evidence matrix |
| `src/cashflow.ts` | immutable per-currency income/consumption/category/month projection |
| `src/views/BankTransactions.tsx` | independent bank ledger + account-label management |
| `src/views/BankStatementImport.tsx` | async import lifecycle + section mapping + preview |
| `src/views/BankTransactionEditor.tsx` | manual edit/classification/reversal/return semantics |
| `src/views/BankCategoryRules.tsx` | first-match keyword rules and edit/reopen state |
| `src/views/CashflowSummary.tsx` | unified Overview controls/totals and classified drilldown |
| `src/views/CashflowChart.tsx` | narrow responsive monthly grouped bars and category donut |
| `src/routes.ts`, `src/App.tsx`, `src/views/Overview.tsx` | new route, save binding, replace Overview expense summary in both branches |
| `src/history.ts`, `src/saveState.ts`, `src/quantityHistory.ts`, `src/holdingPeriods.ts`, `src/views/Expenses.tsx` | preserve v13 through existing mutation/save paths |
| `src/index.css`, `src/views/Legal.tsx`, `README.md`, `docs/bank-statement-import.md` | scoped styling and truthful privacy/import docs |
| `tests/bank-transactions.test.mjs`, `bank-statements.test.mjs`, `cashflow.test.mjs`, `bank-version.test.mjs`, `bank-ui.test.mjs` | focused new tests using established SSR/JSDOM setup |
| `tests/fixtures/bank-statements/*.mjs` | synthetic positional fixtures; no customer PDFs |

Do not turn `Expenses.tsx` into a general transaction screen. Do not change account valuation, existing card provenance keys, or cryptographic formats. Reuse existing categorical constants without changing their values. Types below define planned APIs; executors must preserve existing app contracts.

## Task 0 — Baseline, spec and format evidence (Lead gate)

- [x] Finish sanitized bank-format matrix: bank/section headers, column coordinates, date policy, debit/credit evidence, continuation/wrapped rows, account/currency boundaries, excluded products, unsupported cases. Canonical report above; user must see partial E.Sun / unsupported DBS scope before execution.
- [ ] Independently review written spec, integrate required corrections, request user review. Commit only approved design docs; no samples/secrets.
- [x] Run baseline `npm test` in existing installed isolated clone on stated main: 316 passed, 0 failed/skipped. Evidence `/tmp/wealthline-pr33-BpSLYp/bank-design-baseline-test.log`. Fresh execution worktree must install with `npm ci --ignore-scripts` and repeat baseline; report if main/counts change.
- [ ] Create isolated feature execution branch/worktree after document approval; establish clean `git status --short`.
- [ ] Review complete plan against final spec/matrix; unblock subsequent tasks only after review succeeds.

## Task 1 — Ledger schema, classification and stable identity

**Files:** Create `src/bankTransactions.ts`; create `tests/bank-transactions.test.mjs`.

Planned core types:

```ts
export const INCOME_CATEGORIES = ['薪資','股利','利息','投資回收款','其他收入','未分類'] as const
export type Classification =
  | {kind:'income'; category:typeof INCOME_CATEGORIES[number]}
  | {kind:'expense'; category:ExpenseCategory}
  | {kind:'excluded'; reason:'自有帳戶轉帳'|'信用卡繳款'|'投資本金移動'|'其他不計收支'}
  | {kind:'pending'}
export interface BankTransactionAccount {id:string; label:string; bank:string}
export interface BankTransaction {
  id:string; accountId:string; date:string; description:string;
  currency:string; direction:'debit'|'credit'; amount:number;
  classification?:Classification; sourceKey?:string; importKey?:string;
}
export interface BankCategoryRule {keyword:string; direction?:'debit'|'credit'; target:Classification}
// Implement strict parseBankTransactionAccounts, parseBankTransactions,
// parseBankCategoryRules, classifyBankTransaction, prepareBankTransactions,
// mergeBankTransactions. Treat unknown as pending; no transfer inference by
// the word 轉帳 alone. No references to model.ts values at runtime.
```

- [ ] Write failing tests for strict types/ranges, duplicate ids, dangling account references, invalid classification combinations, array/object validation and sensitive-key stripping. Import APIs via Vite `ssrLoadModule` as current tests do, not a new compiler/test dependency.

```js
const tx={id:'row-1',accountId:'ledger-1',date:'2026-01-12',description:'Example',currency:'TWD',direction:'credit',amount:100,classification:{kind:'income',category:'投資回收款'},balance:999,accountNumber:'synthetic-hidden'}
const parsed=bank.parseBankTransactions([tx],[{id:'ledger-1',label:'Test',bank:'Test bank'}])[0]
assert.equal(parsed.amount,100)
assert.equal('balance' in parsed,false)
assert.equal('accountNumber' in parsed,false)
assert.throws(()=>bank.parseBankTransactions([{...tx,amount:-1}],accounts))
```

- [ ] Run `node --test tests/bank-transactions.test.mjs`; expected RED for missing contract/validation. Capture actual expected failure before production edits.
- [ ] Implement strict allowlists (description<=500, label/bank<=100, finite amount 0..1e12, valid three-letter currency/date, bounded rules<=100, ids/provenance hashes validated). Account/transaction ids unique; every accountId resolves exactly once; reject orphan references rather than generating ids or linking asset accounts. New mapped account + its rows confirm atomically. Unknown classification stays pending. Manual pending overrides a matching rule as deliberately as manual income/expense.
- [ ] Add RED synthetic embedded-sensitive-text tests (not just forbidden fields): explicit account-number narration and known transient identifiers masked before preview/hashing; label/edit/JSON roundtrip same contextual policy; ordinary order/reference numbers retained. Implement `src/bankTextPrivacy.ts`, fixed replacement markers and deterministic normalization; never claim arbitrary free text can be perfectly de-identified. Parser omits header/customer identity text. No identifier list or unmasked text persists; UI warns against supplying full account/customer data.
- [ ] Add RED tests for normalized first-match rules, direction qualification, manual override, existing expense category reuse, generic transfer pending and investment-recovery label. Then minimal classification implementation and GREEN rerun.
- [ ] Add RED identity tests for rename, opposite-direction same values, two accounts and transfer counterparts, repeated equal rows, batch duplicate PDF, edited reimport, remapping a preview account. Implement account-id-based bank-v1 hashes and atomic merge; do not reuse card signature/keys.
- [ ] Run focused tests and `npm run lint`; review only scoped diff. Commit tested unit only after Lead-authorized implementation execution (local commit, no push).

## Task 2 — v13 integration and all save/edit guards

**Files:** Create `src/dataVersion.ts`, `tests/bank-version.test.mjs`; modify `src/model.ts`, `src/App.tsx`, `src/history.ts`, `src/saveState.ts`, `src/quantityHistory.ts`, `src/holdingPeriods.ts`, `src/views/Expenses.tsx`. Add relevant cases to existing statement/password safety tests only as required.

- [ ] Write RED tests: load v1–12 unchanged; promote any bank collection to13 (including []); preserve v13 without collections; invalid/dangling bank references fail with source context; read strips extra balance fields; JSON roundtrip retains bank accounts/rules/rows. Password/expense/quantity/period operations preserve13 and all new data.
- [ ] Run `node --test tests/bank-version.test.mjs tests/statement-passwords.test.mjs tests/statements.test.mjs`; verify expected RED, not environment failure.
- [ ] Implement version helper with explicit previous/persisted version support and no model/history circular runtime dependency. Existing v3–12 feature-presence priorities must remain the same. Update ALL hard-coded selectors found with `rg -n 'version:|version===|version ===' src`; do not just update App.
- [ ] Parse collections in model, validate references, never copy unknown fields. Use whole-file persistence unchanged. Add contextual errors without raw customer values.
- [ ] Test deferred save: editing a bank classification/label during save retains current edits and dirty state; saved stamp/asset snapshots never introduce bank changes to positions/history diffs. Local locks and Drive ETag conflicts still reject stale overwrites.
- [ ] Run `npm test && npm run lint`; expect all original tests plus new cases passing. Inspect full change scope and commit tested unit if execution authorized.

## Task 3 — Document boundary and six format parsers

**Dependencies:** final bank-format evidence + Task1 contracts. Own only PDF/parser files and fixture/tests; do not modify bank UI or model.

**Files:** `src/statementDocument.ts`, `src/statementPdf.ts`, `src/bankStatements.ts`, `src/bankStatements/common.ts`, bank-specific adapters, `tests/bank-statements.test.mjs`, synthetic fixtures.

Planned parser contract:

```ts
interface PositionedItem {text:string;x:number;y:number;width:number;height:number}
interface BankPage {page:number;items:PositionedItem[]}
interface BankDraftRow {sectionKey:string;page:number;rowKey:string;date:string;description:string;currency:string;direction:'debit'|'credit';amount:number}
interface BankSection {key:string;bank:string;currency:string;rows:BankDraftRow[];warnings:{page:number;code:string}[];noTransactions:boolean}
// Transient sectionKey is not a complete account number; persistent id is
// user-selected independent ledger identity. Return sanitized issue codes.
// parseBankStatement(pages, metadata): sections + detected/unsupported status.
// readBankStatementPdf(...) returns neutral pages/metadata, no card OCR path.
```

- [ ] Write RED positional synthetic fixtures for each **verified supported** adapter: true debit/credit columns differ from balance, date/currency headers, repeated header/continuation page, summary and securities/card sections excluded, no transactions vs parse failure. Never declare a bank supported from a generic regex test alone.
- [ ] Run `node --test tests/bank-statements.test.mjs`; prove missing behavior RED.
- [ ] Implement neutral shared PDF lifecycle behind an explicit document mode; preserve credit-card adapter output and existing HSBC OCR behavior. Bank path must never call `hsbcSgPage`, merchant OCR or credit-card transaction-boundary filtering. Maintain limits/resources/abort/password behavior and destroy task on all exits.
- [ ] Implement one adapter at a time from finalized matrix using table section and x-position cells. HSBC Taiwan: DD/MM/YYYY, multi-line amount completion, section-local inherited dates; HSBC SG: DDMMMYYYY and validated account continuation through carried/brought-forward markers; Taishin: YYYY/MM/DD, integer $/comma values; Fubon: YYYY/MM/DD plus strict observed decimal money grammar vs long numeric/masked reference in opposite money band; E.Sun: ROC+1911, explicit withdrawals only and unique transient account-summary currency linkage. DBS recognizes summary/disclosure but returns unsupported; do NOT fabricate its transaction adapter or accept zero. E.Sun must label partial outgoing-table coverage, never whole monthly account activity. If layout only exposes one unsigned amount and no reliable direction marker, emit warning/reject, never infer from balance deltas. Wrapped description attachment cannot bleed into next account/summary.
- [ ] Add RED safety cases for unknown date year, shifted/ambiguous amount columns, simultaneous debit/credit, missing currency/account table, multi-currency sections, encrypted synthetic PDF, cancellation, and recognized bank but unsupported layout.
- [ ] Verify all existing card tests unchanged, plus bank GREEN tests: `node --test tests/bank-statements.test.mjs tests/statements.test.mjs` then `npm test && npm run build`.
- [ ] Bounded dedicated local sample verification may read BANK_PASSWORDS using a separate nontracked script; output only bank/section metadata, aggregate counts and unsupported reasons. Do not submit real extracted rows to reviewers. Compare parsed transaction count with safe table-row count, not balances. Document unsupported cases truthfully.

## Task 4 — Pure unified cashflow projection

**Dependencies:** Task1, not bank parser/UI. Can run independently of Task3 after contracts lock.

**Files:** Create `src/cashflow.ts`, `tests/cashflow.test.mjs`.

Planned API: `cashflowSummary({expenses,expenseRules,bankTransactions,bankRules}, endMonth, period)` returns per-currency months, net income/consumption/difference, signed category totals, exclusions/pending debit+credit counts and amounts. Input objects must remain unchanged.

- [ ] Write RED tests for period validation/cross-year 1/3/6/12, currency separation, incomplete/no-record vs zero, existing card refunds, bank income reversal, bank refund, excluded card payment/own transfer/investment principal, pending, rule changes and negative category totals.

```js
// All synthetic; bank directions with the same amount must not collapse.
const rows=[
 {...base,id:'salary',direction:'credit',amount:1000,classification:{kind:'income',category:'薪資'}},
 {...base,id:'groceries',direction:'debit',amount:100,classification:{kind:'expense',category:'購物'}},
 {...base,id:'refund',direction:'credit',amount:20,classification:{kind:'expense',category:'購物'}},
 {...base,id:'payment',direction:'debit',amount:200,classification:{kind:'excluded',reason:'信用卡繳款'}},
 {...base,id:'unknown',direction:'credit',amount:500,classification:{kind:'pending'}}
]
// Card purchase200 + refund-10; bank consumption100-20.
const g=cashflow.cashflowSummary({expenses:[card(200),card(-10)],bankTransactions:rows,expenseRules:[],bankRules:[]},'2026-01',1)[0]
assert.equal(g.income,1000)
assert.equal(g.consumption,270)
assert.equal(g.difference,730)
assert.equal(g.pending.creditAmount,500)
```

- [ ] Run `node --test tests/cashflow.test.mjs`; verify expected RED.
- [ ] Implement projection only, never call asset valuation or modify expenses/accounts. Retain signed income/expense categories, no premature rounding. Report excluded/pending by direction to avoid a misleading unsigned combined value.
- [ ] Cover only-bank, only-card, zero assets, no matching currency this period, net-negative consumption and investment recovery full amount warning flag. Repeat with frozen/structured-cloned inputs; assert no mutation.
- [ ] Run focused GREEN and `npm test`; review contract before consumers start.

## Task 5 — Separate ledger UI, mapping and classification

**Dependencies:** Tasks1–3. UI executor owns only bank views/routes/App wiring plus bank UI tests; parallel Overview executor must NOT also edit App/routes.

**Files:** create bank view modules and `tests/bank-ui.test.mjs`; modify `src/routes.ts`, `src/App.tsx`, scoped bank styles in `src/index.css`.

- [ ] Write RED routes and render tests for `/bank-transactions`, back/forward, zero asset accounts, independent account creation/rename/reference deletion guard. Existing `/expenses` table remains card-only.
- [ ] Build page using existing React patterns: section mapping selector/new label before confirm, editable records, direction and classification controls, pending badge, filter/account/currency/date, delete row. Amount input nonnegative; refund/income reversal explicit.
- [ ] Add import tests with mocked neutral PDF extraction for multi-file partial success, valid no-transaction sections, unsupported table, field correction, unselected rows, manual row, duplicate preview counts, abort/navigation/account-session switch, vault reuse/manual fallback. No state write until confirmation; no automatic persist until existing Save action.
- [ ] Preserve edited rows and selections when classification dialog opens/closes/cancels/Escape/native close, when password manager rerenders and when first-match rule is edited. Disabled/busy guards cover async saves; latest data closure prevents overwriting other edits. Generate provenance after mapping, remap keys safely.
- [ ] Validate no accidental asset or liability mutation using snapshots of `data.accounts`, `data.liabilities`, `data.history`. No position history changes after storing bank-only edits. Empty ledger may exist without any asset account.
- [ ] Use shared StatementPasswordSettings unchanged unless required; never load local development .env in app. Bank account labels and vault scope remain different identities.
- [ ] Run `node --test tests/bank-ui.test.mjs tests/ui-data-safety.test.mjs`; expected RED→GREEN for each feature slice; run full suite and commit reviewed UI slice.

## Task 6 — Unified Overview charts and drilldown

**Dependencies:** Task4 (locked projection), Task5 navigation props. Own Overview, cashflow view/chart, scoped styles and tests; coordinate App callback handoff with Task5 owner, not overlapping edits.

**Files:** `src/views/CashflowSummary.tsx`, `CashflowChart.tsx`, `Overview.tsx`; new focused chart/overview cases in `tests/bank-ui.test.mjs` only after Task5 executor resolves or in separate `tests/cashflow-ui.test.mjs`; scoped CSS.

- [ ] Write RED render tests for two Overview branches (assets empty vs present), only-bank, only-card, both, and a single unified section. Existing ExpenseSummary must not also double-display separate trend in Overview. Expenses page remains unaffected.
- [ ] Implement shared end-month/period/currency controls and totals using only cashflow projection. Warning badges link to bank ledger; source drilldown clearly separated. Investment-recovery notice always appears when contributing.
- [ ] Write chart tests with narrow width280 and page width320: bars honor signed values and zero baseline; real bounding rectangle at two viewport offsets maps each of12 months correctly; keyboard buttons select same dates. Reuse lessons from PR33 coordinate fix. No generic `nearest()` guessing from default JSDOM zero geometry.
- [ ] Implement SVG grouped bars and category donut without new dependency; represent null as missing, not zero, negative totals accurately. Positive slices denominator is sum of positive category net values; signed table contains all categories and totals. All-negative/zero case has explanation, no invalid SVG/NaN. Provide exact value table and text labels, not color-only distinctions.
- [ ] Switch trend/income categories/expense categories within same chart block; changes preserve period/month. Check current incomplete month notice and never describe income−consumption as bank balance or true investment return.
- [ ] Real-browser synthetic-data checks after automated GREEN: mobile320/375, desktop, click/keyboard/touch, multi-currency, negative/refund, empty/pending states. If browser unavailable report unverified; do not invent pass.

## Task 7 — Final integration, privacy, review and acceptance

**Files:** `src/views/Legal.tsx`, `README.md`, `docs/bank-statement-import.md`; necessary integration fixes owned by Lead after assigned executors resolve.

- [ ] Document verified bank versions, unsupported cases, account mapping, date semantics, duplicates limits, transfer/payment review, investment-recovery warning, no balances/assets linkage, password/new-device behavior and category-rule precedence. Correct preexisting outdated statement-import docs only where relevant to shared vault/document mode.
- [ ] Update Chinese/English privacy disclosures for bank transaction metadata; do not claim summaries contain no personal information (descriptions may contain it).
- [ ] Independent review of requirement compliance and code quality, with exact changed files, synthetic fixture evidence and no real secrets. Resolve important findings; re-review modified scope.
- [ ] Verify 6-sample local matrix with aggregate evidence; any unsupported sample section is disclosed, not silently declared complete. Native local/Drive concurrency tested in mocks; production Drive not touched.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, `git diff --check` and read full outputs/exit codes. Compare asset-domain snapshots before/after bank-only actions; inspect tracking for secret/sample leakage.
- [ ] Complete line-by-line acceptance checklist against final spec. Report exact tested banks/layouts, test counts, real-browser coverage and limitations.
- [ ] Do not push/create PR/deploy/merge without further user authorization. Retain local feature artifacts and provide paths for review.

## Execution ownership and staging

Recommended sequential contracts: 0→1→2, then parser task3 and pure report task4 may run in parallel (disjoint files). Task5 and6 are staged only after relevant dependencies lock; CSS edits coordinate by one owner or Lead integration. Each unresolved unit has one executor; never inspect/modify live delegated scope locally. Fresh bounded implementer per unit, spec then quality review. Agent report is not proof: Lead accepts diff and independently validates after each result resolves.

Implementation completion is NOT inferred from document review. A plan reviewer cannot approve parser completeness without the finalized sanitized bank matrix; this is an explicit dependency gate.
