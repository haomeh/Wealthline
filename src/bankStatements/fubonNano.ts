import type { Layout } from './common';
import type { BankProfile } from './profile';
// Robo-advisor trust statement: one cash ledger per currency, cents printed without a leading zero.
export const layout: Layout = { bank: 'Fubon Nano', dateKind: 'roc', date: '年/月/日', description: '摘要', debit: '支出', credit: '存入', balance: '結存', anchors: [14, 177, 396, 460, 535], edges: [436, 501], decimalOnly: true };
const firstMonth: Layout = { ...layout, anchors: [14, 153, 355, 444, 532], edges: [408, 496] };
export const profile: BankProfile = {
    layout, variants: [firstMonth], brand: /奈米投/,
    cover: () => true,
    // The currency is the label line directly above the header; the trust has no account number.
    acceptTable: ({ lines, index }) => { const currency = lines[index - 1]?.text.match(/^幣別\s*[:：]\s*([A-Z]{3})$/)?.[1]; return currency ? { account: 'trust', currency } : 'missing-section-currency'; },
};
