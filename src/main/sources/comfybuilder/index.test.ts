// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn().mockResolvedValue('') },
  net: { request: vi.fn() },
}))

// Stub the library so install() wiring can be asserted without real downloads.
vi.mock('../../comfybuilder', () => ({
  installArtifact: vi.fn(async () => {}),
  buildLaunchSpec: vi.fn(() => null),
  stageModels: vi.fn(async () => {}),
  resolveModelManifest: vi.fn(async () => ({ models: [], modelPolicy: null, partnerNodePolicy: null })),
}))
vi.mock('../../devplatform/session', () => ({ getBuilderClient: vi.fn(() => ({})) }))
vi.mock('../../devplatform/distributions', () => ({
  resolveHost: vi.fn(async () => ({ os: 'linux', gpu: 'nvidia' })),
  resolveHostArtifactForVersion: vi.fn(),
  listCompleteVersions: vi.fn(async () => []),
}))

import { promises as fsp } from 'fs'
import { installArtifact, stageModels, resolveModelManifest } from '../../comfybuilder'
import { resolveHostArtifactForVersion } from '../../devplatform/distributions'
import { comfybuilder, withAccelArgs } from './index'
import type { InstallationRecord } from '../../installations'
import type { InstallTools } from '../../types/sources'

const record = (overrides: Record<string, unknown> = {}): InstallationRecord =>
  ({
    id: 'i1',
    name: 'desktop-4target-stg-v0190',
    sourceId: 'comfybuilder',
    installPath: '/installs/dist',
    status: 'installed',
    distributionId: 'd1',
    distributionName: 'desktop-4target-stg-v0190',
    version: '1',
    ...overrides,
  }) as unknown as InstallationRecord

function fakeTools(signal?: AbortSignal): InstallTools & { sent: Array<{ phase: string; detail: unknown }> } {
  const sent: Array<{ phase: string; detail: unknown }> = []
  return {
    sent,
    sendProgress: (phase: string, detail: unknown) => sent.push({ phase, detail }),
    download: vi.fn(),
    cache: {} as never,
    extract: vi.fn(),
    ...(signal ? { signal } : {}),
  } as never
}

describe('comfybuilder.install wiring', () => {
  beforeEach(() => vi.clearAllMocks())

  it('wipes the venv before extracting so a re-install/update lays down a clean env', async () => {
    const rm = vi.spyOn(fsp, 'rm').mockResolvedValue(undefined)
    try {
      await comfybuilder.install!(record(), fakeTools())
      expect(rm).toHaveBeenCalledWith(
        expect.stringContaining('venv'),
        expect.objectContaining({ recursive: true, force: true }),
      )
      // The venv must be gone before the archive lays down a fresh one.
      const rmOrder = rm.mock.invocationCallOrder[0]!
      const installOrder = (installArtifact as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]!
      expect(rmOrder).toBeLessThan(installOrder)
    } finally {
      rm.mockRestore()
    }
  })

  it('installs the archive, then resolves the manifest, then stages models', async () => {
    const tools = fakeTools()
    await comfybuilder.install!(record(), tools)

    expect(installArtifact).toHaveBeenCalledTimes(1)
    expect(resolveModelManifest).toHaveBeenCalledTimes(1)
    expect(stageModels).toHaveBeenCalledTimes(1)
    // The archive must be in place before models are staged into its tree.
    const archiveOrder = (installArtifact as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]!
    const stageOrder = (stageModels as unknown as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0]!
    expect(archiveOrder).toBeLessThan(stageOrder)

    // The manifest is keyed by the record's distribution + version number.
    expect(resolveModelManifest).toHaveBeenCalledWith(expect.anything(), 'd1', '1')
    // A terminal models progress event fires so the step completes.
    expect(tools.sent.some((s) => s.phase === 'models')).toBe(true)
  })

  it('folds the library resolve phase into the download step', async () => {
    const tools = fakeTools()
    await comfybuilder.install!(record(), tools)
    const onProgress = (installArtifact as unknown as { mock: { calls: Array<[{ onProgress: (p: unknown) => void }]> } }).mock.calls[0]![0].onProgress
    onProgress({ phase: 'resolve', percent: 0 })
    expect(tools.sent.some((s) => s.phase === 'download')).toBe(true)
    expect(tools.sent.some((s) => s.phase === 'resolve')).toBe(false)
  })

  it('threads the abort signal into both phases', async () => {
    const signal = new AbortController().signal
    await comfybuilder.install!(record(), fakeTools(signal))
    expect((installArtifact as unknown as { mock: { calls: Array<[{ signal?: AbortSignal }]> } }).mock.calls[0]![0].signal).toBe(signal)
    expect((stageModels as unknown as { mock: { calls: Array<[{ signal?: AbortSignal }]> } }).mock.calls[0]![0].signal).toBe(signal)
  })
})

describe('comfybuilder.getListActions', () => {
  // Without this the renderer gets an empty action array, reads the install as
  // unlaunchable, and bounces a tile click into the new-install wizard.
  it.each([
    ['installed', 'installed', true],
    ['installing', 'installing', false],
    ['failed', 'failed', false],
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
    expect(comfybuilder.getListPreview!(record({ name: 'My Renamed Install' })))
      .toBe('desktop-4target-stg-v0190')
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
    ['cpu build on an nvidia host (no nvidia build published)', 'cpu', 'cpu', '--enable-manager --cpu'],
    ['nvidia build', 'nvidia', 'cu128', '--enable-manager'],
    ['amd build', 'amd', 'rocm6.2', '--enable-manager'],
    ['mps build', 'mps', 'mps', '--enable-manager'],
  ])('%s', (_name, artifactGpu, artifactAccelVariant, expected) => {
    expect(withAccelArgs(record({ artifactGpu, artifactAccelVariant }), '--enable-manager')).toBe(expected)
  })

  it('falls back to accelVariant when the gpu field is absent', () => {
    expect(withAccelArgs(record({ artifactGpu: undefined, artifactAccelVariant: 'cpu' }), '--enable-manager'))
      .toBe('--enable-manager --cpu')
  })

  it.each(['--cpu', '--enable-manager --cpu', '--cpu --listen'])('does not double up on %s', (args) => {
    expect(withAccelArgs(record({ artifactGpu: 'cpu' }), args)).toBe(args)
  })

  it('does not mistake --cpu-vae for the cpu flag', () => {
    expect(withAccelArgs(record({ artifactGpu: 'cpu' }), '--cpu-vae')).toBe('--cpu-vae --cpu')
  })
})

describe('comfybuilder update-distribution', () => {
  beforeEach(() => vi.clearAllMocks())

  const artifact = {
    id: 'art-9',
    os: 'linux',
    gpu: 'nvidia',
    accelVariant: 'cu128',
    status: 'ready',
    archiveSha256: 'sha-9',
  }

  function actionTools() {
    const updates: Record<string, unknown>[] = []
    return {
      updates,
      update: vi.fn(async (d: Record<string, unknown>) => {
        updates.push(d)
      }),
      sendProgress: vi.fn(),
      sendOutput: vi.fn(),
    }
  }

  it('re-points the record, re-installs, then marks it installed', async () => {
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue({ artifact, version: 9 } as never)
    const tools = actionTools()

    const result = await comfybuilder.handleAction(
      'update-distribution',
      record(),
      { version: 9 },
      tools as never,
    )

    expect(result.ok).toBe(true)
    expect(installArtifact).toHaveBeenCalledTimes(1)
    // Installing first, installed last — never left mid-flight.
    expect(tools.updates[0]).toMatchObject({ version: '9', artifactId: 'art-9', status: 'installing' })
    expect(tools.updates.at(-1)).toMatchObject({ status: 'installed' })
    // The environment is laid down for the NEW artifact, not the old one.
    const passed = vi.mocked(installArtifact).mock.calls[0]![0] as { artifact: { id: string } }
    expect(passed.artifact.id).toBe('art-9')
  })

  it('restores the previous version when the install fails', async () => {
    // Otherwise the record advertises a version whose environment never landed.
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue({ artifact, version: 9 } as never)
    vi.mocked(installArtifact).mockRejectedValueOnce(new Error('disk full'))
    const tools = actionTools()

    const result = await comfybuilder.handleAction(
      'update-distribution',
      record({ artifactId: 'art-1' }),
      { version: 9 },
      tools as never,
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('disk full')
    expect(tools.updates.at(-1)).toMatchObject({ version: '1', artifactId: 'art-1', status: 'installed' })
  })

  it('refuses a version with no build for this machine, without touching the record', async () => {
    vi.mocked(resolveHostArtifactForVersion).mockResolvedValue(null)
    const tools = actionTools()

    const result = await comfybuilder.handleAction(
      'update-distribution',
      record(),
      { version: 4 },
      tools as never,
    )

    expect(result.ok).toBe(false)
    expect(installArtifact).not.toHaveBeenCalled()
    expect(tools.update).not.toHaveBeenCalled()
  })

  it('rejects a missing target version', async () => {
    const tools = actionTools()
    const result = await comfybuilder.handleAction('update-distribution', record(), {}, tools as never)
    expect(result.ok).toBe(false)
    expect(tools.update).not.toHaveBeenCalled()
  })
})
