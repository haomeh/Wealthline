import { isoDate, money, type BankDraftRow, type BankSection, type BankWarning, type SpatialLine } from './common';
/**
 * Wise "Assets Trade Statement": fund orders, not a cash ledger. A BUY leaves the cash balance, a SELL enters it.
 * Only orders priced in the balance currency are read; a statement with an "Amount settled" column fails closed.
 */
export function parseWiseStatement(pages: readonly { page: number; lines: SpatialLine[] }[]) {
    const first = pages[0]?.lines ?? [];
    if (!first.some(l => /^Wise\b/.test(l.text)) || !first.some(l => l.text === 'Assets Trade Statement'))
        return undefined;
    const warning = (code: string): BankWarning => ({ page: 1, code, count: 1 });
    const unsupported = { status: 'unsupported' as const, bank: 'Wise', sections: [], warnings: [warning('unsupported-activity-layout')], recognizedCount: 0, rejectedCount: 0 };
    const settled = pages.some(p => p.lines.some(l => /settled/i.test(l.text)));
    const rows: BankDraftRow[] = [], warnings: BankWarning[] = [];
    let currency = '';
    for (const p of pages) {
        const end = p.lines.findIndex(l => /^Portfolio Value/.test(l.text));
        p.lines.slice(0, end < 0 ? undefined : end).forEach((l, n) => {
            const order = l.items.findIndex(i => /^(?:BUY|SELL)$/.test(i.text));
            if (order < 0)
                return;
            // The year is printed on the next line, under the day and month.
            const year = p.lines[n + 1]?.items.find(i => Math.abs(i.x - l.items[0].x) < 5 && /^\d{4}$/.test(i.text))?.text;
            const date = isoDate(`${l.items[0].text}${year ?? ''}`, 'sg'), code = l.items.at(-1)!.text, amount = money(l.items.at(-2)?.text ?? '', true);
            const description = l.items.slice(1, order).filter(i => !/^[A-Z]{2}[A-Z0-9]{10}$/.test(i.text)).map(i => i.text).join(' ');
            if (!date || !amount || !/^[A-Z]{3}$/.test(code) || !description || (currency && code !== currency)) {
                warnings.push({ page: p.page, code: 'ambiguous-transaction', count: 1 });
                return;
            }
            currency = code;
            rows.push({ sectionKey: 'section-1', page: p.page, rowKey: `row-${n + 1}`, date, description: `${l.items[order].text} ${description}`, currency, direction: l.items[order].text === 'BUY' ? 'debit' : 'credit', amount });
        });
        // An empty month still names its currency on the portfolio line.
        if (!currency && end >= 0)
            currency = p.lines.slice(end + 1).map(l => l.items.at(-1)?.text ?? '').find(t => /^[A-Z]{3}$/.test(t)) ?? '';
    }
    // Orders settled in another currency are not guessed; without orders that layout is still an empty month.
    if (!currency || settled && rows.length + warnings.length > 0 || !pages.some(p => p.lines.some(l => l.text === 'Transactions')))
        return unsupported;
    const section: BankSection = { key: 'section-1', bank: 'Wise', currency, rows, warnings, noTransactions: !rows.length && !warnings.length, partial: false };
    return { status: warnings.length ? 'partial' as const : 'recognized' as const, bank: 'Wise', sections: [section], warnings: [], recognizedCount: rows.length, rejectedCount: warnings.length };
}
