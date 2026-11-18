import type * as NodeFs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Readable, Writable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadProgress } from './comfyDownloadManager'
import type { CloudAssetPage } from '../../types/ipc'

const getInstallation = vi.fn()
const getAccessToken = vi.fn()
const outputFile = vi.fn()
const panelHostWindow = vi.fn()
const handlers = new Map<string, (...args: unknown[]) => unknown>()

const showSaveDialog = vi.fn()
const written = new Map<string, string>()
const createWriteStream = vi.fn((filePath: string, _options?: { flags: string }) => {
  const chunks: Buffer[] = []
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk)
      done()
    },
    final(done) {
      written.set(filePath, Buffer.concat(chunks).toString())
      done()
    }
  })
})

vi.mock('electron', () => ({
  app: { getPath: () => '/downloads' },
  BrowserWindow: { fromWebContents: () => null, getFocusedWindow: () => ({ focused: true }) },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  }
}))
const removeFile = vi.fn(async (_path: string, _options: { force: boolean }) => {})
const renameFile = vi.fn(async (from: string, to: string) => {
  written.set(to, written.get(from) ?? '')
  written.delete(from)
})
const copyOf = (filePath: string): string => `copy of ${filePath}`
const createReadStream = vi.fn((filePath: string) => Readable.from([Buffer.from(copyOf(filePath))]))
const statFile = vi.fn(async (filePath: string) => ({ size: copyOf(filePath).length }))
const readFile = vi.fn(async (filePath: string) => Buffer.from(copyOf(filePath)))
const savedSettings = new Map<string, string>()
vi.mock('fs', () => ({
  default: {
    existsSync: (dir: string) => dir === '/remembered',
    createReadStream: (filePath: string) => createReadStream(filePath),
    createWriteStream: (filePath: string, options?: { flags: string }) =>
      createWriteStream(filePath, options),
    promises: {
      stat: (filePath: string) => statFile(filePath),
      readFile: (filePath: string) => readFile(filePath),
      rm: (path: string, options: { force: boolean }) => removeFile(path, options),
      rename: (from: string, to: string) => renameFile(from, to)
    }
  }
}))
vi.mock('../settings', () => ({
  get: (key: string) => savedSettings.get(key),
  set: (key: string, value: string) => savedSettings.set(key, value)
}))
const panelSender = { panel: true }
const trashOutputFile = vi.fn()
vi.mock('../host/registry', () => ({
  findHostWindowByPanelSender: (sender: unknown) => panelHostWindow(sender),
  isPanelSender: (sender: unknown) => sender === panelSender
}))
vi.mock('./outputFolders', () => ({
  outputFilePath: (target: string) => outputFile(target),
  revealOutputFile: vi.fn(),
  copyOutputImage: vi.fn(),
  trashOutputFile: (target: string) => trashOutputFile(target)
}))
vi.mock('../installations', () => ({ get: (id: string) => getInstallation(id) }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken })
}))
vi.mock('./ipc/shared', () => ({
  _broadcastToRenderer: vi.fn(),
  sourceMap: {
    cloud: { category: 'cloud' },
    standalone: { category: 'local' },
    remote: { category: 'remote' }
  }
}))

const {
  assetKind,
  downloadAsset,
  findCloudAsset,
  listAssets,
  readAssetModel,
  registerAssetsHandlers,
  signedStorageUrl
} = await import('./assets')
const {
  cancelModelDownload,
  clearFinishedDownloads,
  getDownloadsTrayState,
  pauseModelDownload,
  retryDownload
} = await import('./comfyDownloadManager')

const fetchMock = vi.fn()
const realFs = await vi.importActual<typeof NodeFs>('node:fs')
const SAMPLE_VIDEO = path.resolve('src/renderer/public/install-showcase-scene/Assets/earpods.webm')

function pngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const header = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0)
  header.writeUInt32BE(13, 8)
  header.write('IHDR', 12, 'ascii')
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  header.writeUInt8(8, 24)
  header.writeUInt8(2, 25)
  return new Uint8Array(header)
}

const FIRST_PAGE = { offset: 0, limit: 100, order: 'newest' } as const

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  written.clear()
  savedSettings.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('assetKind', () => {
  it.each([
    ['clip.bin', 'video/mp4', 'video'],
    ['still.png', undefined, 'image'],
    ['narration.WAV', undefined, 'audio'],
    ['mesh.glb', undefined, '3d'],
    ['notes.txt', undefined, null],
    ['shader.constructor', undefined, null],
    ['png', undefined, null]
  ])('classifies %s (%s) as %s', (name, mimeType, kind) => {
    expect(assetKind(name, mimeType)).toBe(kind)
  })
})

describe('signedStorageUrl', () => {
  it.each([
    ['https://storage.googleapis.com/bucket/a.png?sig=1', true],
    ['https://evil.example.com/a.png', false],
    ['http://storage.googleapis.com/a.png', false],
    [null, false]
  ])('accepts only https Google storage links: %s', (location, accepted) => {
    expect(signedStorageUrl(location) !== null).toBe(accepted)
  })
})

describe('listAssets', () => {
  it('never asks a local or remote build over HTTP', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    expect((await listAssets('local-1', FIRST_PAGE)).assets).toEqual([])
    getInstallation.mockResolvedValue({ id: 'remote-1', sourceId: 'remote' })
    expect((await listAssets('remote-1', FIRST_PAGE)).assets).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns nothing for Cloud when signed out', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue(null)

    expect((await listAssets('cloud-1', FIRST_PAGE)).assets).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops Cloud rows whose fields have the wrong type and keeps an empty size', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: [
            { id: 'bad', name: 'bad.png', mime_type: 1 },
            { id: 'good', name: 'good.png', mime_type: null, created_at: null, size: 0 }
          ],
          total: 2,
          has_more: false
        })
      )
      .mockResolvedValue(new Response(null, { status: 404 }))

    const { assets } = await listAssets('cloud-1', FIRST_PAGE)

    expect(assets.map((a) => [a.id, a.sizeBytes])).toEqual([['good', 0]])
  })

  it('keeps one page of Cloud rows when the server sends more than it was asked for', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: Array.from({ length: 150 }, (_, i) => ({ id: `a${i}`, name: `a${i}.bin` })),
          total: 150,
          has_more: true,
          next_cursor: 'next'
        })
      )
      .mockResolvedValue(new Response(null, { status: 404 }))

    const { assets } = await listAssets('cloud-1', FIRST_PAGE)

    expect(assets).toHaveLength(100)
    expect(assets.at(-1)!.id).toBe('a99')
  })

  it('asks for a capped total on the first page and treats 10,000 as a lower bound', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        assets: [{ id: 'a1', name: 'a1.bin' }],
        total: 10_000,
        has_more: true,
        next_cursor: 'start-2'
      })
    )

    const page = await listAssets('cloud-1', FIRST_PAGE)

    const query = new URL(fetchMock.mock.calls[0]![0]).searchParams
    expect(query.get('capped_total')).toBe('true')
    expect(query.has('include_total')).toBe(false)
    expect(query.has('offset')).toBe(false)
    expect(page).toMatchObject({ total: 10_000, totalIsLowerBound: true, nextCursor: 'start-2' })
  })

  it('jumps to a numbered page at the requested offset, size and order without a count', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        assets: [{ id: 'a1', name: 'a1.bin' }],
        total: 152,
        has_more: true,
        next_cursor: 'next'
      })
    )

    const page = await listAssets('cloud-1', { offset: 150, limit: 50, order: 'oldest' })

    const asked = new URL(fetchMock.mock.calls[0]![0])
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      tags_any: 'output',
      sort: 'created_at',
      order: 'asc',
      limit: '50',
      offset: '150',
      include_public: 'false',
      include_total: 'false'
    })
    expect(page).toMatchObject({ total: null, nextCursor: 'next' })
  })

  it('follows the cursor past 10,000 with no offset or count, and uses raw rows to find the end', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        assets: [
          { id: 42, name: 'bad.bin' },
          { id: 'a10002', name: 'last.bin' }
        ],
        total: 2,
        has_more: false
      })
    )

    const page = await listAssets('cloud-1', { ...FIRST_PAGE, offset: 10_000, after: 'next' })

    const query = new URL(fetchMock.mock.calls[0]![0]).searchParams
    expect(query.get('after')).toBe('next')
    expect(query.get('include_total')).toBe('false')
    expect(query.has('offset')).toBe(false)
    expect(query.has('capped_total')).toBe(false)
    expect(page.assets.map((asset) => asset.name)).toEqual(['last.bin'])
    expect(page.total).toBe(10_002)
  })

  it('rejects a continuing Cloud page with no next cursor', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ assets: [{ id: 'a1', name: 'a1.bin' }], total: 101, has_more: true })
    )

    await expect(listAssets('cloud-1', FIRST_PAGE)).rejects.toThrow('invalid cursor')
  })

  describe('with a type', () => {
    function cloudOfOutputs(total: number): number[] {
      const offsetsAsked: number[] = []
      getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
      getAccessToken.mockResolvedValue('token')
      fetchMock.mockImplementation(async (url: string) => {
        const asked = new URL(url)
        const offset = Number(asked.searchParams.get('after')?.replace('cursor-', '') ?? 0)
        const limit = Number(asked.searchParams.get('limit'))
        offsetsAsked.push(offset)
        const count = Math.max(0, Math.min(limit, total - offset))
        return jsonResponse({
          assets: Array.from({ length: count }, (_, i) => {
            const index = offset + i
            return index % 100 === 3
              ? { id: `m${index}`, name: `mesh-${index}.glb` }
              : { id: `a${index}`, name: `out-${index}.bin` }
          }),
          total: count,
          has_more: offset + count < total,
          next_cursor: offset + count < total ? `cursor-${offset + count}` : undefined
        })
      })
      return offsetsAsked
    }

    it('reads the whole Cloud list in large pages and keeps only that type, without opening any file', async () => {
      const offsetsAsked = cloudOfOutputs(1200)

      const page = await listAssets('cloud-1', { ...FIRST_PAGE, limit: 5, kind: '3d' })

      expect(offsetsAsked).toEqual([0, 500, 1000])
      expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('limit')).toBe('500')
      expect(page.total).toBe(12)
      expect(page.assets.map((a) => a.name)).toEqual([
        'mesh-3.glb',
        'mesh-103.glb',
        'mesh-203.glb',
        'mesh-303.glb',
        'mesh-403.glb'
      ])
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('scans by cursor without asking for any count or offset', async () => {
      cloudOfOutputs(1200)

      await listAssets('cloud-1', { ...FIRST_PAGE, limit: 5, kind: '3d' })

      const counts = fetchMock.mock.calls.map(([url]) => {
        const asked = new URL(url as string).searchParams
        return [asked.get('after'), asked.get('offset'), asked.get('include_total')]
      })
      expect(counts).toEqual([
        [null, null, 'false'],
        ['cursor-500', null, 'false'],
        ['cursor-1000', null, 'false']
      ])
    })

    it('stops a cursor scan when a page fails', async () => {
      getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
      getAccessToken.mockResolvedValue('token')
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            assets: [{ id: 'a1', name: 'asset.bin' }],
            has_more: true,
            next_cursor: 'next'
          })
        )
        .mockResolvedValueOnce(new Response(null, { status: 500 }))

      await expect(listAssets('cloud-1', { ...FIRST_PAGE, kind: '3d' })).rejects.toThrow('HTTP 500')

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('reports when it reaches the 50,000-output scan limit with more rows available', async () => {
      const checked = cloudOfOutputs(50_001)

      const page = await listAssets('cloud-1', { ...FIRST_PAGE, limit: 5, kind: '3d' })

      expect(checked).toHaveLength(100)
      expect(page).toMatchObject({ total: 500, scanLimit: 50_000 })
    })

    it('reads the list again for a later page once the read is 30 minutes old', async () => {
      const offsetsAsked = cloudOfOutputs(1200)
      const slot = {}
      const signal = new AbortController().signal
      const threeD = { ...FIRST_PAGE, limit: 5, kind: '3d' } as const
      const now = vi.spyOn(Date, 'now')
      try {
        now.mockReturnValue(0)
        await listAssets('cloud-1', threeD, signal, slot)
        now.mockReturnValue(30 * 60_000)

        await listAssets('cloud-1', { ...threeD, offset: 5 }, signal, slot)
      } finally {
        now.mockRestore()
      }

      expect(offsetsAsked).toHaveLength(6)
    })

    it('reuses that read for the later pages of the type, and reads again for the first page', async () => {
      const offsetsAsked = cloudOfOutputs(1200)
      const signal = new AbortController().signal
      const slot = {}
      const page = (offset: number) =>
        listAssets('cloud-1', { ...FIRST_PAGE, offset, limit: 5, kind: '3d' }, signal, slot)
      await page(0)

      const second = await page(5)
      expect(offsetsAsked, 'page 2 reads nothing new').toHaveLength(3)
      expect(second.assets[0]!.name).toBe('mesh-503.glb')

      await page(0)
      expect(offsetsAsked, 'page 1 reads the list again').toHaveLength(6)
    })

    it('reads again for a later page when a new read of page 1 was stopped', async () => {
      const offsetsAsked = cloudOfOutputs(1200)
      const slot = {}
      const threeD = { ...FIRST_PAGE, limit: 5, kind: '3d' } as const
      await listAssets('cloud-1', threeD, new AbortController().signal, slot)

      const stopped = new AbortController()
      stopped.abort()
      await expect(listAssets('cloud-1', threeD, stopped.signal, slot)).rejects.toThrow()
      const asksBefore = offsetsAsked.length
      await listAssets('cloud-1', { ...threeD, offset: 5 }, new AbortController().signal, slot)

      expect(offsetsAsked.length - asksBefore, 'page 2 does not reuse the old read').toBe(3)
    })

    it("keeps each window's read apart", async () => {
      const offsetsAsked = cloudOfOutputs(1200)
      registerAssetsHandlers()
      const list = handlers.get('assets:list')!
      const firstWindow = {}
      const threeD = { ...FIRST_PAGE, limit: 5, kind: '3d' }

      await list({ sender: firstWindow }, 'cloud-1', threeD)
      await list({ sender: {} }, 'cloud-1', { ...threeD, order: 'oldest' })
      const second = (await list({ sender: firstWindow }, 'cloud-1', {
        ...threeD,
        offset: 5
      })) as CloudAssetPage

      expect(offsetsAsked, "page 2 uses the first window's own read").toHaveLength(6)
      expect(second.assets[0]!.name).toBe('mesh-503.glb')
    })

    it('keeps only one copy when Cloud returns the same output across two scan pages', async () => {
      getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
      getAccessToken.mockResolvedValue('token')
      fetchMock.mockImplementation(async (url: string) => {
        const first = !new URL(url).searchParams.has('after')
        const indexes = first ? Array.from({ length: 500 }, (_, i) => i) : [499, 500]
        return jsonResponse({
          assets: indexes.map((i) => ({ id: `m${i}`, name: `mesh-${i}.glb` })),
          has_more: first,
          next_cursor: first ? 'next' : undefined
        })
      })

      const page = await listAssets('cloud-1', { ...FIRST_PAGE, offset: 497, kind: '3d' })

      expect(page.assets.map((a) => a.id)).toEqual(['m497', 'm498', 'm499', 'm500'])
      expect(page.total).toBe(501)
    })
  })

  it('lists the signed-in cloud workspace and resolves signed media links for playable kinds', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: [
            { id: 'v1', name: 'clip.mp4', created_at: '2026-11-09T10:00:00Z' },
            { id: 's1', name: 'audio/voice.wav', created_at: '2026-11-09T09:00:00Z' },
            { id: 'm1', name: 'mesh.glb', created_at: '2026-11-09T08:00:00Z' }
          ],
          total: 3,
          has_more: false
        })
      )
      .mockImplementation(
        async (url: string) =>
          new Response(null, {
            status: 302,
            headers: {
              Location: `https://storage.googleapis.com/bucket/${/\/assets\/([^/]+)\/content/.exec(url)?.[1]}?sig=1`
            }
          })
      )

    const { assets } = await listAssets('cloud-1', FIRST_PAGE)

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer token')
    expect(assets.map((a) => [a.name, a.kind, a.previewUrl])).toEqual([
      ['clip.mp4', 'video', 'https://storage.googleapis.com/bucket/v1?sig=1'],
      ['voice.wav', 'audio', 'https://storage.googleapis.com/bucket/s1?sig=1'],
      ['mesh.glb', '3d', null]
    ])
    expect(
      fetchMock,
      'the list, two links, and the start of the video and the audio'
    ).toHaveBeenCalledTimes(5)
  })

  it('shows the picture Cloud keeps for a 3D output, and opens no model file to list it', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: [
            { id: 'm1', name: 'fox.glb', preview_id: 'p9' },
            { id: 'm2', name: 'robot.glb', preview_id: null }
          ],
          total: 2,
          has_more: false
        })
      )
      .mockImplementation(
        async (url: string) =>
          new Response(null, {
            status: 302,
            headers: {
              Location: `https://storage.googleapis.com/bucket/${/\/assets\/([^/]+)\/content/.exec(url)?.[1]}?sig=1`
            }
          })
      )

    const { assets } = await listAssets('cloud-1', FIRST_PAGE)

    expect(assets.map((a) => [a.name, a.thumbnailUrl, a.previewUrl])).toEqual([
      ['fox.glb', 'https://storage.googleapis.com/bucket/p9?sig=1', null],
      ['robot.glb', null, null]
    ])
    expect(fetchMock, 'the list and one picture link').toHaveBeenCalledTimes(2)
  })

  it('reads the size of each Cloud picture and video, and how long a video runs, from the start of the file', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    const files: Record<string, Uint8Array<ArrayBuffer>> = {
      p1: pngHeader(768, 1344),
      v1: new Uint8Array(realFs.readFileSync(SAMPLE_VIDEO))
    }
    const rangesAsked: string[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/assets?'))
        return jsonResponse({
          assets: [
            { id: 'p1', name: 'portrait.png', created_at: '2026-11-09T10:00:00Z' },
            { id: 'v1', name: 'clip.webm', created_at: '2026-11-09T09:00:00Z' }
          ],
          total: 2,
          has_more: false
        })
      const id = /\/assets\/([^/]+)\/content/.exec(url)?.[1]
      if (id)
        return new Response(null, {
          status: 302,
          headers: { Location: `https://storage.googleapis.com/bucket/${id}?sig=1` }
        })
      rangesAsked.push(new Headers(init?.headers).get('Range') ?? '')
      const file = files[/bucket\/([^?]+)/.exec(url)![1]!]!
      return new Response(file, { status: 206 })
    })

    const { assets } = await listAssets('cloud-1', FIRST_PAGE)

    expect(
      assets.map((a) => [
        a.name,
        a.width,
        a.height,
        a.durationSeconds && Math.round(a.durationSeconds)
      ])
    ).toEqual([
      ['portrait.png', 768, 1344, null],
      ['clip.webm', 714, 530, 8]
    ])
    expect(rangesAsked.toSorted(), 'only the start of each file is asked for').toEqual([
      'bytes=0-524287',
      'bytes=0-65535'
    ])
  })
})

describe('findCloudAsset', () => {
  type LookupPage = { assets: unknown; has_more?: unknown; next_cursor?: unknown }

  function serveLookup(pages: Record<string, LookupPage | Response>): URL[] {
    const asked: URL[] = []
    fetchMock.mockImplementation(async (url: string) => {
      const id = /\/assets\/([^/?]+)\/content/.exec(url)?.[1]
      if (id)
        return new Response(null, {
          status: 302,
          headers: { Location: `https://storage.googleapis.com/bucket/${id}?sig=1` }
        })
      if (url.startsWith('https://storage.googleapis.com/'))
        return new Response(null, { status: 404 })
      const request = new URL(url)
      asked.push(request)
      const page = pages[request.searchParams.get('after') ?? 'first']
      if (!page) return new Response(null, { status: 404 })
      return page instanceof Response ? page : jsonResponse(page)
    })
    return asked
  }

  const row = (id: string, name: string) => ({ id, name, created_at: '2026-11-01T00:00:00Z' })

  beforeEach(() => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
  })

  it('asks Comfy Cloud by name, follows the cursor, and returns the newest exact match', async () => {
    const asked = serveLookup({
      first: { assets: [row('a1', 'my-cutout.png')], has_more: true, next_cursor: 'c1' },
      c1: {
        assets: [row('a2', 'audio/cutout.png'), row('a3', 'cutout.png')],
        has_more: true,
        next_cursor: 'c2'
      }
    })

    const lookup = await findCloudAsset('cloud-1', 'cutout.png')

    expect(lookup).toMatchObject({
      status: 'found',
      asset: {
        id: 'a2',
        name: 'cutout.png',
        previewUrl: 'https://storage.googleapis.com/bucket/a2?sig=1'
      }
    })
    expect(asked.map((url) => url.searchParams.get('name_contains'))).toEqual([
      'cutout.png',
      'cutout.png'
    ])
    expect(asked.map((url) => url.searchParams.get('after'))).toEqual([null, 'c1'])
    expect(asked[0]!.searchParams.get('tags_any')).toBe('output')
    expect(asked[0]!.searchParams.get('include_public')).toBe('false')
    expect(asked.every((url) => url.searchParams.get('include_total') === 'false')).toBe(true)
  })

  it('says the file is absent only after Comfy Cloud reports no more pages', async () => {
    serveLookup({
      first: { assets: [row('a1', 'my-cutout.png')], has_more: true, next_cursor: 'c1' },
      c1: { assets: [row('a2', 'cutout.png.webp')], has_more: false }
    })

    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'absent' })
  })

  it('says the search is incomplete when a later page fails', async () => {
    serveLookup({
      first: { assets: [row('a1', 'my-cutout.png')], has_more: true, next_cursor: 'c1' },
      c1: new Response(null, { status: 500 })
    })

    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'incomplete' })
  })

  it('says the search is incomplete when it reaches its page limit', async () => {
    const pages: Record<string, LookupPage> = {}
    for (let i = 0; i < 12; i++) {
      pages[i === 0 ? 'first' : `c${i}`] = {
        assets: [row(`a${i}`, `other-${i}.png`)],
        has_more: true,
        next_cursor: `c${i + 1}`
      }
    }
    const asked = serveLookup(pages)

    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'incomplete' })
    expect(asked).toHaveLength(10)
  })

  it('says the search is incomplete for unreadable rows or unusable page details', async () => {
    serveLookup({ first: { assets: [{ id: 7, name: 'cutout.png' }], has_more: false } })
    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'incomplete' })

    serveLookup({ first: { assets: [], has_more: true } })
    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'incomplete' })

    serveLookup({ first: { assets: [] } })
    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'incomplete' })

    serveLookup({
      first: { assets: [], has_more: true, next_cursor: 'c1' },
      c1: { assets: [], has_more: true, next_cursor: 'c1' }
    })
    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'incomplete' })
  })

  it('says the search is incomplete when signed out, and asks nothing', async () => {
    getAccessToken.mockResolvedValue(null)

    expect(await findCloudAsset('cloud-1', 'cutout.png')).toEqual({ status: 'incomplete' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('downloadAsset', () => {
  const win = {
    isDestroyed: () => false,
    setProgressBar: vi.fn(),
    webContents: { isDestroyed: () => false, send: vi.fn() }
  } as unknown as Parameters<typeof downloadAsset>[0]
  const signedUrl = 'https://storage.googleapis.com/bucket/v1?sig=1'
  const partFilePath = (): string => createWriteStream.mock.calls[0]![0]

  function downloadsRow(savePath: string): DownloadProgress | undefined {
    const { active, recent } = getDownloadsTrayState()
    const url = pathToFileURL(savePath).href
    return [...recent, ...active].find((row) => row.url === url)
  }

  async function finishedRow(savePath: string): Promise<DownloadProgress> {
    return vi.waitFor(() => {
      const row = downloadsRow(savePath)
      expect(row?.status).toMatch(/^(completed|error|cancelled)$/)
      return row!
    })
  }

  function fileOnThisComputer(file: string): void {
    outputFile.mockImplementation(async (target: string) => (target === file ? file : null))
  }

  function cloudFile(storage: (init: { signal: AbortSignal }) => Response): void {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock.mockImplementation(async (url: string, init: { signal: AbortSignal }) =>
      url === signedUrl
        ? storage(init)
        : new Response(null, { status: 302, headers: { Location: signedUrl } })
    )
  }

  function heldOpenStream(
    init: { signal: AbortSignal },
    first: string
  ): { response: Response; finish: () => void } {
    let finish = (): void => {}
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first))
        finish = () => controller.close()
        init.signal.addEventListener('abort', () => controller.error(new Error('aborted')))
      }
    })
    return {
      response: new Response(body, { headers: { 'Content-Length': String(first.length * 2) } }),
      finish: () => finish()
    }
  }

  afterEach(() => {
    clearFinishedDownloads()
  })

  it('copies a file on this computer to where the user picks and lists it in Downloads as finished', async () => {
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })

    expect(await downloadAsset(win, 'local', '/out/still.png', '../still.png')).toBe(true)

    expect(await finishedRow('/picked/still.png')).toMatchObject({
      status: 'completed',
      filename: 'still.png',
      savePath: '/picked/still.png',
      isImage: true
    })
    expect(showSaveDialog.mock.calls[0]![1].defaultPath).toBe('/downloads/still.png')
    expect(createReadStream).toHaveBeenCalledExactlyOnceWith('/out/still.png')
    expect(partFilePath()).toMatch(/^\/picked\/still\.png\..+\.part$/)
    expect(createWriteStream.mock.calls[0]![1], 'never overwrites a partial file').toEqual({
      flags: 'wx'
    })
    expect(written.get('/picked/still.png')).toBe('copy of /out/still.png')
    expect(savedSettings.get('lastSaveDialogDir')).toBe('/picked')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a file outside the output folders before asking where to save it', async () => {
    outputFile.mockResolvedValue(null)

    await expect(downloadAsset(win, 'local', '/etc/passwd', 'passwd')).rejects.toThrow(
      'not available'
    )
    expect(showSaveDialog).not.toHaveBeenCalled()
    expect(createReadStream).not.toHaveBeenCalled()
  })

  it('shows a failed copy in Downloads, and Retry saves the file to the same place', async () => {
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })
    createReadStream.mockImplementationOnce(
      () =>
        new Readable({
          read() {
            this.destroy(new Error('disk read error'))
          }
        })
    )

    await downloadAsset(win, 'local', '/out/still.png', 'still.png')

    const failed = await finishedRow('/picked/still.png')
    expect(failed).toMatchObject({ status: 'error', error: 'disk read error' })
    expect(removeFile).toHaveBeenCalledWith(partFilePath(), { force: true })
    expect(renameFile, 'the file the user picked is never overwritten').not.toHaveBeenCalled()
    expect(savedSettings.has('lastSaveDialogDir'), 'remembered only once saved').toBe(false)

    expect(retryDownload(failed.id!)).toBe(true)

    await vi.waitFor(() => expect(downloadsRow('/picked/still.png')?.status).toBe('completed'))
    expect(showSaveDialog, 'Retry does not ask again').toHaveBeenCalledOnce()
    expect(written.get('/picked/still.png')).toBe('copy of /out/still.png')
    expect(savedSettings.get('lastSaveDialogDir')).toBe('/picked')
  })

  it('offers only a plain file name in the save dialog when the name is unusable', async () => {
    fileOnThisComputer('/out/a1')
    showSaveDialog.mockResolvedValue({ canceled: true })

    await downloadAsset(win, 'local', '/out/a1', '..')

    expect(showSaveDialog.mock.calls[0]![1].defaultPath).toBe('/downloads/a1')
  })

  it('starts the save dialog in the folder the user picked last time', async () => {
    savedSettings.set('lastSaveDialogDir', '/remembered')
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: true })

    await downloadAsset(win, 'local', '/out/still.png', 'still.png')

    expect(showSaveDialog.mock.calls[0]![1].defaultPath).toBe('/remembered/still.png')
  })

  it('writes nothing and lists nothing in Downloads when the save dialog is cancelled', async () => {
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: true })

    expect(await downloadAsset(win, 'local', '/out/still.png', 'still.png')).toBe(false)
    expect(createReadStream).not.toHaveBeenCalled()
    expect(createWriteStream).not.toHaveBeenCalled()
    expect(getDownloadsTrayState()).toEqual({ active: [], recent: [] })
  })

  it('saves a Cloud asset through its signed storage link and lists it in Downloads', async () => {
    cloudFile(() => new Response('video'))
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    expect(await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')).toBe(true)

    expect(await finishedRow('/picked/clip.mp4')).toMatchObject({
      status: 'completed',
      filename: 'clip.mp4',
      savePath: '/picked/clip.mp4',
      isImage: false
    })
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/assets/v1/content?disposition=attachment')
    expect(fetchMock.mock.calls[1]![0]).toBe(signedUrl)
    expect(written.get('/picked/clip.mp4')).toBe('video')
  })

  it('shows a Cloud download in Downloads with its progress while it runs', async () => {
    let stream: ReturnType<typeof heldOpenStream> | undefined
    cloudFile((init) => {
      stream = heldOpenStream(init, 'half')
      return stream.response
    })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')

    const running = await vi.waitFor(() => {
      const row = downloadsRow('/picked/clip.mp4')
      expect(row).toMatchObject({
        status: 'downloading',
        filename: 'clip.mp4',
        progress: 0.5,
        receivedBytes: 4,
        totalBytes: 8,
        canPause: false
      })
      return row!
    })
    expect(win.setProgressBar, 'the Dock icon shows progress').toHaveBeenCalledWith(0.5)
    expect(pauseModelDownload(running.id!), 'a streamed save offers no Pause').toBe(false)

    stream!.finish()

    expect((await finishedRow('/picked/clip.mp4')).status).toBe('completed')
    expect(win.setProgressBar).toHaveBeenLastCalledWith(-1)
  })

  it('stops a Cloud download cancelled from Downloads and removes the partial file', async () => {
    cloudFile((init) => heldOpenStream(init, 'half').response)
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')
    const running = await vi.waitFor(() => {
      const row = downloadsRow('/picked/clip.mp4')
      expect(row?.status).toBe('downloading')
      return row!
    })

    expect(cancelModelDownload(running.id!)).toBe(true)

    expect((await finishedRow('/picked/clip.mp4')).status).toBe('cancelled')
    await vi.waitFor(() => expect(removeFile).toHaveBeenCalledWith(partFilePath(), { force: true }))
    expect(renameFile, 'the file the user picked is never written').not.toHaveBeenCalled()
    expect(win.setProgressBar, 'the Dock icon stops showing progress').toHaveBeenLastCalledWith(-1)
  })

  it('shows the progress of a copy on this computer while it runs', async () => {
    fileOnThisComputer('/out/clip.mp4')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })
    statFile.mockResolvedValueOnce({ size: 8 })
    const source = new Readable({ read() {} })
    createReadStream.mockReturnValueOnce(source)

    await downloadAsset(win, 'local', '/out/clip.mp4', 'clip.mp4')
    source.push('half')

    await vi.waitFor(() =>
      expect(downloadsRow('/picked/clip.mp4')).toMatchObject({
        status: 'downloading',
        progress: 0.5,
        receivedBytes: 4,
        totalBytes: 8
      })
    )

    source.push('done')
    source.push(null)

    expect((await finishedRow('/picked/clip.mp4')).status).toBe('completed')
    expect(written.get('/picked/clip.mp4')).toBe('halfdone')
  })

  it('stops a copy on this computer cancelled mid-copy and leaves the picked file untouched', async () => {
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })
    const source = new Readable({ read() {} })
    createReadStream.mockReturnValueOnce(source)

    await downloadAsset(win, 'local', '/out/still.png', 'still.png')
    source.push('part')
    const copying = await vi.waitFor(() => {
      const row = downloadsRow('/picked/still.png')
      expect(row?.status).toBe('downloading')
      return row!
    })

    expect(cancelModelDownload(copying.id!)).toBe(true)

    expect((await finishedRow('/picked/still.png')).status).toBe('cancelled')
    await vi.waitFor(() => expect(removeFile).toHaveBeenCalledWith(partFilePath(), { force: true }))
    expect(source.destroyed, 'the copy stops reading the source').toBe(true)
    expect(renameFile, 'the file the user picked is never replaced').not.toHaveBeenCalled()
    expect(written.has('/picked/still.png')).toBe(false)
    expect(savedSettings.has('lastSaveDialogDir')).toBe(false)
  })

  it('does not follow a redirect away from the signed storage link', async () => {
    cloudFile(() => new Response('video'))
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')
    await finishedRow('/picked/clip.mp4')

    expect(fetchMock.mock.calls[1]![1].redirect).toBe('error')
  })

  it('fails before asking where to save when signed out of Cloud', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue(null)

    await expect(downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')).rejects.toThrow('not available')
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('writes each Cloud download to its own new partial file next to the picked file', async () => {
    cloudFile(() => new Response('bytes'))
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')
    await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')
    await vi.waitFor(() => expect(renameFile).toHaveBeenCalledTimes(2))

    const [first, second] = createWriteStream.mock.calls
    expect(first![0]).toMatch(/^\/picked\/clip\.mp4\..+\.part$/)
    expect(second![0]).not.toBe(first![0])
    expect(first![1]).toEqual({ flags: 'wx' })
  })

  it('shows the failure in Downloads without writing a file when storage cannot serve the asset', async () => {
    let signal: AbortSignal | undefined
    cloudFile((init) => {
      signal = init.signal
      return new Response('Service Unavailable', { status: 503 })
    })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')

    expect(await finishedRow('/picked/clip.mp4')).toMatchObject({
      status: 'error',
      error: 'Download failed: HTTP 503'
    })
    expect(createWriteStream).not.toHaveBeenCalled()
    expect(signal?.aborted, 'the failed response is released').toBe(true)
  })

  it('removes the half-written file when the download breaks off', async () => {
    cloudFile(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('part'))
              controller.error(new Error('connection reset'))
            }
          })
        )
    )
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')

    expect(await finishedRow('/picked/clip.mp4')).toMatchObject({
      status: 'error',
      error: 'connection reset'
    })
    expect(removeFile).toHaveBeenCalledWith(partFilePath(), { force: true })
    expect(renameFile, 'the file the user picked is never overwritten').not.toHaveBeenCalled()
  })

  it('keeps a Cloud download going while a slow disk catches up', async () => {
    cloudFile(
      (init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('a'))
              controller.enqueue(new TextEncoder().encode('b'))
              setTimeout(() => controller.close(), 50_000)
              init.signal.addEventListener('abort', () => controller.error(new Error('aborted')))
            }
          })
        )
    )
    createWriteStream.mockImplementationOnce((filePath: string) => {
      const chunks: Buffer[] = []
      return new Writable({
        highWaterMark: 1,
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk)
          setTimeout(done, 30_000)
        },
        final(done) {
          written.set(filePath, Buffer.concat(chunks).toString())
          done()
        }
      })
    })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      expect(await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')).toBe(true)
      await vi.advanceTimersByTimeAsync(90_000)
    } finally {
      vi.useRealTimers()
    }
    expect((await finishedRow('/picked/clip.mp4')).status).toBe('completed')
    expect(written.get('/picked/clip.mp4')).toBe('ab')
  })

  it('gives up and removes the partial file when the download stops sending data', async () => {
    cloudFile(
      (init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('part'))
              init.signal.addEventListener('abort', () => controller.error(init.signal.reason))
            }
          })
        )
    )
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')
      await vi.advanceTimersByTimeAsync(20_000)
    } finally {
      vi.useRealTimers()
    }
    expect(await finishedRow('/picked/clip.mp4')).toMatchObject({
      status: 'error',
      error: 'The download stopped sending data.'
    })
    expect(removeFile).toHaveBeenCalledWith(partFilePath(), { force: true })
  })
})

describe('the download handler', () => {
  it('opens the save dialog over the window that holds the Assets page', async () => {
    const owner = { owner: true }
    const sender = {}
    panelHostWindow.mockImplementation((wc: unknown) => (wc === sender ? owner : null))
    outputFile.mockResolvedValue('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: true })
    registerAssetsHandlers()

    await handlers.get('assets:download')!({ sender }, 'local', '/out/still.png', 'still.png')

    expect(showSaveDialog.mock.calls[0]![0]).toBe(owner)
  })
})

describe('the list handler', () => {
  function cloudListThatWaits(): AbortSignal[] {
    const signals: AbortSignal[] = []
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          signals.push(init.signal)
          init.signal.addEventListener('abort', () => reject(init.signal.reason))
          setTimeout(() => resolve(jsonResponse({ assets: [], total: 0, has_more: false })), 50)
        })
    )
    return signals
  }

  it('stops the page a window asked for before when the window asks for another', async () => {
    const signals = cloudListThatWaits()
    registerAssetsHandlers()
    const list = handlers.get('assets:list')!
    const sender = {}

    const first = list({ sender }, 'cloud-1', FIRST_PAGE)
    await vi.waitFor(() => expect(signals).toHaveLength(1))
    const second = list({ sender }, 'cloud-1', { ...FIRST_PAGE, offset: 100 })

    expect(await first, 'the replaced page').toBeNull()
    expect(signals[0]!.aborted).toBe(true)
    expect(await second).toEqual({ assets: [], total: null })
  })

  it('lets two windows list pages at the same time', async () => {
    const signals = cloudListThatWaits()
    registerAssetsHandlers()
    const list = handlers.get('assets:list')!

    const pages = await Promise.all([
      list({ sender: {} }, 'cloud-1', FIRST_PAGE),
      list({ sender: {} }, 'cloud-1', FIRST_PAGE)
    ])

    expect(pages, 'neither window replaced the other').toEqual([
      { assets: [], total: 0 },
      { assets: [], total: 0 }
    ])
    expect(signals).toHaveLength(2)
  })

  it.each([
    ['no page', undefined],
    ['a negative offset', { ...FIRST_PAGE, offset: -1 }],
    ['an offset beyond the count cap without a cursor', { ...FIRST_PAGE, offset: 10_000 }],
    ['an empty cursor', { ...FIRST_PAGE, offset: 100, after: '' }],
    ['a page larger than Cloud allows here', { ...FIRST_PAGE, limit: 500 }],
    ['an unknown order', { ...FIRST_PAGE, order: 'random' }],
    ['an unknown type', { ...FIRST_PAGE, kind: 'font' }]
  ])('asks Cloud nothing for %s', async (_case, page) => {
    registerAssetsHandlers()

    expect(await handlers.get('assets:list')!({ sender: {} }, 'cloud-1', page)).toEqual({
      assets: [],
      total: 0
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('readAssetModel', () => {
  const signedModel = 'https://storage.googleapis.com/bucket/m1?sig=1'

  function cloudModel(model: Response): void {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock.mockImplementation(async (url: string) =>
      url === signedModel
        ? model
        : new Response(null, { status: 302, headers: { Location: signedModel } })
    )
  }

  it('reads a Cloud model through its signed link', async () => {
    cloudModel(new Response(new Uint8Array([1, 2, 3])))

    const bytes = await readAssetModel('cloud-1', 'm1')

    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3])
  })

  it('does not read a Cloud model larger than 100 MB', async () => {
    cloudModel(
      new Response(new Uint8Array([1]), {
        headers: { 'Content-Length': String(150 * 1024 * 1024) }
      })
    )

    expect(await readAssetModel('cloud-1', 'm1')).toBeNull()
  })

  it('reads a model in an output folder on this computer, and nothing outside them', async () => {
    outputFile.mockImplementation(async (target: string) =>
      target === '/out/fox.glb' ? target : null
    )

    expect(Buffer.from((await readAssetModel('local', '/out/fox.glb'))!).toString()).toBe(
      copyOf('/out/fox.glb')
    )
    expect(await readAssetModel('local', '/etc/passwd')).toBeNull()
    expect(readFile).toHaveBeenCalledExactlyOnceWith('/out/fox.glb')
  })

  it('answers only the Assets page', async () => {
    cloudModel(new Response(new Uint8Array([1])))
    registerAssetsHandlers()

    expect(await handlers.get('assets:read-model')!({ sender: {} }, 'cloud-1', 'm1')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the delete handler', () => {
  it('moves a file on this computer to the Trash only when the Assets page asks', async () => {
    trashOutputFile.mockResolvedValue(true)
    registerAssetsHandlers()
    const trash = handlers.get('assets:trash')!

    expect(await trash({ sender: {} }, 'local', '/out/still.png'), 'another page').toBe(false)
    expect(await trash({ sender: panelSender }, 'cloud', 'c1'), 'a Cloud file').toBe(false)
    expect(trashOutputFile).not.toHaveBeenCalled()

    expect(await trash({ sender: panelSender }, 'local', '/out/still.png')).toBe(true)
    expect(trashOutputFile).toHaveBeenCalledExactlyOnceWith('/out/still.png')
  })
})
