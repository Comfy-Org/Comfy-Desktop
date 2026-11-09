import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { InstallationRecord } from '../../installations'
import type { RestoreResult } from '../../lib/snapshots'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))

vi.mock('../../lib/i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))

vi.mock('../../lib/git', () => ({
  readGitHead: vi.fn(() => null),
  rollbackComfySource: vi.fn(async () => true)
}))

vi.mock('../../lib/popoutWindows', () => ({
  releaseInstallTerminalForFsOp: vi.fn()
}))

vi.mock('./envPaths', () => ({
  getMasterPythonPath: () => '/test/python',
  getActivePythonPath: () => '/test/python',
  getActiveUvPath: () => '/test/uv',
  getInstalledTorchTuple: () => ({ torch: null, torchvision: null, torchaudio: null })
}))

vi.mock('./torchStackTransaction', () => ({
  recoverTorchStackTransaction: vi.fn(async () => {}),
  preflightDiskSpace: vi.fn(async () => {}),
  prepareBundleStack: vi.fn(),
  preparePipStack: vi.fn(),
  applyTorchStackTransaction: vi.fn(),
  DiskSpaceError: class DiskSpaceError extends Error {}
}))

vi.mock('./torchStackCatalog', () => ({
  resolveTorchStack: vi.fn(async () => null),
  resolveSnapshotManagedTarget: vi.fn(async () => null),
  refreshTorchStackCatalog: vi.fn(async () => {})
}))

vi.mock('../../settings', () => ({
  get: vi.fn(() => undefined),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false }))
}))

const installationsGet = vi.hoisted(() => vi.fn())
vi.mock('../../installations', () => ({
  get: (id: string) => installationsGet(id)
}))

const snapshotsMock = vi.hoisted(() => ({
  loadStagedSnapshotEnvelope: vi.fn(),
  loadSnapshot: vi.fn(),
  restoreComfyUIVersion: vi.fn(async () => ({ changed: false, commit: null })),
  restoreCustomNodes: vi.fn(async () => ({
    installed: [],
    switched: [],
    enabled: [],
    disabled: [],
    removed: [],
    failed: [],
    unreportable: []
  })),
  restorePipPackages: vi.fn(
    async (): Promise<RestoreResult> => ({
      installed: [],
      removed: [],
      changed: [],
      protectedSkipped: [],
      failed: [],
      errors: []
    })
  ),
  repairNodeRequirements: vi.fn(async () => ({ changed: [], errors: [] })),
  protectedPackageDrift: vi.fn(async () => []),
  describePackageRevert: vi.fn((revert?: unknown) => (revert ? 'REVERT_NOTE' : 'NO_OUTCOME_NOTE')),
  buildPostRestoreState: vi.fn(() => ({})),
  ensureCurrentSnapshotOnTop: vi.fn(
    async (_installPath: string, _installation: unknown, _label?: string) => ({
      filename: null
    })
  ),
  getSnapshotCount: vi.fn(async () => 1),
  importSnapshots: vi.fn(async () => {}),
  releaseStagedSnapshotEnvelope: vi.fn(async () => {}),
  saveSnapshot: vi.fn(async () => 'post-restore.json'),
  listSnapshots: vi.fn(async () => []),
  deleteSnapshot: vi.fn(async () => {}),
  diffAgainstCurrent: vi.fn(async () => ({}))
}))
vi.mock('../../lib/snapshots', () => snapshotsMock)

import { handleAction } from './actions'
import { resolveSnapshotManagedTarget } from './torchStackCatalog'
import type { ActionTools } from '../../types/sources'

describe('handleAction(snapshot-restore) staged-envelope commit gating', () => {
  let tmpRoot: string
  let installation: InstallationRecord

  const stagedSnapshot = {
    comfyui: { commit: 'abc1234' },
    pipPackages: [],
    skipPipSync: true,
    updateChannel: 'stable'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-gating-'))
    installation = {
      id: 'gating-test',
      name: 'gating-test',
      installPath: tmpRoot,
      sourceId: 'standalone',
      status: 'installed'
    } as unknown as InstallationRecord
    installationsGet.mockImplementation(async () => installation)
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [stagedSnapshot]
    }))
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  function makeTools(signal?: AbortSignal, outputs?: string[]): ActionTools {
    return {
      update: async () => {},
      sendProgress: () => {},
      sendOutput: (text: string) => {
        outputs?.push(text)
      },
      ...(signal ? { signal } : {})
    }
  }

  it('commits and releases a staged envelope when the restore cleanly reaches its target', async () => {
    const result = await handleAction(
      'snapshot-restore',
      installation,
      { restoreToken: 'tok-1' },
      makeTools()
    )

    expect(result.ok).toBe(true)
    expect(snapshotsMock.importSnapshots).toHaveBeenCalledTimes(1)
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).toHaveBeenCalledWith('tok-1')
  })

  it('neither commits nor releases the staged envelope when an abort lands during the final record reload', async () => {
    const controller = new AbortController()
    installationsGet.mockImplementationOnce(async () => {
      controller.abort()
      return installation
    })

    const result = await handleAction(
      'snapshot-restore',
      installation,
      { restoreToken: 'tok-2' },
      makeTools(controller.signal)
    )

    expect(result.ok).toBe(false)
    expect(result.cancelled).toBe(true)
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).not.toHaveBeenCalled()
    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalled()
  })

  it('a failed package phase reports what the revert did, and labels the recorded state', async () => {
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [{ ...stagedSnapshot, skipPipSync: false }]
    }))
    snapshotsMock.restorePipPackages.mockImplementationOnce(async () => ({
      installed: [],
      removed: [],
      changed: [],
      protectedSkipped: [],
      failed: ['ghost-pkg'],
      errors: ['Failed to remove ghost-pkg'],
      revert: {
        reason: 'failures',
        uninstalled: [],
        keptPreexisting: ['aiohttp'],
        restoredFromBackup: false,
        complete: true
      }
    }))

    const result = await handleAction(
      'snapshot-restore',
      installation,
      { restoreToken: 'tok-fail' },
      makeTools()
    )

    expect(result.ok).toBe(false)
    expect(snapshotsMock.describePackageRevert).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'failures', keptPreexisting: ['aiohttp'] })
    )
    expect(result.message).toContain('REVERT_NOTE')
    expect(result.message).not.toContain('reverted where possible')
    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalledWith(
      installation.installPath,
      expect.anything(),
      'snapshots.labelRestoreIncomplete'
    )
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
  })

  it('does not label the post-restore snapshot of a restore that succeeded', async () => {
    await handleAction('snapshot-restore', installation, { restoreToken: 'tok-ok' }, makeTools())

    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalled()
    for (const call of snapshotsMock.ensureCurrentSnapshotOnTop.mock.calls) {
      expect(call[2]).toBeUndefined()
    }
  })

  it('exact mode: unknown protected drift fails the restore, keeps the staged envelope, and discloses why', async () => {
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [{ ...stagedSnapshot, skipPipSync: false }]
    }))
    snapshotsMock.protectedPackageDrift.mockImplementationOnce(async () => {
      throw new Error('python missing')
    })

    const outputs: string[] = []
    const result = await handleAction(
      'snapshot-restore',
      installation,
      { restoreToken: 'tok-3', mode: 'exact' },
      makeTools(undefined, outputs)
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('standalone.snapshotProtectedDriftUnknown')
    expect(outputs.join('')).toContain('standalone.snapshotProtectedDriftUnknown')
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).not.toHaveBeenCalled()
  })

  it('exact mode: a catalog fetch error while resolving the snapshot stack aborts with pytorchCatalogError before any mutation', async () => {
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [
        {
          ...stagedSnapshot,
          torchStack: {
            kind: 'managed',
            ref: {
              stackId: 'pytorch-index:cu130:2.13.0',
              variant: 'win-nvidia',
              pythonVersion: '3.13.2',
              packages: { torch: '2.13.0+cu130' },
              source: { kind: 'pytorch-index', backend: 'cuda', indexTag: 'cu130' }
            }
          }
        }
      ]
    }))
    vi.mocked(resolveSnapshotManagedTarget).mockRejectedValueOnce(new Error('offline'))

    const result = await handleAction(
      'snapshot-restore',
      installation,
      { restoreToken: 'tok-5', mode: 'exact' },
      makeTools()
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('standalone.pytorchCatalogError')
    expect(result.message).toContain('offline')
    expect(snapshotsMock.restorePipPackages).not.toHaveBeenCalled()
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).not.toHaveBeenCalled()
  })

  it('compatible mode: unknown protected drift succeeds with disclosure but never commits the envelope', async () => {
    snapshotsMock.loadStagedSnapshotEnvelope.mockImplementation(async () => ({
      snapshots: [{ ...stagedSnapshot, skipPipSync: false }]
    }))
    snapshotsMock.protectedPackageDrift.mockImplementationOnce(async () => {
      throw new Error('python missing')
    })

    const outputs: string[] = []
    const result = await handleAction(
      'snapshot-restore',
      installation,
      { restoreToken: 'tok-4', mode: 'compatible' },
      makeTools(undefined, outputs)
    )

    expect(result.ok).toBe(true)
    expect(outputs.join('')).toContain('standalone.snapshotProtectedDriftUnknown')
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalled()
    expect(snapshotsMock.releaseStagedSnapshotEnvelope).toHaveBeenCalledWith('tok-4')
  })
})
