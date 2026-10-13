// An in-memory Google Drive with the requests src/google/drive.ts makes: appProperties
// queries, v2 metadata and pinned media reads, conditional media and multipart updates,
// multipart creates, folder creates and v3 renames. Install `fetch` as globalThis.fetch.

import { createHash } from 'node:crypto'

const md5 = (text) => createHash('md5').update(text).digest('hex')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

export function createFakeDrive({ profile } = {}) {
  const files = new Map() // id -> { id, name, appProperties, parents, text, version, trashed, created }
  const log = []
  let nextId = 1
  let created = 0
  let hold = null // (file, init) => boolean: hold this write until release()
  const held = []
  let failures = [] // { match(file|null, init, url), status }

  const etag = (f) => `"v${f.version}"`
  const add = ({ id = `file-${nextId++}`, name, appProperties = {}, parents = [], text = '' }) => {
    const file = { id, name, appProperties, parents, text, version: 1, trashed: false, created: created++ }
    files.set(id, file)
    return file
  }

  function query(q) {
    const conditions = [...q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)].map((m) => [m[1], m[2]])
    return [...files.values()]
      .filter((f) => !f.trashed && conditions.every(([k, v]) => f.appProperties[k] === v))
      .sort((a, b) => a.created - b.created)
  }

  function parseMultipart(body) {
    const boundary = body.slice(2, body.indexOf('\r\n'))
    const sections = body.split(`--${boundary}`).slice(1, -1)
    const content = (s) => s.slice(s.indexOf('\r\n\r\n') + 4, s.lastIndexOf('\r\n'))
    return { metadata: JSON.parse(content(sections[0])), text: content(sections[1]) }
  }

  async function respond(url, init, file) {
    const failure = failures.find((f) => f.match(file, init, url))
    if (failure) {
      failures = failures.filter((f) => f !== failure)
      return new Response('', { status: failure.status })
    }
    return null
  }

  async function fetch(input, init = {}) {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    log.push({ method, url: String(input), headers: init.headers ?? {} })
    if (url.hostname !== 'www.googleapis.com') return null
    const path = url.pathname

    if (method === 'GET' && path === '/drive/v3/files') {
      return json({ files: query(url.searchParams.get('q') ?? '').map((f) => ({ id: f.id, name: f.name, appProperties: f.appProperties, size: String(new TextEncoder().encode(f.text).length), md5Checksum: md5(f.text) })) })
    }
    if (method === 'POST' && path === '/drive/v3/files') {
      const meta = JSON.parse(init.body)
      const f = add({ name: meta.name, appProperties: meta.appProperties, parents: meta.parents })
      return json({ id: f.id })
    }
    let m = path.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (method === 'PATCH' && m) {
      const f = files.get(m[1])
      if (!f) return new Response('', { status: 404 })
      const failed = await respond(url, init, f)
      if (failed) return failed
      f.name = JSON.parse(init.body).name
      return json({ id: f.id })
    }
    m = path.match(/^\/drive\/v2\/files\/([^/]+)$/)
    if (method === 'GET' && m) {
      const f = files.get(m[1])
      if (!f || f.trashed) return new Response('', { status: 404 })
      if (url.searchParams.get('alt') === 'media') {
        if (url.searchParams.get('revisionId') !== `r${f.version}`) return new Response('', { status: 404 })
        return new Response(f.text)
      }
      return json({ id: f.id, etag: etag(f), headRevisionId: `r${f.version}` })
    }
    if (method === 'POST' && path === '/upload/drive/v2/files') {
      const failed = await respond(url, init, null)
      if (failed) return failed
      const { metadata, text } = parseMultipart(init.body)
      const appProperties = Object.fromEntries((metadata.properties ?? []).map((p) => [p.key, p.value]))
      const f = add({ name: metadata.title, appProperties, parents: (metadata.parents ?? []).map((p) => p.id), text })
      return json({ id: f.id, etag: etag(f), md5Checksum: md5(f.text) })
    }
    m = path.match(/^\/upload\/drive\/v2\/files\/([^/]+)$/)
    if (method === 'PUT' && m) {
      const f = files.get(m[1])
      if (!f) return new Response('', { status: 404 })
      const write = async () => {
        const failed = await respond(url, init, f)
        if (failed) return failed
        if (init.headers['If-Match'] !== etag(f)) return new Response('', { status: 412 })
        if (url.searchParams.get('uploadType') === 'multipart') {
          const { metadata, text } = parseMultipart(init.body)
          if (metadata.title !== undefined) f.name = metadata.title
          f.text = text
        } else {
          f.text = init.body
        }
        f.version++
        return json({ id: f.id, etag: etag(f), md5Checksum: md5(f.text) })
      }
      if (hold?.(f, init)) return new Promise((resolve) => held.push({ resolve, write }))
      return write()
    }
    throw new Error(`fake Drive: unexpected ${method} ${url}`)
  }

  const dataFile = () => query("appProperties has { key='weWealth' and value='data' }")[0]
  const parts = () => [...files.values()].filter((f) => !f.trashed && f.appProperties.weWealth === 'part')

  return {
    fetch,
    log,
    files,
    // Puts a main data file with `data` (indented like the app writes it), in a folder with the
    // current names, or the names from before the rename to Wealthline with `{ legacy: true }`.
    seed(data, { legacy = false } = {}) {
      const folder = add({ name: legacy ? 'We Wealth' : 'Wealthline', appProperties: { weWealth: 'folder' } })
      return add({ name: legacy ? 'we-wealth-data.json' : 'wealthline-data.json', appProperties: { weWealth: 'data' }, parents: [folder.id], text: JSON.stringify(data, null, 2) })
    },
    folder: () => query("appProperties has { key='weWealth' and value='folder' }")[0],
    dataFile,
    main: () => JSON.parse(dataFile().text),
    parts,
    part: (name) => parts().find((f) => f.appProperties.part === name),
    // The main file (or `mainText`, a main file being written) with its parts put back, as the app reads it.
    joined(mainText = dataFile().text) {
      const main = JSON.parse(mainText)
      const all = parts().filter((f) => f.appProperties.dataset === main.datasetId).map((f) => JSON.parse(f.text))
      const rows = (key) => all.flatMap((p) => p[key] ?? [])
      const ledger = (key) => (main[key] !== undefined || all.some((p) => p[key]?.length) ? [...(main[key] ?? []), ...rows(key)] : main[key])
      return {
        ...main,
        expenses: ledger('expenses'),
        bankTransactions: ledger('bankTransactions'),
        history: { ...main.history, snapshots: [...rows('snapshots'), ...(main.history?.snapshots ?? [])], changes: [...rows('changes'), ...(main.history?.changes ?? [])], liabilityChanges: [...rows('liabilityChanges'), ...(main.history?.liabilityChanges ?? [])] },
      }
    },
    // Holds media updates for which `match(file, init)` is true until `release`.
    hold(match) { hold = match },
    async release(status = 200) {
      const next = held.shift()
      if (!next) throw new Error('fake Drive: no held write')
      next.resolve(status === 200 ? await next.write() : new Response('', { status }))
    },
    get heldCount() { return held.length },
    // The next request `match(file, init, url)` accepts fails with `status`.
    fail(match, status) { failures.push({ match, status }) },
    profile,
  }
}
