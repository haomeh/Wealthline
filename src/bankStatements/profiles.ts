import type { BankProfile } from './profile';
import { taiwanProfile as hsbcTaiwan, singaporeProfile as hsbcSingapore } from './hsbc';
import { profile as taishin } from './taishin';
import { profile as fubon } from './fubon';
import { profile as esun, ledgerProfile as esunLedger } from './esun';
import { singaporeProfile as dbsSingapore } from './dbs';
import { profile as fubonNano } from './fubonNano';
/**
 * Supported layouts. On a cover that names one bank, the first matching brand is used.
 * To add a bank with a standard table: write its Layout and BankProfile in a new file, add the
 * profile here, add its institution in ../bankStatementAssets.ts, and add synthetic test pages.
 */
export const BANK_PROFILES: readonly BankProfile[] = [hsbcSingapore, hsbcTaiwan, taishin, fubon, esunLedger, esun, dbsSingapore, fubonNano];
