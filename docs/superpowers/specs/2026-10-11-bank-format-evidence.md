# Local bank-statement format evidence

## Scope and handling

Read-only format reconnaissance of six supplied PDFs, using the already-installed local `pdfjs-dist` library. No repository source was inspected or changed; no packages were installed and no external service was used. The environment file was accessed programmatically only to select its `BANK_PASSWORDS` entry. Passwords and password-to-bank associations are not recorded and are not bank matching rules.

Extraction stayed in process memory. Inspection output used a fixed whitelist of structural bank/header/currency vocabulary, masked numeric/date shapes, text lengths, and coordinates. This report contains no customer names, account identifiers, original filenames, actual dates, balances, transaction values, or full extracted text. No balance deltas were calculated. All examples below are invented and deliberately omit balance values.

**Evidence limit:** one sample per variant, not a production compatibility guarantee. “Confident” means the observed transaction table supports an explicit positional rule; new layouts still require header validation and fail-closed handling.

Coordinates below are approximate PDF points, origin bottom-left; y decreases as reading proceeds. Use header-relative bands and right edges, not universal absolute coordinates. Widths/page dimensions are aggregate layout metadata.

## Coverage / recommended status

| Variant | Pages | Dimensions | Observed scope | Status |
|---|---:|---|---|---|
| HSBC Taiwan | 4 | 612 × 864 | TWD transaction table and three foreign-currency blocks | Confident for observed cash-account tables |
| DBS Taiwan | 4 | 612 × 864 | Cover, account summary, disclosures, effectively blank final page | Recognizable statement; transaction parsing **unproven / fail closed** |
| HSBC Singapore | 3 | 595 × 842 | SGD savings activity, multi-page continuation | Confident with explicit date/page continuation state |
| Taishin Taiwan | 4 | 595 × 842 | TWD cash-account activity | Confident for observed TWD table only |
| Taipei Fubon Taiwan | 3 | 595 × 842 | TWD and USD cash-account activity | Confident only with strict amount-vs-reference discrimination |
| E.SUN Taiwan | 2 | approximately 612 × 864 | Deposit summary plus a narrowly scoped outgoing-transfer activity table | Conditional support for that transfer table; **not evidence of a complete account-activity parser** |

Do not treat an unrecognized or summary-only statement as successfully parsed zero transactions. Recognized no-activity sections and unsupported/unobserved transaction layouts are different outcomes.

## HSBC Taiwan

- Page 1 is principally relationship/account summaries and a credit-card summary. It includes `帳戶`, `帳戶幣別`, `結餘`, TWD/JPY/SGD/USD labels, and a `信用卡` area. This is not the transaction source.
- Page 2 contains `交易明細`, a `新臺幣`/`活期`/`存款` section, and the ordered columns `日期 | 交易明細 | 存入 | 支出 | 結餘`.
- Page 3 repeats that schema separately for foreign-currency sections. Currency appears near the right edge below each table header: JPY, SGD and USD subaccounts are represented. Currency must come from the section, **not** from currency text inside the narrative (which can mention the other side of an FX transfer).
- Observed x anchors: date ~53–88; narrative ~103 onward; credit amount right edge ~402; debit amount right edge ~482; balance right edge ~573. Header starts are ~60,103,385,465,557. Rows/continuation lines use roughly 8–9 pt vertical spacing.
- Actual transaction date shape is **DD/MM/YYYY**, confirmed locally by first components exceeding 12 and no second components exceeding 12. Do not interpret as US MM/DD/YYYY.
- Narratives can span many lines. The date is on the first line; the debit/credit amount often appears on the last narrative line, alongside a separate balance cell. Some later transactions omit the date when sharing a date group. Narrative lines can themselves contain dates, references, currencies and FX rates; only the left date-column date is the booking-date anchor.
- Keep a pending logical transaction across narrative lines. Finish on one valid explicit amount in the credit/debit band, not on the first date or narrative line. A later amount-bearing item with no new left-column date can inherit the most recent date **within the same validated section**.
- Opening/closing balance rows (`結餘` vocabulary), period totals and transaction-count rows also contain numbers. Exclude them by structural position/row role before looking for transaction amounts. Two foreign-currency blocks show no individual transaction rows, only opening/closing and summary rows; that is a section-level no-activity pattern, not a global generic “no transactions” sentence.
- Repeated page header resides above transaction content (~650–760 y); multilingual footer/disclaimer content mostly below ~130 y. Page 4 has no observed transaction table. Reset section state on each foreign-currency header. Do not let the relationship/card summary or FX reference-rate table become activity.
- A few private-use glyphs occur in peripheral material; standard transaction headers and columns remained extractable. Matching should not require an exact complete-page text match.

Synthetic logical example (invented): `17/06/2031 | Example subscription [wrapped narrative] | 存入: empty | 支出: 42.50 | currency: TWD`. A narrative mention of `SGD` does not change this section's TWD currency.

## DBS Taiwan

- Page 1 has a `綜合對帳單` heading and a period in **YYYY/MM/DD–YYYY/MM/DD** shape.
- Page 2 begins an `帳戶`/`摘要` summary with product/account/currency/balance columns. Observed products include foreign-currency demand deposits and TWD cash-account variants; observed currencies include SGD and TWD. Approximate x anchors: product ~34, masked account reference ~226, currency ~386, balance right edge ~591.
- The rest of page 2 and page 3 is dense disclosure/marketing/investment material. Page 4 contains only a page/header item. No booking-date/debit/credit transaction table was observed anywhere in this sample.
- Summary values are not transaction values. The presence of deposit accounts or small/empty-looking summary cells does not justify reconstructing transactions, assuming an opening balance, or deriving a delta.
- No explicit no-transactions phrase was established by this inspection. This may be a statement with no activity, but **the sample does not prove a supported transaction-table variant or an explicit no-activity certification**.
- Fail closed for DBS transaction imports until an activity-bearing sample establishes the headers, direction and row geometry. Bank/statement recognition can be designed now; transaction parsing cannot be claimed from this evidence.

## HSBC Singapore

- Page 1 has statement metadata and relationship summaries above the cash-account transaction section. Summary headings themselves include debit/credit/balance terms: do not confuse them with activity columns.
- Cash-account header is `Date | Transaction [details] | Deposits | Withdrawals | Balance [debit qualifier]`. The account/currency section is above it; observed cash-account currency is SGD.
- Approximate x anchors: date ~52–90; description starts ~102; deposits right edge ~402; withdrawals right edge ~483; balance right edge ~573. Header starts ~59,102,369,437,498. Page 1 transaction header is around y231; subsequent pages around y564. Narrative spacing is ~10–11 pt.
- Left-column dates use **DDMMMYYYY**, with month abbreviations (spacing can be normalized). All observed booking dates included a four-digit year.
- Descriptions wrap over several lines and include references and narrative dates. A transaction amount can land many lines below its left-column date.
- Pages 2 and 3 explicitly repeat `Balance Brought Forward`, and page 1/page 2 end with `Balance Carried Forward`. These are non-transaction continuation markers. A logical transaction can continue after that boundary: early page-2 amount rows have no fresh date, and page 3 begins with an amount-bearing continuation before `Closing Balance` and transaction totals/counts.
- Thus page boundaries must preserve **validated account, currency, latest booking date and unfinished narrative state**, while removing repeated statement headers, footers and carried/brought-forward balance lines. Only carry state when the next table is demonstrably the same account/section. If this continuity cannot be established, reject the affected rows rather than guess a date or derive an amount from balance.
- Deposits are credits, withdrawals debits. The word `Credit` within a narrative does not independently establish direction. The debit qualifier in the balance heading is a balance-sign convention, not an instruction to invert activity direction.
- Final closing balance, transaction totals and counts are not activity. Relationship facilities/credit-limit summaries, deposit-insurance footer and final statement text must be excluded.

Synthetic logical example (invented): `09JUL2031 | Example transfer [six continuation lines] | Deposits: empty | Withdrawals: 120.00 | currency: SGD`. A subsequent same-account continuation page can finish the pending record with an explicit deposit amount; it must never infer that amount from carried balances.

## Taishin Taiwan

- Page 1 is a relationship/deposit summary. Page 2 contains a dedicated TWD account-activity table; below it and across pages 3–4 are disclosures, fund/investment/security explanations. Names of other banks appear in disclosures, so bank detection must use the statement masthead/section context, not arbitrary bank-name occurrences anywhere in extracted text.
- Ordered activity columns: account identifier, `日期`, `摘要`, `支票` reference, `支出金額`, `存入金額`, transfer/counterparty reference, `餘額`.
- Approximate x bands: masked own-account identifier ~60–120; date ~144–183; description ~198–233; check/reference header ~244; debit amounts right edge ~342; credit amounts right edge ~401; transfer/counterparty reference ~411–480; balance right edge ~545. Header y~751; row spacing ~17 pt.
- Booking dates are **YYYY/MM/DD**. Amount strings can include `$` and grouping commas; observed TWD amounts in this table are whole-unit strings, so decimal-only money grammar would wrongly reject them.
- The observed rows are compact single-line transactions with a repeated own-account identifier on each row. Both debit and credit columns are demonstrated. A counterparty identifier can appear near the transfer-reference column; it must not become an amount or a new account section.
- Currency is established by the TWD section heading, not the `$` symbol alone. Foreign-currency activity and wrapped/multi-page activity are **not established** by this sample.
- There is no need for balance-delta derivation. A row with neither explicit amount, both populated amount cells, or a missing validated date/currency must fail closed.

Synthetic example (invented): `2031/05/16 | Example cash deposit | 支出金額: empty | 存入金額: $800 | currency: TWD`.

## Taipei Fubon Taiwan

- Page 1 is relationship/asset summaries. Page 2 has separate deposit summaries followed by **TWD activity and foreign-currency activity**. Page 3 is disclosures. Summary sections have date-free balance columns and must not be imported as activity.
- TWD activity header: account identifier, `日期`, `摘要`, `支出`, `收入`, `餘額`. Approximate date x107–148; description x170 onward; debit money right edge ~335; credit money right edge ~458; balance right edge ~581. Header y~471; row spacing ~11–12 pt.
- Foreign-currency activity adds `幣別`: account identifier x~23; currency x~100; date x135–176; description x191 onward; debit right edge ~349; credit right edge ~468; balance right edge ~581. Header y~353. Observed currency USD; the TWD table inherits TWD from its heading.
- Dates are **YYYY/MM/DD**. Observed transaction money has fractional digits and may have grouping commas.
- **Critical ambiguity:** the visually empty opposite-direction amount band can hold a counterparty identifier or descriptive text. Examples of observed shapes include long unpunctuated digit strings, masked digit strings, and bank/transfer text. These may be right-aligned at the same edge as genuine money. Counting every numeric token in the `支出`/`收入` band as a monetary amount would produce wrong direction or a fabricated huge amount.
- For this observed variant, accept money only with strict currency/format-aware syntax (observed fractional money format), rejecting masked identifiers and long integer references. Account references in the opposite band do not mean both debit and credit are populated. Geometry alone is insufficient. If two genuine money cells remain, reject instead of netting them or consulting the balance.
- Initial `結餘` rows carry a date and balance but no transaction amount: explicitly exclude them. The own-account identifier appears at the section start and is omitted on subsequent rows; section-local currency/account context is necessary.
- A bank-account debit narrative can mention `信用卡` (payment from the bank account). **Keep that cash-account transaction**; exclude separate card-statement sections, not every row containing card vocabulary. This distinction also applies to bank debits funding investments.
- No wrapped activity narrative was established here; do not extrapolate arbitrary multiline support from the disclosure text.

Synthetic example (invented): `2031/03/12 | Example incoming transfer | 支出-band: counterparty reference, not money | 收入: 150.25 | currency: TWD`. A reference such as `REF-EXAMPLE` is not a debit amount.

## E.SUN Taiwan

- Page 1 is a dashboard/relationship summary, not a transaction source. Some graphical/compact labels are not clearly represented by ordinary text items; text extraction success alone must not imply full-document semantic coverage.
- Page 2 begins a deposit summary with `幣別` and `存款餘額`. Observed summary includes two TWD account variants and a USD account. These are not activity.
- Below it is a specifically scoped **outgoing-transfer transaction detail** section (heading includes `轉出` and `交易明細`), not a proven complete account ledger.
- Header order: outgoing/own account, `交易日期`, `摘要`, `提款`, `存款`, `幣別`, receiving-account/`備註`, and bank/`匯率` related reference information.
- Approximate x anchors: masked own account ~35–91; date ~112–150; description starts ~173; withdrawal amount right edge ~307; deposit header ~366; currency header ~392; receiving reference ~422; auxiliary routing/reference text ~481–570. Header y~616; observed rows y~597/~578, roughly 19 pt apart.
- Dates have **YYY/MM/DD** shape, consistent with Taiwan ROC calendar. The three-digit year must be explicitly interpreted as ROC (Gregorian = ROC + 1911), not truncated Gregorian. Cross-check against the statement period; reject inconsistent dates rather than assume all three-digit values are valid ROC years.
- Both observed activity rows contain explicit withdrawal amounts. No deposit-side example is present. Their transaction currency cells are blank, despite a `幣別` header. A local equality check established that their masked own-account references match the first TWD entry in the deposit summary. That supports **section-scoped account-to-currency mapping for this sample**, without disclosing or persisting identifiers. It does not authorize a default currency for all E.SUN transactions or an arbitrary first-account fallback.
- A design can conditionally parse explicit withdrawals with unique, validated account-summary currency linkage. Blank currency plus missing/ambiguous linkage must fail closed. A credit-side parser, complete general deposit activity, FX activity, cross-page behavior and other product variants are **unproven**.
- Disclosure text immediately beneath the transfer table refers to activity/detail availability for different account types. Do not silently present these two transfer rows as all monthly bank transactions. Exclude nearby summaries, graphics, securities/card references and disclosures.

Synthetic example (invented): `120/04/08 | Example outgoing transfer | 提款: 33.00 | 存款: empty | 幣別: blank; uniquely linked summary account => TWD`. The invented ROC date converts to `2031-04-08`.

## Shared fail-closed acceptance constraints

1. Recognize the actual bank/region variant and eligible cash-account section before parsing. Password success, attachment naming, an isolated bank name in disclosures, or generic `Date`/`Balance` text are insufficient matching rules.
2. Preserve x/y/width metadata and normalize page orientation. Sort spatially; raw PDF item order is not reliably reading order (confirmed by headers/footers interleaving in extraction).
3. Use the **explicit money cell in a validated debit/credit column** for amount and direction. Ignore references/FX rates/narrative figures. Reject both-genuine-amount, no-explicit-amount, malformed-money and unanchored rows.
4. Balances may help identify the column and non-transaction boundary rows, but must never be emitted, stored as transaction fields, or used to derive transaction amounts/direction. **No eligible observed cash-transaction layout requires a balance delta.** Balance-only summaries/rows cannot support transaction reconstruction and are unsupported if presented as activity.
5. Resolve currency per section, per explicit row currency, or through unique section-scoped linkage where evidenced (E.SUN); never through a narrative mention, `$` alone, document-wide first currency, or guessing.
6. Handle repeated headers, opening/closing/carried/brought-forward rows, totals and counts before emitting activity. Keep date carry-forward local to the validated section; cross-page carry requires proven same-section continuity.
7. Wrapped descriptions need grouping by date/section/amount geometry, not one-text-line-one-transaction. Never take narrative dates as booking dates. Do not leak narrative account identifiers into any sanitized fixture.
8. Exclude actual card/investment/relationship summary sections, but retain genuine cash-account movements whose descriptions happen to mention card payments or investment funding.
9. Return unsupported/partial-coverage diagnostics for DBS and narrow E.SUN coverage rather than fabricated zero or implied complete activity. Additional representative samples are needed for their unobserved layouts, and for foreign-currency Taishin/general E.SUN credit activity.

## Reusable artifact and validation

- Canonical handoff: `/tmp/wealthline-pr33-BpSLYp/bank-format-evidence.md`.
- Local inspection helper: `/tmp/wealthline-pr33-BpSLYp/inspect-bank-layout.mjs`; contains generic whitelist, sensitive-input paths, and masking logic, but no passwords or extracted customer text. It is not a production parser and should not be committed or used as a fixture generator.
- Successfully decrypted and inspected all six PDFs and all 20 pages. Verified structural column geometry, date shapes, page continuation patterns, private-use/replacement-glyph counts, and E.SUN account-link equality using sanitized output only. No replacement glyphs were observed; a few HSBC Taiwan peripheral private-use glyphs were observed.
- No implementation, project tests, repository mutations, commits, or pushes were performed. The remaining work is parser design/implementation under the lead's approved scope, plus additional samples for the explicitly unproven variants.
