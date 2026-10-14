import type { Layout } from './common';
import { currencyLabelAbove, type BankProfile } from './profile';
// Rows run to the page bottom and continue on the next page without a header. A long summary wraps around its row. Foreign rows print $0 in the unused amount column.
export const layout: Layout = { observedHeader: { anchors: [154, 207, 297, 356, 509], bodyStarts: [144, 198], accountX: 60 }, bank: 'Taishin', dateKind: 'ymd', date: '日期', description: '摘要', credit: '存入金額', debit: '支出金額', balance: '餘額', anchors: [144, 198, 300, 360, 515], edges: [342, 401], accountColumn: true, bodyBottom: 0, headerlessContinuation: true, zeroAmountBlank: true, splitDescription: true };
// Header label x, body starts and amount right edges measured on statements of each period.
const at = (anchors: number[], bodyStarts: [number, number], accountX: number, edges: [number, number], balance = '帳戶餘額'): Layout => ({ ...layout, balance, anchors, observedHeader: { anchors, bodyStarts, accountX }, edges, note: '備註' });
const foreign = (balance: string) => ({ ...at([145, 197, 301, 372, 477], [134, 186], 61, [353, 422], balance), currencyColumn: true });
/** 2021-07 renamed the balance column, 2021-12 and 2022-11 moved the columns. The last two print 幣別 in the foreign table at the same anchors. */
export const variants: readonly Layout[] = [{ ...layout, balance: '帳戶餘額' }, foreign('餘額'), foreign('帳戶餘額'), at([135, 180, 262, 321, 386], [124, 166], 53, [307, 367]), at([135, 185, 272, 331, 396], [124, 166], 53, [317, 377])];
export const profile: BankProfile = {
    layout, variants, brand: /台新(?:銀行|國際)/,
    cover: () => true,
    fingerprint: currencyLabelAbove,
    acceptTable: ({ table, resolved }) => table.currencyX === undefined && resolved !== 'TWD' ? 'unsupported-taishin-currency' : undefined,
};
// Visa debit card e-statement: after the card purchases it lists the whole month of the linked TWD account, without an account column.
export const debitLedger: Layout = { bank: 'Taishin', dateKind: 'ymd', date: '日期', description: '摘要', debit: '支出', credit: '存入', balance: '餘額', note: '備註', anchors: [143, 191, 239, 291, 342], observedHeader: { anchors: [143, 191, 239, 291, 342], bodyStarts: [131, 185] }, edges: [268, 323], bodyBottom: 0, zeroAmountBlank: true };
const debitStatement = (pages: readonly { lines: readonly { text: string }[] }[]) => pages.some(p => p.lines.some(l => /金融卡消費\(存款帳號/.test(l.text)));
export const debitLedgerProfile: BankProfile = {
    layout: debitLedger, brand: /台新(?:銀行|國際)/,
    cover: (_, pages) => debitStatement(pages),
    fingerprint: ({ pages }) => debitStatement(pages),
    acceptTable: () => ({ account: 'debit-card-account', currency: 'TWD' }),
};
