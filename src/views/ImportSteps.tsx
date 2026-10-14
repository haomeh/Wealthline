// 1 上傳 → 2 預覽 → 3 完成; the third step is the list page's message after importing.
export function ImportSteps({step}: {step:1|2}) {
  return <ol className="import-steps" aria-label="匯入步驟">{['上傳','預覽','完成'].map((name,i)=><li key={name} className={i+1===step?'on':i+1<step?'done':''} aria-current={i+1===step?'step':undefined}>{i+1} {name}{i+1<step?' ✓':''}</li>)}</ol>
}

// Card and bank statements share one import entry. 自動判斷 reads each PDF to pick the kind; choosing a kind
// skips detection and opens that kind's screen. A page mounted on its own has no other choice (no `onSelect`).
export type ImportKindChoice = 'auto' | 'card' | 'bank'
const KIND_HINTS: Record<ImportKindChoice, string> = {
  auto: '依每份 PDF 的內容判斷信用卡帳單或銀行帳單，可一起選；無法辨識的檔案會列出，不會自動匯入。',
  card: '只解析信用卡帳單，匯入到信用卡消費。銀行對帳單請改選「銀行帳單」或「自動判斷」，選錯類型可能解析出錯誤金額。',
  bank: '只解析銀行對帳單，匯入到銀行流水。信用卡帳單請改選「信用卡帳單」或「自動判斷」。',
}
export function ImportKind({kind,disabled,onSelect}: {kind:ImportKindChoice;disabled?:boolean;onSelect?:(kind:ImportKindChoice)=>void}) {
  if(!onSelect) return null
  return <div className="import-kind"><span className="muted small">帳單類型</span><div className="segmented" role="group" aria-label="帳單類型">{([['auto','自動判斷'],['card','信用卡帳單'],['bank','銀行帳單']] as const).map(([k,name])=><button type="button" key={k} className={k===kind?'on':''} aria-pressed={k===kind} disabled={disabled} onClick={k===kind?undefined:()=>onSelect(k)}>{name}</button>)}</div><span className="muted small">{disabled&&kind!=='auto'?'處理中或已有預覽時不能切換類型；要改類型請先取消匯入。':KIND_HINTS[kind]}</span></div>
}

/** Files of one kind the import entry detected, parsed as soon as the import screen opens. */
export type QueuedImport = {files:File[];password:string}
