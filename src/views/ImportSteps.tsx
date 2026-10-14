// 1 上傳 → 2 預覽 → 3 完成; the third step is the list page's message after importing.
export function ImportSteps({step}: {step:1|2}) {
  return <ol className="import-steps" aria-label="匯入步驟">{['上傳','預覽','完成'].map((name,i)=><li key={name} className={i+1===step?'on':i+1<step?'done':''} aria-current={i+1===step?'step':undefined}>{i+1} {name}{i+1<step?' ✓':''}</li>)}</ol>
}

// Card and bank statements share one import screen: the kind picks the parser and the page the rows land on.
// A page mounted on its own has no other kind to switch to (no `onSwitch`).
export function ImportKind({kind,disabled,onSwitch}: {kind:'card'|'bank';disabled?:boolean;onSwitch?:()=>void}) {
  if(!onSwitch) return null
  return <div className="import-kind"><span className="muted small">帳單類型</span><div className="segmented" role="group" aria-label="帳單類型">{([['card','信用卡帳單'],['bank','銀行帳單']] as const).map(([k,name])=><button type="button" key={k} className={k===kind?'on':''} aria-pressed={k===kind} disabled={disabled} onClick={k===kind?undefined:onSwitch}>{name}</button>)}</div><span className="muted small">{disabled?'處理中或已有預覽時不能切換類型；要改類型請先取消匯入。':kind==='card'?'只解析信用卡帳單，匯入到信用卡消費。銀行對帳單請改選「銀行帳單」，選錯類型可能解析出錯誤金額。':'只解析銀行對帳單，匯入到銀行流水。信用卡帳單請改選「信用卡帳單」。'}</span></div>
}
