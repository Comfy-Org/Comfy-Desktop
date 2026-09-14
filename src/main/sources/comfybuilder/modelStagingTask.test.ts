// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const acquireModelDownloadRootLock = vi.hoisted(() =>
  vi.fn<(modelsRoot: string) => (() => void) | null>(() => vi.fn())
)
const releaseParkedModelJobsUnder = vi.hoisted(() => vi.fn<(modelsRoot: string) => void>())
const startManagedModelJob = vi.hoisted(() => vi.fn())
const cancelModelDownload = vi.hoisted(() => vi.fn())
const stageModels = vi.hoisted(() => vi.fn(async (_opts: unknown) => {}))
const resolveModelManifest = vi.hoisted(() =>
  vi.fn(async () => ({ models: [], modelPolicy: null, partnerNodePolicy: null }))
)
const updateInstallation = vi.hoisted(() => vi.fn(async () => null))

vi.mock('../../lib/comfyDownloadManager', () => ({
  acquireModelDownloadRootLock,
  releaseParkedModelJobsUnder,
  startManagedModelJob,
  cancelModelDownload
}))
vi.mock('../../comfybuilder', () => ({
  stageModels,
  installModelsRoot: vi.fn((installPath: string) => `${installPath}/ComfyUI/models`),
  resolveModelManifest
}))
vi.mock('../../devplatform/session', () => ({ getBuilderClient: vi.fn(() => ({})) }))
vi.mock('../../installations', () => ({ update: updateInstallation }))

import {
  abortModelStaging,
  restageBuildModelsIfNeeded,
  startModelStaging
} from './modelStagingTask'
import type { InstallationRecord } from '../../installations'
import type { ModelDescriptor } from '../../comfybuilder'

const record = (overrides: Record<string, unknown> = {}): InstallationRecord =>
  ({
    id: 'i1',
    name: 'build',
    sourceId: 'comfybuilder',
    installPath: '/installs/dist',
    status: 'installed',
    distributionId: 'd1',
    version: '1',
    ...overrides
  }) as unknown as InstallationRecord

const model: ModelDescriptor = {
  type: 'checkpoints',
  filename: 'm.safetensors',
  downloadUrl: 'https://x/m'
} as ModelDescriptor

/** The task is fire-and-forget; poll until its observable effect lands. */
const settle = (check: () => void): Promise<void> => vi.waitFor(check, { timeout: 2000 })

describe('startModelStaging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    abortModelStaging('i1')
    acquireModelDownloadRootLock.mockImplementation(() => vi.fn())
    stageModels.mockImplementation(async () => {})
    resolveModelManifest.mockImplementation(async () => ({
      models: [],
      modelPolicy: null,
      partnerNodePolicy: null
    }))
  })

  it('marks a build with no models as staged without touching the download manager', async () => {
    startModelStaging(record(), [])
    await settle(() =>
      expect(updateInstallation).toHaveBeenCalledWith('i1', { modelsStaged: true })
    )
    expect(stageModels).not.toHaveBeenCalled()
    expect(acquireModelDownloadRootLock).not.toHaveBeenCalled()
  })

  it('stages under the model-root lock on the managed job surface, then records completion', async () => {
    const releaseLock = vi.fn()
    acquireModelDownloadRootLock.mockReturnValueOnce(releaseLock)

    startModelStaging(record(), [model])
    await settle(() =>
      expect(updateInstallation).toHaveBeenCalledWith('i1', { modelsStaged: true })
    )

    expect(releaseParkedModelJobsUnder).toHaveBeenCalledWith('/installs/dist/ComfyUI/models')
    expect(acquireModelDownloadRootLock).toHaveBeenCalledWith('/installs/dist/ComfyUI/models')
    expect(stageModels).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [model],
        installPath: '/installs/dist',
        installationId: 'i1',
        jobs: { start: startManagedModelJob, cancel: cancelModelDownload }
      })
    )
    expect(releaseLock).toHaveBeenCalledOnce()
  })

  it('bails without staging when the model root is busy', async () => {
    acquireModelDownloadRootLock.mockReturnValueOnce(null)

    startModelStaging(record(), [model])
    await settle(() => expect(acquireModelDownloadRootLock).toHaveBeenCalled())
    // Give the task a beat to (incorrectly) continue if it were going to.
    await new Promise((r) => setTimeout(r, 10))

    expect(stageModels).not.toHaveBeenCalled()
    expect(updateInstallation).not.toHaveBeenCalled()
  })

  it('releases the lock and never records completion when staging fails', async () => {
    const releaseLock = vi.fn()
    acquireModelDownloadRootLock.mockReturnValueOnce(releaseLock)
    stageModels.mockRejectedValueOnce(new Error('network down'))

    startModelStaging(record(), [model])
    await settle(() => expect(releaseLock).toHaveBeenCalledOnce())
    await new Promise((r) => setTimeout(r, 10))

    expect(updateInstallation).not.toHaveBeenCalled()
  })

  it('does not record completion for an aborted staging', async () => {
    const releaseLock = vi.fn()
    acquireModelDownloadRootLock.mockReturnValueOnce(releaseLock)
    let seenSignal: AbortSignal | undefined
    stageModels.mockImplementationOnce(async (opts) => {
      seenSignal = (opts as { signal: AbortSignal }).signal
      await new Promise<void>((_resolve, reject) => {
        seenSignal!.addEventListener('abort', () => reject(new Error('Cancelled')), {
          once: true
        })
      })
    })

    startModelStaging(record(), [model])
    await settle(() => expect(stageModels).toHaveBeenCalledOnce())
    abortModelStaging('i1')

    await settle(() => expect(releaseLock).toHaveBeenCalledOnce())
    expect(seenSignal?.aborted).toBe(true)
    expect(updateInstallation).not.toHaveBeenCalled()
  })

  it('ignores a second start while a task is already running', async () => {
    let finish!: () => void
    stageModels.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))

    startModelStaging(record(), [model])
    await settle(() => expect(stageModels).toHaveBeenCalledOnce())
    startModelStaging(record(), [model])
    finish()
    await settle(() =>
      expect(updateInstallation).toHaveBeenCalledWith('i1', { modelsStaged: true })
    )

    expect(stageModels).toHaveBeenCalledOnce()
  })
})

describe('restageBuildModelsIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    abortModelStaging('i1')
    acquireModelDownloadRootLock.mockImplementation(() => vi.fn())
    stageModels.mockImplementation(async () => {})
    resolveModelManifest.mockImplementation(async () => ({
      models: [],
      modelPolicy: null,
      partnerNodePolicy: null
    }))
  })

  it('does nothing when the record is already staged', async () => {
    restageBuildModelsIfNeeded(record({ modelsStaged: true }))
    await new Promise((r) => setTimeout(r, 10))
    expect(resolveModelManifest).not.toHaveBeenCalled()
  })

  it('resolves the manifest and stages the models it declares', async () => {
    resolveModelManifest.mockResolvedValueOnce({
      models: [model],
      modelPolicy: null,
      partnerNodePolicy: null
    } as never)

    restageBuildModelsIfNeeded(record())
    await settle(() =>
      expect(updateInstallation).toHaveBeenCalledWith('i1', { modelsStaged: true })
    )

    expect(resolveModelManifest).toHaveBeenCalledWith(expect.anything(), 'd1', '1')
    expect(stageModels).toHaveBeenCalledWith(expect.objectContaining({ models: [model] }))
  })

  it('stays silent when the manifest cannot be resolved (signed out or offline)', async () => {
    resolveModelManifest.mockRejectedValueOnce(new Error('not signed in'))

    restageBuildModelsIfNeeded(record())
    await settle(() => expect(resolveModelManifest).toHaveBeenCalledOnce())
    await new Promise((r) => setTimeout(r, 10))

    expect(stageModels).not.toHaveBeenCalled()
    expect(updateInstallation).not.toHaveBeenCalled()
  })
})
