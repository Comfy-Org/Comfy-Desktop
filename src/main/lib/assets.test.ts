import { Writable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getInstallation = vi.fn()
const getAccessToken = vi.fn()
const outputFile = vi.fn()

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
  BrowserWindow: {},
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  ipcMain: { handle: vi.fn() }
}))
const removeFile = vi.fn(async (_path: string, _options: { force: boolean }) => {})
const renameFile = vi.fn(async (from: string, to: string) => {
  written.set(to, written.get(from) ?? '')
  written.delete(from)
})
const copyFile = vi.fn(async (from: string, to: string, _mode: number) => {
  written.set(to, `copy of ${from}`)
})
const savedSettings = new Map<string, string>()
vi.mock('fs', () => ({
  default: {
    constants: { COPYFILE_EXCL: 1 },
    existsSync: (dir: string) => dir === '/remembered',
    createWriteStream: (filePath: string, options?: { flags: string }) =>
      createWriteStream(filePath, options),
    promises: {
      copyFile: (from: string, to: string, mode: number) => copyFile(from, to, mode),
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
vi.mock('./outputFolders', () => ({ outputFilePath: (target: string) => outputFile(target) }))
vi.mock('../installations', () => ({ get: (id: string) => getInstallation(id) }))
vi.mock('../devplatform/session', () => ({
  getCloudSession: () => ({ getAccessToken })
}))
vi.mock('./ipc/shared', () => ({
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
    expect(await listAssets('local-1')).toEqual([])
    getInstallation.mockResolvedValue({ id: 'remote-1', sourceId: 'remote' })
    expect(await listAssets('remote-1')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns nothing for Cloud when signed out', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue(null)

    expect(await listAssets('cloud-1')).toEqual([])
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
          ]
        })
      )
      .mockResolvedValue(new Response(null, { status: 404 }))

    const assets = await listAssets('cloud-1')

    expect(assets.map((a) => [a.id, a.sizeBytes])).toEqual([['good', 0]])
  })

  it('keeps one page of Cloud rows when the server sends more than it was asked for', async () => {
    getInstallation.mockResolvedValue({ id: 'cloud-1', sourceId: 'cloud' })
    getAccessToken.mockResolvedValue('token')
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          assets: Array.from({ length: 150 }, (_, i) => ({ id: `a${i}`, name: `a${i}.bin` }))
        })
      )
      .mockResolvedValue(new Response(null, { status: 404 }))

    const assets = await listAssets('cloud-1')

    expect(assets).toHaveLength(100)
    expect(assets.at(-1)!.id).toBe('a99')
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
  const signedUrl = 'https://storage.googleapis.com/bucket/v1?sig=1'
  const partFilePath = (): string => createWriteStream.mock.calls[0]![0]

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

  it('copies a file on this computer to where the user picks, without asking a build', async () => {
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })

    expect(await downloadAsset(win, 'local', '/out/still.png', '../still.png')).toBe(true)
    expect(showSaveDialog.mock.calls[0]![1].defaultPath).toBe('/downloads/still.png')
    expect(copyFile.mock.calls[0]![0]).toBe('/out/still.png')
    expect(copyFile.mock.calls[0]![1]).toMatch(/^\/picked\/still\.png\..+\.part$/)
    expect(copyFile.mock.calls[0]![2], 'never overwrites a partial file').toBe(1)
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
    expect(copyFile).not.toHaveBeenCalled()
  })

  it('removes the partial copy when copying a file on this computer fails', async () => {
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/still.png' })
    copyFile.mockRejectedValueOnce(new Error('disk full'))

    await expect(downloadAsset(win, 'local', '/out/still.png', 'still.png')).rejects.toThrow(
      'disk full'
    )
    expect(removeFile).toHaveBeenCalledWith(copyFile.mock.calls[0]![1], { force: true })
    expect(renameFile, 'the file the user picked is never overwritten').not.toHaveBeenCalled()
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

  it('writes nothing when the save dialog is cancelled', async () => {
    fileOnThisComputer('/out/still.png')
    showSaveDialog.mockResolvedValue({ canceled: true })

    expect(await downloadAsset(win, 'local', '/out/still.png', 'still.png')).toBe(false)
    expect(copyFile).not.toHaveBeenCalled()
    expect(createWriteStream).not.toHaveBeenCalled()
  })

  it('saves a Cloud asset through its signed storage link', async () => {
    cloudFile(() => new Response('video'))
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    expect(await downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')).toBe(true)
    expect(fetchMock.mock.calls[0]![0]).toContain('/api/assets/v1/content?disposition=attachment')
    expect(fetchMock.mock.calls[1]![0]).toBe(signedUrl)
    expect(written.get('/picked/clip.mp4')).toBe('video')
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

    const [first, second] = createWriteStream.mock.calls
    expect(first![0]).toMatch(/^\/picked\/clip\.mp4\..+\.part$/)
    expect(second![0]).not.toBe(first![0])
    expect(first![1]).toEqual({ flags: 'wx' })
  })

  it('fails without writing a file when storage cannot serve the asset', async () => {
    let signal: AbortSignal | undefined
    cloudFile((init) => {
      signal = init.signal
      return new Response('Service Unavailable', { status: 503 })
    })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })

    await expect(downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')).rejects.toThrow('HTTP 503')
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

    await expect(downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')).rejects.toThrow(
      'connection reset'
    )
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
      const download = downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')
      await vi.advanceTimersByTimeAsync(90_000)
      expect(await download).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    expect(written.get('/picked/clip.mp4')).toBe('ab')
  })

  it('gives up and removes the partial file when the download stops sending data', async () => {
    cloudFile(
      (init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('part'))
              init.signal.addEventListener('abort', () => controller.error(new Error('stalled')))
            }
          })
        )
    )
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/picked/clip.mp4' })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const download = downloadAsset(win, 'cloud-1', 'v1', 'clip.mp4')
      const failed = expect(download).rejects.toThrow('stalled')
      await vi.advanceTimersByTimeAsync(20_000)
      await failed
    } finally {
      vi.useRealTimers()
    }
    expect(removeFile).toHaveBeenCalledWith(partFilePath(), { force: true })
  })
})
