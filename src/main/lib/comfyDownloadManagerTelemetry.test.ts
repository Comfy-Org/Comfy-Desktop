import { createServer, request, type Server } from 'http'
import type { AddressInfo } from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DownloadManager from './comfyDownloadManager'
import type * as Telemetry from './telemetry'
import { stagingMetaPathFor, stagingPathFor, writeStagedMeta } from './modelDownloadStaging'

let root: string
let modelsDir: string
const captured: Array<{ event: string; properties: Record<string, unknown> }> = []

vi.mock('electron', () => ({
  app: { getPath: () => root },
  BrowserWindow: Object.assign(class {}, { getAllWindows: () => [] }),
  dialog: {},
  nativeImage: {},
  net: { request: (options: { url: string }) => request(options.url), isOnline: () => true },
  session: { defaultSession: {} }
}))

vi.mock('../settings', () => ({
  get: (key: string) => (key === 'modelsDirs' ? [modelsDir] : undefined),
  defaults: {
    get modelsDirs() {
      return [modelsDir]
    }
  }
}))
vi.mock('../installations', () => ({ get: async () => null, list: async () => [] }))
vi.mock('../host/registry', () => ({ findInstallationIdByComfySender: () => null }))
vi.mock('./ipc/shared', () => ({ _broadcastToRenderer: vi.fn() }))
vi.mock('./paths', () => ({ configDir: () => root, dataDir: () => root }))
vi.mock('posthog-node', () => ({
  PostHog: class {
    on(): void {}
    capture(call: (typeof captured)[number]): void {
      captured.push(call)
    }
    async flush(): Promise<void> {}
  }
}))

let manager: typeof DownloadManager
let telemetry: typeof Telemetry
let server: Server
let baseUrl: string
let requestPaths: string[]
const content = Buffer.from('model weights')

function events(): typeof captured {
  return captured.filter(({ event }) => event.startsWith('comfy.desktop.model_download.'))
}

function eventNames(): string[] {
  return events().map(({ event }) => event.replace('comfy.desktop.model_download.', ''))
}

function options(
  route: string,
  filename = 'private-model.safetensors'
): DownloadManager.ModelJobOptions {
  return {
    url: `${baseUrl}/${route}?token=private-token`,
    filename,
    directory: 'checkpoints',
    source: 'app'
  }
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-download-telemetry-'))
  manager = await import('./comfyDownloadManager')
  telemetry = await import('./telemetry')
  server = createServer((req, res) => {
    const route = req.url!.split('?')[0]!
    requestPaths.push(route)
    if (
      route === '/denied' ||
      (route === '/retry' && requestPaths.filter((p) => p === route).length === 1)
    ) {
      res.writeHead(route === '/denied' ? 403 : 503)
      res.end()
      return
    }
    const offset = Number(req.headers.range?.match(/^bytes=(\d+)-$/)?.[1] ?? 0)
    res.writeHead(offset > 0 ? 206 : 200, {
      'Content-Length': content.length - offset,
      ETag: '"model-v1"',
      ...(offset > 0
        ? { 'Content-Range': `bytes ${offset}-${content.length - 1}/${content.length}` }
        : {})
    })
    if (route === '/slow' && offset === 0) {
      res.write(content.subarray(0, 3))
    } else {
      res.end(content.subarray(offset))
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

beforeEach(() => {
  modelsDir = fs.mkdtempSync(path.join(root, 'models-'))
  requestPaths = []
  manager._test_resetModelDownloadsInit()
  manager._test_resetModelDownloadsQuitLatch()
  telemetry._resetForTest()
  telemetry._test_resetVolumeGuards()
  vi.stubEnv('POSTHOG_ENABLED', '1')
  vi.stubEnv('COMFY_DESKTOP_POSTHOG_ENABLED', '1')
  vi.stubEnv('COMFY_DESKTOP_POSTHOG_API_KEY', 'test-key')
  telemetry.initTelemetry({ appVersion: '1.0.0', appEnv: 'test', isPackaged: true })
  telemetry.setConsentState('granted')
  telemetry.bindAnonymousId('test-anonymous', 'test-installation')
  captured.length = 0
})

afterEach(async () => {
  for (const download of manager.getActiveDownloads()) {
    if (download.id) manager.cancelModelDownload(download.id)
  }
  await vi.waitFor(() => expect(manager.getActiveDownloads()).toHaveLength(0))
  manager.clearFinishedDownloads()
  vi.unstubAllEnvs()
  telemetry._resetForTest()
})

afterAll(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
})

describe('model download events through the real manager and transfer', () => {
  it.each(['comfyui', 'template', 'app'] as const)(
    'records one started and completed pair for a %s download',
    async (source) => {
      const opts = { ...options('success'), source }
      if (source === 'comfyui') {
        const win = {
          isDestroyed: () => false,
          webContents: { send: vi.fn(), isDestroyed: () => false },
          setProgressBar: vi.fn()
        } as unknown as Electron.BrowserWindow
        expect(await manager.startModelDownload(win, opts.url, opts.filename, opts.directory)).toBe(
          true
        )
        await vi.waitFor(() => expect(eventNames()).toEqual(['started', 'completed']))
      } else {
        const job = await manager.startManagedModelJob(opts)
        await expect(job.completion).resolves.toMatchObject({ status: 'completed' })
      }
      expect(fs.readFileSync(path.join(modelsDir, opts.directory, opts.filename))).toEqual(content)
      expect(eventNames()).toEqual(['started', 'completed'])
      const [started, completed] = events()
      expect(started!.properties).toMatchObject({ source, is_retry: false, received_bytes: 0 })
      expect(completed!.properties).toMatchObject({
        download_id: started!.properties.download_id,
        source,
        received_bytes: content.length,
        total_bytes: content.length,
        duration_ms: expect.any(Number)
      })
      expect(JSON.stringify(events())).not.toMatch(/private|127\.0\.0\.1|checkpoints|safetensors/)
      expect(JSON.stringify(events())).not.toContain(modelsDir)
    }
  )

  it('does not count a cached model as a new download', async () => {
    const opts = options('success')
    const first = await manager.startManagedModelJob(opts)
    await first.completion
    const cached = await manager.startManagedModelJob(opts)
    await expect(cached.completion).resolves.toMatchObject({
      status: 'completed',
      alreadyPresent: true
    })
    expect(eventNames()).toEqual(['started', 'completed'])
    expect(requestPaths).toEqual(['/success'])
  })

  it('joins concurrent requests and records pause and resume once on the same download', async () => {
    const onProgress = vi.fn()
    const opts = { ...options('slow'), onProgress }
    const first = await manager.startManagedModelJob(opts)
    const joined = await manager.startManagedModelJob(opts)
    expect(joined.id).toBe(first.id)
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(3, content.length))
    expect(eventNames()).toEqual(['started'])
    expect(manager.pauseModelDownload(first.id)).toBe(true)
    expect(manager.pauseModelDownload(first.id)).toBe(true)
    expect(eventNames()).toEqual(['started', 'paused'])
    expect(events()[1]!.properties.received_bytes).toBe(3)
    expect(manager.resumeModelDownload(first.id)).toBe(true)
    expect(manager.resumeModelDownload(first.id)).toBe(true)
    await expect(joined.completion).resolves.toMatchObject({ status: 'completed' })
    expect(eventNames()).toEqual(['started', 'paused', 'resumed', 'completed'])
    expect(new Set(events().map(({ properties }) => properties.download_id)).size).toBe(1)
    expect(events().at(-1)!.properties).toMatchObject({
      received_bytes: content.length,
      resume_count: 1
    })
  })

  it('records cancelled bytes even before a throttled UI progress update', async () => {
    const onProgress = vi.fn()
    const job = await manager.startManagedModelJob({ ...options('slow'), onProgress })
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(3, content.length))
    expect(manager.cancelModelDownload(job.id)).toBe(true)
    await expect(job.completion).resolves.toEqual({ status: 'cancelled' })
    expect(manager.cancelModelDownload(job.id)).toBe(false)
    expect(eventNames()).toEqual(['started', 'cancelled'])
    expect(events().at(-1)!.properties).toMatchObject({
      received_bytes: 3,
      total_bytes: content.length
    })
  })

  it('reports HTTP access failures without credentials, URLs or file paths', async () => {
    const opts = options('denied')
    opts.url = opts.url.replace('http://', 'http://private-user:private-password@')
    const job = await manager.startManagedModelJob(opts)
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(eventNames()).toEqual(['started', 'failed'])
    expect(events().at(-1)!.properties).toMatchObject({
      error_bucket: 'access_denied',
      http_status: 403
    })
    expect(JSON.stringify(events())).not.toMatch(/private|127\.0\.0\.1|checkpoints|safetensors/)
    expect(JSON.stringify(events())).not.toContain(modelsDir)
  })

  it('records a retry as a new attempt with the original source', async () => {
    const job = await manager.startManagedModelJob({ ...options('retry'), source: 'template' })
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(manager.retryDownload(job.id)).toBe(true)
    await vi.waitFor(() =>
      expect(eventNames()).toEqual(['started', 'failed', 'started', 'completed'])
    )
    expect(events()[0]!.properties.is_retry).toBe(false)
    expect(events()[2]!.properties).toMatchObject({ is_retry: true, source: 'template' })
    expect(events()[2]!.properties.download_id).not.toBe(events()[0]!.properties.download_id)
  })

  it('reports directory preparation failures before making a network request', async () => {
    fs.writeFileSync(path.join(modelsDir, 'checkpoints'), 'not a directory')
    const job = await manager.startManagedModelJob(options('success'))
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(eventNames()).toEqual(['started', 'failed'])
    expect(requestPaths).toHaveLength(0)
    expect(JSON.stringify(events())).not.toContain(modelsDir)
  })

  it('records rejected destinations without exposing the rejected path', async () => {
    const job = await manager.startManagedModelJob({
      ...options('success'),
      directory: '../outside'
    })
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(eventNames()).toEqual(['started', 'failed'])
    expect(events().at(-1)!.properties.error_bucket).toBe('path')
    expect(JSON.stringify(events())).not.toMatch(/outside|private|checkpoints/)
    expect(requestPaths).toHaveLength(0)
  })

  it('starts observing restored downloads only when they are resumed', async () => {
    const opts = options('slow')
    const finalPath = path.join(modelsDir, opts.directory, opts.filename)
    fs.mkdirSync(path.dirname(stagingPathFor(finalPath)), { recursive: true })
    fs.writeFileSync(stagingPathFor(finalPath), content.subarray(0, 3))
    expect(
      writeStagedMeta(stagingMetaPathFor(finalPath), {
        version: 2,
        jobId: 'private-persisted-id',
        url: opts.url,
        filename: opts.filename,
        directory: opts.directory,
        expectedSize: content.length,
        etag: '"model-v1"'
      })
    ).toBe(true)
    await manager.initializeModelDownloads()
    expect(eventNames()).toEqual([])
    const restored = manager.getActiveDownloads()[0]!
    expect(manager.resumeModelDownload(restored.id!)).toBe(true)
    await vi.waitFor(() => expect(eventNames()).toEqual(['started', 'completed']))
    expect(events()[0]!.properties).toMatchObject({ source: 'restored', received_bytes: 3 })
    expect(JSON.stringify(events())).not.toContain('private-persisted-id')
    expect(fs.readFileSync(finalPath)).toEqual(content)
  })

  it.each(['denied', 'undecided'] as const)(
    'respects %s consent while still downloading',
    async (consent) => {
      telemetry.setConsentState(consent)
      const opts = options('success')
      const job = await manager.startManagedModelJob(opts)
      await expect(job.completion).resolves.toMatchObject({ status: 'completed' })
      telemetry.setConsentState('granted')
      expect(events()).toEqual([])
      expect(fs.readFileSync(path.join(modelsDir, opts.directory, opts.filename))).toEqual(content)
    }
  )
})
