// 1 上傳 → 2 預覽 → 3 完成; the third step is the list page's message after importing.
export function ImportSteps({step}: {step:1|2}) {
  return <ol className="import-steps" aria-label="匯入步驟">{['上傳','預覽','完成'].map((name,i)=><li key={name} className={i+1===step?'on':i+1<step?'done':''} aria-current={i+1===step?'step':undefined}>{i+1} {name}{i+1<step?' ✓':''}</li>)}</ol>
}

import type { PreparedStatement } from '../statementKind'

/**
 * Files of one kind the import entry detected, parsed as soon as the import screen opens.
 * `prepared`: what the entry already read from a file while detecting it, used instead of reading it again.
 */
export type QueuedImport = {files:File[];password:string;prepared?:ReadonlyMap<File,PreparedStatement>}
