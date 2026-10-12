/** Transient parser evidence only. Never persist this object with ledger records. */
export interface BankTextPrivacyContext {
  accountIdentifiers?: readonly string[]
  identityIdentifiers?: readonly string[]
}
export const BANK_ACCOUNT_MASK = '[帳號已遮蔽]'
export const BANK_IDENTITY_MASK = '[識別碼已遮蔽]'

/** Fixed normalization precedes masking and signatures. Arbitrary free text is NOT anonymized. */
export function normalizeBankText(text: string): string {
  return text.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, ' ').trim()
}
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function protectBankText(text: string, context: BankTextPrivacyContext = {}): string {
  let value = normalizeBankText(text)
  // Contextual labels deliberately do not include order/reference/invoice numbers.
  // Account tokens need at least six digits: short labels (帳戶1 / 帳戶2.0)
  // are not identifiers. Bare A/C matches the parser's labeledAccount grammar.
  // This is not general free-text anonymization; explicitly
  // recognized identifiers below still use the transient parser evidence.
  const token = '([A-Z]{0,3}[0-9][A-Z0-9]*(?:[ -][0-9]+)*)'
  const account = new RegExp('(帳號|帳戶(?:號碼)?|賬號|账户(?:号码)?|收款帳戶|轉出帳戶|ACCOUNT\\s*(?:NUMBER|NO\\.?|#)|A/C(?:\\s*(?:NO\\.?|NUMBER))?)([ :：#-]*)' + token, 'gi')
  const identity = new RegExp('(身分證(?:字號|號)?|身份證(?:字號|號)?|客戶識別碼|客戶編號|CUSTOMER\\s*(?:ID|NUMBER)|IDENTITY\\s*(?:ID|NUMBER)|NATIONAL\\s*ID|PASSPORT\\s*(?:NO\\.?|NUMBER))([ :：#-]*)' + token, 'gi')
  value = value.replace(account, (match, label: string, separator: string, identifier: string) =>
    (identifier.match(/[0-9]/g)?.length ?? 0) >= 6 ? label + separator + BANK_ACCOUNT_MASK : match)
    .replace(identity, (_match, label: string, separator: string) => label + separator + BANK_IDENTITY_MASK)
  for (const [identifiers, marker] of [[context.accountIdentifiers, BANK_ACCOUNT_MASK], [context.identityIdentifiers, BANK_IDENTITY_MASK]] as const) {
    // Longest first avoids a shorter known identifier consuming part of a longer one.
    const known = [...new Set((identifiers ?? []).map(id => normalizeBankText(id).replace(/[ -]/g, '')))].sort((a,b) => b.length-a.length)
    for (const id of known) {
      if (!/^[A-Z0-9]{6,40}$/i.test(id)) throw new Error('銀行識別碼遮蔽設定無效')
      const pattern = new RegExp('(?<![A-Z0-9])' + [...id].map(escapePattern).join('[ -]*') + '(?![A-Z0-9])', 'gi')
      value = value.replace(pattern, marker)
    }
  }
  return value
}
