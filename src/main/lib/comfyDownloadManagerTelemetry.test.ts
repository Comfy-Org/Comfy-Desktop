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
  it('records one started and result pair for a completed download', async () => {
    const opts = options('success')
    const job = await manager.startManagedModelJob(opts)
    await expect(job.completion).resolves.toMatchObject({ status: 'completed' })
    expect(fs.readFileSync(path.join(modelsDir, opts.directory, opts.filename))).toEqual(content)
    expect(eventNames()).toEqual(['started', 'result'])
    const [started, result] = events()
    const context = {
      installation_id: buildId,
      source: 'app',
      directory_bucket: 'checkpoints',
      file_ext: 'safetensors'
    }
    expect(started!.properties).toMatchObject({ ...context, is_retry: false, received_bytes: 0 })
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

    const cached = await manager.startManagedModelJob(opts)
    await expect(cached.completion).resolves.toMatchObject({ alreadyPresent: true })
    expect(eventNames()).toEqual(['started', 'result'])
  })

  it('records a cancelled attempt with the bytes received so far', async () => {
    const onProgress = vi.fn()
    const job = await manager.startManagedModelJob({ ...options('slow'), onProgress })
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(3, content.length))
    expect(manager.cancelModelDownload(job.id)).toBe(true)
    await expect(job.completion).resolves.toEqual({ status: 'cancelled' })
    expect(eventNames()).toEqual(['started', 'result'])
    expect(events().at(-1)!.properties).toMatchObject({ result: 'cancelled', received_bytes: 3 })
  })

  it('does not count a rejected destination as a download attempt', async () => {
    const job = await manager.startManagedModelJob({
      ...options('success'),
      directory: '../outside'
    })
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(requestPaths).toHaveLength(0)
    expect(events()).toEqual([])
  })

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

  it('names the app that asked for an app download on both events', async () => {
    const job = await manager.startManagedModelJob({ ...options('success'), appId: 'product-ads' })
    await expect(job.completion).resolves.toMatchObject({ status: 'completed' })

    expect(eventNames()).toEqual(['started', 'result'])
    for (const { properties } of events()) {
      expect(properties).toMatchObject({ source: 'app', app_id: 'product-ads' })
    }
  })

  it.each([
    ['an app download with no app', { appId: null }],
    ['a template download', { source: 'template' as const, appId: 'product-ads' }]
  ])('names no app for %s', async (_what, extra) => {
    const job = await manager.startManagedModelJob({ ...options('success'), ...extra })
    await expect(job.completion).resolves.toMatchObject({ status: 'completed' })

    expect(eventNames()).toEqual(['started', 'result'])
    for (const { properties } of events()) expect(properties).not.toHaveProperty('app_id')
  })

  it('keeps the app on a retry of an app download', async () => {
    const job = await manager.startManagedModelJob({ ...options('retry'), appId: 'product-ads' })
    await expect(job.completion).resolves.toMatchObject({ status: 'error' })
    expect(manager.retryDownload(job.id)).toBe(true)
    await vi.waitFor(() => expect(eventNames()).toEqual(['started', 'result', 'started', 'result']))

    expect(events()[2]!.properties).toMatchObject({ is_retry: true, app_id: 'product-ads' })
    expect(events()[3]!.properties).toMatchObject({ result: 'completed', app_id: 'product-ads' })
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
})
