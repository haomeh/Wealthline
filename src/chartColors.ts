import type { Slice } from './model'

// Eight categorical slots (CSS vars --s1..--s8), assigned in a fixed entity order so a category keeps
// its color no matter its rank. Only the entities present take a slot: a user's own category name is not
// pushed out by preset ones that hold nothing. Past the eighth present entity, the rest fold into 其餘.
const SLOTS = 8

export interface ColoredSlice extends Slice {
  color: string
}

export function colorize(slices: Slice[], order: string[]): ColoredSlice[] {
  const present = new Set(slices.map((s) => s.label))
  const known = order.filter((label) => present.has(label))
  for (const s of slices) if (!known.includes(s.label) && s.label !== '未設定') known.push(s.label)
  const colored: ColoredSlice[] = []
  const other: ColoredSlice = { label: '其餘', value: 0, share: 0, color: 'var(--other)' }
  let unset: ColoredSlice | null = null
  for (const s of slices) {
    const i = known.indexOf(s.label)
    if (s.label === '未設定') unset = { ...s, color: 'var(--unset)' }
    else if (i < SLOTS) colored.push({ ...s, color: `var(--s${i + 1})` })
    else {
      other.value += s.value
      other.share += s.share
    }
  }
  if (other.value) colored.push(other)
  if (unset) colored.push(unset)
  return colored
}
