import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resolveTemplateModels = vi.fn<() => Promise<Array<Record<string, unknown>>>>()
const startManagedModelJob = vi.fn()
const getDiskSpace = vi.fn(async (_dir: string) => ({ free: 1e15, total: 1e15 }))
const resolveDownloadContextById = vi.fn(async (_id: string): Promise<unknown> => null)
const areModelsPresent = vi.fn(async (_id: string, _models: unknown[]) => false)

vi.mock('./templateModels', () => ({ resolveTemplateModels: () => resolveTemplateModels() }))
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
  abortTemplateDownload,
  forgetTemplateDownload,
  startTemplateDownload,
  getTemplateDownloadState,
  subscribeTemplateDownload
} from './templateDownloadTask'
import { DISK_SPACE_ERROR } from './templateDownloadCore'

const sendOutput = vi.fn()

function makeInstall(id: string) {
  return {
    id,
    bundledTemplateId: 't',
    bundledTemplateModelBytes: 1024
  } as unknown as Parameters<typeof startTemplateDownload>[0]
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

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }
}

describe('starter model download task', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resolveTemplateModels.mockReset()
    startManagedModelJob.mockReset()
    jobReleases.clear()
    sendOutput.mockReset()
    getDiskSpace.mockReset().mockResolvedValue({ free: 1e15, total: 1e15 })
    resolveDownloadContextById.mockReset().mockResolvedValue(null)
    areModelsPresent.mockReset().mockResolvedValue(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('is done at once when the starter workflow needs no models', async () => {
    resolveTemplateModels.mockResolvedValue([])
    startTemplateDownload(makeInstall('done-1'), 0, { sendOutput })
    await flush()

    expect(getTemplateDownloadState('done-1')?.status).toBe('done')
    expect(startManagedModelJob).not.toHaveBeenCalled()
  })

  it('fails when the model list cannot be resolved', async () => {
    resolveTemplateModels.mockRejectedValue(new Error('network down'))
    startTemplateDownload(makeInstall('err-1'), 0, { sendOutput })
    await flush()

    expect(getTemplateDownloadState('err-1')).toMatchObject({
      status: 'error',
      error: 'network down'
    })
  })

  it('fails before downloading anything when the disk is too small', async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    getDiskSpace.mockResolvedValue({ free: 1, total: 1e15 })
    startTemplateDownload(makeInstall('err-disk'), 10 * 1024 ** 3, { sendOutput })
    await flush()

    expect(getTemplateDownloadState('err-disk')).toMatchObject({
      status: 'error',
      error: DISK_SPACE_ERROR
    })
    expect(startManagedModelJob).not.toHaveBeenCalled()
  })

  it('skips the disk pre-flight when every model is already on disk', async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    getDiskSpace.mockResolvedValue({ free: 1, total: 1e15 })
    areModelsPresent.mockResolvedValue(true)
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('present-1'), 10 * 1024 ** 3, { sendOutput })
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    expect(getDiskSpace).not.toHaveBeenCalled()
    expect(getTemplateDownloadState('present-1')?.status).toBe('downloading')
    abortTemplateDownload('present-1')
  })

  it('is cancelled by abortTemplateDownload, which releases its model jobs', async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('cancel-1'), 0, { sendOutput })
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    abortTemplateDownload('cancel-1')

    await vi.waitFor(() => expect(jobReleases.get('id-u')).toHaveBeenCalled())
    expect(getTemplateDownloadState('cancel-1')?.status).toBe('cancelled')
  })

  it('forgetTemplateDownload aborts an in-flight task and drops its state', async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('forget-1'), 0, { sendOutput })
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    forgetTemplateDownload('forget-1')

    await vi.waitFor(() => expect(jobReleases.get('id-u')).toHaveBeenCalled())
    expect(getTemplateDownloadState('forget-1')).toBeUndefined()
  })

  it('starts each template model as a real managed model job (issue #1322)', async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('job-1'), 0, { sendOutput })
    await flush()

    expect(startManagedModelJob).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'u',
        filename: 'm.safetensors',
        directory: 'checkpoints',
        installationId: 'job-1',
        onProgress: expect.any(Function)
      })
    )
    abortTemplateDownload('job-1')
  })

  it("uses the install's effective primary models dir for preflight, not a global dir (#1376)", async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    resolveDownloadContextById.mockResolvedValue({
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models'],
      extraPaths: []
    })
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('dest-1'), 1024, { sendOutput })
    await flush()

    expect(resolveDownloadContextById).toHaveBeenCalledWith('dest-1')
    expect(getDiskSpace).toHaveBeenCalledWith('/install/models')
    abortTemplateDownload('dest-1')
  })
})

describe('subscribeTemplateDownload', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resolveTemplateModels
      .mockReset()
      .mockResolvedValue([{ filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }])
    startManagedModelJob.mockReset().mockImplementation(async () => hangingJob('u'))
    jobReleases.clear()
    getDiskSpace.mockReset().mockResolvedValue({ free: 1e15, total: 1e15 })
    resolveDownloadContextById.mockReset().mockResolvedValue(null)
    areModelsPresent.mockReset().mockResolvedValue(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes every 500 ms while the task runs, then once when it settles', async () => {
    const listener = vi.fn()
    subscribeTemplateDownload('sub-paced', listener)
    expect(listener).not.toHaveBeenCalled()

    startTemplateDownload(makeInstall('sub-paced'), 0, { sendOutput })
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())
    listener.mockClear()
    await vi.advanceTimersByTimeAsync(500)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'downloading' }))

    abortTemplateDownload('sub-paced')
    await vi.waitFor(() =>
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'cancelled' }))
    )
    const calls = listener.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).toHaveBeenCalledTimes(calls)
  })

  it('reports a running task at once and stops after unsubscribe', async () => {
    startTemplateDownload(makeInstall('sub-running'), 0, { sendOutput })
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    const listener = vi.fn()
    const unsubscribe = subscribeTemplateDownload('sub-running', listener)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'downloading' }))

    unsubscribe()
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).toHaveBeenCalledOnce()
    abortTemplateDownload('sub-running')
  })

  it('reports a settled task once', async () => {
    resolveTemplateModels.mockResolvedValue([])
    startTemplateDownload(makeInstall('sub-settled'), 0, { sendOutput })
    await flush()
    expect(getTemplateDownloadState('sub-settled')?.status).toBe('done')

    const listener = vi.fn()
    subscribeTemplateDownload('sub-settled', listener)
    await vi.advanceTimersByTimeAsync(2000)
    expect(listener).toHaveBeenCalledOnce()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }))
  })

  it('forgetTemplateDownload drops the listeners with the task', async () => {
    startTemplateDownload(makeInstall('sub-forget'), 0, { sendOutput })
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
