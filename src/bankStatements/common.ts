import { normalizeBankText } from '../bankTextPrivacy';
export interface PositionedItem {
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface BankPage {
    page: number;
    width?: number;
    height?: number;
    items: PositionedItem[];
}
export interface BankDraftRow {
    sectionKey: string;
    page: number;
    rowKey: string;
    date: string;
    description: string;
    currency: string;
    direction: 'debit' | 'credit';
    amount: number;
    /**
     * Transient preview-only review metadata; never persisted with the ledger.
     * Narration lines printed next to this row whose owner is unproven: leading
     * lines may begin this row or trail the previous one, trailing lines may trail
     * this row or begin the next. They are NOT part of description, which may be
     * empty when every narration line of the row is unowned.
     */
    ambiguousNarration?: {
        leading: string[];
        trailing: string[];
    };
}
export interface BankWarning {
    page: number;
    code: string;
    count: number;
}
export interface BankSection {
    key: string;
    bank: string;
    currency: string;
    rows: BankDraftRow[];
    warnings: BankWarning[];
    noTransactions: boolean;
    partial: boolean;
}
export interface BankStatementMetadata {
    periodStart?: string;
    periodEnd?: string;
}
export interface SpatialLine {
    y: number;
    items: PositionedItem[];
    text: string;
}
export interface Layout {
    bank: string;
    dateKind: 'dmy' | 'ymd' | 'sg' | 'roc';
    date: string;
    description: string;
    debit: string;
    credit: string;
    balance?: string;
    anchors: number[];
    observedHeader?: {
        anchors: number[];
        bodyStarts: [
            number,
            number
        ];
        accountX: number;
    };
    edges: [
        number,
        number
    ];
    decimalOnly?: boolean;
    wrapped?: boolean;
    /** Never inherit a date for a new amount-bearing row in this layout. */
    datedRowsOnly?: boolean;
    partial?: boolean;
    accountColumn?: boolean;
    currencyColumn?: boolean;
}
export interface Table {
    dateX: number;
    descriptionX: number;
    descriptionEnd: number;
    debitEdge: number;
    creditEdge: number;
    accountX?: number;
    currencyX?: number;
    balanceX?: number;
    scale: number;
}
export function spatialLines(items: readonly PositionedItem[]): SpatialLine[] {
    const result: SpatialLine[] = [];
    for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
        if (!normalizeBankText(item.text))
            continue;
        let line = result.at(-1);
        if (!line || Math.abs(line.y - item.y) > 2.5) {
            line = { y: item.y, items: [], text: '' };
            result.push(line);
        }
        line.items.push({ ...item, text: normalizeBankText(item.text) });
    }
    for (const line of result) {
        line.items.sort((a, b) => a.x - b.x);
        line.text = line.items.map(i => i.text).join(' ');
    }
    return result;
}
const compact = (s: string) => s.replace(/\s+/g, '').toUpperCase();
export function tableHeader(line: SpatialLine, layout: Layout): Table | undefined {
    // Join adjacent label fragments only while validating the full header. Body
    // narration/amount items remain separate and cannot become generic columns.
    const labels = [...line.items];
    for (let n = 0; n < line.items.length; n++) {
        let text = line.items[n].text;
        for (let k = n + 1; k < Math.min(line.items.length, n + 6); k++) {
            const previous = line.items[k - 1], next = line.items[k];
            if (next.x - (previous.x + previous.width) > 10)
                break;
            text += next.text;
            labels.push({ ...line.items[n], text, width: next.x + next.width - line.items[n].x });
        }
    }
    const find = (name: string) => labels.find(i => compact(i.text) === compact(name) || (name === 'Transaction details' && /^TRANSACTION(?:DETAILS)?$/.test(compact(i.text))));
    const date = find(layout.date), description = find(layout.description), debit = find(layout.debit), credit = find(layout.credit), balance = layout.balance ? labels.find(i => compact(i.text).startsWith(compact(layout.balance!))) : undefined;
    if (!date || !description || !debit || !credit || (layout.balance && !balance))
        return;
    const columns = [date, description, debit, credit, ...(balance ? [balance] : [])];
    // Header labels can be centered inside their body columns. Validate a complete
    // evidenced header geometry, then map to its distinct body starts/right edges.
    const geometries = [...(layout.observedHeader ? [layout.observedHeader] : []), { anchors: layout.anchors, bodyStarts: [layout.anchors[0], layout.anchors[1]], accountX: undefined }];
    const geometry = geometries.find(g => { const scale = (description.x - date.x) / (g.anchors[1] - g.anchors[0]); return scale >= 0.8 && scale <= 1.2 && columns.every((c, n) => Math.abs(c.x - (date.x + (g.anchors[n] - g.anchors[0]) * scale)) < 12 * scale); });
    if (!geometry)
        return;
    const expected = geometry.anchors;
    const scale = (description.x - date.x) / (expected[1] - expected[0]);
    const account = labels.filter(i => i.x < date.x).sort((a, b) => a.x - b.x).find(i => /^(帳號|銀行帳號|轉出帳(?:戶|號)|Account(?: No\.?)?)$/i.test(i.text) || (i.x < date.x && i.text.length <= 12 && /轉出/.test(i.text) && /帳號/.test(i.text)));
    const currency = labels.find(i => compact(i.text) === '幣別');
    if (layout.accountColumn && !account)
        return;
    if (layout.currencyColumn && !currency)
        return;
    const reference = labels.find(i => /^支票(?:號碼)?$/.test(i.text) && i.x > description.x);
    return { dateX: date.x + (geometry.bodyStarts[0] - expected[0]) * scale, descriptionX: date.x + (geometry.bodyStarts[1] - expected[0]) * scale, descriptionEnd: reference?.x ?? Math.min(debit.x, credit.x), debitEdge: date.x + (layout.edges[0] - expected[0]) * scale, creditEdge: date.x + (layout.edges[1] - expected[0]) * scale, scale, accountX: geometry.accountX === undefined ? account?.x : date.x + (geometry.accountX - expected[0]) * scale, currencyX: currency?.x, balanceX: balance?.x };
}
export function money(text: string, decimalOnly = false): number | undefined {
    const normalized = text.replace(/^\$\s*/, '');
    const syntax = decimalOnly ? /^(?:\d{1,3}(?:,\d{3})*|\d+)\.\d{2}$/ : /^(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{2})?$/;
    if (!syntax.test(normalized))
        return;
    const value = Number(normalized.replaceAll(',', ''));
    return Number.isFinite(value) && value <= 1e12 ? value : undefined;
}
export function isoDate(text: string, kind: Layout['dateKind']): string | undefined {
    let y: number, m: number, d: number;
    let match: RegExpMatchArray | null;
    if (kind === 'sg') {
        match = text.replaceAll(' ', '').toUpperCase().match(/^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{4})$/);
        if (!match)
            return;
        d = +match[1];
        m = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(match[2]) + 1;
        y = +match[3];
    }
    else {
        match = text.match(kind === 'roc' ? /^(\d{3})\/(\d{2})\/(\d{2})$/ : kind === 'dmy' ? /^(\d{2})\/(\d{2})\/(\d{4})$/ : /^(\d{4})\/(\d{2})\/(\d{2})$/);
        if (!match)
            return;
        if (kind === 'roc' && +match[1] < 1)
            return;
        [y, m, d] = kind === 'dmy' ? [+match[3], +match[2], +match[1]] : [+match[1] + (kind === 'roc' ? 1911 : 0), +match[2], +match[3]];
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    if (y < 1900 || y > 9999 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
        return;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function identifier(text: string): string | undefined { const value = normalizeBankText(text).replace(/[ -]/g, ''); return /^[A-Z0-9*X]{6,40}$/i.test(value) && /\d/.test(value) ? value : undefined; }
export function labeledAccount(text: string): string | undefined { const match = text.match(/(?:帳號|轉出帳戶|帳戶號碼|Account\s*(?:No\.?|Number)|A\/C)\s*[:：#]?\s*([\dA-Z*]+(?:[- ][\d*]+)*)/i); return match ? identifier(match[1]) : undefined; }
export function currencies(text: string): string[] {
    const codes: string[] = [...(text.match(/\b(?:TWD|USD|SGD|JPY|EUR|GBP|AUD|CAD|HKD|CHF|NZD|CNY)\b/g) ?? [])];
    for (const [pattern, code] of [[/新臺幣|新台幣|臺幣|台幣/, 'TWD'], [/新加坡幣|新加坡元/, 'SGD'], [/日圓|日元/, 'JPY'], [/美元|美金/, 'USD']] as const)
        if (pattern.test(text))
            codes.push(code);
    return [...new Set(codes)];
}
