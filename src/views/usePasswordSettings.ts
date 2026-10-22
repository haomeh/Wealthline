import { useLayoutEffect, useMemo, useRef } from 'react'
import { dataVersion } from '../dataVersion'
import type { WealthData } from '../model'
import { mergeStatementPasswords, parseStatementPasswords, type StatementPassword } from '../statementPasswords'

// The save and remove handlers StatementPasswordSettings needs; each reads the latest data and does nothing while busy.
export function usePasswordSettings({ data, busy, onChange }: { data: WealthData; busy: boolean; onChange: (next: WealthData) => void }) {
  const latest = useRef({ data, busy, onChange })
  useLayoutEffect(() => { latest.current = { data, busy, onChange } })
  return useMemo(() => {
    const apply = (next: (current: StatementPassword[]) => StatementPassword[]) => {
      const { data, busy, onChange } = latest.current
      if (!busy) onChange({ ...data, version: dataVersion(data, { minimumVersion: 12 }), statementPasswords: next(data.statementPasswords ?? []) })
    }
    return {
      onSave: (rows: StatementPassword[]) => apply(current => parseStatementPasswords(mergeStatementPasswords(current, rows))),
      onRemove: (id: string) => apply(current => current.filter(p => p.id !== id)),
      onRemoveAll: () => apply(() => []),
    }
  }, [])
}
