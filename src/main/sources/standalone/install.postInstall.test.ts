import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChildProcessModule from 'child_process'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const execFile = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: () => void) => {
    setImmediate(cb)
    return { kill: () => true }
  })
  return { ...actual, execFile, default: { ...actual, execFile } }
})
vi.mock('../../lib/telemetry', () => ({ emit: vi.fn() }))
vi.mock('../../lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../lib/copy', () => ({ copyDirWithProgress: vi.fn(async () => {}) }))
vi.mock('./macRepair', () => ({
  repairMacBinaries: vi.fn(async () => {}),
  codesignBinaries: vi.fn(async () => {})
}))
vi.mock('../../lib/git', () => ({
  readGitHead: vi.fn(() => null),
  isGitAvailable: vi.fn(async () => true),
  isPygit2Configured: vi.fn(() => true),
  tryConfigurePygit2Fallback: vi.fn(async () => {}),
  fetchTags: vi.fn(async () => {})
}))
vi.mock('../../lib/snapshots', () => ({
  saveSnapshot: vi.fn(async () => 'boot.json'),
  getSnapshotCount: vi.fn(async () => 1)
}))
vi.mock('../../lib/comfyui-releases', () => ({
  fetchLatestRelease: vi.fn(async () => ({ tag_name: 'v0.44.0' }))
}))
vi.mock('./updateOrchestrator', () => ({ runComfyUIUpdate: vi.fn() }))

import { postInstall } from './install'
import { runComfyUIUpdate } from './updateOrchestrator'
import { emit } from '../../lib/telemetry'
import type { InstallationRecord } from '../../installations'

describe('standalone postInstall ComfyUI update', () => {
  let root: string
  let installation: InstallationRecord

  beforeEach(() => {
    vi.clearAllMocks()
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-post-'))
    const site =
      process.platform === 'win32'
        ? path.join('Lib', 'site-packages')
        : path.join('lib', 'python3.12', 'site-packages')
    fs.mkdirSync(path.join(root, 'standalone-env', site), { recursive: true })
    fs.mkdirSync(path.join(root, 'ComfyUI', '.venv', site), { recursive: true })
    fs.mkdirSync(path.join(root, 'ComfyUI', '.git'), { recursive: true })
    installation = {
      id: 'inst-1',
      installPath: root,
      autoUpdateComfyUI: true,
      comfyVersion: { baseTag: 'v0.42.1', commitsAhead: 0 }
    } as unknown as InstallationRecord
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const depsSyncEnd = (): Record<string, unknown> | undefined =>
    vi
      .mocked(emit)
      .mock.calls.map(([, props]) => props as Record<string, unknown>)
      .find((p) => p.phase === 'torch_deps_sync' && p.status === 'end')

  it('finishes the install, says why the update failed, and tags the phase as aborted', async () => {
    vi.mocked(runComfyUIUpdate).mockResolvedValue({
      ok: false,
      message: 'requirements install exited with code 1\n\nerror: No solution found',
      installation
    })
    const progress: Array<[string, Record<string, unknown>]> = []

    await expect(
      postInstall(installation, {
        sendProgress: (step, data) => progress.push([step, data]),
        update: async () => {}
      })
    ).resolves.toBeUndefined()

    expect(progress.at(-1)).toEqual([
      'update',
      { percent: 100, status: 'Update failed: requirements install exited with code 1' }
    ])
    expect(depsSyncEnd(), 'counted, without failing the phase').toMatchObject({
      update_aborted: 1
    })
  })

  it('points at the app log when the failed update carries no message', async () => {
    vi.mocked(runComfyUIUpdate).mockResolvedValue({ ok: false, installation })
    const progress: Array<[string, Record<string, unknown>]> = []

    await postInstall(installation, {
      sendProgress: (step, data) => progress.push([step, data]),
      update: async () => {}
    })

    expect(progress.at(-1)).toEqual([
      'update',
      { percent: 100, status: 'Update failed: see the app log' }
    ])
  })

  it('counts no failed update when the user cancels it', async () => {
    const abort = new AbortController()
    vi.mocked(runComfyUIUpdate).mockImplementation(async () => {
      abort.abort()
      return { ok: false, message: 'Cancelled', installation }
    })
    const progress: Array<[string, Record<string, unknown>]> = []

    await postInstall(installation, {
      sendProgress: (step, data) => progress.push([step, data]),
      update: async () => {},
      signal: abort.signal
    })

    expect(progress.at(-1)).toEqual(['update', { percent: 100, status: 'Cancelled' }])
    expect(depsSyncEnd()).not.toHaveProperty('update_aborted')
  })

  it('leaves the phase untagged when the update applies', async () => {
    vi.mocked(runComfyUIUpdate).mockResolvedValue({ ok: true, installation })
    const progress: Array<[string, Record<string, unknown>]> = []

    await postInstall(installation, {
      sendProgress: (step, data) => progress.push([step, data]),
      update: async () => {}
    })

    expect(progress.at(-1)).toEqual(['update', { percent: 100, status: 'Up to date' }])
    expect(depsSyncEnd()).toBeDefined()
    expect(depsSyncEnd()).not.toHaveProperty('update_aborted')
  })
})
