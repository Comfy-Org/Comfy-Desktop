import { createServer, request, type Server } from 'http'
import type { AddressInfo } from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstallationRecord } from '../installations'
import type * as DownloadManager from './comfyDownloadManager'
import { createExecutionTap } from './executionTap'
import type * as Telemetry from './telemetry'
import { stagingMetaPathFor, stagingPathFor, writeStagedMeta } from './modelDownloadStaging'

let root: string
let modelsDir: string
const buildId = 'test-build'
let installation: InstallationRecord
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
vi.mock('../installations', () => ({
  get: async (id: string) => (id === buildId ? installation : null),
  list: async () => [installation],
  update: async (_id: string, fields: Partial<InstallationRecord>) => {
    installation = { ...installation, ...fields }
  }
}))
vi.mock('../host/registry', () => ({ findInstallationIdByComfySender: () => buildId }))
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
    installationId: buildId,
    source: 'app'
  }
}

function seedRestoredModel(installationId?: string): string {
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
      installationId,
      etag: '"model-v1"'
    })
  ).toBe(true)
  return finalPath
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
  installation = {
    id: buildId,
    name: 'Local build',
    createdAt: new Date().toISOString(),
    installPath: path.join(root, 'build'),
    sourceId: 'standalone',
    useSharedModels: true
  }
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
    'records one started and result pair for a %s download',
    async (source) => {
      const opts = { ...options('success'), source }
      if (source === 'comfyui') {
        const win = {
          isDestroyed: () => false,
          webContents: { send: vi.fn(), isDestroyed: () => false },
          setProgressBar: vi.fn()
        } as unknown as Electron.BrowserWindow
        expect(
          await manager.startModelDownload(
            win,
            opts.url,
            opts.filename,
            opts.directory,
            win.webContents
          )
        ).toBe(true)
        await vi.waitFor(() => expect(eventNames()).toEqual(['started', 'result']))
      } else {
        const job = await manager.startManagedModelJob(opts)
        await expect(job.completion).resolves.toMatchObject({ status: 'completed' })
      }
      expect(fs.readFileSync(path.join(modelsDir, opts.directory, opts.filename))).toEqual(content)
      expect(eventNames()).toEqual(['started', 'result'])
      const [started, result] = events()
      const context = {
        installation_id: buildId,
        source,
        directory_bucket: 'checkpoints',
        file_ext: 'safetensors'
      }
      expect(started!.properties).toMatchObject({
        ...context,
        is_retry: false,
        received_bytes: 0
      })
      expect(result!.properties).toMatchObject({
        ...context,
        download_id: started!.properties.download_id,
        result: 'completed',
        received_bytes: content.length,
        total_bytes: content.length,
        size_bucket: 'lt_10mb',
        duration_ms: expect.any(Number)
      })
      expect(JSON.stringify(events())).not.toMatch(/private|127\.0\.0\.1/)
      expect(JSON.stringify(events())).not.toContain(modelsDir)
    }
  )

  it('records install, download and first successful run with the same build ID', async () => {
    telemetry.captureInstallCompleted({ installationId: buildId, method: 'express', express: true })
    const job = await manager.startManagedModelJob(options('success'))
    await expect(job.completion).resolves.toMatchObject({ status: 'completed' })
    createExecutionTap({ installationId: buildId }).ingest(
      'got prompt\nPrompt executed in 0.5 seconds\n',
      'stdout'
    )

    await vi.waitFor(() =>
      expect(
        captured
          .filter(({ properties }) => properties.installation_id === buildId)
          .map(({ event }) => event)
      ).toEqual([
        'comfy.desktop.install.completed',
        'comfy.desktop.model_download.started',
        'comfy.desktop.model_download.result',
        'comfy.desktop.execution.first_completed'
      ])
    )
  })

  it('does not count a cached model as a new download', async () => {
    const opts = options('success')
    const first = await manager.startManagedModelJob(opts)
    await first.completion
    const cached = await manager.startManagedModelJob(opts)
    await expect(cached.completion).resolves.toMatchObject({
      status: 'completed',
      alreadyPresent: true
    })
    expect(eventNames()).toEqual(['started', 'result'])
    expect(requestPaths).toEqual(['/success'])
  })

  it.each([
    { state: 'activated', installationId: buildId, firstRunAt: '2026-11-17T12:00:00.000Z' },
    { state: 'unattributed', installationId: null, firstRunAt: undefined }
  ])(
    'downloads for an $state build without download telemetry',
    async ({ installationId, firstRunAt }) => {
      installation.firstRunAt = firstRunAt
      const opts = options('success')
      const job = await manager.startManagedModelJob({ ...opts, installationId })
      await expect(job.completion).resolves.toMatchObject({ status: 'completed' })
      expect(fs.readFileSync(path.join(modelsDir, opts.directory, opts.filename))).toEqual(content)
      expect(events()).toEqual([])
    }
  )

  it('joins requests and retains a resumed attempt result after the build activates', async () => {
    const onProgress = vi.fn()
    const opts = { ...options('slow'), onProgress }
    const first = await manager.startManagedModelJob(opts)
    const joined = await manager.startManagedModelJob(opts)
    expect(joined.id).toBe(first.id)
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(3, content.length))
    expect(eventNames()).toEqual(['started'])
    expect(manager.pauseModelDownload(first.id)).toBe(true)
    expect(manager.pauseModelDownload(first.id)).toBe(true)
    expect(eventNames()).toEqual(['started'])
    createExecutionTap({ installationId: buildId }).ingest(
      'got prompt\nPrompt executed in 0.5 seconds\n',
      'stdout'
    )
    await vi.waitFor(() =>
      expect(captured.map(({ event }) => event)).toContain(
        'comfy.desktop.execution.first_completed'
      )
    )
    expect(manager.resumeModelDownload(first.id)).toBe(true)
    expect(manager.resumeModelDownload(first.id)).toBe(true)
    await expect(joined.completion).resolves.toMatchObject({ status: 'completed' })
    expect(eventNames()).toEqual(['started', 'result'])
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
    expect(eventNames()).toEqual(['started', 'result'])
    expect(events().at(-1)!.properties).toMatchObject({
      result: 'cancelled',
      received_bytes: 3,
      total_bytes: content.length
    })
  })

  it('reports HTTP access failures without credentials, URLs or file paths', async () => {
    const opts = options('denied')
    opts.url = opts.url.replace('http://', 'http://private-user:private-password@')
    const job = await manager.startManagedModelJob(opts)
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(eventNames()).toEqual(['started', 'result'])
    expect(events().at(-1)!.properties).toMatchObject({
      result: 'error',
      error_bucket: 'access_denied',
      http_status: 403
    })
    expect(JSON.stringify(events())).not.toMatch(/private|127\.0\.0\.1/)
    expect(JSON.stringify(events())).not.toContain(modelsDir)
  })

  it('records a retry as a new attempt with the original source', async () => {
    const job = await manager.startManagedModelJob({ ...options('retry'), source: 'template' })
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(manager.retryDownload(job.id)).toBe(true)
    await vi.waitFor(() => expect(eventNames()).toEqual(['started', 'result', 'started', 'result']))
    expect(events()[0]!.properties.is_retry).toBe(false)
    expect(events()[1]!.properties.result).toBe('error')
    expect(events()[2]!.properties).toMatchObject({
      installation_id: buildId,
      is_retry: true,
      source: 'template'
    })
    expect(events()[3]!.properties.result).toBe('completed')
    expect(events()[2]!.properties.download_id).not.toBe(events()[0]!.properties.download_id)
  })

  it('skips telemetry for retries that begin after activation', async () => {
    const opts = options('retry')
    const job = await manager.startManagedModelJob(opts)
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    installation.firstRunAt = new Date().toISOString()
    expect(manager.retryDownload(job.id)).toBe(true)

    await vi.waitFor(() => {
      expect(requestPaths).toEqual(['/retry', '/retry'])
      expect(manager.getActiveDownloads()).toHaveLength(0)
    })
    expect(fs.readFileSync(path.join(modelsDir, opts.directory, opts.filename))).toEqual(content)
    expect(eventNames()).toEqual(['started', 'result'])
  })

  it('reports directory preparation failures before making a network request', async () => {
    fs.writeFileSync(path.join(modelsDir, 'checkpoints'), 'not a directory')
    const job = await manager.startManagedModelJob(options('success'))
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(eventNames()).toEqual(['started', 'result'])
    expect(events().at(-1)!.properties.result).toBe('error')
    expect(requestPaths).toHaveLength(0)
    expect(JSON.stringify(events())).not.toContain(modelsDir)
  })

  it('records rejected destinations without exposing the rejected path', async () => {
    const job = await manager.startManagedModelJob({
      ...options('success'),
      directory: '../outside'
    })
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(eventNames()).toEqual(['started', 'result'])
    expect(events().at(-1)!.properties).toMatchObject({ result: 'error', error_bucket: 'path' })
    expect(JSON.stringify(events())).not.toMatch(/outside|private|checkpoints/)
    expect(requestPaths).toHaveLength(0)
  })

  it('records a restored attempt when the build resumes before its first run', async () => {
    const finalPath = seedRestoredModel(buildId)
    await manager.initializeModelDownloads()
    expect(events()).toEqual([])
    const restored = manager.getActiveDownloads()[0]!
    expect(manager.resumeModelDownload(restored.id!)).toBe(true)

    await vi.waitFor(() => expect(eventNames()).toEqual(['started', 'result']))
    expect(events()[0]!.properties).toMatchObject({
      source: 'restored',
      installation_id: buildId,
      received_bytes: 3
    })
    expect(events()[1]!.properties).toMatchObject({
      installation_id: buildId,
      result: 'completed'
    })
    expect(JSON.stringify(events())).not.toContain('private-persisted-id')
    expect(fs.readFileSync(finalPath)).toEqual(content)
  })

  it.each([
    { state: 'activated', stagedBuildId: buildId },
    { state: 'unknown', stagedBuildId: 'private-staged-build' },
    { state: 'unattributed', stagedBuildId: undefined }
  ])(
    'resumes a restored download for an $state build without telemetry',
    async ({ state, stagedBuildId }) => {
      const finalPath = seedRestoredModel(stagedBuildId)
      await manager.initializeModelDownloads()
      if (state === 'activated') installation.firstRunAt = new Date().toISOString()
      const restored = manager.getActiveDownloads()[0]!
      expect(manager.resumeModelDownload(restored.id!)).toBe(true)

      await vi.waitFor(() => expect(manager.getActiveDownloads()).toHaveLength(0))
      expect(fs.readFileSync(finalPath)).toEqual(content)
      expect(events()).toEqual([])
    }
  )

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
