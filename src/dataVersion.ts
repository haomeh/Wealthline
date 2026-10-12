// Structural inputs only: this helper must not depend on model/history at runtime.
// 15: the Drive data file is split into a main file and part files (dataParts.ts).
export type DataVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15
export interface VersionedData {
  version: DataVersion
  bankStatementBalances?: unknown
  bankTransactionAccounts?: unknown
  bankTransactions?: unknown
  bankCategoryRules?: unknown
  statementPasswords?: unknown
  expenseCategoryRules?: unknown
  expenses?: unknown
  history?: { holdingPeriods?: unknown; quantityDays?: unknown }
  liabilities?: readonly { schedule?: unknown; basisHistory?: unknown }[]
}
export interface DataVersionOptions {
  minimumVersion?: DataVersion
  persistedVersion?: DataVersion
  // Loading historically promotes only card/password fields, not historical features.
  legacyHistory?: boolean
}
export function dataVersion(data: VersionedData, options: DataVersionOptions = {}): DataVersion {
  let version = Math.max(data.version, options.minimumVersion ?? 1, options.persistedVersion ?? 1)
  if (data.bankTransactionAccounts !== undefined || data.bankTransactions !== undefined || data.bankCategoryRules !== undefined) version = Math.max(version, 13)
  if (data.bankStatementBalances !== undefined) version = Math.max(version, 14)
  if (data.statementPasswords !== undefined) version = Math.max(version, 12)
  if (data.expenseCategoryRules !== undefined) version = Math.max(version, 11)
  if (data.expenses !== undefined) version = Math.max(version, 10)
  if (options.legacyHistory !== false) {
    if (data.history?.holdingPeriods !== undefined) version = Math.max(version, 5)
    if (data.liabilities?.some(d => d.schedule || d.basisHistory)) version = Math.max(version, 4)
    if (data.history?.quantityDays !== undefined) version = Math.max(version, 3)
  }
  return version as DataVersion
}
