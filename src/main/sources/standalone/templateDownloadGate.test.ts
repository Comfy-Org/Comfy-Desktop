import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The gate (`awaitTemplateDownloadSettled`) polls the process-global download
// state that `startTemplateDownload` writes. We drive that state through the
// real public API while mocking only the download manager underneath the task,
// so the poller's branching (terminal / skip / abort / absent) is exercised
// end-to-end against real managed-job orchestration (issue #1322).

const resolveTemplateModels = vi.fn<() => Promise<Array<Record<string, unknown>>>>()
const startManagedModelJob = vi.fn()
const getDiskSpace = vi.fn(async (_dir: string) => ({ free: 1e15, total: 1e15 }))
const resolveDownloadContextById = vi.fn(async (_id: string): Promise<unknown> => null)

vi.mock('./templateModels', () => ({ resolveTemplateModels: () => resolveTemplateModels() }))
vi.mock('./templateInputAssets', () => ({ downloadTemplateInputAssets: vi.fn(async () => []) }))
vi.mock('../../lib/disk', () => ({ getDiskSpace: (dir: string) => getDiskSpace(dir) }))
vi.mock('../../lib/comfyDownloadManager', () => ({
  startManagedModelJob: (...a: unknown[]) => startManagedModelJob(...a)
}))
vi.mock('../../lib/modelDownloadPaths', () => ({
  getModelsBaseDir: () => '/tmp/models',
  resolveDownloadContextById: (id: string) => resolveDownloadContextById(id)
}))
// Keep the task hermetic - never touch the real filesystem. `stat` rejects so
// the completed-size probe is simply skipped.
vi.mock('fs', () => ({
  default: {
    promises: {
      stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
      mkdir: vi.fn().mockResolvedValue(undefined)
    }
  }
}))

import {
  awaitTemplateDownloadSettled,
  requestSkipTemplateDownload,
  abortTemplateDownload,
  startTemplateDownload,
  getTemplateDownloadState
} from './templateDownloadTask'

const sendOutput = vi.fn()

function makeInstall(id: string) {
  return {
    id,
    bundledTemplateId: 't',
    bundledTemplateModelBytes: 1024
  } as unknown as Parameters<typeof startTemplateDownload>[0]
}

/** Per-handle caller-owned lease release spies, keyed by job id. */
const jobReleases = new Map<string, ReturnType<typeof vi.fn>>()

/** A managed-job handle whose completion never settles (in-flight download). */
function hangingJob(url: string) {
  const release = vi.fn()
  jobReleases.set(`id-${url}`, release)
  return {
    id: `id-${url}`,
    url,
    savePath: `/tmp/models/checkpoints/${url}`,
    completion: new Promise(() => {
      /* hangs */
    }),
    release
  }
}

/** Spin the microtask queue + fake-timer poll until the task settles the state. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }
}

describe('awaitTemplateDownloadSettled', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resolveTemplateModels.mockReset()
    startManagedModelJob.mockReset()
    jobReleases.clear()
    sendOutput.mockReset()
    getDiskSpace.mockReset().mockResolvedValue({ free: 1e15, total: 1e15 })
    resolveDownloadContextById.mockReset().mockResolvedValue(null)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("resolves 'absent' when there is no task for the install", async () => {
    const ctrl = new AbortController()
    await expect(awaitTemplateDownloadSettled('nope', ctrl.signal)).resolves.toBe('absent')
  })

  it("resolves 'done' once the task finishes (no models is an instant done)", async () => {
    resolveTemplateModels.mockResolvedValue([])
    startTemplateDownload(makeInstall('done-1'), 0, { sendOutput })
    await flush()
    expect(getTemplateDownloadState('done-1')?.status).toBe('done')

    const ctrl = new AbortController()
    await expect(awaitTemplateDownloadSettled('done-1', ctrl.signal)).resolves.toBe('done')
  })

  it("resolves 'error' when the task fails (resolve throws)", async () => {
    resolveTemplateModels.mockRejectedValue(new Error('network down'))
    startTemplateDownload(makeInstall('err-1'), 0, { sendOutput })
    await flush()
    expect(getTemplateDownloadState('err-1')?.status).toBe('error')

    const ctrl = new AbortController()
    await expect(awaitTemplateDownloadSettled('err-1', ctrl.signal)).resolves.toBe('error')
  })

  it("resolves 'error' on a disk-space pre-flight failure", async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    getDiskSpace.mockResolvedValue({ free: 1, total: 1e15 })
    startTemplateDownload(makeInstall('err-disk'), 10 * 1024 ** 3, { sendOutput })
    await flush()
    expect(getTemplateDownloadState('err-disk')?.status).toBe('error')

    const ctrl = new AbortController()
    await expect(awaitTemplateDownloadSettled('err-disk', ctrl.signal)).resolves.toBe('error')
  })

  it("resolves 'cancelled' after abortTemplateDownload, cancelling the real jobs", async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('cancel-1'), 0, { sendOutput })
    // Event-driven: wait for the managed job to be dispatched instead of
    // counting ticks (lease registration happens after the dispatch await).
    await vi.waitFor(() => expect(startManagedModelJob).toHaveBeenCalled())

    abortTemplateDownload('cancel-1')
    // The abort must release this install's own lease handle on the actual
    // managed transfer (never a URL- or id-addressed whole-job cancel -
    // another caller may hold its own lease on the same job), not just flip
    // state. The manager parks the transfer once the last lease is released,
    // so a destination shared with another caller survives. The release may
    // land via the add-after-abort re-release path, so wait for the event.
    await vi.waitFor(() => expect(jobReleases.get('id-u')).toHaveBeenCalled())
    const ctrl = new AbortController()
    await expect(awaitTemplateDownloadSettled('cancel-1', ctrl.signal)).resolves.toBe('cancelled')
  })

  it("resolves 'skipped' when the user requests skip mid-download", async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('skip-1'), 0, { sendOutput })
    await flush()
    expect(getTemplateDownloadState('skip-1')?.status).not.toBe('done')

    const ctrl = new AbortController()
    const settled = awaitTemplateDownloadSettled('skip-1', ctrl.signal)
    requestSkipTemplateDownload('skip-1')
    await vi.advanceTimersByTimeAsync(300) // one poll tick
    await expect(settled).resolves.toBe('skipped')
  })

  it('starts each template model as a real managed model job (issue #1322)', async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('job-1'), 0, { sendOutput })
    await flush()

    // The SAME managed entry point in-Comfy downloads use, carrying the
    // install identity so destination/session resolution matches.
    expect(startManagedModelJob).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'u',
        filename: 'm.safetensors',
        directory: 'checkpoints',
        installationId: 'job-1',
        onProgress: expect.any(Function)
      })
    )
  })

  it("uses the install's effective primary models dir for preflight, not a global dir (#1376)", async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    // Install-aware storage context (useSharedModels / modelDirs / modelDirsPrimary)
    // resolved through the same byId lookup the download manager itself uses.
    resolveDownloadContextById.mockResolvedValue({
      downloadBaseDir: '/install/models',
      modelRoots: ['/install/models'],
      extraPaths: []
    })
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('dest-1'), 1024, { sendOutput })
    await flush()

    // Disk preflight must probe the install-aware base dir, not '/tmp/models'.
    expect(resolveDownloadContextById).toHaveBeenCalledWith('dest-1')
    expect(getDiskSpace).toHaveBeenCalledWith('/install/models')
  })

  it("resolves 'aborted' when the gate's own signal aborts (launch teardown)", async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('abort-1'), 0, { sendOutput })
    await flush()

    const ctrl = new AbortController()
    const settled = awaitTemplateDownloadSettled('abort-1', ctrl.signal)
    ctrl.abort()
    await expect(settled).resolves.toBe('aborted')
  })

  it('clears the skip flag on settle so a later download for the same id is not pre-skipped', async () => {
    resolveTemplateModels.mockResolvedValue([
      { filename: 'm.safetensors', directory: 'checkpoints', url: 'u' }
    ])
    startManagedModelJob.mockImplementation(async () => hangingJob('u'))
    startTemplateDownload(makeInstall('skip-clear'), 0, { sendOutput })
    await flush()

    const ctrl1 = new AbortController()
    const first = awaitTemplateDownloadSettled('skip-clear', ctrl1.signal)
    requestSkipTemplateDownload('skip-clear')
    await vi.advanceTimersByTimeAsync(300)
    await expect(first).resolves.toBe('skipped')

    // Second wait must NOT immediately resolve 'skipped' from the stale flag.
    const ctrl2 = new AbortController()
    const second = awaitTemplateDownloadSettled('skip-clear', ctrl2.signal)
    ctrl2.abort()
    await expect(second).resolves.toBe('aborted')
  })
})
