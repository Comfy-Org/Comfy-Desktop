// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: false },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: {},
  shell: { openPath: vi.fn().mockResolvedValue('') },
  net: { request: vi.fn() },
}))

import { comfybuilder, withAccelArgs } from './index'
import type { InstallationRecord } from '../../installations'

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
