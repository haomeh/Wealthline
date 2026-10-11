// Small asynchronous IndexedDB double; real browser persistence is checked separately.
export function statementKeyStore() {
  const records=new Map()
  return {
    records,
    open(){
      const request={}
      queueMicrotask(()=>{
        request.result={close(){},createObjectStore(){},transaction(){
          const tx={objectStore(){return {
            get(scope){const get={};queueMicrotask(()=>{get.result=records.get(scope);get.onsuccess?.()});return get},
            put(value,scope){records.set(scope,structuredClone(value))},
          }}}
          setTimeout(()=>tx.oncomplete?.(),0)
          return tx
        }}
        request.onsuccess?.()
      })
      return request
    },
  }
}
