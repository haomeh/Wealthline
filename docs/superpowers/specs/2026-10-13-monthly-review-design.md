# Monthly Review, Drilldown, and Traceable Reports

Status: implementation and integration verified. The user authorized commit, push, and pull request creation on 2026-10-14. Merge and deployment remain unauthorized.
Date: 2026-10-13, Asia/Taipei.

## Intent and scope

Help a person finish a monthly financial review: inspect the records behind a number, confirm the sources they intended to review, and export a report that preserves its evidence. Keep financial processing in the browser and use the existing local/Google Drive storage modes.

The user requested current-feature analysis, an implementation plan, and then plan files in a project-local worktree. This design records the proposal discussed in chat. The subsequent user instruction authorizes implementation, tests, and independent review. A later instruction authorizes commit, push, and pull request creation; merge, deployment, and dependency changes remain outside scope.

## Verified baseline

- Planning worktree: `.worktrees/monthly-review-plan`, branch `codex/monthly-review-plan`, based on locally stored `origin/main` at `0c9b016`.
- The original checkout remains at `3451e0d`; its existing `.gitignore` edit is outside this work.
- `0c9b016` includes PR #65: a fixed twelve-month chart, month selection, inline card/bank records, yearly disclosures, and ledger-load retry.
- Local bank-performance branch `781f333` exists separately. Its pagination and loading work is not assumed merged. Reconcile this dependency before implementation. Do not reset, merge, or cherry-pick automatically.
- The prior attempt to check the remote failed with DNS resolution failure. This is a local Git baseline, not proof of the latest deployment.
- No application tests or browser checks were run for this planning task.

| Area | Existing source | Reuse | Gap |
| --- | --- | --- | --- |
| Monthly calculations | `src/cashflow.ts` | Signed card/bank contributions, exclusions, monthly currency totals | No reusable row-level evidence output |
| FX | `src/cashflowFx.ts`, `src/historicalFx.ts` | Monthly rates, completed quotes, two-leg crypto conversion | Result does not retain rate evidence |
| Inline records | `src/views/Cashflow.tsx` | PR #65 month/year records and chart selection | No metric/category drilldown or durable selection |
| Record presentation | `src/views/ExpenseRecords.tsx`, `src/views/BankTransactions.tsx` | Read-only record views | Filtered edit-and-return navigation |
| Coverage | `src/cashflow.ts`, `src/dataSummary.ts` | Counts; `coverage.complete` remains false | Expected sources and persisted human review |
| Persistence | `src/model.ts`, `src/dataVersion.ts`, `src/dataParts.ts`, `src/google/driveStore.ts`, `src/localStore.ts` | Validation, split files, conflict guards, backups | Review field and safe version promotion |
| Routing | `src/routes.ts`, `src/site.ts` | Path navigation and browser history | Query changes are not currently observed |
| Reporting | `src/localStore.ts`, `src/backupPreview.ts` | Full data backup only | Monthly report export and isolated viewer |

## Global constraints

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

## Chosen approach

Use one contribution projection for totals and evidence, URL-backed drilldown, small persisted monthly review records, and reports generated on demand. Do not create a second transaction ledger.

Alternatives considered: transient UI checkboxes are cheap but cannot survive a reload or identify stale confirmation. A Drive report archive can preserve many report versions but adds a new storage lifecycle. The selected design persists review state and exports self-contained report snapshots; archive management is outside v1.

## R1: Contribution and FX evidence

Create a read-only entry for each saved card/bank row. Its identity is `(source kind, record ID)`, because the two collections may reuse the same ID. Preserve date, description, source identity/label, currency, amount, bank direction, effective classification, classification basis, and optional existing provenance keys.

Each entry exposes signed `income`, `consumption`, and `difference` in its original currency. Card refunds reduce consumption. Bank income debits reverse income; expense credits reverse consumption. Pending bank credits/debits remain income/consumption respectively. Excluded rows remain visible with zero contribution and their reason. A zero-value row is still a member of its classification; membership cannot be determined by `amount !== 0`.

Classification basis is `manual`, `custom-rule`, `builtin`, or `unclassified`. Show only the matching rule, not unrelated rules. Preserve first-match ordering and the current text normalization. Refactor classification once so its evidence and its result cannot diverge.

For every observed currency/month, retain target date, effective rate, actual symbol/date/rate for each quote leg. TWD has rate 1 and no fetched quote. Keep existing staleness checks, no-future-price rule, and all-or-nothing conversion. Do not initiate extra quote requests just to construct evidence.

Use unrounded amounts for calculation. Display two decimal places in evidence and CSV display columns; include unrounded machine values in JSON/CSV. Show a rounding adjustment when summing displayed row values differs from the displayed aggregate. Existing summary formatting can remain unchanged.

Acceptance: raw-row and summary projections match within a documented floating-point tolerance; displayed reconciliation accounts for any rounding difference. Input objects are not mutated. Summary-only data can draw existing charts but cannot claim row-level evidence is ready.

## R2: Drilldown and return

Keep the fixed-year chart and month/year/all-period controls. Extend selection rather than replacing it. Monthly review and reports apply to one selected month; year/all-period views offer a month selection action.

- Month bars select that month's records.
- Income/consumption cards select all contributing rows, including negative reversals/refunds and zero rows.
- Category items filter by effective category across both sources.
- Pending filters distinguish bank pending from card unclassified; the existing bank-only pending count stays bank-only.
- Excluded filters show direction, reason, original amount, and zero contribution.
- Difference opens both income and consumption contributions, excluding zero-contribution exclusions unless explicitly requested.

Use fixed tokens in query parameters: `range`, `year`, `month`, `metric`, `category`, `source`, `panel`, and `page`. `range` is `month|year|all`. Month range uses `month=YYYY-MM`; year range uses `year=YYYY`; all range omits both. A month can be initially absent to preserve the existing latest-recorded-month default; resolve it once data arrives and replace the URL. Review/report panels require a concrete month. Metric/category filters can also apply to a selected year or all periods. `metric` is `all|income|consumption|difference|pending|excluded`; `source` is `all|bank|card`; `panel` is `records|review|report`. Category tokens map explicitly to the existing Chinese enums. Omit defaults when serializing. Invalid dates, unknown tokens, contradictory category/metric combinations, and invalid pages normalize to a safe unfiltered selection, with a visible notice when user intent could not be preserved. No description, account name, or card label belongs in the URL.

Preserve path-only `usePath` for public pages and add a location subscription for app routing. Navigation compares pathname plus search. Same-page filter changes must not trigger the global scroll-to-top behavior. Push deliberate user selections; replace automatic corrections and page resets. Back/forward restores selection. Existing path-only URLs remain valid.

Editing uses the existing source editors with a source record ID focus and an allowlisted cashflow return route. A missing/deleted record yields a notice, never a different row. Browser Back, explicit return, and reload preserve the originating query. Do not add a bank month path route.

Extract the inline cashflow record view and use bounded rendering (100 rows per page). Filter before pagination; totals always cover all matching records. Reuse existing paging primitives if PR #64 has landed. Preserve separate card/bank presentation and use current `DetailRecord` accessibility behavior. Direct selection opens the relevant disclosure and provides keyboard focus without stealing focus after background requests.

## R3: Monthly review

Store optional `monthlyReviews` in `WealthData`. One record per `YYYY-MM`. Each record contains expected source references, per-source decisions, timestamps, and fingerprints. Store the record in the main file; ledger files keep their existing quarterly format.

A source reference is `{kind:'bank', accountId}` or `{kind:'card', card}`. Match card labels exactly as saved; do not silently merge similar labels. The UI lists observed sources and permits a manually supplied expected card label that has no transactions. Bank sources come from independent ledger accounts, not asset accounts. Source settings include all currencies belonging to that source. Renames, removals, new currencies, and newly observed sources require review.

Each source decision is `reviewed` or `no-activity`. The latter requires zero observed rows, an explicit user action, and applies only to that source/month. A review can retain unclassified entries only with an explicit bounded note. Pending exceptions remain visible in the report; a note does not change classification or money. Copying last month's expected sources copies no decisions.

Monthly display state is derived: `unreviewed`, `in-progress`, `reviewed`, or `stale`, plus separate load/save states. A reviewed month requires at least one expected source, all expected decisions current, all observed sources included, and no unacknowledged unclassified rows. Current-month completion reads `截至目前已核對`; past months read `已人工核對`. With retained exceptions, add the count. Future months cannot be confirmed.

Fingerprint only relevant month's canonical rows, effective classifications/basis, source labels, expectation list, and calculation-policy version. Exclude unrelated months, row ordering, global `updatedAt`, report generation time, and FX quotes. Rule changes that change effective results or evidence invalidate affected months; irrelevant rule changes do not. Recompute after imports, edits, deletes, source-label edits, rules, restore, and reload. A cross-month move invalidates both months. Never erase the old confirmation merely because it became stale.

Do not trust stored fingerprints while only summaries are loaded. Expose `not-loaded|loading|ready|error`; confirmation requires `ready` and the current data/session revision. Confirmation updates the normal editable data and requires existing Save Changes. Show unsaved state. A later mutation while hashing or saving must not certify a newer revision.

No-activity confirmation does not rewrite `coverage.complete` or generate synthetic zero transactions. Existing no-record chart values remain null. A report can describe manual no-activity confirmation while retaining null observed totals.

## R4: Version and storage safety

Promote to v16 only when `monthlyReviews` exists, including an empty list. Accept v1-v15 without inventing confirmations. Retain higher versions through saves. If another feature has already allocated v16 at implementation time, stop and revise the version contract before any write.

Replace exact-v15 split handling with an explicit supported split-version predicate for v15/v16. Update parser ceiling, version helper, `splitData`, `loadDrive`, `saveDrive`, and the raw split-main backup rejection in `readDataFile`. A raw split main file is still not a complete backup. Full backups must include reviews and all parts. Old clients must reject the new version rather than strip unknown review fields.

Validate unique months/source references, valid dates, reference shapes, decisions, finite counts, and bounded strings. Limit reviews to 1,200 months, sources to 200 per month, and exception notes to 500 characters; apply existing whole-file size guards. Unknown fields are removed by an allowlist. Deleted source references remain explainable as stale history; never drop the review silently.

Use existing optimistic conflict and partial-write rollback behavior. Saving only reviews cannot delete unread ledger/history parts or rewrite unrelated parts. Restore and deletion follow existing data-management flows. Review metadata must never contain passwords, tokens, raw PDFs, or OCR candidate text.

## R5: Traceable monthly report

Produce a separate `wealthline-monthly-report` document, `formatVersion: 1`. It contains month, generated time, source data version, policy version, content fingerprint, review snapshot, entries, signed totals/categories, exclusion/pending annotations, FX evidence, and rounding information. Store the evidence needed for display; record IDs alone are insufficient after later edits. Include the local calculation `asOfDate` separately from generation timestamp, and bank labels only for selected-month observed or review-referenced bank IDs, so FX policy and review fingerprints can be recomputed from the snapshot.

Build preview from current editable data with an explicit unsaved label. Export only a captured saved revision with complete ledger data and all necessary rates. Review may be incomplete: export with `未核對` or `需重新核對`, never silently upgrade it. Existing investment-recovery warnings remain. Empty observed months retain null totals and distinguish manual no-activity confirmation from observed zero.

After any await, verify session and saved revision still match the captured inputs; otherwise cancel generation and ask the user to regenerate. Do not use a full-backup fallback that permits partial files. Ledger completeness is required, but unrelated archived asset history is not. First release uses the existing ledger-group loading; targeted quarterly fetching is not required.

Exports: UTF-8 CSV evidence and self-contained JSON snapshot. CSV includes metric membership, original amount/currency, signed contributions, source kind/record ID/label, effective category, classification basis, and FX references. Quote fields correctly and neutralize spreadsheet formulas in user-controlled text without altering numeric negative amounts. Download filenames use only validated month and timestamp.

Provide an isolated read-only snapshot viewer from the cashflow report panel. Opening a report must not call the wealth-data restore path, `onChange`, or live FX services. Validate format, finite numbers, identifiers, month, unique entry identities, rate references, totals, fingerprint, and existing file-size limit before rendering. Render text through React, never HTML. A hash detects content changes; it is not proof of authenticity. Later source edits never alter the open snapshot; a current-data link may show a divergence/missing-record notice.

## Out of scope

Automatic transfer pairing; statement-balance reconciliation; original PDF/page storage; persistent import-warning history; AI analysis; Excel/PDF generation; Drive report archives; family editing; new authentication services; global asset chart redesign; new dependencies.

## Delivery and review

Deliver sequentially: shared evidence, drilldown, review/storage, reports. Storage migration and final integrated behavior require independent review when implementation is authorized. Keep ownership narrow; do not launch all roles by default. Preserve existing execution preferences.

Success is measured by these tasks: reach a category's supporting rows; correct a row and return; confirm a month and see it become stale after an applicable change; export/reopen a report and reconcile its totals without live data. Synthetic fixtures prove these mechanics, not real-bank completeness or production access.

## Latest-main integration - 2026-10-14

User authorized integration after initial implementation. Worktree now uses fetched origin/main f240172; the original baseline above is historical. Preserved upstream inline editing and partial bank loading together with review/report full-ledger gates. Validation:757/757 tests, lint, typecheck, synthetic Chromium375/1280 and independent integration review PASS. No commit/push/deploy. Local evidence: `.superpowers/sdd/2026-10-13-monthly-review-plan/main-integration/verification.md`.
