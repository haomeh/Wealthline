import type { Layout } from './common';
import { currencyLabelAbove, type BankProfile } from './profile';
export const layout: Layout = { observedHeader: { anchors: [120, 178, 265, 388, 511], bodyStarts: [107, 170], accountX: 23 }, bank: 'Fubon', dateKind: 'ymd', date: '日期', description: '摘要', credit: '收入', debit: '支出', balance: '餘額', anchors: [107, 170, 305, 428, 551], edges: [335, 458], decimalOnly: true, accountColumn: true };
export const foreignLayout: Layout = { ...layout, observedHeader: { anchors: [148, 199, 281, 400, 516], bodyStarts: [135, 191], accountX: 23 }, anchors: [135, 191, 319, 438, 551], edges: [349, 468], currencyColumn: true };
export const profile: BankProfile = {
    layout, variants: [foreignLayout], brand: /(?:台北|臺北)?富邦銀行/,
    cover: () => true,
    fingerprint: currencyLabelAbove,
    acceptTable: ({ table, resolved }) => !table.currencyX && resolved !== 'TWD' ? 'unsupported-fubon-currency' : undefined,
};
