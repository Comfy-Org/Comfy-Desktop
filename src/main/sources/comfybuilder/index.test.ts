// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const acquireModelDownloadRootLock = vi.hoisted(() =>
  vi.fn<(modelsRoot: string) => (() => void) | null>(() => vi.fn())
)
const releaseParkedModelJobsUnder = vi.hoisted(() => vi.fn<(modelsRoot: string) => void>())
const startManagedModelJob = vi.hoisted(() => vi.fn())
const cancelModelDownload = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn().mockResolvedValue('') },
  net: { request: vi.fn() }
}))

// Stub the library so install() wiring can be asserted without real downloads.
vi.mock('../../comfybuilder', () => ({
  installArtifact: vi.fn(async () => {}),
  buildLaunchSpec: vi.fn(() => null),
  stageModels: vi.fn(async () => {}),
  installModelsRoot: vi.fn((installPath: string) => `${installPath}/ComfyUI/models`),
  normalizeSha256: vi.fn((value: string | undefined) => value?.trim() ?? ''),
  resolveModelManifest: vi.fn(async () => ({
    models: [],
    modelPolicy: null,
    partnerNodePolicy: null
  }))
}))
vi.mock('../../devplatform/session', () => ({ getBuilderClient: vi.fn(() => ({})) }))
vi.mock('../../lib/comfyDownloadManager', () => ({
  acquireModelDownloadRootLock,
  releaseParkedModelJobsUnder,
  startManagedModelJob,
  cancelModelDownload
}))
vi.mock('../../devplatform/distributions', () => ({
  resolveHost: vi.fn(async () => ({ os: 'linux', gpu: 'nvidia' })),
  resolveHostArtifactForVersion: vi.fn(),
  listCompleteVersions: vi.fn(async () => [])
}))

import fs, { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'
import { installArtifact, stageModels, resolveModelManifest } from '../../comfybuilder'
import {
  listCompleteVersions,
  resolveHostArtifactForVersion
} from '../../devplatform/distributions'
import {
  clearVersionCache,
  getCachedVersions,
  getVersionCacheGeneration,
  setCachedVersions
} from '../../devplatform/versionCache'
import {
  comfybuilder,
  finalizeComfyBuilderRecovery,
  recoverComfyBuilderInstallation,
  withAccelArgs
} from './index'
import type { InstallationRecord } from '../../installations'
import type { InstallTools } from '../../types/sources'

const realFsp = {
  access: fsp.access.bind(fsp),
  mkdir: fsp.mkdir.bind(fsp),
  rename: fsp.rename.bind(fsp),
  rm: fsp.rm.bind(fsp),
  writeFile: fsp.writeFile.bind(fsp)
}

const record = (overrides: Record<string, unknown> = {}): InstallationRecord =>
  ({
    id: 'i1',
    name: 'desktop-4target-stg-v0190',
    sourceId: 'comfybuilder',
    installPath: '/installs/dist',
    status: 'installed',
    useSharedModels: false,
    distributionId: 'd1',
    distributionName: 'desktop-4target-stg-v0190',
    version: '1',
    // Every real record carries its build identity (written by installDistribution).
    artifactId: 'art-default',
    artifactOs: 'linux',
    artifactGpu: 'nvidia',
    artifactAccelVariant: 'cu128',
    ...overrides
  }) as unknown as InstallationRecord

function fakeTools(
  signal?: AbortSignal
): InstallTools & { sent: Array<{ phase: string; detail: unknown }> } {
  const sent: Array<{ phase: string; detail: unknown }> = []
  return {
    sent,
    sendProgress: (phase: string, detail: unknown) => sent.push({ phase, detail }),
    download: vi.fn(),
    cache: {} as never,
    extract: vi.fn(),
    ...(signal ? { signal } : {})
  } as never
}

describe('comfybuilder.install wiring', () => {
  let access: ReturnType<typeof vi.spyOn>
  let mkdir: ReturnType<typeof vi.spyOn>
  let rename: ReturnType<typeof vi.spyOn>
  let rm: ReturnType<typeof vi.spyOn>
  let writeFile: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    access = vi
      .spyOn(fsp, 'access')
      .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    mkdir = vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined)
    rename = vi.spyOn(fsp, 'rename').mockResolvedValue(undefined)
    rm = vi.spyOn(fsp, 'rm').mockResolvedValue(undefined)
    writeFile = vi.spyOn(fsp, 'writeFile').mockResolvedValue(undefined)
  })
  afterEach(() => {
    access.mockRestore()
    mkdir.mockRestore()
    rename.mockRestore()
    rm.mockRestore()
    writeFile.mockRestore()
  })

  it('moves both executable trees aside while preserving models', async () => {
    const releaseModelRoot = vi.fn()
    acquireModelDownloadRootLock.mockReturnValueOnce(releaseModelRoot)
    const rename = vi.spyOn(fsp, 'rename').mockResolvedValue(undefined)
    const rm = vi.spyOn(fsp, 'rm').mockResolvedValue(undefined)
    const mkdir = vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined)
    try {
      await comfybuilder.install!(record(), fakeTools())
      expect(rename).toHaveBeenCalledWith(
        expect.stringContaining('venv'),
        expect.stringContaining('venv.previous')
      )
      expect(rename).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]ComfyUI$/),
        expect.stringContaining('ComfyUI.previous')
      )
      expect(rename).toHaveBeenCalledWith(
        expect.stringContaining('.comfybuilder-models-preserved'),
        expect.stringMatching(/[\\/]ComfyUI[\\/]models$/)
      )
      const renameOrder = rename.mock.invocationCallOrder[0]!
      const installOrder = (
        installArtifact as unknown as { mock: { invocationCallOrder: number[] } }
      ).mock.invocationCallOrder[0]!
      expect(renameOrder).toBeLessThan(installOrder)
      expect(acquireModelDownloadRootLock).toHaveBeenCalledWith('/installs/dist/ComfyUI/models')
      // Stale parked rows must be retired before the lock is taken, or they
      // would keep the root busy forever.
      expect(releaseParkedModelJobsUnder).toHaveBeenCalledWith('/installs/dist/ComfyUI/models')
      expect(releaseParkedModelJobsUnder.mock.invocationCallOrder[0]!).toBeLessThan(
        acquireModelDownloadRootLock.mock.invocationCallOrder[0]!
      )
      expect(releaseModelRoot).toHaveBeenCalledOnce()
    } finally {
      rename.mockRestore()
      rm.mockRestore()
      mkdir.mockRestore()
    }
  })

  it('puts the previous code, venv, and preserved models back when install fails', async () => {
    const releaseModelRoot = vi.fn()
    acquireModelDownloadRootLock.mockReturnValueOnce(releaseModelRoot)
    const rename = vi.spyOn(fsp, 'rename').mockResolvedValue(undefined)
    const rm = vi.spyOn(fsp, 'rm').mockResolvedValue(undefined)
    const mkdir = vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined)
    vi.mocked(installArtifact).mockRejectedValueOnce(new Error('disk full'))
    try {
      await expect(comfybuilder.install!(record(), fakeTools())).rejects.toThrow('disk full')
      expect(rename).toHaveBeenCalledWith(
        expect.stringContaining('venv.previous'),
        expect.stringMatching(/[\\/]venv$/)
      )
      expect(rename).toHaveBeenCalledWith(
        expect.stringContaining('ComfyUI.previous'),
        expect.stringMatching(/[\\/]ComfyUI$/)
      )
      expect(rename).toHaveBeenLastCalledWith(
        expect.stringContaining('venv.previous'),
        expect.stringMatching(/[\\/]venv$/)
      )
      expect(releaseModelRoot).toHaveBeenCalledOnce()
    } finally {
      rename.mockRestore()
      rm.mockRestore()
      mkdir.mockRestore()
    }
  })

  // A record without its build identity is corrupt: reject it with a clear
  // message before touching the environment, instead of silently installing
  // a target the record never chose.
  it('rejects a record missing its artifact identity before mutating anything', async () => {
    acquireModelDownloadRootLock.mockReturnValueOnce(vi.fn())
    const rename = vi.spyOn(fsp, 'rename').mockResolvedValue(undefined)
    try {
      await expect(
        comfybuilder.install!(
          record({ artifactOs: undefined, artifactGpu: undefined }),
          fakeTools()
        )
      ).rejects.toThrow(/build identity/)
      expect(installArtifact).not.toHaveBeenCalled()
      expect(rename).not.toHaveBeenCalled()
    } finally {
      rename.mockRestore()
    }
  })

  it('refuses to mutate the environment while its model root is busy', async () => {
    acquireModelDownloadRootLock.mockReturnValueOnce(null)

    await expect(comfybuilder.install!(record(), fakeTools())).rejects.toThrow(
      /model directory is busy/i
    )
    expect(installArtifact).not.toHaveBeenCalled()
    expect(stageModels).not.toHaveBeenCalled()
  })

  it('installs the archive, then resolves the manifest, then stages models', async () => {
    const tools = fakeTools()
    await comfybuilder.install!(record(), tools)

    expect(installArtifact).toHaveBeenCalledTimes(1)
    expect(resolveModelManifest).toHaveBeenCalledTimes(1)
    expect(stageModels).toHaveBeenCalledTimes(1)
    // The archive must be in place before models are staged into its tree.
    const archiveOrder = (installArtifact as unknown as { mock: { invocationCallOrder: number[] } })
      .mock.invocationCallOrder[0]!
    const stageOrder = (stageModels as unknown as { mock: { invocationCallOrder: number[] } }).mock
      .invocationCallOrder[0]!
    expect(archiveOrder).toBeLessThan(stageOrder)

    // The manifest is keyed by the record's distribution + version number.
    expect(resolveModelManifest).toHaveBeenCalledWith(expect.anything(), 'd1', '1')
    // Staging runs on the managed download surface, not an ad-hoc downloader.
    expect(stageModels).toHaveBeenCalledWith(
      expect.objectContaining({
        jobs: { start: startManagedModelJob, cancel: cancelModelDownload }
      })
    )
    // A terminal models progress event fires so the step completes.
    expect(tools.sent.some((s) => s.phase === 'models')).toBe(true)
  })

  it('folds the library resolve phase into the download step', async () => {
    const tools = fakeTools()
    await comfybuilder.install!(record(), tools)
    const onProgress = (
      installArtifact as unknown as {
        mock: { calls: Array<[{ onProgress: (p: unknown) => void }]> }
      }
    ).mock.calls[0]![0].onProgress
    onProgress({ phase: 'resolve', percent: 0 })
    expect(tools.sent.some((s) => s.phase === 'download')).toBe(true)
    expect(tools.sent.some((s) => s.phase === 'resolve')).toBe(false)
  })

  it('threads the abort signal into both phases', async () => {
    const signal = new AbortController().signal
    await comfybuilder.install!(record(), fakeTools(signal))
    expect(
      (installArtifact as unknown as { mock: { calls: Array<[{ signal?: AbortSignal }]> } }).mock
        .calls[0]![0].signal
    ).toBe(signal)
    expect(
      (stageModels as unknown as { mock: { calls: Array<[{ signal?: AbortSignal }]> } }).mock
        .calls[0]![0].signal
    ).toBe(signal)
  })
})

describe('comfybuilder interrupted-install recovery', () => {
  it('migrates existing distribution records to isolated model storage', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'comfybuilder-isolation-'))
    try {
      await expect(
        recoverComfyBuilderInstallation(record({ installPath: root, useSharedModels: undefined }))
      ).resolves.toEqual({ action: 'update', data: { useSharedModels: false } })
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('restores record metadata when shutdown happens before the filesystem swap', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'comfybuilder-pending-'))
    try {
      await fsp.mkdir(path.join(root, 'venv'), { recursive: true })
      await fsp.mkdir(path.join(root, 'ComfyUI'), { recursive: true })
      await fsp.writeFile(path.join(root, 'ComfyUI', 'main.py'), 'old code')
      const result = await recoverComfyBuilderInstallation(
        record({
          installPath: root,
          version: '9',
          artifactId: 'new',
          status: 'installing',
          comfybuilderRollback: {
            version: '1',
            artifactId: 'old',
            status: 'installed'
          }
        })
      )
      expect(result).toEqual({
        action: 'update',
        data: expect.objectContaining({ version: '1', artifactId: 'old', status: 'installed' })
      })
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('restores both old trees, models, and record metadata after an interrupted update', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'comfybuilder-recovery-'))
    try {
      await fsp.mkdir(path.join(root, 'venv.previous'), { recursive: true })
      await fsp.writeFile(path.join(root, 'venv.previous', 'old.txt'), 'old venv')
      await fsp.mkdir(path.join(root, 'ComfyUI.previous'), { recursive: true })
      await fsp.writeFile(path.join(root, 'ComfyUI.previous', 'main.py'), 'old code')
      await fsp.mkdir(path.join(root, 'venv'), { recursive: true })
      await fsp.writeFile(path.join(root, 'venv', 'new.txt'), 'partial venv')
      await fsp.mkdir(path.join(root, 'ComfyUI', 'models'), { recursive: true })
      await fsp.writeFile(path.join(root, 'ComfyUI', 'models', 'user.safetensors'), 'model')

      const result = await recoverComfyBuilderInstallation(
        record({
          installPath: root,
          version: '9',
          artifactId: 'new',
          status: 'installing',
          comfybuilderRollback: {
            version: '1',
            artifactId: 'old',
            status: 'installed'
          }
        })
      )

      expect(result).toEqual({
        action: 'update',
        data: expect.objectContaining({ version: '1', artifactId: 'old', status: 'installed' })
      })
      await expect(fsp.readFile(path.join(root, 'venv', 'old.txt'), 'utf8')).resolves.toBe(
        'old venv'
      )
      await expect(fsp.readFile(path.join(root, 'ComfyUI', 'main.py'), 'utf8')).resolves.toBe(
        'old code'
      )
      await expect(
        fsp.readFile(path.join(root, 'ComfyUI', 'models', 'user.safetensors'), 'utf8')
      ).resolves.toBe('model')
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('keeps the commit marker until recovered metadata is persisted', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'comfybuilder-ready-'))
    try {
      await fsp.mkdir(path.join(root, 'venv'), { recursive: true })
      await fsp.mkdir(path.join(root, 'ComfyUI'), { recursive: true })
      await fsp.writeFile(path.join(root, 'ComfyUI', 'main.py'), 'new code')
      await fsp.mkdir(path.join(root, 'venv.previous'), { recursive: true })
      await fsp.mkdir(path.join(root, 'ComfyUI.previous'), { recursive: true })
      await fsp.writeFile(path.join(root, '.comfybuilder-environment-ready'), '')

      const result = await recoverComfyBuilderInstallation(
        record({ installPath: root, version: '9', status: 'installing' })
      )

      expect(result).toEqual({
        action: 'update',
        data: { status: 'installed', comfybuilderRollback: undefined }
      })
      await expect(fsp.access(path.join(root, 'ComfyUI', 'main.py'))).resolves.toBeUndefined()
      await expect(
        fsp.access(path.join(root, '.comfybuilder-environment-ready'))
      ).resolves.toBeUndefined()

      // If shutdown happens before the caller persists `result.data`, the same
      // record is recovered again rather than being mistaken for a failed install.
      await expect(
        recoverComfyBuilderInstallation(
          record({ installPath: root, version: '9', status: 'installing' })
        )
      ).resolves.toEqual(result)

      await finalizeComfyBuilderRecovery(root)
      await expect(fsp.access(path.join(root, 'venv.previous'))).rejects.toThrow()
      await expect(fsp.access(path.join(root, '.comfybuilder-environment-ready'))).rejects.toThrow()
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('makes a fresh interrupted install visible as failed without deleting its path', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'comfybuilder-fresh-'))
    try {
      await expect(
        recoverComfyBuilderInstallation(record({ installPath: root, status: 'installing' }))
      ).resolves.toEqual({ action: 'update', data: { status: 'failed' } })
      await expect(fsp.access(root)).resolves.toBeUndefined()
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })
})

describe('comfybuilder.getListActions', () => {
  // Without this the renderer gets an empty action array, reads the install as
  // unlaunchable, and bounces a tile click into the new-install wizard.
  it.each([
    ['installed', 'installed', true],
    ['installing', 'installing', false],
    ['failed', 'failed', false]
  ])('exposes a launch action for a %s install (enabled=%s)', (_name, status, enabled) => {
    const actions = comfybuilder.getListActions!(record({ status }))
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ id: 'launch', style: 'primary', enabled })
  })

  it('surfaces the launch progress UI so the boot wait is not silent', () => {
    const [action] = comfybuilder.getListActions!(record())
    expect(action).toMatchObject({ showProgress: true, cancellable: true })
    expect(action!.progressTitle).toBeTruthy()
  })

  it('explains itself when disabled', () => {
    const [action] = comfybuilder.getListActions!(record({ status: 'installing' }))
    expect(action!.disabledMessage).toBeTruthy()
  })
})

describe('comfybuilder.getListPreview', () => {
  it('yields to the source label when it would echo the tile title', () => {
    expect(comfybuilder.getListPreview!(record())).toBeNull()
  })

  it('surfaces the distribution once a rename has made the two differ', () => {
    expect(comfybuilder.getListPreview!(record({ name: 'My Renamed Install' }))).toBe(
      'desktop-4target-stg-v0190'
    )
  })
})

describe('comfybuilder.withAccelArgs', () => {
  // The flag tracks the INSTALLED ARTIFACT, not the host. `selectArtifactForHost`
  // treats a cpu build as the universal fallback, so an nvidia machine lands on
  // a cpu artifact whenever the distribution has no nvidia build: that torch is
  // still CPU-only and ComfyUI would assert "Torch not compiled with CUDA
  // enabled" without --cpu. nvidia/amd/mps builds bring their own accelerated
  // torch and are auto-detected, so they take no flag.
  it.each([
    ['cpu build', 'cpu', 'cpu', '--enable-manager --cpu'],
    [
      'cpu build on an nvidia host (no nvidia build published)',
      'cpu',
      'cpu',
      '--enable-manager --cpu'
    ],
    ['nvidia build', 'nvidia', 'cu128', '--enable-manager'],
    ['amd build', 'amd', 'rocm6.2', '--enable-manager'],
    ['mps build', 'mps', 'mps', '--enable-manager']
  ])('%s', (_name, artifactGpu, artifactAccelVariant, expected) => {
    expect(withAccelArgs(record({ artifactGpu, artifactAccelVariant }), '--enable-manager')).toBe(
      expected
    )
  })

  it('falls back to accelVariant when the gpu field is absent', () => {
    expect(
      withAccelArgs(
        record({ artifactGpu: undefined, artifactAccelVariant: 'cpu' }),
        '--enable-manager'
      )
    ).toBe('--enable-manager --cpu')
  })

  it.each(['--cpu', '--enable-manager --cpu', '--cpu --listen'])(
    'does not double up on %s',
    (args) => {
      expect(withAccelArgs(record({ artifactGpu: 'cpu' }), args)).toBe(args)
    }
  )

  it('does not mistake --cpu-vae for the cpu flag', () => {
    expect(withAccelArgs(record({ artifactGpu: 'cpu' }), '--cpu-vae')).toBe('--cpu-vae --cpu')
  })
})

describe('comfybuilder update status', () => {
  beforeEach(() => clearVersionCache())

  it('exposes the generic update tag and action when a newer version is cached', () => {
    setCachedVersions('d1', [9, 1])
    expect(comfybuilder.getStatusTag?.(record())).toEqual({
      style: 'update',
      version: 'v9',
      label: 'comfybuilder.updateToVersion'
    })
    const actions = comfybuilder
      .getDetailSections?.(record())
      .flatMap((section) => (section.actions as Array<{ id: string }> | undefined) ?? [])
    expect(actions?.some((action) => action.id === 'update-comfyui')).toBe(true)
  })
})

describe('comfybuilder update-comfyui', () => {
  let access: ReturnType<typeof vi.spyOn>
  let mkdir: ReturnType<typeof vi.spyOn>
  let rename: ReturnType<typeof vi.spyOn>
  let rm: ReturnType<typeof vi.spyOn>
  let writeFile: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.clearAllMocks()
    access = vi
      .spyOn(fsp, 'access')
      .mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    mkdir = vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined)
    rename = vi.spyOn(fsp, 'rename').mockResolvedValue(undefined)
    rm = vi.spyOn(fsp, 'rm').mockResolvedValue(undefined)
    writeFile = vi.spyOn(fsp, 'writeFile').mockResolvedValue(undefined)
  })
  afterEach(() => {
    access.mockRestore()
    mkdir.mockRestore()
    rename.mockRestore()
    rm.mockRestore()
    writeFile.mockRestore()
  })

  const artifact = {
    id: 'art-9',
    os: 'linux',
    gpu: 'nvidia',
    accelVariant: 'cu128',
    status: 'ready',
    archiveSha256: 'sha-9'
  }

  function actionTools() {
    const updates: Record<string, unknown>[] = []
    return {
      updates,
      update: vi.fn(async (d: Record<string, unknown>) => {
        updates.push(d)
      }),
      sendProgress: vi.fn(),
      sendOutput: vi.fn()
    }
  }

  it('re-points the record, re-installs, then marks it installed', async () => {
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue({ artifact, version: 9 } as never)
    const tools = actionTools()

    const result = await comfybuilder.handleAction(
      'update-comfyui',
      record(),
      { version: 9 },
      tools as never
    )

    expect(result.ok).toBe(true)
    expect(installArtifact).toHaveBeenCalledTimes(1)
    // Installing first, installed last — never left mid-flight.
    expect(tools.updates[0]).toMatchObject({
      version: '9',
      artifactId: 'art-9',
      status: 'installing'
    })
    expect(tools.updates.at(-1)).toMatchObject({ status: 'installed' })
    // The environment is laid down for the NEW artifact, not the old one.
    const passed = vi.mocked(installArtifact).mock.calls[0]![0] as { artifact: { id: string } }
    expect(passed.artifact.id).toBe('art-9')
  })

  it('restores the previous version when the install fails', async () => {
    // Otherwise the record advertises a version whose environment never landed.
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue({ artifact, version: 9 } as never)
    vi.mocked(installArtifact).mockRejectedValueOnce(new Error('disk full'))
    // The venv survived — `installEnvironment` put it back.
    const stat = vi.spyOn(fsp, 'stat').mockResolvedValue({} as never)
    const tools = actionTools()

    try {
      const result = await comfybuilder.handleAction(
        'update-comfyui',
        record({ artifactId: 'art-1' }),
        { version: 9 },
        tools as never
      )

      expect(result.ok).toBe(false)
      expect(result.message).toContain('disk full')
      expect(tools.updates.at(-1)).toMatchObject({
        version: '1',
        artifactId: 'art-1',
        status: 'installed'
      })
    } finally {
      stat.mockRestore()
    }
  })

  it('reports failed when the environment did not survive the attempt', async () => {
    // Restoring the record but still claiming `installed` would advertise a
    // working install that cannot launch.
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue({ artifact, version: 9 } as never)
    vi.mocked(installArtifact).mockRejectedValueOnce(new Error('disk full'))
    const stat = vi.spyOn(fsp, 'stat').mockRejectedValue(new Error('ENOENT'))
    const tools = actionTools()

    try {
      const result = await comfybuilder.handleAction(
        'update-comfyui',
        record({ artifactId: 'art-1' }),
        { version: 9 },
        tools as never
      )

      expect(result.ok).toBe(false)
      expect(tools.updates.at(-1)).toMatchObject({ version: '1', status: 'failed' })
    } finally {
      stat.mockRestore()
    }
  })

  it('keeps rollback metadata when filesystem restoration stops partway', async () => {
    access.mockImplementation(realFsp.access)
    mkdir.mockImplementation(realFsp.mkdir)
    rename.mockImplementation(realFsp.rename)
    writeFile.mockImplementation(realFsp.writeFile)
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'comfybuilder-restore-failure-'))
    fs.mkdirSync(path.join(root, 'venv'), { recursive: true })
    fs.mkdirSync(path.join(root, 'ComfyUI', 'models'), { recursive: true })
    fs.writeFileSync(path.join(root, 'ComfyUI', 'main.py'), 'old code')
    fs.writeFileSync(path.join(root, 'ComfyUI', 'models', 'user.safetensors'), 'model')

    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue({ artifact, version: 9 } as never)
    vi.mocked(installArtifact).mockImplementationOnce(async ({ installPath }) => {
      fs.mkdirSync(path.join(installPath, 'venv'), { recursive: true })
      fs.writeFileSync(path.join(installPath, 'venv', 'new.txt'), 'partial venv')
      throw new Error('disk full')
    })
    const previousVenv = path.join(root, 'venv.previous')
    const activeVenv = path.join(root, 'venv')
    rm.mockImplementation(async (target: fs.PathLike, options?: fs.RmOptions) => {
      if (String(target) === activeVenv) {
        throw new Error('venv restore failed')
      }
      return realFsp.rm(target, options)
    })
    const tools = actionTools()

    try {
      const result = await comfybuilder.handleAction(
        'update-comfyui',
        record({ installPath: root, artifactId: 'art-1' }),
        { version: 9 },
        tools as never
      )

      expect(result.ok).toBe(false)
      expect(tools.updates.at(-1)).toMatchObject({
        version: '1',
        status: 'failed',
        comfybuilderRollback: expect.objectContaining({ version: '1', artifactId: 'art-1' })
      })
      await expect(fsp.access(previousVenv)).resolves.toBeUndefined()
    } finally {
      await fsp.rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to update an install that is not ready', async () => {
    // The section disables the button, but an action id is reachable alone.
    const tools = actionTools()
    const result = await comfybuilder.handleAction(
      'update-comfyui',
      record({ status: 'failed' }),
      { version: 9 },
      tools as never
    )

    expect(result.ok).toBe(false)
    expect(resolveHostArtifactForVersion).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('refuses a version with no build for this machine, without touching the record', async () => {
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue(null)
    const tools = actionTools()

    const result = await comfybuilder.handleAction(
      'update-comfyui',
      record(),
      { version: 4 },
      tools as never
    )

    expect(result.ok).toBe(false)
    expect(installArtifact).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('refuses a build with no integrity value before touching the record', async () => {
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue({
      artifact: { ...artifact, archiveSha256: undefined },
      version: 9
    } as never)
    const tools = actionTools()

    const result = await comfybuilder.handleAction(
      'update-comfyui',
      record(),
      { version: 9 },
      tools as never
    )

    expect(result.ok).toBe(false)
    expect(installArtifact).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('rejects a missing target version', async () => {
    const tools = actionTools()
    const result = await comfybuilder.handleAction('update-comfyui', record(), {}, tools as never)
    expect(result.ok).toBe(false)
    expect(tools.update).not.toHaveBeenCalled()
  })
})

describe('comfybuilder check-update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearVersionCache()
  })

  it('warms the version cache from the catalog', async () => {
    vi.mocked(listCompleteVersions).mockResolvedValue([7, 3])
    const result = await comfybuilder.handleAction(
      'check-update',
      record(),
      undefined,
      fakeTools() as never
    )
    expect(result.ok).toBe(true)
    expect(getCachedVersions('d1')?.versions).toEqual([7, 3])
  })

  it('reports failure and leaves the cache untouched when the catalog read throws', async () => {
    vi.mocked(listCompleteVersions).mockRejectedValueOnce(new Error('offline'))
    const result = await comfybuilder.handleAction(
      'check-update',
      record(),
      undefined,
      fakeTools() as never
    )
    expect(result.ok).toBe(false)
    expect(result.message).toContain('offline')
    expect(getCachedVersions('d1')).toBeNull()
  })

  it('does not cache an update check completed after authentication changed', async () => {
    let resolveVersions!: (versions: number[]) => void
    vi.mocked(listCompleteVersions).mockReturnValueOnce(
      new Promise<number[]>((resolve) => {
        resolveVersions = resolve
      })
    )
    const result = comfybuilder.handleAction(
      'check-update',
      record(),
      undefined,
      fakeTools() as never
    )
    const startedGeneration = getVersionCacheGeneration()
    clearVersionCache()
    expect(getVersionCacheGeneration()).toBeGreaterThan(startedGeneration)
    resolveVersions([9])

    await expect(result).resolves.toEqual({ ok: true })
    expect(getCachedVersions('d1')).toBeNull()
  })
})
