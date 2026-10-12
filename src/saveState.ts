import { dataVersion } from './dataVersion'
import type { WealthData } from './model'

// Only merge metadata produced by this save. All edits made after submission win.
export function finishSave(current: WealthData, submitted: WealthData, persisted: WealthData): WealthData {
  if (current === submitted) return persisted
  const stamps = new Map(persisted.accounts.flatMap((a) => a.positions.map((p) => [p.id, p.addedAt])))
  return {
    ...current,
    version: dataVersion(current, { persistedVersion: persisted.version }),
    liabilities: current.liabilities ?? [],
    updatedAt: persisted.updatedAt,
    history: current.history === submitted.history ? persisted.history :
      (current.history.quantityDays !== submitted.history.quantityDays || current.history.holdingPeriods !== submitted.history.holdingPeriods) &&
      current.history.changes === submitted.history.changes &&
      current.history.snapshots === submitted.history.snapshots &&
      current.history.liabilityChanges === submitted.history.liabilityChanges
        ? { ...persisted.history, quantityDays: current.history.quantityDays, holdingPeriods: current.history.holdingPeriods }
        : current.history,
    accounts: current.accounts.map((a) => ({
      ...a,
      positions: a.positions.map((p) => p.addedAt || !stamps.has(p.id) ? p : { ...p, addedAt: stamps.get(p.id) }),
    })),
  }
}
