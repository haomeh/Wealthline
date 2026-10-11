export interface StatementPassword { id:string; label:string; keyId:string; iv:string; ciphertext:string }
export interface DeviceKey { id:string; key:CryptoKey }
const error = () => new Error('無法使用此瀏覽器的帳單密碼儲存。請重新設定，或在匯入時手動輸入。')

export function parseStatementPasswords(raw:unknown):StatementPassword[] {
  if(!Array.isArray(raw) || raw.length>20) throw new Error('帳單密碼設定最多 20 組')
  const rows = raw.map((item:unknown)=>{
    const p = item as StatementPassword
    if(!p || typeof p.id!=='string' || !/^[a-zA-Z0-9-]{1,64}$/.test(p.id) || typeof p.keyId!=='string' || !/^[a-zA-Z0-9-]{1,64}$/.test(p.keyId) || typeof p.label!=='string' || !p.label.trim() || p.label.length>100 || typeof p.iv!=='string' || !/^[A-Za-z0-9+/]{16}$/.test(p.iv) || typeof p.ciphertext!=='string' || p.ciphertext.length>1400 || !/^[A-Za-z0-9+/]+={0,2}$/.test(p.ciphertext) || p.ciphertext.length%4!==0 || atob(p.ciphertext).length<17) throw new Error('帳單密碼設定格式不正確')
    return {id:p.id,label:p.label.trim(),keyId:p.keyId,iv:p.iv,ciphertext:p.ciphertext}
  })
  if(new Set(rows.map(p=>p.id)).size!==rows.length) throw new Error('帳單密碼設定識別碼重複')
  return rows
}
const encode = (bytes:Uint8Array) => btoa(String.fromCharCode(...bytes))
const decode = (value:string) => Uint8Array.from(atob(value),c=>c.charCodeAt(0))
const aad = (scope:string,id:string) => new TextEncoder().encode(JSON.stringify(['wealthline-statement-password-v1',scope,id]))

export async function sealStatementPassword(scope:string,id:string,label:string,password:string,device:DeviceKey):Promise<StatementPassword> {
  if(!scope || !password.length || password.length>256) throw new Error('請填寫帳單密碼（最多 256 字）')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(scope,id)},device.key,new TextEncoder().encode(password))
  return parseStatementPasswords([{id,label,keyId:device.id,iv:encode(iv),ciphertext:encode(new Uint8Array(ciphertext))}])[0]
}

export async function openStatementPassword(scope:string,p:StatementPassword,device:DeviceKey):Promise<string> {
  if(device.id!==p.keyId) throw error()
  try {
    return new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(p.iv),additionalData:aad(scope,p.id)},device.key,decode(p.ciphertext)))
  } catch { throw error() }
}

// The key is never exported: Drive/backups contain only ciphertext.
async function deviceKey(scope:string,create=false):Promise<DeviceKey|null> {
  if(!scope || !globalThis.indexedDB || !crypto.subtle) throw error()
  const db = await new Promise<IDBDatabase>((resolve,reject)=>{
    const request = indexedDB.open('wealthline-statement-keys',1)
    let blocked = false
    request.onupgradeneeded = ()=>request.result.createObjectStore('keys')
    request.onerror = ()=>reject(error())
    request.onblocked = ()=>{blocked=true;reject(error())}
    request.onsuccess = ()=>{if(blocked)request.result.close();else resolve(request.result)}
  })
  db.onversionchange = ()=>db.close()
  const read = (candidate?:DeviceKey) => new Promise<DeviceKey|null>((resolve,reject)=>{
    const tx = db.transaction('keys',candidate?'readwrite':'readonly')
    const store = tx.objectStore('keys')
    const request = store.get(scope)
    let value:DeviceKey|null = null
    request.onsuccess = ()=>{
      value = request.result ?? candidate ?? null
      if(candidate && !request.result) store.put(candidate,scope)
    }
    tx.oncomplete = ()=>resolve(value)
    tx.onerror = tx.onabort = ()=>reject(error())
  })
  try {
    const existing = await read()
    if(existing || !create) return existing
    const key = await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])
    // A second tab may have created its key while generateKey was pending.
    return await read({id:crypto.randomUUID(),key})
  } finally {db.close()}
}

export async function saveStatementPassword(scope:string,label:string,password:string,id:string=crypto.randomUUID()) {
  try {return await sealStatementPassword(scope,id,label,password,(await deviceKey(scope,true))!)}
  catch {throw new Error('密碼設定未保存。請確認名稱、密碼與瀏覽器儲存權限，或改用手動輸入。')}
}

export async function statementPasswordStatus(scope:string,passwords:StatementPassword[]) {
  try {
    const device = await deviceKey(scope)
    return passwords.filter(p=>p.keyId===device?.id).map(p=>p.id)
  } catch {return []}
}

export async function unlockStatementPasswords(scope:string,passwords:StatementPassword[]) {
  const values:string[] = []
  let unavailable = 0
  if(!passwords.length) return {values,unavailable}
  let device:DeviceKey|null = null
  try {device=await deviceKey(scope)} catch { /* Manual entry remains available. */ }
  for(const p of passwords) {
    try {if(!device)throw error();values.push(await openStatementPassword(scope,p,device))}
    catch {unavailable++}
  }
  return {values,unavailable}
}
