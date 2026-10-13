import type { Layout } from './common';
import type { BankProfile } from './profile';
export const layout: Layout = { observedHeader: { anchors: [118, 205, 291, 366], bodyStarts: [112, 173], accountX: 35 }, bank: 'E.SUN', dateKind: 'roc', date: '交易日期', description: '摘要', credit: '存款', debit: '提款', anchors: [112, 173, 277, 336], edges: [307, 366], partial: true, accountColumn: true, currencyColumn: true };
export const profile: BankProfile = {
    layout, brand: /玉山銀行|E\.?SUN/i,
    cover: () => true,
    fingerprint: ({ nearby }) => /轉出.*交易明細/.test(nearby),
    acceptTable: ({ before }) => !/轉出.*交易明細/.test(before) ? 'unsupported-esun-table' : undefined,
};
