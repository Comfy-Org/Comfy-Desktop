// @vitest-environment node
/**
 * Integration tests for the envelope commit gating in
 * `restoreSnapshotIntoInstallation` (fresh-install migration restore): the
 * imported envelope commits only when the recorded state was provably
 * reached. Legacy partial torch records compare tag-aware (+cpu vs +cu121),
 * and unverifiable protected drift blocks the commit and is disclosed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { InstallationRecord } from '../installations'

vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => '' },
  ipcMain: { handle: vi.fn() }
}))

// Modules imported by standaloneMigration but unused on the restore path.
vi.mock('./gpu', () => ({ detectGPU: vi.fn() }))
vi.mock('./download', () => ({ download: vi.fn() }))
vi.mock('./cache', () => ({ createCache: vi.fn() }))
vi.mock('./extract', () => ({ extractNested: vi.fn() }))
vi.mock('./migrate', () => ({ mergeDirFlat: vi.fn() }))
vi.mock('./paths', () => ({
  defaultInstallDir: vi.fn(() => ''),
  sanitizeDirName: vi.fn((s: string) => s),
  allocateUniqueDir: vi.fn()
}))
vi.mock('./desktopDetect', () => ({ assertReadable: vi.fn() }))

vi.mock('./i18n', () => ({
  t: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key
}))

vi.mock('./telemetry', () => ({
  trackedStep: async <T>(_name: string, _ctx: unknown, fn: () => Promise<T>) => fn(),
  emit: vi.fn()
}))

vi.mock('../settings', () => ({
  get: vi.fn(() => undefined),
  getMirrorConfig: vi.fn(() => ({ pypiMirror: undefined, useChineseMirrors: false }))
}))

const installationsGet = vi.hoisted(() => vi.fn())
vi.mock('../installations', () => ({
  get: (id: string) => installationsGet(id)
}))

const installedTorch = vi.hoisted(() => ({
  tuple: { torch: null as string | null, torchvision: null, torchaudio: null }
}))
vi.mock('../sources/standalone/envPaths', () => ({
  getInstalledTorchTuple: () => installedTorch.tuple
}))

const snapshotsMock = vi.hoisted(() => ({
  validateExportEnvelope: vi.fn((parsed: unknown) => parsed),
  importSnapshots: vi.fn(async () => {}),
  ensureCurrentSnapshotOnTop: vi.fn(async () => ({ filename: 'post.json' })),
  getSnapshotCount: vi.fn(async () => 1),
  restoreCustomNodes: vi.fn(async () => ({
    installed: [],
    switched: [],
    enabled: [],
    disabled: [],
    removed: [],
    failed: [],
    unreportable: []
  })),
  restorePipPackages: vi.fn(async () => ({
    installed: [],
    removed: [],
    changed: [],
    protectedSkipped: [],
    failed: [],
    errors: []
  })),
  restoreComfyUIVersion: vi.fn(async () => ({ changed: false, commit: null })),
  buildPostRestoreState: vi.fn(() => ({})),
  frozenSnapshotInstallOverrides: vi.fn(() => ({})),
  repairNodeRequirements: vi.fn(async () => ({ changed: [], errors: [] })),
  protectedPackageDrift: vi.fn(async () => [])
}))
vi.mock('./snapshots', () => snapshotsMock)

import { restoreSnapshotIntoInstallation } from './standaloneMigration'

describe('restoreSnapshotIntoInstallation envelope commit gating', () => {
  let tmpRoot: string
  let stagedFile: string
  let entry: InstallationRecord
  let outputs: string[]

  function writeStaged(snapshot: Record<string, unknown>): void {
    fs.writeFileSync(stagedFile, JSON.stringify({ snapshots: [snapshot] }))
  }

  function tools() {
    return {
      sendProgress: () => {},
      sendOutput: (text: string) => {
        outputs.push(text)
      },
      signal: new AbortController().signal
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    outputs = []
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-restore-'))
    stagedFile = path.join(tmpRoot, 'staged.json')
    entry = {
      id: 'migration-test',
      name: 'migration-test',
      installPath: tmpRoot,
      sourceId: 'standalone',
      status: 'installed'
    } as unknown as InstallationRecord
    installationsGet.mockImplementation(async () => entry)
    installedTorch.tuple = { torch: null, torchvision: null, torchaudio: null }
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('commits the envelope when a legacy partial torch record matches tag-aware', async () => {
    installedTorch.tuple = { torch: '2.4.1+cu121', torchvision: null, torchaudio: null }
    writeStaged({
      comfyui: { commit: 'abc1234' },
      pipPackages: [],
      skipPipSync: true,
      torchStack: { kind: 'observed', torchVersion: '2.4.1+cu121' }
    })

    await restoreSnapshotIntoInstallation(entry, stagedFile, false, tools(), async () => {})

    expect(snapshotsMock.importSnapshots).toHaveBeenCalledTimes(1)
    expect(outputs.join('')).not.toContain('pytorchSnapshotObservedSkip')
  })

  it('treats 2.4.1+cpu vs 2.4.1+cu121 as different stacks: disclosed, envelope never committed', async () => {
    installedTorch.tuple = { torch: '2.4.1+cu121', torchvision: null, torchaudio: null }
    writeStaged({
      comfyui: { commit: 'abc1234' },
      pipPackages: [],
      skipPipSync: true,
      // Legacy partial record: torch alone, with a CPU local tag. Under the
      // old publicVersion comparison this wrongly matched the +cu121 install.
      torchStack: { kind: 'observed', torchVersion: '2.4.1+cpu' }
    })

    await restoreSnapshotIntoInstallation(entry, stagedFile, false, tools(), async () => {})

    // The restore succeeds (fresh installs adapt), but the recorded state was
    // not reached: the substitution is disclosed and nothing is committed.
    expect(outputs.join('')).toContain('pytorchSnapshotObservedSkip')
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalled()
  })

  it('unknown protected drift blocks the envelope commit and is disclosed', async () => {
    writeStaged({
      comfyui: { commit: 'abc1234' },
      pipPackages: [],
      skipPipSync: false
    })
    snapshotsMock.protectedPackageDrift.mockImplementationOnce(async () => {
      throw new Error('python missing')
    })

    await restoreSnapshotIntoInstallation(entry, stagedFile, false, tools(), async () => {})

    expect(outputs.join('')).toContain('standalone.snapshotProtectedDriftUnknown')
    expect(snapshotsMock.importSnapshots).not.toHaveBeenCalled()
    expect(snapshotsMock.ensureCurrentSnapshotOnTop).toHaveBeenCalled()
  })
})
