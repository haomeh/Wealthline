import { statementClosingDate, closingCashAmount } from './bankStatements/balances';
import type { StatementCashBalance } from './bankStatementAssets';
import { BANK_PDF_ERRORS } from './bankStatementErrors';
import { protectBankText } from './bankTextPrivacy';
import { spatialLines, tableHeader, isoDate, money, identifier, labeledAccount, currencies } from './bankStatements/common';
import type { BankDraftRow, BankPage, BankSection, BankStatementMetadata, BankWarning, SpatialLine, Table } from './bankStatements/common';
import { layout as taiwan } from './bankStatements/hsbcTaiwan';
import { layout as singapore } from './bankStatements/hsbcSingapore';
import { layout as taishin } from './bankStatements/taishin';
import { layout as fubon, foreignLayout } from './bankStatements/fubon';
import { layout as esun } from './bankStatements/esun';
import { DBS_UNSUPPORTED, singaporeLayout as dbsSingapore, dbsSingaporeContext } from './bankStatements/dbs';
import type { BankProfile } from './bankStatements/profile';
import { BANK_PROFILES } from './bankStatements/profiles';
export type { PositionedItem, BankPage, BankSection, BankDraftRow, BankStatementMetadata, BankWarning } from './bankStatements/common';
export interface BankStatementResult {
    status: 'recognized' | 'partial' | 'unsupported';
    bank?: string;
    sections: BankSection[];
    warnings: BankWarning[];
    recognizedCount: number;
    rejectedCount: number;
    balances?: StatementCashBalance[];
}
const warning = (page: number, code: string): BankWarning => ({ page, code, count: 1 });
// Profiles of one bank are matched by the brand pattern text, not by RegExp object identity.
const brandKey = (brand: RegExp) => `${brand.source}/${brand.flags}`;
const sameBrand = (a: RegExp, b: RegExp) => brandKey(a) === brandKey(b);
const tableHeaderOf = (line: SpatialLine, profile: BankProfile): Table | undefined => {
    for (const layout of [profile.layout, ...(profile.variants ?? [])]) {
        const table = tableHeader(line, layout);
        if (table)
            return table;
    }
};
const nonActivity = /^(?:期初|期末|開戶|Closing Balance|Opening Balance|Balance Brought Forward|Balance Carried Forward|結餘|餘額|合計|總計|交易筆數|Transaction (?:total|count)|Total (?:deposits|withdrawals))/i;
const boundary = /^(?:帳戶摘要|存款總覽|投資摘要|信用卡摘要|證券|Investment Summary|Relationship Summary|Credit Card Summary|重要事項|注意事項|Disclosure)/i;
interface Pending {
    date?: string;
    description: string[];
    page: number;
    rowKey: string;
    invalid: boolean;
    leading?: string[];
}
/**
 * Pure, synchronous positional parser. Input pages and all identifier evidence are transient.
 * `profiles` is for tests; the app always uses BANK_PROFILES.
 */
export function parseBankStatement(pages: readonly BankPage[], metadata: BankStatementMetadata = {}, profiles: readonly BankProfile[] = BANK_PROFILES): BankStatementResult {
    if (pages.length > 100 || new Set(pages.map(p => p.page)).size !== pages.length)
        throw new Error('銀行文件頁數無效');
    let chars = 0;
    for (const p of pages) {
        if (!Number.isInteger(p.page) || p.page < 1 || p.page > 100 || !Array.isArray(p.items))
            throw new Error('銀行文件位置無效');
        for (const i of p.items) {
            if (typeof i.text !== 'string' || ![i.x, i.y, i.width, i.height].every(Number.isFinite) || i.width < 0 || i.height < 0)
                throw new Error('銀行文件位置無效');
            chars += i.text.length;
        }
    }
    if (chars > 500000)
        throw new Error('銀行文件文字超過限制');
    const ordered = [...pages].sort((a, b) => a.page - b.page).map(p => ({ page: p.page, lines: spatialLines(p.items), height: p.height ?? p.items.reduce((max, i) => Math.max(max, i.y), 0) + 30 }));
    const periods = new Map<string, {
        start: string;
        end: string;
    }>();
    for (const l of ordered[0]?.lines ?? []) {
        if (l.y < (ordered[0].height - 220) && !/^帳單期間|^Statement Period/i.test(l.text))
            continue;
        const match = l.text.match(/(\d{3,4}\/\d{2}\/\d{2})\s*[-–至]\s*(\d{3,4}\/\d{2}\/\d{2})/);
        if (match) {
            const start = isoDate(match[1], match[1].split('/')[0].length === 3 ? 'roc' : 'ymd'), end = isoDate(match[2], match[2].split('/')[0].length === 3 ? 'roc' : 'ymd');
            if (start && end && start <= end)
                periods.set(start + '_' + end, { start, end });
        }
    }
    const hasPrintedRange = periods.size > 0;
    const explicitStart = metadata.periodStart && isoDate(metadata.periodStart.replaceAll('-', '/'), 'ymd'), explicitEnd = metadata.periodEnd && isoDate(metadata.periodEnd.replaceAll('-', '/'), 'ymd');
    if (explicitStart && explicitEnd && explicitStart <= explicitEnd)
        periods.set(explicitStart + '_' + explicitEnd, { start: explicitStart, end: explicitEnd });
    if (!hasPrintedRange) {
        for (const l of ordered[0]?.lines ?? []) {
            if (l.y < ordered[0].height - 180)
                continue;
            const m = l.text.match(/(\d{3,4})年\s*(\d{1,2})月/);
            if (m) {
                const year = +m[1] + (m[1].length === 3 ? 1911 : 0), month = +m[2];
                const start = isoDate(`${year}/${String(month).padStart(2, '0')}/01`, 'ymd');
                if (start) {
                    const end = `${start.slice(0, 8)}${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;
                    periods.set(start + '_' + end, { start, end });
                }
            }
        }
    }
    const period = periods.size === 1 ? [...periods.values()][0] : undefined;
    const balanceDate=periods.size>1?undefined:statementClosingDate(ordered[0]?.lines??[],period?.end);
    const closing=new Map<string,{currency:string;quantity:number}>(),invalidClosing=new Set<string>(),cashScopes=new Map<string,string>();
    const masthead = ordered[0]?.lines.filter(l => l.y > ordered[0].height - 160 && !/Disclosure|注意|說明|優惠|投資|mentions/i.test(l.text)).map(l => l.text).join(' ') ?? '';
    // The first bank named on the cover decides; several banks fail closed below.
    const coverBrand = profiles.find(p => p.cover && p.brand.test(masthead))?.brand;
    let detected: BankProfile | undefined = coverBrand && profiles.find(p => sameBrand(p.brand, coverBrand) && p.cover?.(masthead, ordered));
    const statementHeading = ordered[0]?.lines.some(l => l.y > 400 && l.items.some(i => /對帳單|STATEMENT/.test(i.text.replace(/\s/g, '').toUpperCase()))) ?? false;
    // The samples use raster logos. A bank-specific, complete positional activity
    // fingerprint plus a statement cover/cash context is stronger than arbitrary
    // bank-name occurrences in disclosures. Do not widen name search to page bodies.
    if (!detected && statementHeading) {
        const fingerprints = profiles.filter(candidate => candidate.fingerprint && ordered.some(p => p.lines.some((l, n) => {
            if (!tableHeaderOf(l, candidate))
                return false;
            const nearby = p.lines.slice(Math.max(0, n - 4), n).filter(r => r.y - l.y < 40).map(r => r.text).join(' ');
            return candidate.fingerprint!({ nearby, lines: p.lines, index: n, pages: ordered });
        })));
        if (fingerprints.length === 1)
            detected = fingerprints[0];
    }
    const dbsFooter = ordered[0]?.lines.some(l => l.y < 100 && l.items.some(i => /\bDBS\b/i.test(i.text))) ?? false;
    const isDbs = /DBS|星展銀行/i.test(masthead) || (statementHeading && dbsFooter && !detected);
    const bankMatches = [...new Map(profiles.map(p => [brandKey(p.brand), p.brand])).values()].filter(pattern => pattern.test(masthead));
    if (bankMatches.length > 1 || profiles.some(p => p.ambiguousCover?.(masthead)))
        detected = undefined;
    if (!detected && isDbs && bankMatches.length <= 1 && ordered.some(p => p.lines.some((_, n) => dbsSingaporeContext(p.lines, n))))
        detected = profiles.find(p => p.layout === dbsSingapore);
    const sections: BankSection[] = [], warnings: BankWarning[] = [];
    if (!detected)
        return { status: 'unsupported', ...(isDbs ? { bank: 'DBS' } : {}), sections, warnings: [warning(ordered[0]?.page ?? 1, isDbs ? DBS_UNSUPPORTED : 'unsupported-bank-layout')], recognizedCount: 0, rejectedCount: 0 };
    const profile = detected, layout = profile.layout;
    // Collect only explicit identifier contexts and validated own-account columns, never arbitrary long references.
    const accounts = new Set<string>(), identities = new Set<string>(), summary = new Map<string, Set<string>>();
    for (const p of ordered) {
        let summaryMode = false;
        let summaryAccountX: number | undefined, summaryCurrencyX: number | undefined;
        for (const l of p.lines) {
            const own = labeledAccount(l.text);
            if (own)
                accounts.add(own);
            const identity = l.text.match(/(?:客戶編號|客戶識別碼|身分證字號|Customer ID)\s*[:：]?\s*([A-Z0-9]{6,40})/i);
            if (identity)
                identities.add(identity[1]);
            if (/帳戶摘要|存款摘要|存款餘額/.test(l.text))
                summaryMode = true;
            if (/轉出.*交易明細/.test(l.text))
                summaryMode = false;
            if (summaryMode) {
                const a = l.items.find(i => /^(帳號|銀行帳號|帳戶|帳戶號碼)$/.test(i.text)), c = l.items.find(i => i.text === '幣別');
                if (a && c) {
                    summaryAccountX = a.x;
                    summaryCurrencyX = c.x;
                }
                const linked = own ?? (summaryAccountX === undefined ? undefined : identifier(l.items.find(i => Math.abs(i.x - summaryAccountX!) < 20)?.text ?? ''));
                const cs = summaryCurrencyX === undefined ? currencies(l.text) : currencies(l.items.find(i => Math.abs(i.x - summaryCurrencyX!) < 20)?.text ?? '');
                if (linked && cs.length) {
                    accounts.add(linked);
                    const set = summary.get(linked) ?? new Set<string>();
                    cs.forEach(c => set.add(c));
                    summary.set(linked, set);
                }
            }
            if (layout === singapore && /Savings\s*Account/i.test(l.text) && currencies(l.text).includes('SGD')) {
                const id = identifier(l.items.find(i => i.x > 230 && i.x < 325)?.text ?? '');
                if (id) {
                    accounts.add(id);
                    summary.set(id, new Set(['SGD']));
                }
            }
            const h = tableHeaderOf(l, profile);
            if(h&&(layout===taiwan||layout===singapore)){
                const index=p.lines.indexOf(l);
                for(const heading of p.lines.slice(Math.max(0,index-3),index).filter(r=>r.y-l.y<=30)){
                    const id=identifier(heading.items.find(i=>i.x>230&&i.x<350)?.text??'');
                    if(id)accounts.add(id);
                }
            }
            if (h?.accountX !== undefined) {
                const counterpartX = l.items.find(i => /轉帳帳號|收款帳戶|收款帳號/.test(i.text))?.x;
                for (const row of p.lines.filter(r => r.y < l.y)) {
                    for (const x of [h.accountX, counterpartX]) {
                        if (x === undefined)
                            continue;
                        const id = identifier(row.items.find(i => Math.abs(i.x - x) < 20)?.text ?? '');
                        if (id)
                            accounts.add(id);
                    }
                }
            }
        }
    }
    const privacy = { accountIdentifiers: [...accounts].filter(a => !a.includes('*')), identityIdentifiers: [...identities] };
    let section: BankSection | undefined, table: Table | undefined, activeLayout = layout, account: string | undefined, currency = '', lastDate: string | undefined, pending: Pending | undefined;
    let context: string[] = [], contextAccount: string | undefined, continuation = false, lastPage = 0, closed = false;
    // Unowned narration since the last completed transaction, and that transaction
    // when it was emitted. Both are review candidates only, never description text.
    let orphans: string[] = [], emitted: BankDraftRow | undefined;
    const issue = (page: number, code: string) => {
        (section?.warnings ?? warnings).push(warning(page, code));
    };
    const discard = (code: string) => {
        if (pending) {
            issue(pending.page, code);
            pending = undefined;
        }
    };
    const createSection = (curr: string) => {
        const key = `section-${sections.length + 1}`;
        section = { key, bank: layout.bank, currency: curr, rows: [], warnings: [], noTransactions: false, partial: !!layout.partial };
        sections.push(section);
        if (layout.partial)
            section.warnings.push(warning(lastPage, 'partial-outgoing-transfer-coverage'));
        lastDate = undefined;
        closed = false;
        orphans = [];
    };
    for (const p of ordered) {
        const previousAccount = account, previousCurrency = currency;
        const mayContinue = layout === singapore && continuation && !!lastDate && !!previousAccount && p.page === lastPage + 1;
        table = undefined;
        context = [];
        contextAccount = undefined;
        orphans = [];
        lastPage = p.page;
        if (!mayContinue) {
            discard('unfinished-transaction');
            pending = undefined;
            lastDate = undefined;
            section = undefined;
            account = undefined;
            currency = '';
        }
        continuation = false;
        for (let n = 0; n < p.lines.length; n++) {
            const l = p.lines[n];
            const own = labeledAccount(l.text);
            if (own)
                contextAccount = own;
            if (table && layout === taiwan && l.items.some(i => i.x < table!.descriptionX && /活期|綜合外幣存款/.test(i.text))) {
                discard('section-boundary');
                table = undefined;
                section = undefined;
                lastDate = undefined;
                context = [l.text];
                contextAccount = identifier(l.items.find(i => i.x > 230 && i.x < 350)?.text ?? '');
                continue;
            }
            if (table && own && l.items.some(i => i.x < table!.dateX && labeledAccount(i.text))) {
                discard('section-boundary');
                table = undefined;
                section = undefined;
                lastDate = undefined;
                context = [l.text];
                continue;
            }
            const candidate = tableHeaderOf(l, profile);
            if (candidate) {
                let before = context.join(' ');
                if (layout !== singapore && layout !== esun) {
                    const nearby = p.lines.slice(Math.max(0, n - 4), n).filter(r => r.y - l.y < 40 && r.items.some(i => i.x < 110 && i.text.length < 30 && /活期|存款|台幣|臺幣|外幣/.test(i.text))).at(-1);
                    if (nearby)
                        before = nearby.text;
                }
                const below = p.lines.slice(n + 1, n + 4).filter(r => l.y - r.y < 35 && r.items.length === 1 && r.items[0].x > candidate.creditEdge && currencies(r.text).length === 1).map(r => r.text).join(' ');
                if (layout === singapore || layout === taiwan) {
                    const heading = p.lines.slice(Math.max(0, n - 3), n).filter(r => r.y - l.y <= 30);
                    const ids = heading.flatMap(r => r.items.filter(i => i.x > 230 && i.x < 350).map(i => identifier(i.text)).filter((i): i is string => !!i));
                    if (new Set(ids).size === 1)
                        contextAccount = ids[0];
                }
                const cs = currencies(before + ' ' + below);
                const brought = p.lines.slice(n + 1, n + 4).some(r => /Balance Brought Forward/i.test(r.text));
                const continuing = mayContinue && contextAccount === previousAccount && brought;
                let resolved = cs.length === 1 ? cs[0] : continuing ? previousCurrency : '';
                const accepted = profile.acceptTable?.({ lines: p.lines, index: n, table: candidate, before, resolved, continuing, contextAccount, summary });
                if (typeof accepted === 'string') {
                    issue(p.page, accepted);
                    table = undefined;
                    continue;
                }
                if (accepted) {
                    contextAccount = accepted.account;
                    resolved = accepted.currency;
                }
                if (layout !== esun && !candidate.currencyX && !resolved) {
                    issue(p.page, 'missing-section-currency');
                    table = undefined;
                    continue;
                }
                if (mayContinue && pending) {
                    if (contextAccount !== previousAccount || resolved !== previousCurrency) {
                        discard('unproven-page-continuity');
                        section = undefined;
                        lastDate = undefined;
                    }
                    else {
                        account = previousAccount;
                        currency = previousCurrency;
                    }
                }
                // Repeated header can preserve state only with an explicit matching identity.
                if (section && !(mayContinue && account === contextAccount && currency === resolved)) {
                    discard('section-boundary');
                    section = undefined;
                    lastDate = undefined;
                }
                // Only a validated new table reopens a closed section. Authenticated
                // SG continuation retains its unfinished transaction state.
                if (!continuing || !section)
                    closed = false;
                table = candidate;
                activeLayout = layout === fubon && candidate.currencyX !== undefined ? foreignLayout : layout;
                account = contextAccount;
                currency = resolved;
                if (!section && layout !== esun && !candidate.currencyX)
                    createSection(currency);
                context = [];
                continue;
            }
            if (!table) {
                // A cash section, not the earlier relationship summary, owns currency context.
                if (/活期|Savings Account|轉出.*交易明細|^(?:TWD|USD|SGD|JPY|新臺幣|新台幣|臺幣|台幣).*交易明細/i.test(l.text))
                    context = [l.text];
                else
                    context.push(l.text);
                continue;
            }
            if (boundary.test(l.text) || (layout === esun && l.items.some(i => i.x < 50 && i.text.length > 40 && /對帳單|交易明細/.test(i.text))) || (layout === taishin && l.items.some(i => i.x < 60 && i.text.length > 40)) || (layout === fubon && l.items.some(i => i.x < 40 && i.text.length > 40))) {
                discard('section-boundary');
                table = undefined;
                section = undefined;
                context = [l.text];
                continue;
            }
            if (/^(?:交易筆數|Transaction count|Number of transactions)\s*[:：]?\s*0$/i.test(l.text) && section && !section.rows.length && !pending && !section.warnings.length) {
                section.noTransactions = true;
                closed = true;
                continue;
            }
            if(section&&account&&currency){const scope=JSON.stringify([account,currency]);cashScopes.set(scope,currency);if(balanceDate){const quantity=closingCashAmount(l,table,activeLayout);if(quantity!==undefined){if(closing.has(scope)&&closing.get(scope)!.quantity!==quantity)invalidClosing.add(scope);else closing.set(scope,{currency,quantity});}}}
            const role = l.items.find(i => i.x >= table!.descriptionX - 4 && i.x < table!.descriptionEnd)?.text ?? '';
            // Fubon's own account is printed on the opening-balance row only.
            // Retain that structural identity while discarding every balance value.
            if (layout === fubon && /^(?:[\u3400-\u9fff]{2})?結餘$/.test(role) && table.accountX !== undefined) {
                const id = identifier(l.items.find(i => Math.abs(i.x - table!.accountX!) < 20)?.text ?? '');
                if (id) {
                    if (account && account !== id) {
                        discard('account-boundary');
                        section = undefined;
                        lastDate = undefined;
                    }
                    account = id;
                }
            }
            if (/^交易(?:筆數|次數|宗數|件數|數目|總數)$/.test(role) && section && !section.rows.length && !pending && !section.warnings.length) {
                const cells = l.items.filter(i => Math.abs(i.x + i.width - table!.debitEdge) < 18 || Math.abs(i.x + i.width - table!.creditEdge) < 18);
                if (cells.length === 2 && cells.every(i => money(i.text) === 0))
                    section.noTransactions = true;
            }
            if (layout === dbsSingapore && /^CURRENCY\s*:/i.test(l.text) && l.items.some(i => i.x < table!.descriptionX && /^CURRENCY\s*:/i.test(i.text))) {
                if (/^CURRENCY\s*:\s*SINGAPORE DOLLAR$/i.test(l.text))
                    continue;
                // A foreign block also ends a closed SGD table: report its exclusion.
                discard('currency-boundary');
                issue(p.page, 'unsupported-dbs-sg-account');
                table = undefined;
                section = undefined;
                lastDate = undefined;
                account = undefined;
                currency = '';
                orphans = [];
                emitted = undefined;
                closed = true;
                context = [l.text];
                continue;
            }
            if (layout === dbsSingapore && /^Total Balance Carried Forward in SGD:/i.test(role)) {
                discard('unfinished-transaction');
                closed = true;
                orphans = [];
                continue;
            }
            if (nonActivity.test(l.text) || /^(?:[\u3400-\u9fff]{2}結餘|結餘|交易總額|交易筆數|交易次數|交易數目|交易宗數|交易件數|交易總數|Balance (?:Brought|Carried) Forward|Closing Balance|Opening Balance|Transaction (?:total|count))/i.test(role) || l.items.some(i => /^(?:期初.*結餘|期末.*結餘|結餘|餘額)$/.test(i.text))) {
                if (/Carried Forward/i.test(role || l.text))
                    continuation = true;
                if (/Closing|期末|合計|總計|Total |Transaction (?:total|count)|^結餘$|^交易總額|^交易筆數/i.test(role || l.text)) {
                    discard('unfinished-transaction');
                    closed = true;
                }
                orphans = [];
                continue;
            }
            if (l.y < 100) {
                // Footer geometry is an exclusion, not evidence that no activity was lost.
                // Warn only; never build a transaction from below the boundary.
                const dateText = l.items.filter(i => i.x >= table!.dateX - 10 * table!.scale && i.x < table!.descriptionX - 8 * table!.scale).map(i => i.text).join(' ');
                const cells = l.items.filter(i => (Math.abs(i.x + i.width - table!.debitEdge) < 18 * table!.scale || Math.abs(i.x + i.width - table!.creditEdge) < 18 * table!.scale) && money(i.text, !!activeLayout.decimalOnly) !== undefined);
                // A wrapped table prints same-day rows without a date: exactly one
                // debit/credit cell in an open, already dated table is activity-shaped.
                // Other footer numbers (page counts, balances, disclosures) are not.
                if (cells.length && isoDate(dateText, activeLayout.dateKind) || cells.length === 1 && !dateText && activeLayout.wrapped && lastDate && !closed)
                    issue(p.page, 'activity-below-table-boundary');
                continue;
            }
            if (closed || (l.items.length === 1 && l.items[0].x > table.creditEdge && currencies(l.text).length === 1))
                continue;
            if (/^(?:本期無交易|無交易|No transactions|No activity)$/i.test(l.text)) {
                if (!section && currency)
                    createSection(currency);
                if (section && !section.rows.length && !pending && !section.warnings.length) {
                    section.noTransactions = true;
                    closed = true;
                }
                continue;
            }
            const t = table;
            const dateItems = l.items.filter(i => i.x >= t.dateX - 10 * t.scale && i.x < t.descriptionX - 8 * t.scale);
            const dateText = dateItems.map(i => i.text).join(' '), date = isoDate(dateText, activeLayout.dateKind);
            const ownItem = t.accountX === undefined ? undefined : l.items.find(i => Math.abs(i.x - t.accountX!) < 20 * t.scale);
            const rowAccount = ownItem ? identifier(ownItem.text) : undefined;
            if ((layout === taishin || layout === esun) && dateText && !rowAccount) {
                issue(p.page, 'missing-row-account');
                discard('account-boundary');
                continue;
            }
            if (rowAccount && !account && section && !section.rows.length && !pending)
                account = rowAccount;
            if (rowAccount && rowAccount !== account) {
                discard('account-boundary');
                account = rowAccount;
                section = undefined;
                lastDate = undefined;
                if (layout !== esun && t.currencyX === undefined)
                    createSection(currency);
            }
            let rowCurrency = currency;
            if (t.currencyX !== undefined) {
                const cell = l.items.find(i => Math.abs(i.x - t.currencyX!) < 15 * t.scale);
                const cs = currencies(cell?.text ?? '');
                if (cs.length === 1)
                    rowCurrency = cs[0];
                else if (layout === esun || date)
                    rowCurrency = '';
            }
            if (layout === esun) {
                const linkage = account ? summary.get(account) : undefined;
                if (!rowCurrency && linkage?.size === 1)
                    rowCurrency = [...linkage][0];
                if (rowCurrency && linkage && (linkage.size !== 1 || !linkage.has(rowCurrency)))
                    rowCurrency = '';
            }
            if (layout === fubon && t.currencyX !== undefined && rowCurrency !== 'USD')
                rowCurrency = '';
            if (layout === esun && rowCurrency !== 'TWD')
                rowCurrency = '';
            if (rowCurrency && (!section || section.currency !== rowCurrency)) {
                discard('currency-boundary');
                currency = rowCurrency;
                createSection(currency);
            }
            const debitItems = l.items.filter(i => Math.abs(i.x + i.width - t.debitEdge) < 18 * t.scale), creditItems = l.items.filter(i => Math.abs(i.x + i.width - t.creditEdge) < 18 * t.scale);
            const debit = debitItems.flatMap(i => { const v = money(i.text, !!activeLayout.decimalOnly); return v === undefined ? [] : [v]; }), credit = creditItems.flatMap(i => { const v = money(i.text, !!activeLayout.decimalOnly); return v === undefined ? [] : [v]; });
            // Only narrative geometry, not own-account, date, reference, currency or balance cells.
            const narrative = l.items.filter(i => i.x >= t.descriptionX - 4 * t.scale && i.x < t.descriptionEnd - 4 * t.scale && i.x + i.width < Math.min(t.debitEdge, t.creditEdge) - 25 * t.scale).map(i => i.text).join(' ');
            if (!dateText && !debit.length && !credit.length && !narrative)
                continue;
            if (dateText) {
                discard('missing-explicit-amount');
                lastDate = date;
                // A printed date starts a row: earlier unowned lines cannot begin it.
                orphans = [];
                pending = { date, description: [], page: p.page, rowKey: `row-${n + 1}`, invalid: !date };
            }
            // A narrative-only line after an already completed transaction has no
            // proven owner: it may trail that row or begin a new undated row.
            // Never silently attach it to either; keep it as a review candidate on
            // both neighbours and leave the ownership decision to the preview.
            if (!pending && !dateText && narrative && !debit.length && !credit.length && activeLayout.wrapped && lastDate) {
                issue(p.page, 'ambiguous-trailing-narration');
                const candidate = protectBankText(narrative, privacy);
                orphans.push(candidate);
                if (emitted && section?.rows.at(-1) === emitted)
                    (emitted.ambiguousNarration ??= { leading: [], trailing: [] }).trailing.push(candidate);
                continue;
            }
            if (!pending && (date || ((debit.length || credit.length || narrative) && activeLayout.wrapped && !activeLayout.datedRowsOnly && lastDate))) {
                pending = { date: date ?? lastDate, description: [], page: p.page, rowKey: `row-${n + 1}`, invalid: false, ...(orphans.length && { leading: orphans }) };
                orphans = [];
            }
            if (!pending) {
                if (debit.length || credit.length)
                    issue(p.page, 'unanchored-transaction');
                continue;
            }
            if (narrative)
                pending.description.push(narrative);
            if (layout.accountColumn && !account)
                pending.invalid = true;
            const malformed = [...debitItems, ...creditItems].some(i => money(i.text, !!activeLayout.decimalOnly) === undefined && (layout !== fubon || /^[\d,$.]+$/.test(i.text) && /[.$]/.test(i.text)));
            if (malformed)
                pending.invalid = true;
            if (debit.length || credit.length) {
                if (layout === esun && (!period || !pending.date || pending.date < period.start || pending.date > period.end))
                    pending.invalid = true;
                emitted = undefined;
                if (pending.invalid || !pending.date || !rowCurrency || !section || debit.length + credit.length !== 1 || (layout === esun && credit.length)) {
                    issue(p.page, 'ambiguous-transaction');
                }
                else {
                    const description = protectBankText(pending.description.join(' '), privacy);
                    // An empty summary is acceptable only as a draft whose unowned
                    // candidate lines are retained for explicit review.
                    if ((!description && !pending.leading) || description.length > 500)
                        issue(p.page, 'invalid-description');
                    else {
                        emitted = { sectionKey: section.key, page: pending.page, rowKey: pending.rowKey, date: pending.date, description, currency: rowCurrency, direction: debit.length ? 'debit' : 'credit', amount: (debit[0] ?? credit[0]), ...(pending.leading && { ambiguousNarration: { leading: pending.leading, trailing: [] } }) };
                        section.rows.push(emitted);
                    }
                }
                pending = undefined;
            }
            else if (!activeLayout.wrapped) {
                discard('missing-explicit-amount');
            }
        }
        // A page can end after a complete row but before the section's closing total.
        // Warn even when there is no pending row; a headerless next page cannot be verified.
        if (layout === dbsSingapore && table && !closed)
            issue(p.page, 'unproven-page-continuity');
        if (mayContinue && pending && !table)
            discard('unproven-page-continuity');
    }
    discard('unfinished-transaction');
    for (const s of sections)
        if (!s.rows.length && !s.noTransactions && !s.warnings.length)
            s.warnings.push(warning(lastPage, 'no-supported-activity-evidence'));
    const recognizedCount = sections.reduce((n, s) => n + s.rows.length, 0), rejectedCount = [...warnings, ...sections.flatMap(s => s.warnings)].filter(w => !w.code.startsWith('partial-')).reduce((n, w) => n + w.count, 0);
    const supported = recognizedCount > 0 || sections.some(s => s.noTransactions);
    if (!supported)
        warnings.push(warning(ordered[0]?.page ?? 1, 'unsupported-activity-layout'));
    const balances:StatementCashBalance[]=[];
    if(balanceDate)for(const curr of new Set(cashScopes.values())){const scopes=[...cashScopes].filter(([,c])=>c===curr).map(([key])=>key);if(scopes.length&&scopes.every(key=>closing.has(key)&&!invalidClosing.has(key)))balances.push({bank:layout.bank,date:balanceDate,currency:curr,quantity:scopes.reduce((n,key)=>n+closing.get(key)!.quantity,0)});}
    return { ...(balances.length&&{balances}), status: !supported ? 'unsupported' : layout.partial || rejectedCount ? 'partial' : 'recognized', bank: layout.bank, sections, warnings, recognizedCount, rejectedCount };
}
/** Lazy browser-local neutral reader; never enters the card OCR/scoping adapter. */
export async function readBankStatementPdf(bytes: Uint8Array, password: string | readonly string[], signal: AbortSignal) {
    let reader: typeof import('./statementDocument');
    try { reader = await import('./statementDocument'); }
    catch { throw new Error(BANK_PDF_ERRORS.module); }
    return reader.readBankDocument(bytes, password, signal);
}
