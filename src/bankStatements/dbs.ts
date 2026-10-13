import { labeledAccount, tableHeader, type Layout, type SpatialLine } from './common';
import type { BankProfile } from './profile';

// Taiwan's supplied summary has no activity evidence. Keep it unsupported.
export const DBS_UNSUPPORTED = 'unsupported-dbs-activity-layout';
export const singaporeLayout: Layout = {
    bank: 'DBS Singapore', dateKind: 'dmy', date: 'Date', description: 'Description',
    debit: 'Withdrawal (-)', credit: 'Deposit (+)', balance: 'Balance',
    anchors: [45, 113, 338, 430, 515], edges: [395, 474],
    decimalOnly: true, wrapped: true, datedRowsOnly: true,
};

/** Full positional table, own-account heading and nearby printed SGD label are all required. */
export function dbsSingaporeContext(lines: readonly SpatialLine[], index: number): { account: string; currency: 'SGD' } | undefined {
    const header = lines[index], table = tableHeader(header, singaporeLayout);
    if (!table) return;
    const headings = lines.slice(0, index).filter(row => row.y - header.y <= 40 * table.scale && row.items.some(i => i.x < table.descriptionX && /^My Account$/i.test(i.text)));
    const accounts = new Set(headings.flatMap(row => row.items.filter(i => i.x > table.debitEdge).map(i => labeledAccount(i.text)).filter((id): id is string => !!id)));
    const labels = lines.slice(index + 1).filter(row => header.y - row.y <= 45 * table.scale && /^CURRENCY:/i.test(row.text) && row.items.some(i => i.x < table.descriptionX && /^CURRENCY\s*:/i.test(i.text)));
    if (accounts.size !== 1 || labels.length !== 1 || !/^CURRENCY:\s*SINGAPORE DOLLAR$/i.test(labels[0].text)) return;
    return { account: [...accounts][0], currency: 'SGD' };
}

/** The cover alone never selects DBS: the parser also needs dbsSingaporeContext evidence. */
export const singaporeProfile: BankProfile = {
    layout: singaporeLayout, brand: /DBS|星展銀行/i,
    acceptTable: ({ lines, index }) => dbsSingaporeContext(lines, index) ?? 'unsupported-dbs-sg-account',
};
