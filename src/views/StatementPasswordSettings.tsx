import { useEffect, useRef, useState } from 'react'
import { saveStatementPassword, statementPasswordStatus, type StatementPassword } from '../statementPasswords'

export function StatementPasswordSettings({scope,passwords,busy,onSave,onRemove,onClose}: {scope:string;passwords:StatementPassword[];busy:boolean;onSave:(p:StatementPassword)=>void;onRemove:(id:string)=>void;onClose:()=>void}) {
  const ref = useRef<HTMLDialogElement>(null)
  const active = useRef(true)
  const save = useRef(onSave)
  useEffect(()=>{save.current=onSave},[onSave])
  const [available,setAvailable] = useState<string[]>([])
  const [id,setId] = useState<string|undefined>()
  const [label,setLabel] = useState('')
  const [password,setPassword] = useState('')
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const locked = busy || saving
  useEffect(()=>{active.current=true;ref.current?.showModal();return()=>{active.current=false}},[])
  useEffect(()=>{let cancelled=false;void statementPasswordStatus(scope,passwords).then(ids=>{if(!cancelled)setAvailable(ids)});return()=>{cancelled=true}},[scope,passwords])
  return <dialog ref={ref} className="review statement-password-dialog" aria-label="帳單密碼設定" onCancel={e=>{e.preventDefault();if(!locked)onClose()}}>
    <div className="panel-head"><h3>帳單密碼設定</h3><button disabled={locked} onClick={onClose}>關閉</button></div>
    <p className="muted small">密碼加密後隨個人資料保存，解密金鑰只留在此瀏覽器。新裝置或清除網站資料後，請重新設定。修改後需按「儲存變更」。</p>
    {!!passwords.length && <ul className="statement-password-list">{passwords.map(p=><li key={p.id}><div><strong>{p.label}</strong><small className="muted">{available.includes(p.id)?'已設定 · 此瀏覽器可用':'需在此瀏覽器重新設定'}</small></div><div className="row"><button disabled={locked} onClick={()=>{setId(p.id);setLabel(p.label);setPassword('');setError('')}} aria-label={`重新設定 ${p.label} 密碼`}>重新設定</button><button disabled={locked} onClick={()=>{onRemove(p.id);if(id===p.id){setId(undefined);setLabel('');setPassword('')}}} aria-label={`移除 ${p.label} 密碼`}>移除</button></div></li>)}</ul>}
    <form className="form" onSubmit={async e=>{
      e.preventDefault();if(locked)return
      setError('');setSaving(true)
      const secret=password;setPassword('')
      try {
        const result=await saveStatementPassword(scope,label,secret,id)
        if(active.current){save.current(result);setId(undefined);setLabel('')}
      } catch {if(active.current)setError('密碼設定未保存。請確認名稱、密碼與瀏覽器儲存權限，或改用手動輸入。')}
      finally {if(active.current)setSaving(false)}
    }}>
      <h4>{id?'重新設定密碼':'新增密碼'}</h4>
      <fieldset disabled={locked || (!id && passwords.length>=20)} className="expense-fields">
        <label className="field"><span>密碼設定名稱</span><input required maxLength={100} value={label} placeholder="例如：匯豐 (SG)" onChange={e=>setLabel(e.target.value)}/></label>
        <label className="field"><span>帳單 PDF 密碼</span><input type="password" autoComplete="new-password" required maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      </fieldset>
      {error && <p role="alert" className="banner error">{error}</p>}
      <div className="row"><button className="primary" disabled={locked || (!id && passwords.length>=20)}>{saving?'正在加密…':id?'更新密碼設定':'新增密碼設定'}</button>{id && <button type="button" disabled={locked} onClick={()=>{setId(undefined);setLabel('');setPassword('');setError('')}}>取消修改</button>}</div>
      <p className="muted small">最多 20 組；每組只填一個密碼，逗號會視為密碼的一部分。匯入時會自動嘗試已設定的密碼。</p>
    </form>
  </dialog>
}
