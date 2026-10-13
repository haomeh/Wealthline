import { currencies, tableHeader } from './common';
import type { BankProfile, ProfilePage } from './profile';
import { layout as taiwanLayout } from './hsbcTaiwan';
import { layout as singaporeLayout } from './hsbcSingapore';
const brand = /HSBC|匯豐|滙豐/i;
const singaporeCover = /Singapore|新加坡/i, taiwanCover = /Taiwan|台灣|臺灣|匯豐|滙豐/i;
// A cover that names only HSBC: exactly one of the two table layouts decides.
const taiwanTable = (pages: readonly ProfilePage[]) => pages.some(p => p.lines.some(l => tableHeader(l, taiwanLayout)));
const singaporeTable = (pages: readonly ProfilePage[]) => pages.some(p => p.lines.some(l => tableHeader(l, singaporeLayout)) && p.lines.some(l => /SGD.*Savings|Savings.*SGD/i.test(l.text)));
const ambiguousCover = (masthead: string) => /HSBC/i.test(masthead) && /Singapore/i.test(masthead) && /Taiwan/i.test(masthead);
export const singaporeProfile: BankProfile = {
    layout: singaporeLayout, brand, ambiguousCover,
    cover: (masthead, pages) => singaporeCover.test(masthead) || (!taiwanCover.test(masthead) && singaporeTable(pages) && !taiwanTable(pages)),
    fingerprint: ({ nearby, pages }) => pages.some(page => page.lines.some(row => /Savings\s*Account/i.test(row.text) && currencies(row.text).includes('SGD'))) || /Savings/i.test(nearby),
    acceptTable: ({ resolved, before, continuing, summary, contextAccount }) => resolved !== 'SGD' || (!/Savings/i.test(before) && !continuing && !summary.get(contextAccount ?? '')?.has('SGD')) ? 'unsupported-hsbc-sg-account' : undefined,
};
export const taiwanProfile: BankProfile = {
    layout: taiwanLayout, brand,
    cover: (masthead, pages) => !singaporeCover.test(masthead) && (taiwanCover.test(masthead) || (taiwanTable(pages) && !singaporeTable(pages))),
    fingerprint: ({ nearby }) => /活期|綜合外幣存款/.test(nearby),
    acceptTable: ({ resolved, before }) => !['TWD', 'USD', 'JPY', 'SGD'].includes(resolved) || !/活期|存款|Savings|Deposit/i.test(before) ? 'unsupported-hsbc-tw-account' : undefined,
};
