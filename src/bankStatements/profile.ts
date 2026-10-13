import type { Layout, SpatialLine, Table } from './common';
export interface ProfilePage {
    lines: SpatialLine[];
}
export interface FingerprintContext {
    /** Text of up to four lines just above the header, within 40pt. */
    nearby: string;
    lines: readonly SpatialLine[];
    /** Index of the matched header line in `lines`. */
    index: number;
    pages: readonly ProfilePage[];
}
export interface TableContext {
    lines: readonly SpatialLine[];
    index: number;
    table: Table;
    /** Section label text before the header. */
    before: string;
    /** Section currency from the label or a proven continuation; empty when unknown. */
    resolved: string;
    continuing: boolean;
    contextAccount?: string;
    /** Account summary: account identifier to the currencies it lists. */
    summary: ReadonlyMap<string, ReadonlySet<string>>;
}
/**
 * One supported statement layout. The parser tries the profiles in BANK_PROFILES; bank-specific
 * detection and table rules live here, not in the parser.
 */
export interface BankProfile {
    layout: Layout;
    /** Other header geometries of the same table, tried after `layout`. */
    variants?: readonly Layout[];
    /** Bank name on the cover. Profiles of one bank use the same pattern and flags. Two banks named on one cover fail closed. */
    brand: RegExp;
    /** For a cover that names this bank: does it select this layout? Without it, the cover never selects this profile. */
    cover?(masthead: string, pages: readonly ProfilePage[]): boolean;
    /** True when the cover is ambiguous for this bank, for example it names two regions. */
    ambiguousCover?(masthead: string): boolean;
    /** For a cover with only a logo: does the text near a matched header prove this layout? Without it, no fingerprint detection. */
    fingerprint?(context: FingerprintContext): boolean;
    /** A warning code skips the table as unsupported. An object replaces the section account and currency. Undefined accepts the table. */
    acceptTable?(context: TableContext): string | { account: string; currency: string } | undefined;
}
/** Section currency label at the left, on one of the four lines above the header. */
export function currencyLabelAbove({ lines, index }: FingerprintContext): boolean {
    const header = lines[index];
    return lines.slice(Math.max(0, index - 4), index).some(r => r.y - header.y < 40 && r.items.some(i => i.x < 110 && /^(?:新臺幣|新台幣|臺幣|台幣|TWD|外幣).{0,10}$/.test(i.text)));
}
