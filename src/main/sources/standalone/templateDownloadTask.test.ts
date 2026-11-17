import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTemplateModelsFromJson = vi.fn<(json: unknown) => Array<Record<string, unknown>>>()
const startManagedModelJob = vi.fn()
const getDiskSpace = vi.fn(async (_dir: string) => ({ free: 1e15, total: 1e15 }))
const resolveDownloadContextById = vi.fn(async (_id: string): Promise<unknown> => null)
const areModelsPresent = vi.fn(async (_id: string, _models: unknown[]) => false)

vi.mock('./templateModels', () => ({
  resolveTemplateModelsFromJson: (json: unknown) => resolveTemplateModelsFromJson(json)
}))
vi.mock('./templateInputAssets', () => ({ downloadTemplateInputAssets: vi.fn(async () => []) }))
vi.mock('../../lib/disk', () => ({ getDiskSpace: (dir: string) => getDiskSpace(dir) }))
vi.mock('../../lib/comfyDownloadManager', () => ({
  startManagedModelJob: (...a: unknown[]) => startManagedModelJob(...a)
}))
vi.mock('../../lib/modelDownloadPaths', () => ({
  getModelsBaseDir: () => '/tmp/models',
  resolveDownloadContextById: (id: string) => resolveDownloadContextById(id),
  areModelsPresent: (id: string, models: unknown[]) => areModelsPresent(id, models)
}))
vi.mock('fs', () => ({
  default: {
    promises: {
      stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
      mkdir: vi.fn().mockResolvedValue(undefined)
    }
  }
}))

import {
  forgetTemplateDownload,
  startTemplateDownloadTask,
  subscribeTemplateDownload
} from './templateDownloadTask'
import { DISK_SPACE_ERROR, type TemplateDownloadSummary } from './templateDownloadCore'
import type { InstallationRecord } from '../../installations'

const sendOutput = vi.fn()
const WORKFLOW = { nodes: [] }
const ONE_MODEL = [{ filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }]

function start(
  taskId: string,
  { installationId = 'install-1', estimatedSizeBytes = 0 } = {}
): void {
  startTemplateDownloadTask(
    taskId,
    { id: installationId } as unknown as InstallationRecord,
    'example',
    estimatedSizeBytes,
    { sendOutput },
    WORKFLOW
  )
}

function latest(taskId: string): TemplateDownloadSummary | undefined {
  let summary: TemplateDownloadSummary | undefined
  subscribeTemplateDownload(taskId, (s) => {
    summary ??= s
  })()
  return summary
}

const jobReleases = new Map<string, ReturnType<typeof vi.fn>>()

function hangingJob(url: string) {
  const release = vi.fn()
  jobReleases.set(`id-${url}`, release)
  return {
    id: `id-${url}`,
    url,
    savePath: `/tmp/models/checkpoints/${url}`,
    completion: new Promise(() => {}),
    release
  }
}

function settlingJob(url: string) {
  let complete!: () => void
  const completion = new Promise((resolve) => {
    complete = () => resolve({ status: 'completed', savePath: `/tmp/models/checkpoints/${url}` })
  })
  return {
    job: {
      id: `id-${url}`,
      url,
      savePath: `/tmp/models/checkpoints/${url}`,
      completion,
      release: vi.fn()
    },
    complete: () => complete()
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }
}

function resetMocks(): void {
  resolveTemplateModelsFromJson.mockReset().mockReturnValue(ONE_MODEL)
  startManagedModelJob.mockReset().mockImplementation(async () => hangingJob('u'))
  jobReleases.clear()
  sendOutput.mockReset()
  getDiskSpace.mockReset().mockResolvedValue({ free: 1e15, total: 1e15 })
  resolveDownloadContextById.mockReset().mockResolvedValue(null)
  areModelsPresent.mockReset().mockResolvedValue(false)
}

describe('template model download task', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is done at once when the workflow needs no models', async () => {
    resolveTemplateModelsFromJson.mockReturnValue([])
    start('done-1')
    await flush()

    expect(latest('done-1')?.status).toBe('done')
    expect(startManagedModelJob).not.toHaveBeenCalled()
  })

  it('reads the model list from the workflow it was given', async () => {
    start('workflow-1')
    await flush()

    expect(resolveTemplateModelsFromJson).toHaveBeenCalledWith(WORKFLOW)
    forgetTemplateDownload('workflow-1')
  })

  it("fails when the workflow's model list cannot be read", async () => {
    resolveTemplateModelsFromJson.mockImplementation(() => {
      throw new Error('malformed workflow')
    })
    start('err-1')
    await flush()

    expect(latest('err-1')).toMatchObject({ status: 'error', error: 'malformed workflow' })
  })

  it('fails before downloading anything when the disk is too small', async () => {
    getDiskSpace.mockResolvedValue({ free: 1, total: 1e15 })
    start('err-disk', { estimatedSizeBytes: 10 * 1024 ** 3 })
    await flush()

    expect(latest('err-disk')).toMatchObject({ status: 'error', error: DISK_SPACE_ERROR })
    expect(startManagedModelJob).not.toHaveBeenCalled()
  })

  it('skips the disk pre-flight when every model is already on disk', async () => {
    getDiskSpace.mockResolvedValue({ free: 1, total: 1e15 })
    areModelsPresent.mockResolvedValue(true)
    start('present-1', { estimatedSizeBytes: 10 * 1024 ** 3 })
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    expect(getDiskSpace).not.toHaveBeenCalled()
    expect(latest('present-1')?.status).toBe('downloading')
    forgetTemplateDownload('present-1')
  })

  it('forgetTemplateDownload aborts an in-flight task, releases its model jobs and drops its state', async () => {
    start('forget-1')
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    forgetTemplateDownload('forget-1')

    await vi.waitFor(() => expect(jobReleases.get('id-u')).toHaveBeenCalled())
    expect(latest('forget-1')).toBeUndefined()
  })

  it("starts each model as a managed model job owned by the task's installation (issue #1322)", async () => {
    start('job-1', { installationId: 'install-job' })
    await flush()

    expect(startManagedModelJob).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'u',
        filename: 'm.safetensors',
        directory: 'checkpoints',
        installationId: 'install-job',
        source: 'template',
        isRetry: false,
        onProgress: expect.any(Function)
      })
    )
    forgetTemplateDownload('job-1')
  })

  it('marks automatic model retries for telemetry', async () => {
    const successful = settlingJob('u')
    successful.complete()
    startManagedModelJob
      .mockResolvedValueOnce({
        ...successful.job,
        completion: Promise.resolve({ status: 'error', error: 'Download failed: HTTP 503' })
      })
      .mockResolvedValueOnce(successful.job)
    start('retry-telemetry')
    await flush()

    expect(startManagedModelJob.mock.calls.map(([options]) => options.isRetry)).toEqual([
      false,
      true
    ])
    expect(latest('retry-telemetry')?.status).toBe('done')
    forgetTemplateDownload('retry-telemetry')
  })

  it("uses the installation's effective primary models dir for preflight, not a global dir (#1376)", async () => {
    resolveDownloadContextById.mockResolvedValue({
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models'],
      extraPaths: []
    })
    start('dest-1', { installationId: 'install-dest', estimatedSizeBytes: 1024 })
    await flush()

    expect(resolveDownloadContextById).toHaveBeenCalledWith('install-dest')
    expect(getDiskSpace).toHaveBeenCalledWith('/install/models')
    forgetTemplateDownload('dest-1')
  })
})

describe('subscribeTemplateDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes every 500 ms while the task runs, then once when it settles', async () => {
    const { job, complete } = settlingJob('u')
    startManagedModelJob.mockImplementation(async () => job)
    const listener = vi.fn()
    subscribeTemplateDownload('sub-paced', listener)
    expect(listener).not.toHaveBeenCalled()

    start('sub-paced')
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())
    listener.mockClear()
    await vi.advanceTimersByTimeAsync(500)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'downloading' }))

    complete()
    await vi.waitFor(() =>
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'done' }))
    )
    const calls = listener.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).toHaveBeenCalledTimes(calls)
  })

  it('reports a running task at once and stops after unsubscribe', async () => {
    start('sub-running')
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    const listener = vi.fn()
    const unsubscribe = subscribeTemplateDownload('sub-running', listener)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'downloading' }))

    unsubscribe()
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).toHaveBeenCalledOnce()
    forgetTemplateDownload('sub-running')
  })

  it('reports a settled task once', async () => {
    resolveTemplateModelsFromJson.mockReturnValue([])
    start('sub-settled')
    await flush()
    expect(latest('sub-settled')?.status).toBe('done')

    const listener = vi.fn()
    subscribeTemplateDownload('sub-settled', listener)
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }))
  })

  it('forgetTemplateDownload drops the listeners with the task', async () => {
    start('sub-forget')
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())
    const listener = vi.fn()
    subscribeTemplateDownload('sub-forget', listener)
    listener.mockClear()

    forgetTemplateDownload('sub-forget')
    await vi.waitFor(() => expect(jobReleases.get('id-u')).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).not.toHaveBeenCalled()
  })
})
