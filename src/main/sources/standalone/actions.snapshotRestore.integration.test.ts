// @vitest-environment node
/**
 * Integration tests for the staged-envelope commit gating at the end of
 * `handleAction('snapshot-restore')`. The restore phases themselves are
 * mocked; what is under test is the decision layer: a clean staged restore
 * commits the envelope to history, and an abort landing during the final
 * installation-record reload (after the last mid-phase abort check) must
 * neither commit nor release the staged envelope - the retry target stays
 * staged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { InstallationRecord } from '../../installations'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

// Deterministic no-git environment: no op-marker window, no source rollback.
vi.mock('../../lib/git', () => ({
  readGitHead: vi.fn(() => null),
  rollbackComfySource: vi.fn(async () => true),
}))

vi.mock('../../lib/popoutWindows', () => ({
  releaseInstallTerminalForFsOp: vi.fn(),
}))

vi.mock('./envPaths', () => ({
  getMasterPythonPath: () => '/test/python',
  getActivePythonPath: () => '/test/python',
  getActiveUvPath: () => '/test/uv',
  getInstalledTorchTuple: () => ({ torch: null, torchvision: null, torchaudio: null }),
}))

vi.mock('./torchStackTransaction', () => ({
  recoverTorchStackTransaction: vi.fn(async () => {}),
  preflightDiskSpace: vi.fn(async () => {}),
  prepareBundleStack: vi.fn(),
  preparePipStack: vi.fn(),
  applyTorchStackTransaction: vi.fn(),
  DiskSpaceError: class DiskSpaceError extends Error {},
}))

vi.mock('./torchStackCatalog', () => ({
  resolveTorchStack: vi.fn(async () => null),
  refreshTorchStackCatalog: vi.fn(async () => {}),
}))

vi.mock('../../settings', () => ({
  get: vi.fn(() => undefined),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false })),
}))

const installationsGet = vi.hoisted(() => vi.fn())
vi.mock('../../installations', () => ({
  get: (id: string) => installationsGet(id),
}))

const snapshotsMock = vi.hoisted(() => ({
  loadStagedSnapshotEnvelope: vi.fn(),
  loadSnapshot: vi.fn(),
  restoreComfyUIVersion: vi.fn(async () => ({ changed: false, commit: null })),
  restoreCustomNodes: vi.fn(async () => ({
    installed: [], switched: [], enabled: [], disabled: [], removed: [],
    failed: [], unreportable: [],
  })),
  restorePipPackages: vi.fn(async () => ({
    installed: [], removed: [], changed: [], protectedSkipped: [], failed: [], errors: [],
  })),
  repairNodeRequirements: vi.fn(async () => ({ changed: [], errors: [] })),
  protectedPackageDrift: vi.fn(async () => []),
  buildPostRestoreState: vi.fn(() => ({})),
  ensureCurrentSnapshotOnTop: vi.fn(async () => ({ filename: null })),
  getSnapshotCount: vi.fn(async () => 1),
  importSnapshots: vi.fn(async () => {}),
  releaseStagedSnapshotEnvelope: vi.fn(async () => {}),
  saveSnapshot: vi.fn(async () => 'post-restore.json'),
  // Unused by the restore path; present so other action branches don't crash.
  listSnapshots: vi.fn(async () => []),
  deleteSnapshot: vi.fn(async () => {}),
  diffAgainstCurrent: vi.fn(async () => ({})),
}))
vi.mock('../../lib/snapshots', () => snapshotsMock)

// Import the SUT after all mocks are declared.
import { handleAction } from './actions'
import type { ActionTools } from '../../types/sources'

describe('handleAction(snapshot-restore) staged-envelope commit gating', () => {
  let tmpRoot: string
  let installation: InstallationRecord

  const stagedSnapshot = {
    comfyui: { commit: 'abc1234' },
    pipPackages: [],
    skipPipSync: true,
    updateChannel: 'stable',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-gating-'))
    installation = {
      id: 'gating-test',
      name: 'gating-test',
      installPath: tmpRoot,
      sourceId: 'standalone',
      status: 'installed',
    } as unknown as InstallationRecord
    installationsGet.mockImplementation(async () => installation)
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [stagedSnapshot],
    }))
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  function makeTools(signal?: AbortSignal, outputs?: string[]): ActionTools {
    return {
      update: async () => {},
      sendProgress: () => {},
      sendOutput: (text: string) => { outputs?.push(text) },
      ...(signal ? { signal } : {}),
    }
  }

  it('commits and releases a staged envelope when the restore cleanly reaches its target', async () => {
    const result = await handleAction(
      'snapshot-restore', installation, { restoreToken: 'tok-1' }, makeTools(),
    )

    expect(result.ok).toBe(true)
    expect(snapshotsMock.importSnapshots).toHaveBeenCalledTimes(1)
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).toHaveBeenCalledWith('tok-1')
  })

  it('neither commits nor releases the staged envelope when an abort lands during the final record reload', async () => {
    const controller = new AbortController()
    // The abort arrives while the post-restore `installations.get()` reload is
    // pending - after every mid-phase abort check has already passed. Without
    // the post-reload guard this used to commit (or, on the adapted path,
    // release) the staged envelope of a cancelled restore.
    installationsGet.mockImplementationOnce(async () => {
      controller.abort()
      return installation
    })

    const result = await handleAction(
      'snapshot-restore', installation, { restoreToken: 'tok-2' }, makeTools(controller.signal),
    )

    expect(result.ok).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).not.toHaveBeenCalled()
    // The live state is still recorded on top so "Latest" reflects reality.
    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalled()
  })

  it('exact mode: unknown protected drift fails the restore, keeps the staged envelope, and discloses why', async () => {
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [{ ...stagedSnapshot, skipPipSync: false }],
    }))
    snapshotsMock.protectedPackageDrift.mockImplementationOnce(async () => {
      throw new Error('python missing')
    })

    const outputs: string[] = []
    const result = await handleAction(
      'snapshot-restore', installation,
      { restoreToken: 'tok-3', mode: 'exact' }, makeTools(undefined, outputs),
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('standalone.snapshotProtectedDriftUnknown')
    expect(outputs.join('')).toContain('standalone.snapshotProtectedDriftUnknown')
    // The install never provably reached the imported state: nothing commits,
    // and the staged envelope stays for a retry.
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).not.toHaveBeenCalled()
  })

  it('compatible mode: unknown protected drift succeeds with disclosure but never commits the envelope', async () => {
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [{ ...stagedSnapshot, skipPipSync: false }],
    }))
    snapshotsMock.protectedPackageDrift.mockImplementationOnce(async () => {
      throw new Error('python missing')
    })

    const outputs: string[] = []
    const result = await handleAction(
      'snapshot-restore', installation,
      { restoreToken: 'tok-4', mode: 'compatible' }, makeTools(undefined, outputs),
    )

    expect(result.ok).toBe(true)
    expect(outputs.join('')).toContain('standalone.snapshotProtectedDriftUnknown')
    // Adapted success: the actual state is recorded and the staged file is
    // dropped, but the unverified target is never committed to history.
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalled()
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).toHaveBeenCalledWith('tok-4')
  })
})
