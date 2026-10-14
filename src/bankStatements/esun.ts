import { tableHeader, type Layout, type SpatialLine } from './common';
import type { BankProfile } from './profile';
export const layout: Layout = { observedHeader: { anchors: [118, 205, 291, 366], bodyStarts: [112, 173], accountX: 35 }, bank: 'E.SUN', dateKind: 'roc', date: '交易日期', description: '摘要', credit: '存款', debit: '提款', anchors: [112, 173, 277, 336], edges: [307, 366], partial: true, accountColumn: true, currencyColumn: true };
export const profile: BankProfile = {
    layout, brand: /玉山銀行|E\.?SUN/i,
    cover: () => true,
    fingerprint: ({ nearby }) => /轉出.*交易明細/.test(nearby),
    acceptTable: ({ before }) => !/轉出.*交易明細/.test(before) ? 'unsupported-esun-table' : undefined,
};
// Monthly statement since 2023: the full ledger of one labelled TWD deposit account.
export const ledgerLayout: Layout = { observedHeader: { anchors: [35, 118, 208, 293, 558], bodyStarts: [35, 86] }, bank: 'E.SUN', dateKind: 'roc', date: '交易日期', description: '摘要', credit: '存款', debit: '提款', balance: '餘額', anchors: [35, 118, 208, 293, 558], edges: [232, 317], decimalOnly: true };
const titled = (lines: readonly SpatialLine[], index: number) => lines.slice(Math.max(0, index - 4), index).some(l => /活存交易明細/.test(l.text));
export const ledgerProfile: BankProfile = {
    layout: ledgerLayout, brand: /玉山銀行|E\.?SUN/i,
    cover: (_, pages) => pages.some(p => p.lines.some((l, index) => tableHeader(l, ledgerLayout) && titled(p.lines, index))),
    fingerprint: ({ lines, index }) => titled(lines, index),
    acceptTable: ({ before, resolved }) => !/活存交易明細/.test(before) || resolved !== 'TWD' ? 'unsupported-esun-table' : undefined,
};
