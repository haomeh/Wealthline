import type { Layout } from './common';
import { currencyLabelAbove, type BankProfile } from './profile';
// Rows run to the page bottom and continue on the next page without a header. A long summary wraps around its row. Foreign rows print $0 in the unused amount column.
export const layout: Layout = { observedHeader: { anchors: [154, 207, 297, 356, 509], bodyStarts: [144, 198], accountX: 60 }, bank: 'Taishin', dateKind: 'ymd', date: '日期', description: '摘要', credit: '存入金額', debit: '支出金額', balance: '餘額', anchors: [144, 198, 300, 360, 515], edges: [342, 401], accountColumn: true, bodyBottom: 0, headerlessContinuation: true, zeroAmountBlank: true, splitDescription: true };
// Header label x, body starts and amount right edges measured on statements of each period.
const at = (anchors: number[], bodyStarts: [number, number], accountX: number, edges: [number, number], balance = '帳戶餘額'): Layout => ({ ...layout, balance, anchors, observedHeader: { anchors, bodyStarts, accountX }, edges });
const foreign = (balance: string) => ({ ...at([145, 197, 301, 372, 477], [134, 186], 61, [353, 422], balance), currencyColumn: true });
/** 2021-07 renamed the balance column, 2021-12 and 2022-11 moved the columns. The last two print 幣別 in the foreign table at the same anchors. */
export const variants: readonly Layout[] = [{ ...layout, balance: '帳戶餘額' }, foreign('餘額'), foreign('帳戶餘額'), at([135, 180, 262, 321, 386], [124, 166], 53, [307, 367]), at([135, 185, 272, 331, 396], [124, 166], 53, [317, 377])];
export const profile: BankProfile = {
    layout, variants, brand: /台新(?:銀行|國際)/,
    cover: () => true,
    fingerprint: currencyLabelAbove,
    acceptTable: ({ table, resolved }) => table.currencyX === undefined && resolved !== 'TWD' ? 'unsupported-taishin-currency' : undefined,
};
