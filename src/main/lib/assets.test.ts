import { Writable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getInstallation = vi.fn()
const getAccessToken = vi.fn()
const runningSessions = new Map<string, { port?: number }>()

const showSaveDialog = vi.fn()
const written = new Map<string, string>()
const createWriteStream = vi.fn((filePath: string) => {
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
  BrowserWindow: {},
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  ipcMain: { handle: vi.fn() }
}))
const removeFile = vi.fn(async (_path: string, _options: { force: boolean }) => {})
const renameFile = vi.fn(async (from: string, to: string) => {
  written.set(to, written.get(from) ?? '')
  written.delete(from)
})
const savedSettings = new Map<string, string>()
vi.mock('fs', () => ({
  default: {
    existsSync: (dir: string) => dir === '/remembered',
    createWriteStream: (filePath: string) => createWriteStream(filePath),
    promises: {
      rm: (path: string, options: { force: boolean }) => removeFile(path, options),
      rename: (from: string, to: string) => renameFile(from, to)
    }
  }
}))
vi.mock('../settings', () => ({
  get: (key: string) => savedSettings.get(key),
  set: (key: string, value: string) => savedSettings.set(key, value)
}))
vi.mock('./comfyDownloadManager', () => ({
  buildSaveDialogFilters: (name: string) => [{ name, extensions: ['*'] }]
}))
vi.mock('../installations', () => ({ get: (id: string) => getInstallation(id) }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken })
}))
vi.mock('./ipc/shared', () => ({
  _runningSessions: runningSessions,
  sourceMap: {
    cloud: { category: 'cloud' },
    standalone: { category: 'local' },
    remote: { category: 'remote' }
  }
}))

const { assetKind, downloadAsset, listAssets, signedStorageUrl } = await import('./assets')

const fetchMock = vi.fn()

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  runningSessions.clear()
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
  it('lists a running local build with previews served by that build', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({
        assets: [
          {
            id: 'a1',
            name: 'still.png',
            size: 2048,
            mime_type: 'image/png',
            tags: ['output'],
            created_at: '2026-11-09T10:00:00Z',
            preview_url: '/api/view?type=output&filename=still.png'
          }
        ]
      })
    )

    const assets = await listAssets('local-1')

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://127.0.0.1:8188/api/assets?tags_any=output&sort=created_at&order=desc&limit=100'
    )
    expect(assets).toEqual([
      {
        id: 'a1',
        name: 'still.png',
        kind: 'image',
        sizeBytes: 2048,
        createdAt: '2026-11-09T10:00:00Z',
        mimeType: 'image/png',
        tags: ['output'],
        previewUrl: 'http://127.0.0.1:8188/api/view?type=output&filename=still.png'
      }
    ])
  })

  it('skips remote builds instead of asking this machine', async () => {
    getInstallation.mockResolvedValue({ id: 'remote-1', sourceId: 'remote' })
    runningSessions.set('remote-1', { port: 8188 })

    expect(await listAssets('remote-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves local previews only from the build itself', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({
        assets: [{ id: 'a1', name: 'still.png', preview_url: 'http://127.0.0.1:9999/evil.png' }]
      })
    )

    const [summary] = await listAssets('local-1')

    expect(summary!.previewUrl).toBe(
      'http://127.0.0.1:8188/api/assets/a1/content?disposition=inline'
    )
  })

  it('serves local previews only from the build API', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    fetchMock.mockResolvedValue(
      jsonResponse({
        assets: [{ id: 'a1', name: 'still.png', preview_url: '/extensions/evil.png', size: 0 }]
      })
    )

    const [summary] = await listAssets('local-1')

    expect(summary!.previewUrl).toBe(
      'http://127.0.0.1:8188/api/assets/a1/content?disposition=inline'
    )
    expect(summary!.sizeBytes, 'an empty file keeps its size').toBe(0)
  })

  it('returns nothing for a local build that is not running', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })

    expect(await listAssets('local-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
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
          ]
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

    const assets = await listAssets('cloud-1')

    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer token')
    expect(assets.map((a) => [a.name, a.kind, a.previewUrl])).toEqual([
      ['clip.mp4', 'video', 'https://storage.googleapis.com/bucket/v1?sig=1'],
      ['voice.wav', 'audio', 'https://storage.googleapis.com/bucket/s1?sig=1'],
      ['mesh.glb', '3d', null]
    ])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('downloadAsset', () => {
  const win = {} as Parameters<typeof downloadAsset>[0]

  it('saves a local build asset where the user picks', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })
    fetchMock.mockResolvedValue(new Response('bytes'))

    expect(await downloadAsset(win, 'local-1', 'a1', '../still.png')).toBe(true)
    expect(showSaveDialog.mock.calls[0]![1].defaultPath).toBe('/downloads/still.png')
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://127.0.0.1:8188/api/assets/a1/content?disposition=attachment'
    )
    expect(written.get('/picked/still.png')).toBe('bytes')
    expect(savedSettings.get('lastSaveDialogDir')).toBe('/picked')
  })

  it('starts the save dialog in the folder the user picked last time', async () => {
    savedSettings.set('lastSaveDialogDir', '/remembered')
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    showSaveDialog.mockResolvedValue({ canceled: true })

    await downloadAsset(win, 'local-1', 'a1', 'still.png')

    expect(showSaveDialog.mock.calls[0]![1].defaultPath).toBe('/remembered/still.png')
  })

  it('saves a Cloud asset through its signed storage link', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://storage.googleapis.com/bucket/v1?sig=1' }
        })
      )
      .mockResolvedValueOnce(new Response('video'))

    expect(await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')).toBe(true)
    expect(fetchMock.mock.calls[1]![0]).toBe('https://storage.googleapis.com/bucket/v1?sig=1')
    expect(written.get('/picked/clip.mp4')).toBe('video')
  })

  it('fails without writing a file when the build cannot serve the asset', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }))

    await expect(downloadAsset(win, 'local-1', 'a1', 'still.png')).rejects.toThrow('HTTP 503')
    expect(createWriteStream).not.toHaveBeenCalled()
  })

  it('removes the half-written file when the download breaks off', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('part'))
        controller.error(new Error('connection reset'))
      }
    })
    fetchMock.mockResolvedValue(new Response(broken))

    await expect(downloadAsset(win, 'local-1', 'a1', 'still.png')).rejects.toThrow(
      'connection reset'
    )
    expect(removeFile).toHaveBeenCalledWith('/picked/still.png.part', { force: true })
    expect(renameFile, 'the file the user picked is never overwritten').not.toHaveBeenCalled()
  })

  it('gives up and removes the partial file when the download stops sending data', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })
    fetchMock.mockImplementation(async (_url: string, init: { signal: AbortSignal }) => {
      const stalled = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('part'))
          init.signal.addEventListener('abort', () => controller.error(new Error('stalled')))
        }
      })
      return new Response(stalled)
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const download = downloadAsset(win, 'local-1', 'a1', 'still.png')
      const failed = expect(download).rejects.toThrow('stalled')
      await vi.advanceTimersByTimeAsync(20_000)
      await failed
    } finally {
      vi.useRealTimers()
    }
    expect(removeFile).toHaveBeenCalledWith('/picked/still.png.part', { force: true })
  })

  it('writes nothing when the save dialog is cancelled', async () => {
    getInstallation.mockResolvedValue({ id: 'local-1', sourceId: 'standalone' })
    runningSessions.set('local-1', { port: 8188 })
    showSaveDialog.mockResolvedValue({ canceled: true })

    expect(await downloadAsset(win, 'local-1', 'a1', 'still.png')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createWriteStream).not.toHaveBeenCalled()
  })
})
