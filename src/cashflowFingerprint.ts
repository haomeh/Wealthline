import { sha256 } from './expenses'

// Canonical JSON for review/report identity. Callers sort semantically unordered arrays.
// Reject values JSON would silently discard or change; never invoke user-provided toJSON.
export async function cashflowFingerprint(value: unknown): Promise<string> {
  const parents = new Set<object>()
  const canonical = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (typeof item !== 'object' || item === null || parents.has(item)) throw new Error('指紋資料必須是有限的 JSON 值')
    parents.add(item)
    let result: string
    if (Array.isArray(item)) {
      result = '[' + Array.from({ length: item.length }, (_, i) => canonical(item[i])).join(',') + ']'
    } else {
      const prototype = Object.getPrototypeOf(item)
      if (prototype !== Object.prototype && prototype !== null) throw new Error('指紋資料必須是 JSON 物件')
      result = '{' + Object.keys(item).sort().map(key => JSON.stringify(key) + ':' + canonical((item as Record<string, unknown>)[key])).join(',') + '}'
    }
    parents.delete(item)
    return result
  }
  return sha256(new TextEncoder().encode(canonical(value)))
}
