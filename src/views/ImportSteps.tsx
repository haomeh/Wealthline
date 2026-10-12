// 1 上傳 → 2 預覽 → 3 完成; the third step is the list page's message after importing.
export function ImportSteps({step}: {step:1|2}) {
  return <ol className="import-steps" aria-label="匯入步驟">{['上傳','預覽','完成'].map((name,i)=><li key={name} className={i+1===step?'on':i+1<step?'done':''} aria-current={i+1===step?'step':undefined}>{i+1} {name}{i+1<step?' ✓':''}</li>)}</ol>
}
