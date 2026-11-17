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
  const deps: BundleStoreDeps = {
    root,
    base: () => BASE,
    getSmall: async (url) => {
      const body = server.small.get(url)
      if (!body) throw new Error(`${url} answered 404`)
      return body
    },
    transfer,
    supports: async () => SUPPORTED,
    check: async () => true,
    onAvailability: (a) => announced.push(a),
    ...over
  }
  return { store: createBundleStore(deps), transfer }
}

const V1 = {
  NOTICE: 'Gemma notice\n',
  'encoder/model.safetensors': 'weights-v1',
  'router/catalog.json': '{"v":1}'
}
const V1_BYTES = Object.values(V1).reduce((sum, text) => sum + Buffer.byteLength(text), 0)

function entriesIn(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : []
}

describe('bundle store', () => {
  it('offers the download with its size when no bundle is on disk', async () => {
    publish(server, '1.0.0', V1)
    const { store: s } = store()
    expect(await s.prepare()).toEqual({ kind: 'needs_download', bytes: V1_BYTES })
  })

  it('is off when no base address is set and nothing is on disk', async () => {
    const { store: s } = store({ base: () => null })
    expect(await s.prepare()).toEqual({ kind: 'off' })
  })

  it('says it is offline when the index cannot be read', async () => {
    const { store: s } = store()
    expect(await s.prepare()).toEqual({ kind: 'unavailable', reason: 'offline' })
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

  it('keeps only the newest version and the files it uses', async () => {
    const { store: s } = store({ now: () => 0 })
    for (const [version, catalog] of [
      ['1.0.0', 'a'],
      ['1.1.0', 'b']
    ] as const) {
      publish(server, version, { ...V1, 'router/catalog.json': catalog })
      await s.download()
    }
    expect(fs.readdirSync(path.join(root, 'bundles'))).toEqual(['1.1.0'])
    expect(fs.readdirSync(path.join(root, 'files'))).not.toContain(sha('a'))
    expect(fs.readdirSync(path.join(root, 'files'))).toContain(sha('weights-v1'))
  })

  it('looks for a newer version at most once a day, in the background', async () => {
    publish(server, '1.0.0', V1)
    let clock = 0
    const indexReads = vi.fn()
    const { store: s } = store({
      now: () => clock,
      getSmall: async (url) => {
        if (url.endsWith('index.json')) indexReads()
        const body = server.small.get(url)
        if (!body) throw new Error(`${url} answered 404`)
        return body
      }
    })
    await s.download()
    indexReads.mockClear()

    clock = 24 * 60 * 60_000 + 1
    publish(server, '1.1.0', { ...V1, 'router/catalog.json': '{"v":2}' })
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    await vi.waitFor(async () => expect((await s.newest())?.version).toBe('1.1.0'))
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    expect(indexReads).toHaveBeenCalledTimes(1)
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
      await held
      return realTransfer(file)
    })

    const downloading = s.download()
    expect(await s.prepare()).toEqual({ kind: 'ready' })
    expect((await s.newest())?.version).toBe('1.0.0')
    release()
    await downloading
    expect((await s.newest())?.version).toBe('1.1.0')
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
