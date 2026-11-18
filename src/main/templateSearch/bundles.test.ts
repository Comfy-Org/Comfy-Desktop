import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateSearchAvailability } from '../../types/ipc'
import {
  chooseEntry,
  createBundleStore,
  isBundlePath,
  parseIndex,
  parseManifest,
  Unreachable,
  type BundleDownload,
  type BundleStoreDeps,
  type IndexEntry,
  type Supported
} from './bundles'

const BASE = 'https://bundles.example.test/search/'
const SUPPORTED: Supported = { sidecar: '0.1.0', major: 1, minMinor: 0 }

const sha = (data: string | Buffer): string =>
  crypto.createHash('sha256').update(data).digest('hex')

interface Published {
  small: Map<string, Buffer>
  blobs: Map<string, Buffer>
  index: { bundles: Record<string, unknown>[] }
}

function publish(
  server: Published,
  version: string,
  files: Record<string, string>,
  extra: { min_sidecar?: string; yanked?: boolean } = {}
) {
  const listed = Object.entries(files).map(([p, content]) => {
    server.blobs.set(sha(content), Buffer.from(content))
    return { path: p, size: Buffer.byteLength(content), sha256: sha(content) }
  })
  const manifest = Buffer.from(
    JSON.stringify({ version, min_sidecar: extra.min_sidecar ?? null, files: listed })
  )
  server.small.set(`${BASE}manifests/${version}.json`, manifest)
  server.index.bundles.push({
    version,
    manifest: `manifests/${version}.json`,
    manifest_sha256: sha(manifest),
    size: listed.reduce((sum, f) => sum + f.size, 0),
    ...extra
  })
  server.small.set(`${BASE}index.json`, Buffer.from(JSON.stringify(server.index)))
}

let root: string
let server: Published
let announced: TemplateSearchAvailability[]

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-bundles-'))
  server = { small: new Map(), blobs: new Map(), index: { bundles: [] } }
  announced = []
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function store(over: Partial<BundleStoreDeps> = {}) {
  const transfer = vi.fn<BundleStoreDeps['transfer']>(async (file) => {
    const blob = server.blobs.get(file.url.slice(`${BASE}files/`.length))
    if (!blob || sha(blob) !== file.sha256) return { ok: false, error: 'checksum-mismatch' }
    fs.mkdirSync(path.dirname(file.finalPath), { recursive: true })
    fs.writeFileSync(file.finalPath, blob)
    file.onProgress(blob.length)
    return { ok: true }
  })
  const getSmall = vi.fn<BundleStoreDeps['getSmall']>(async (url) => {
    const body = server.small.get(url)
    if (!body) throw new Error(`${url} answered 404`)
    return body
  })
  const deps: BundleStoreDeps = {
    root,
    base: () => BASE,
    getSmall,
    transfer,
    supports: async () => SUPPORTED,
    check: async () => true,
    onAvailability: (a) => announced.push(a),
    ...over
  }
  return { store: createBundleStore(deps), transfer, getSmall }
}

const V1 = {
  NOTICE: 'notice text\n',
  'encoder/model.safetensors': 'weights-v1',
  'router/catalog.json': '{"v":1}'
}
const V1_BYTES = Object.values(V1).reduce((sum, text) => sum + Buffer.byteLength(text), 0)

const A_DAY_LATER = 24 * 60 * 60_000 + 1

function holdTransfers(transfer: ReturnType<typeof store>['transfer']): () => void {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const realTransfer = transfer.getMockImplementation()!
  transfer.mockImplementation(async (file) => {
    await held
    return realTransfer(file)
  })
  return release
}

function entriesIn(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : []
}

describe('bundle store', () => {
  it('starts the download by itself when no bundle is on disk, and is ready once it lands', async () => {
    publish(server, '1.0.0', V1)
    const { store: s, transfer } = store({ now: () => 0 })
    const release = holdTransfers(transfer)
    expect(await s.prepare()).toEqual({ kind: 'downloading', received: 0, total: 0 })
    await vi.waitFor(() => expect(transfer).toHaveBeenCalled(), { timeout: 5000 })
    release()
    await s.download()
    expect(announced.at(-1)).toEqual({ kind: 'idle' })
    expect(transfer).toHaveBeenCalledTimes(3)
    expect(await s.prepare()).toEqual({ kind: 'ready' })
  })

  it('is off when no base address is set and nothing is on disk', async () => {
    const { store: s } = store({ base: () => null })
    expect(await s.prepare()).toEqual({ kind: 'off' })
  })

  it('says it is offline, and starts nothing, when the bundle address cannot be reached', async () => {
    const { store: s, transfer } = store({
      getSmall: async () => {
        throw new Unreachable('connection refused')
      }
    })
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'offline' })
    expect(await s.prepare(), 'nothing started on the first try').toEqual({
      kind: 'unavailable',
      reason: 'offline'
    })
    expect(transfer).not.toHaveBeenCalled()
    expect(announced).toEqual([])
  })

  it('asks for a newer Desktop, without downloading, when no listed version is readable', async () => {
    publish(server, '1.0.0', V1, { min_sidecar: '9.0.0' })
    const { store: s, transfer } = store()
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'update_desktop' })
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'update_desktop' })
    expect(transfer).not.toHaveBeenCalled()
    expect(announced).toEqual([])
  })

  it('asks for a newer Desktop, without downloading, when the manifest itself says it is too new', async () => {
    publish(server, '1.0.0', V1, { min_sidecar: '9.0.0' })
    delete server.index.bundles[0]!.min_sidecar
    server.small.set(`${BASE}index.json`, Buffer.from(JSON.stringify(server.index)))
    const { store: s, transfer } = store()
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'update_desktop' })
    await s.download()
    expect(transfer).not.toHaveBeenCalled()
    expect(await s.newest()).toBeNull()
  })

  it.each([
    ['answers without an index', () => {}],
    [
      'lists a manifest that is not the one it serves',
      () => {
        publish(server, '1.0.0', V1)
        server.small.set(`${BASE}manifests/1.0.0.json`, Buffer.from('{"version":"1.0.0"}'))
      }
    ],
    [
      'lists a version whose manifest names another one',
      () => {
        publish(server, '1.0.0', V1)
        const other = Buffer.from(
          JSON.stringify({ version: '1.1.0', min_sidecar: '9.0.0', files: [] })
        )
        server.small.set(`${BASE}manifests/1.0.0.json`, other)
        server.index.bundles[0]!.manifest_sha256 = sha(other)
        server.small.set(`${BASE}index.json`, Buffer.from(JSON.stringify(server.index)))
      }
    ]
  ])(
    'says the download did not finish, and waits for Try again, when the server %s',
    async (_case, given) => {
      given()
      const { store: s, transfer, getSmall } = store()
      expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'download_failed' })
      const fetched = getSmall.mock.calls.length
      expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'download_failed' })
      await s.download({ quietly: true })
      expect(getSmall, 'nothing is fetched again until Try again').toHaveBeenCalledTimes(fetched)
      expect(transfer).not.toHaveBeenCalled()
    }
  )

  it('stays ready when an update check finds no version it reads', async () => {
    publish(server, '1.0.0', V1)
    const { store: s } = store({ now: () => 0 })
    await s.download()
    server.index.bundles = []
    publish(server, '2.0.0', V1, { min_sidecar: '9.0.0' })
    await s.download()
    expect(announced.at(-1)).toEqual({ kind: 'idle' })
    expect(await s.prepare()).toEqual({ kind: 'ready' })
  })

  it('keeps a quiet download that fails quiet, and lets the next search download', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const { store: s } = store({ now: () => 0 })
    await s.download({ quietly: true })
    expect(announced).toEqual([])
    expect(await s.prepare()).toMatchObject({ kind: 'downloading' })
    await s.download()
  })

  it('says a quiet check that finds nothing new is done, without fetching any file', async () => {
    publish(server, '1.0.0', V1)
    const check = vi.fn(async () => true)
    const { store: s, transfer } = store({ now: () => 0, check })
    await s.download()
    transfer.mockClear()
    check.mockClear()
    announced = []
    await s.download({ quietly: true })
    expect(transfer).not.toHaveBeenCalled()
    expect(check, 'the bundle on disk is not assembled again').not.toHaveBeenCalled()
    expect(announced).toEqual([{ kind: 'idle' }])
  })

  it('says when a quiet download lands, without showing its progress', async () => {
    publish(server, '1.0.0', V1)
    const { store: s } = store({ now: () => 0 })
    await s.download({ quietly: true })
    expect(announced).toEqual([{ kind: 'idle' }])
  })

  it('waits for Try again after a quiet download that a search was waiting on failed', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const { store: s, transfer } = store({ now: () => 0 })
    const release = holdTransfers(transfer)
    const running = s.download({ quietly: true })
    await vi.waitFor(() => expect(transfer).toHaveBeenCalled(), { timeout: 5000 })
    expect(await s.prepare()).toMatchObject({ kind: 'downloading' })
    release()
    await running
    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'download_failed' })
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'download_failed' })
  })

  it('keeps a quiet download from retrying while a failure waits for Try again', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const { store: s, transfer } = store({ now: () => 0 })
    await s.prepare()
    await s.download()
    const tries = transfer.mock.calls.length
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-v1'))
    await s.download({ quietly: true })
    expect(transfer).toHaveBeenCalledTimes(tries)
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'download_failed' })
  })

  it('gives the real reason after Try again, not the old failure', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const { store: s } = store({ now: () => 0 })
    await s.prepare()
    await s.download()
    server.index.bundles = []
    publish(server, '2.0.0', V1, { min_sidecar: '9.0.0' })
    await s.download()
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'update_desktop' })
  })

  it('waits for Try again after a download the user saw failed, instead of downloading on every search', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const { store: s, transfer } = store({ now: () => 0 })
    await s.prepare()
    await s.download()
    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'download_failed' })
    const tries = transfer.mock.calls.length
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'download_failed' })
    expect(transfer).toHaveBeenCalledTimes(tries)

    server.blobs.set(sha('weights-v1'), Buffer.from('weights-v1'))
    await s.download()
    expect(await s.prepare()).toEqual({ kind: 'ready' })
  })

  it('waits for Try again after the search program rejected the bundle on disk', async () => {
    publish(server, '1.0.0', V1)
    const { store: s, transfer } = store({ now: () => 0 })
    await s.download()
    await s.discard('1.0.0')
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'download_failed' })
    expect(transfer).toHaveBeenCalledTimes(3)

    await s.download()
    expect(await s.prepare()).toEqual({ kind: 'ready' })
  })

  it('downloads, puts the bundle together under its version, and is then ready', async () => {
    publish(server, '1.0.0', V1)
    const { store: s } = store({ now: () => 0 })
    await s.download()

    const dir = path.join(root, 'bundles', '1.0.0')
    expect(fs.readFileSync(path.join(dir, 'encoder', 'model.safetensors'), 'utf8')).toBe(
      'weights-v1'
    )
    expect(
      parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')))?.version
    ).toBe('1.0.0')
    expect(await s.newest()).toEqual({ dir, version: '1.0.0' })
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    expect(announced[0]).toEqual({ kind: 'downloading', received: 0, total: V1_BYTES })
    expect(announced.at(-1)).toEqual({ kind: 'idle' })
  })

  it('downloads only the files a newer version changed', async () => {
    publish(server, '1.0.0', V1)
    const { store: s, transfer } = store({ now: () => 0 })
    await s.download()
    publish(server, '1.1.0', { ...V1, 'router/catalog.json': '{"v":2}' })
    transfer.mockClear()

    await s.download()

    expect(transfer.mock.calls.map(([f]) => f.sha256)).toEqual([sha('{"v":2}')])
    expect((await s.newest())?.version).toBe('1.1.0')
  })

  it('leaves nothing under the version when a file arrives damaged', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const { store: s } = store()
    await s.download()

    expect(entriesIn(path.join(root, 'bundles'))).toEqual([])
    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'download_failed' })
  })

  it('refuses a manifest that is not the one the index lists', async () => {
    publish(server, '1.0.0', V1)
    const url = `${BASE}manifests/1.0.0.json`
    server.small.set(url, Buffer.concat([server.small.get(url)!, Buffer.from(' ')]))
    const { store: s, transfer } = store()
    await s.download()
    expect(transfer).not.toHaveBeenCalled()
    expect(await s.newest()).toBeNull()
    expect(announced.at(-1)).toEqual({ kind: 'unavailable', reason: 'download_failed' })
  })

  it('puts together a bundle that lists no files', async () => {
    publish(server, '1.0.0', {})
    const { store: s } = store()
    await s.download()
    expect((await s.newest())?.version).toBe('1.0.0')
  })

  it("does not put a bundle in place that fails the sidecar's own check", async () => {
    publish(server, '1.0.0', V1)
    const { store: s } = store({ check: async () => false })
    await s.download()
    expect(await s.newest()).toBeNull()
    expect(entriesIn(path.join(root, 'bundles'))).toEqual([])
  })

  it('forgets a version it is told to discard', async () => {
    publish(server, '1.0.0', V1)
    const { store: s } = store({ now: () => 0 })
    await s.download()
    await s.discard('1.0.0')
    expect(await s.newest()).toBeNull()
  })

  it('does not use a version on disk that needs a newer sidecar', async () => {
    publish(server, '1.0.0', V1, { min_sidecar: '0.1.0' })
    const { store: s } = store({ now: () => 0 })
    await s.download()
    const newer = createBundleStore({
      root,
      base: () => BASE,
      getSmall: async () => Buffer.from('{}'),
      transfer: async () => ({ ok: true }),
      supports: async () => ({ ...SUPPORTED, sidecar: '0.0.9' }),
      check: async () => true,
      onAvailability: () => {}
    })
    expect((await s.newest())?.version).toBe('1.0.0')
    expect(await newer.newest()).toBeNull()
  })

  it('replaces a stored file found damaged, even with a transfer that will not overwrite', async () => {
    publish(server, '1.0.0', V1)
    fs.mkdirSync(path.join(root, 'files'), { recursive: true })
    fs.writeFileSync(path.join(root, 'files', sha('weights-v1')), 'weights-XX')
    const { store: s, transfer } = store({ now: () => 0 })
    const realTransfer = transfer.getMockImplementation()!
    transfer.mockImplementation(async (file) =>
      fs.existsSync(file.finalPath) ? { ok: false, error: 'exists' } : realTransfer(file)
    )
    await s.download()
    expect((await s.newest())?.version).toBe('1.0.0')
    expect(fs.readFileSync(path.join(root, 'files', sha('weights-v1')), 'utf8')).toBe('weights-v1')
  })

  it('clears a version left half-assembled by an earlier run', async () => {
    publish(server, '1.0.0', V1)
    fs.mkdirSync(path.join(root, 'bundles', '.0.9.0.partial'), { recursive: true })
    const { store: s } = store({ now: () => 0 })
    await s.download()
    expect(fs.readdirSync(path.join(root, 'bundles'))).toEqual(['1.0.0'])
  })

  it('says it is downloading while the first download runs', async () => {
    publish(server, '1.0.0', V1)
    const { store: s, transfer } = store({ now: () => 0 })
    const release = holdTransfers(transfer)
    const downloading = s.download()
    await vi.waitFor(() => expect(transfer).toHaveBeenCalled())
    expect(await s.prepare()).toMatchObject({ kind: 'downloading' })
    release()
    await downloading
  })

  it('keeps only the newest version and the files it uses', async () => {
    const { store: s } = store({ now: () => 0 })
    for (const [version, catalog] of [
      ['1.0.0', 'a'],
      ['1.1.0', 'b']
    ] as const) {
      publish(server, version, { ...V1, 'router/catalog.json': catalog })
      await s.download()
    }
    expect(fs.readdirSync(path.join(root, 'bundles')).sort()).toEqual(['1.0.0', '1.1.0'])
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    expect(fs.readdirSync(path.join(root, 'bundles'))).toEqual(['1.1.0'])
    expect(fs.readdirSync(path.join(root, 'files'))).not.toContain(sha('a'))
    expect(fs.readdirSync(path.join(root, 'files'))).toContain(sha('weights-v1'))
  })

  it('looks for a newer version at most once a day, in the background', async () => {
    publish(server, '1.0.0', V1)
    let clock = 0
    const { store: s, transfer, getSmall } = store({ now: () => clock })
    const indexReads = () => getSmall.mock.calls.filter(([url]) => url.endsWith('index.json'))
    await s.download()
    getSmall.mockClear()
    transfer.mockClear()
    announced = []

    clock = A_DAY_LATER
    publish(server, '1.1.0', { ...V1, 'router/catalog.json': '{"v":2}' })
    const release = holdTransfers(transfer)
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    await vi.waitFor(() => expect(transfer).toHaveBeenCalled(), { timeout: 5000 })
    const landing = s.download({ quietly: true })
    release()
    await landing
    expect((await s.newest())?.version).toBe('1.1.0')
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    expect(indexReads()).toHaveLength(1)
    expect(announced, 'no progress, only that it landed').toEqual([{ kind: 'idle' }])

    const asked = s.download()
    expect(announced, 'a second look within the day started nothing to join').toEqual([
      { kind: 'idle' }
    ])
    await asked
    expect(indexReads()).toHaveLength(2)
  })

  it('stays ready on the version it has while a newer one downloads', async () => {
    publish(server, '1.0.0', V1)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const { store: s, transfer } = store({ now: () => 0 })
    await s.download()
    publish(server, '1.1.0', { ...V1, 'router/catalog.json': '{"v":2}' })
    const realTransfer = transfer.getMockImplementation()!
    transfer.mockImplementation(async (file) => {
      const result = await realTransfer(file)
      await held
      return result
    })

    const downloading = s.download()
    await vi.waitFor(() => expect(entriesIn(path.join(root, 'files'))).toContain(sha('{"v":2}')))
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    expect((await s.newest())?.version).toBe('1.0.0')
    release()
    await downloading
    expect((await s.newest())?.version).toBe('1.1.0')
  })

  it('keeps the files an unfinished update already fetched, for its next try', async () => {
    publish(server, '1.0.0', V1)
    const { store: s, transfer } = store({ now: () => 0 })
    await s.download()
    publish(server, '1.1.0', {
      ...V1,
      'encoder/model.safetensors': 'weights-v2',
      'router/catalog.json': '{"v":2}'
    })
    const realTransfer = transfer.getMockImplementation()!
    transfer.mockImplementation(async (file) =>
      file.sha256 === sha('{"v":2}') ? { ok: false, error: 'network' } : realTransfer(file)
    )
    await s.download()
    expect(await s.prepare()).toEqual({ kind: 'ready' })

    transfer.mockClear()
    transfer.mockImplementation(realTransfer)
    await s.download()
    expect(transfer.mock.calls.map(([f]) => f.sha256)).toEqual([sha('{"v":2}')])
    expect((await s.newest())?.version).toBe('1.1.0')
  })

  it('reports a background download from zero once the user asks for it before it fetches files', async () => {
    publish(server, '1.0.0', V1)
    let clock = 0
    const index: { release?: () => void } = {}
    const { store: s } = store({
      now: () => clock,
      getSmall: async (url) => {
        if (clock > 0 && url.endsWith('index.json'))
          await new Promise<void>((resolve) => (index.release = resolve))
        const body = server.small.get(url)
        if (!body) throw new Error(`${url} answered 404`)
        return body
      }
    })
    await s.download()
    announced.length = 0
    clock = A_DAY_LATER
    await s.prepare()
    await vi.waitFor(() => expect(index.release).toBeDefined())

    const asked = s.download()
    expect(announced).toEqual([{ kind: 'downloading', received: 0, total: 0 }])
    index.release!()
    await asked
  })

  it('keeps the newest version this sidecar can read', async () => {
    const { store: newer } = store({
      now: () => 0,
      supports: async () => ({ ...SUPPORTED, sidecar: '0.2.0' })
    })
    publish(server, '1.0.0', V1)
    await newer.download()
    publish(server, '1.1.0', { ...V1, 'router/catalog.json': 'b' }, { min_sidecar: '0.2.0' })
    await newer.download()
    const { store: older } = store({ now: () => 0 })
    expect(await older.prepare()).toEqual({ kind: 'ready' })
    expect(fs.readdirSync(path.join(root, 'bundles'))).toEqual(['1.0.0'])
  })

  describe('a background look for a newer version', () => {
    async function withOneVersion() {
      publish(server, '1.0.0', V1)
      let clock = 0
      const { store: s, transfer } = store({ now: () => clock })
      await s.download()
      transfer.mockClear()
      announced.length = 0
      return { s, transfer, later: () => (clock = A_DAY_LATER) }
    }

    it('stays quiet when it fails', async () => {
      const { s, later } = await withOneVersion()
      server.small.delete(`${BASE}index.json`)
      later()
      expect(await s.prepare()).toEqual({ kind: 'ready' })
      await s.download({ quietly: true })
      expect(announced).toEqual([])
    })

    it('reports its download once a search is waiting on it', async () => {
      const { s, transfer, later } = await withOneVersion()
      publish(server, '1.1.0', { ...V1, 'router/catalog.json': '{"v":2}' })
      const release = holdTransfers(transfer)
      later()
      expect(await s.prepare()).toEqual({ kind: 'ready' })
      await vi.waitFor(() => expect(transfer).toHaveBeenCalled())
      await s.discard('1.0.0')

      expect(await s.prepare()).toMatchObject({ kind: 'downloading' })
      release()
      await vi.waitFor(() => expect(announced.at(-1)).toEqual({ kind: 'idle' }))
    })

    it('reports its download once the user asks for it', async () => {
      const { s, transfer, later } = await withOneVersion()
      publish(server, '1.1.0', { ...V1, 'router/catalog.json': '{"v":2}' })
      const release = holdTransfers(transfer)
      later()
      await s.prepare()
      await vi.waitFor(() => expect(transfer).toHaveBeenCalled())

      const asked = s.download()
      expect(announced).toEqual([{ kind: 'downloading', received: 0, total: 7 }])
      release()
      await asked
      expect(announced.at(-1)).toEqual({ kind: 'idle' })
    })
  })

  it('reports download progress at most every quarter second', async () => {
    publish(server, '1.0.0', V1)
    let clock = 0
    const { store: s, transfer } = store({ now: () => clock })
    transfer.mockImplementation(async (file) => {
      for (let step = 0; step < 10; step++) {
        clock += 100
        file.onProgress(step)
      }
      fs.mkdirSync(path.dirname(file.finalPath), { recursive: true })
      fs.writeFileSync(file.finalPath, server.blobs.get(file.sha256)!)
      return { ok: true }
    })
    await s.download()
    const progressReports = announced.filter((a) => a.kind === 'downloading').length
    expect(progressReports).toBeGreaterThan(1)
    expect(progressReports).toBeLessThanOrEqual(1 + Math.ceil((3 * 10 * 100) / 250))
  })
})

describe('bundle store download reports', () => {
  it('reports a finished download with its version, the bytes fetched and how long it took', async () => {
    publish(server, '1.0.0', V1)
    let clock = 5000
    const downloads: BundleDownload[] = []
    const { store: s, transfer } = store({
      now: () => clock,
      onDownloaded: (d) => downloads.push(d)
    })
    const realTransfer = transfer.getMockImplementation()!
    transfer.mockImplementation(async (file) => {
      clock += 100
      return realTransfer(file)
    })
    await s.download()
    expect(downloads).toEqual([
      { result: 'completed', bytes: V1_BYTES, durationMs: 300, trigger: 'retry', version: '1.0.0' }
    ])
  })

  it('reports an update check that finds nothing new, and counts only the files a newer version changed', async () => {
    publish(server, '1.0.0', V1)
    const downloads: BundleDownload[] = []
    const { store: s } = store({ now: () => 0, onDownloaded: (d) => downloads.push(d) })
    await s.download()
    await s.download({ quietly: true, trigger: 'update_check' })
    publish(server, '1.1.0', { ...V1, 'router/catalog.json': '{"v":2}' })
    await s.download({ quietly: true, trigger: 'update_check' })
    expect(downloads.slice(1)).toEqual([
      { result: 'up_to_date', bytes: 0, durationMs: 0, trigger: 'update_check', version: null },
      {
        result: 'completed',
        bytes: Buffer.byteLength('{"v":2}'),
        durationMs: 0,
        trigger: 'update_check',
        version: '1.1.0'
      }
    ])
  })

  it('reports when the index offers no version this Desktop can read', async () => {
    publish(server, '1.0.0', V1)
    const downloads: BundleDownload[] = []
    const { store: s } = store({
      now: () => 0,
      supports: async () => null,
      onDownloaded: (d) => downloads.push(d)
    })
    await s.download({ quietly: true, trigger: 'launch' })
    expect(downloads).toEqual([
      { result: 'no_readable_version', bytes: 0, durationMs: 0, trigger: 'launch', version: null }
    ])
  })

  it('reports a download that opening search started, and the daily check after it', async () => {
    publish(server, '1.0.0', V1)
    let clock = 0
    const downloads: BundleDownload[] = []
    const { store: s } = store({ now: () => clock, onDownloaded: (d) => downloads.push(d) })
    await s.prepare()
    await s.download()
    clock = A_DAY_LATER
    await s.prepare()
    await s.download({ quietly: true })
    expect(downloads.map((d) => d.trigger)).toEqual(['bar', 'update_check'])
  })

  it('reports a failed download the user saw once, not again on every search', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const downloads: BundleDownload[] = []
    const { store: s } = store({ now: () => 0, onDownloaded: (d) => downloads.push(d) })
    await s.prepare()
    await s.download()
    await s.prepare()
    await s.prepare()
    expect(downloads.map((d) => [d.result, d.trigger])).toEqual([['failed', 'bar']])
  })

  it('reports a download that failed, with the bytes it had fetched', async () => {
    publish(server, '1.0.0', V1)
    server.blobs.set(sha('weights-v1'), Buffer.from('weights-XX'))
    const downloads: BundleDownload[] = []
    const { store: s } = store({ now: () => 0, onDownloaded: (d) => downloads.push(d) })
    await s.download()
    expect(downloads).toHaveLength(1)
    expect(downloads).toEqual([
      {
        result: 'failed',
        bytes: Buffer.byteLength(V1.NOTICE),
        durationMs: 0,
        trigger: 'retry',
        version: null
      }
    ])
  })
})

describe('chooseEntry', () => {
  const entry = (version: string, minSidecar: string | null = null): IndexEntry => ({
    version,
    manifest: `manifests/${version}.json`,
    manifestSha256: 'a'.repeat(64),
    minSidecar
  })

  it('takes the newest version this sidecar reads', () => {
    expect(
      chooseEntry([entry('1.0.0'), entry('1.2.0'), entry('1.10.1'), entry('2.0.0')], SUPPORTED)
        ?.version
    ).toBe('1.10.1')
  })

  it('passes over versions that need a newer sidecar', () => {
    expect(chooseEntry([entry('1.0.0'), entry('1.2.0', '0.2.0')], SUPPORTED)?.version).toBe('1.0.0')
  })

  it('finds nothing when no version is readable', () => {
    expect(chooseEntry([entry('2.0.0')], SUPPORTED)).toBeNull()
  })
})

describe('parseIndex', () => {
  it('drops yanked entries and entries it cannot read', () => {
    const good = {
      version: '1.0.0',
      manifest: 'manifests/1.0.0.json',
      manifest_sha256: 'b'.repeat(64)
    }
    expect(
      parseIndex({
        bundles: [
          good,
          { ...good, version: '1.1.0', yanked: true },
          { ...good, version: 'latest' },
          { ...good, version: '1.2.0', manifest: '../x.json' },
          { ...good, version: '1.3.0', manifest_sha256: 'short' }
        ]
      }).map((e) => e.version)
    ).toEqual(['1.0.0'])
  })
})

describe('parseManifest and isBundlePath', () => {
  it.each(['../escape', '/etc/passwd', 'a\\b', 'a//b', 'a/./b', ''])('refuses the path %j', (p) => {
    expect(isBundlePath(p)).toBe(false)
  })

  it('refuses a manifest whose file path leaves the bundle', () => {
    const file = { path: '../../outside', size: 1, sha256: 'c'.repeat(64) }
    expect(parseManifest({ version: '1.0.0', files: [file] })).toBeNull()
  })

  it('refuses a manifest that lists itself or a bad hash', () => {
    const file = { path: 'NOTICE', size: 1, sha256: 'c'.repeat(64) }
    expect(parseManifest({ version: '1.0.0', files: [file] })).not.toBeNull()
    expect(
      parseManifest({ version: '1.0.0', files: [{ ...file, path: 'manifest.json' }] })
    ).toBeNull()
    expect(
      parseManifest({ version: '1.0.0', files: [{ ...file, sha256: 'C'.repeat(64) }] })
    ).toBeNull()
  })
})
