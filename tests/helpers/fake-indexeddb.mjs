// A minimal in-memory IndexedDB: the parts src/localStore.ts uses (open with an upgrade,
// one object store, get/put/delete in a transaction). Events fire asynchronously, like a browser's.
// All connections share the same content, so a test can play another tab through `set`.

const later = (fn) => setTimeout(fn, 0)

export function createFakeIndexedDB() {
  const databases = new Map() // name -> { version, stores: Map<storeName, Map> }
  let writeError = null

  function connection(db) {
    return {
      objectStoreNames: { contains: (name) => db.stores.has(name) },
      createObjectStore(name) { db.stores.set(name, new Map()) },
      close() {},
      onversionchange: null,
      transaction(name, mode = 'readonly') {
        const data = db.stores.get(name)
        if (!data) throw new Error(`no object store ${name}`)
        const jobs = []
        const tx = { error: null, oncomplete: null, onerror: null, onabort: null }
        const op = (apply) => {
          const r = { result: undefined, error: null, onsuccess: null, onerror: null }
          jobs.push({ r, apply })
          return r
        }
        const write = (apply) => op(() => {
          if (mode !== 'readwrite') throw new Error('read-only transaction')
          if (writeError) { const e = writeError; writeError = null; throw e }
          return apply()
        })
        tx.objectStore = () => ({
          get: (key) => op(() => data.get(key)),
          put: (value, key) => write(() => { data.set(key, value); return key }),
          delete: (key) => write(() => { data.delete(key) }),
        })
        later(() => {
          // A failed request aborts the transaction: undo what it wrote.
          const before = new Map(data)
          for (const { r, apply } of jobs) {
            try {
              r.result = apply()
              r.onsuccess?.()
            } catch (e) {
              r.error = e
              r.onerror?.()
              tx.error = e
              data.clear()
              for (const [k, v] of before) data.set(k, v)
              break
            }
          }
          later(() => {
            if (tx.error) { tx.onerror?.(); tx.onabort?.() } else tx.oncomplete?.()
          })
        })
        return tx
      },
    }
  }

  const indexedDB = {
    open(name, version = 1) {
      const r = { result: undefined, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
      later(() => {
        let db = databases.get(name)
        const upgrading = !db || db.version < version
        if (!db) { db = { version, stores: new Map() }; databases.set(name, db) }
        r.result = connection(db)
        if (upgrading) { db.version = version; r.onupgradeneeded?.() }
        r.onsuccess?.()
      })
      return r
    },
  }

  return {
    indexedDB,
    // The value under `key` in object store `store` of database `name`, or undefined.
    get: (name, store, key) => databases.get(name)?.stores.get(store)?.get(key),
    set(name, store, key, value) {
      if (!databases.has(name)) databases.set(name, { version: 1, stores: new Map() })
      const stores = databases.get(name).stores
      if (!stores.has(store)) stores.set(store, new Map())
      stores.get(store).set(key, value)
    },
    // Empties every store but keeps the databases, so open connections stay valid.
    reset() { for (const db of databases.values()) for (const store of db.stores.values()) store.clear() },
    // The next write fails with `error`, as a full disk would.
    failNextWrite(error) { writeError = error },
  }
}
