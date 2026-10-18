import type { WealthData } from './model'

export interface ValuationEntry {
  accountId: string
  account: string
  type: 'cash' | 'holding'
  symbol: string
  currency: string
  quantity: number | null
  price: number | null
  rate: number | null
  priceManual?: boolean
  rateManual?: boolean
  priceUpdatedAt?: string
  rateUpdatedAt?: string
}

// An inventory captured with this exact snapshot, never reconstructed for old dates.
export interface ValuationEvidence {
  version: 1
  baseCurrency: 'TWD'
  at: string
  entries: ValuationEntry[]
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const numberOrUnknown = (v: unknown, positive = false) => finite(v) && (!positive || v > 0) ? v : null
export const valuationKey = (e: Pick<ValuationEntry, 'accountId' | 'type' | 'symbol' | 'currency'>) => JSON.stringify([e.accountId, e.type, e.type === 'cash' ? '' : e.symbol.trim().toUpperCase(), e.currency.trim().toUpperCase()])

export function captureValuation(data: WealthData, at: string): ValuationEvidence {
  return {
    version: 1, baseCurrency: 'TWD', at,
    entries: data.accounts.flatMap(a => a.positions.map(p => {
      const rateManual = data.fxManual.includes(p.currency)
      return {
        accountId: a.id, account: a.name, type: p.type,
        symbol: p.type === 'cash' ? '' : p.symbol.trim().toUpperCase(), currency: p.currency,
        quantity: numberOrUnknown(p.quantity), price: numberOrUnknown(p.price, true),
        rate: numberOrUnknown(p.currency === 'TWD' ? 1 : data.fxRates[p.currency], true),
        ...(p.priceManual && { priceManual: true }), ...(rateManual && { rateManual: true }),
        ...(p.priceUpdatedAt && { priceUpdatedAt: p.priceUpdatedAt }),
        ...(!rateManual && p.currency !== 'TWD' && data.fxUpdatedAt && { rateUpdatedAt: data.fxUpdatedAt }),
      }
    })),
  }
}

// Allowlist optional evidence independently from the legacy aggregate values.
export function parseValuation(raw: unknown, fail: (why: string) => never): ValuationEvidence {
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  if (!obj(raw) || raw.version !== 1 || raw.baseCurrency !== 'TWD' || typeof raw.at !== 'string' || !Array.isArray(raw.entries)) return fail('估值依據格式不正確')
  return {
    version: 1, baseCurrency: 'TWD', at: raw.at,
    entries: raw.entries.map((e): ValuationEntry => {
      if (!obj(e) || typeof e.accountId !== 'string' || !e.accountId || (e.type !== 'cash' && e.type !== 'holding') || typeof e.symbol !== 'string' || typeof e.currency !== 'string' || !e.currency.trim()) return fail('估值項目格式不正確')
      return {
        accountId: e.accountId, account: typeof e.account === 'string' ? e.account : '', type: e.type,
        symbol: e.type === 'cash' ? '' : e.symbol.trim().toUpperCase(), currency: e.currency.trim().toUpperCase(),
        quantity: numberOrUnknown(e.quantity), price: numberOrUnknown(e.price, true), rate: numberOrUnknown(e.rate, true),
        ...(e.priceManual === true && { priceManual: true }), ...(e.rateManual === true && { rateManual: true }),
        ...(typeof e.priceUpdatedAt === 'string' && { priceUpdatedAt: e.priceUpdatedAt }),
        ...(typeof e.rateUpdatedAt === 'string' && { rateUpdatedAt: e.rateUpdatedAt }),
      }
    }),
  }
}
