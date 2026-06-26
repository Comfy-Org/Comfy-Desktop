// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../git', () => ({
  readGitHead: vi.fn()
}))

vi.mock('../nodes', () => ({
  scanCustomNodes: vi.fn(),
  nodeKey: vi.fn((n: { type: string; dirName: string }) => `${n.type}:${n.dirName}`)
}))

vi.mock('../pip', () => ({
  pipFreeze: vi.fn()
}))

vi.mock('../pythonEnv', () => ({
  getActiveUvPath: vi.fn(() => '/fake/uv'),
  getActivePythonPath: vi.fn(() => null)
}))

vi.mock('../telemetry', () => ({
  emit: vi.fn()
}))

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    default: {
      ...(actual.default as object),
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => {
        throw new Error('not found')
      }),
      promises: {
        mkdir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        rename: vi.fn(async () => {}),
        readdir: vi.fn(async () => []),
        readFile: vi.fn(async () => {
          throw new Error('not found')
        }),
        unlink: vi.fn(async () => {})
      }
    }
  }
})

import fs from 'fs'
import path from 'path'
import { readGitHead } from '../git'
import { scanCustomNodes } from '../nodes'
import { pipFreeze } from '../pip'
import { getActiveUvPath, getActivePythonPath } from '../pythonEnv'
import {
  captureState,
  saveSnapshot,
  captureSnapshotIfChanged,
  ensureCurrentSnapshotOnTop,
  listSnapshots
} from './store'
import * as telemetry from '../telemetry'
import type { InstallationRecord } from '../../installations'

const mockedTelemetryEmit = vi.mocked(telemetry.emit)

const mockedReadGitHead = vi.mocked(readGitHead)
const mockedScanCustomNodes = vi.mocked(scanCustomNodes)

/**
 * Stateful in-memory `fs.promises` mock — `writeFile`/`rename` route into a
 * Map keyed by absolute path; `readdir`/`readFile`/`unlink` read from the same
 * Map. Lets us drive `captureSnapshotIfChanged`'s `loadSnapshot` /
 * `listSnapshots` / `deduplicateRestartSnapshot` paths without spinning up
 * real disk I/O. Reset in each `beforeEach` via `installFsMemory()`.
 */
function installFsMemory(): Map<string, string> {
  const memory = new Map<string, string>()
  vi.mocked(fs.promises.writeFile).mockImplementation(async (p, data) => {
    memory.set(String(p), String(data))
  })
  vi.mocked(fs.promises.rename).mockImplementation(async (from, to) => {
    const data = memory.get(String(from))
    if (data === undefined) throw new Error(`rename: missing ${String(from)}`)
    memory.set(String(to), data)
    memory.delete(String(from))
  })
  vi.mocked(fs.promises.readdir).mockImplementation(async (dir) => {
    const prefix = String(dir).replace(/[\\/]+$/, '') + path.sep
    const files: string[] = []
    for (const key of memory.keys()) {
      if (key.startsWith(prefix) && !key.slice(prefix.length).includes(path.sep)) {
        files.push(key.slice(prefix.length))
      }
    }
    return files as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>
  })
  vi.mocked(fs.promises.readFile).mockImplementation(async (p) => {
    const data = memory.get(String(p))
    if (data === undefined) throw new Error(`readFile: missing ${String(p)}`)
    return data as unknown as Awaited<ReturnType<typeof fs.promises.readFile>>
  })
  vi.mocked(fs.promises.unlink).mockImplementation(async (p) => {
    memory.delete(String(p))
  })
  return memory
}

describe('captureState commit-matching guard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedScanCustomNodes.mockResolvedValue([])
  })

  it('copies baseTag and commitsAhead when commit matches installation record', async () => {
    mockedReadGitHead.mockReturnValue('abc1234')
    const installation = {
      id: 'test',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.17.2', commitsAhead: 12 }
    } as InstallationRecord

    const state = await captureState('/test/install', installation)

    expect(state.comfyui.commit).toBe('abc1234')
    expect(state.comfyui.baseTag).toBe('v0.17.2')
    expect(state.comfyui.commitsAhead).toBe(12)
  })

  it('does not copy baseTag when commit differs (external git change)', async () => {
    mockedReadGitHead.mockReturnValue('def5678')
    const installation = {
      id: 'test',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.17.2', commitsAhead: 12 }
    } as InstallationRecord

    const state = await captureState('/test/install', installation)

    expect(state.comfyui.commit).toBe('def5678')
    expect(state.comfyui.baseTag).toBeUndefined()
    expect(state.comfyui.commitsAhead).toBeUndefined()
  })

  it('leaves baseTag undefined when no comfyVersion on installation', async () => {
    mockedReadGitHead.mockReturnValue('abc1234')
    const installation = {
      id: 'test',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test'
    } as InstallationRecord

    const state = await captureState('/test/install', installation)

    expect(state.comfyui.commit).toBe('abc1234')
    expect(state.comfyui.baseTag).toBeUndefined()
    expect(state.comfyui.commitsAhead).toBeUndefined()
  })

  it('copies baseTag when commit matches and commitsAhead is 0 (exact tag)', async () => {
    mockedReadGitHead.mockReturnValue('deadbeef')
    const installation = {
      id: 'test',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test',
      comfyVersion: { commit: 'deadbeef', baseTag: 'v0.18.0', commitsAhead: 0 }
    } as InstallationRecord

    const state = await captureState('/test/install', installation)

    expect(state.comfyui.commit).toBe('deadbeef')
    expect(state.comfyui.baseTag).toBe('v0.18.0')
    expect(state.comfyui.commitsAhead).toBe(0)
  })

  it('freezes packages via the adopted-aware uv path so adopted installs do not snapshot 0 packages', async () => {
    // Regression for issue #855: adopted Legacy Desktop installs have no
    // managed standalone-env, so `getUvPath(installPath)` resolved to a
    // file that doesn't exist and the freeze was silently skipped.
    // `captureState` must now consult `getActiveUvPath(installation)`,
    // which returns the uv pip-installed into the legacy `.venv`.
    mockedReadGitHead.mockReturnValue('abc1234')
    vi.mocked(getActiveUvPath).mockReturnValue('/legacy/.venv/bin/uv')
    vi.mocked(getActivePythonPath).mockReturnValue('/legacy/.venv/bin/python3')
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => String(p) === '/legacy/.venv/bin/uv'
    )
    vi.mocked(pipFreeze).mockResolvedValue({ torch: '2.4.0', numpy: '1.26.4' })

    const installation = {
      id: 'adopted',
      name: 'ComfyUI',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/installs/adopted',
      sourceId: 'standalone',
      adopted: true,
      adoptedBaseDir: '/legacy',
      adoptedPythonPath: '/legacy/.venv/bin/python3'
    } as unknown as InstallationRecord

    const state = await captureState('/installs/adopted', installation)

    expect(getActiveUvPath).toHaveBeenCalledWith(installation)
    expect(pipFreeze).toHaveBeenCalledWith(
      '/legacy/.venv/bin/uv',
      '/legacy/.venv/bin/python3'
    )
    expect(Object.keys(state.pipPackages).length).toBe(2)
  })

  it('leaves baseTag undefined when readGitHead returns null', async () => {
    mockedReadGitHead.mockReturnValue(null)
    const installation = {
      id: 'test',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test',
      comfyVersion: { commit: 'abc1234', baseTag: 'v0.17.2', commitsAhead: 12 }
    } as InstallationRecord

    const state = await captureState('/test/install', installation)

    expect(state.comfyui.commit).toBeNull()
    expect(state.comfyui.baseTag).toBeUndefined()
    expect(state.comfyui.commitsAhead).toBeUndefined()
  })
})

describe('saveSnapshot telemetry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedScanCustomNodes.mockResolvedValue([
      { id: 'a', type: 'cnr', dirName: 'a', enabled: true, version: '1.0.0' },
      { id: 'b', type: 'cnr', dirName: 'b', enabled: true, version: '2.0.0' }
    ])
    mockedReadGitHead.mockReturnValue('abc1234')
  })

  it('emits comfy.desktop.snapshot.created with installation_id, trigger, counts, and dedup flag', async () => {
    const installation = {
      id: 'install-42',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test'
    } as InstallationRecord

    await saveSnapshot('/test/install', installation, 'manual', 'my label')

    expect(mockedTelemetryEmit).toHaveBeenCalledTimes(1)
    expect(mockedTelemetryEmit).toHaveBeenCalledWith('comfy.desktop.snapshot.created', {
      installation_id: 'install-42',
      trigger: 'manual',
      custom_nodes_count: 2,
      // pip freeze is short-circuited by the python-path mock returning null
      pip_packages_count: 0,
      has_label: true,
      // saveSnapshot never deduplicates a previous snapshot
      deduplicated_previous: false
    })
  })

  it('reports has_label: false when no label is supplied', async () => {
    const installation = {
      id: 'install-7',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test'
    } as InstallationRecord

    await saveSnapshot('/test/install', installation, 'pre-update')

    expect(mockedTelemetryEmit).toHaveBeenCalledWith(
      'comfy.desktop.snapshot.created',
      expect.objectContaining({ trigger: 'pre-update', has_label: false })
    )
  })
})

describe('captureSnapshotIfChanged telemetry', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedScanCustomNodes.mockResolvedValue([])
    mockedReadGitHead.mockReturnValue('abc1234')
  })

  it('emits no telemetry when boot state matches the last snapshot (saved: false)', async () => {
    const memory = installFsMemory()
    // Pre-seed `lastSnapshot` with a state that matches what `captureState`
    // will produce (manifest read fails → ref:'unknown', commit comes from
    // mocked readGitHead, no nodes, no pip).
    const matching = {
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trigger: 'boot' as const,
      label: null,
      comfyui: { ref: 'unknown', commit: 'abc1234', releaseTag: '', variant: '' },
      customNodes: [],
      pipPackages: {},
      pythonVersion: undefined,
      updateChannel: 'stable'
    }
    const lastFilename = 'last.json'
    // loadSnapshot reads through `resolveSnapshotPath` which uses
    // `path.resolve` — on Windows that prepends the drive letter, so the
    // memory key has to be the resolved absolute path, not a path.join
    // form, or the readFile mock won't find it.
    memory.set(
      path.resolve('/test/install', '.launcher', 'snapshots', lastFilename),
      JSON.stringify(matching)
    )

    const installation = {
      id: 'install-1',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test',
      lastSnapshot: lastFilename
    } as unknown as InstallationRecord

    const result = await captureSnapshotIfChanged('/test/install', installation, 'boot')

    expect(result.saved).toBe(false)
    expect(mockedTelemetryEmit).not.toHaveBeenCalled()
  })

  it('emits deduplicated_previous: true when restart collapses the prior intermediate snapshot', async () => {
    const memory = installFsMemory()
    // Pre-seed an intermediate restart snapshot (no label, same comfyui +
    // empty nodes) that should get collapsed by `deduplicateRestartSnapshot`
    // when the new restart snapshot lands.
    const intermediate = {
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      trigger: 'restart' as const,
      label: null,
      comfyui: { ref: 'unknown', commit: 'abc1234', releaseTag: '', variant: '' },
      customNodes: [],
      pipPackages: {},
      pythonVersion: undefined,
      updateChannel: 'stable'
    }
    // Filename uses the same `YYYYMMDD_HHMMSS_mmm-<trigger>-<suffix>.json`
    // shape `formatTimestamp` produces; an older lexicographic key ensures
    // it sorts AFTER the freshly-written one (newest-first sort in
    // `listSnapshots`).
    const intermediateFilename = '20260101_120000_000-restart-aaaaaa.json'
    memory.set(
      path.join('/test/install', '.launcher', 'snapshots', intermediateFilename),
      JSON.stringify(intermediate)
    )

    const installation = {
      id: 'install-9',
      name: 'Test',
      createdAt: '2026-02-01T00:00:00.000Z',
      installPath: '/test/install',
      sourceId: 'test'
    } as InstallationRecord

    const result = await captureSnapshotIfChanged('/test/install', installation, 'restart')

    expect(result.saved).toBe(true)
    expect(result.deduplicated).toBe(intermediateFilename)
    expect(mockedTelemetryEmit).toHaveBeenCalledTimes(1)
    expect(mockedTelemetryEmit).toHaveBeenCalledWith('comfy.desktop.snapshot.created', {
      installation_id: 'install-9',
      trigger: 'restart',
      custom_nodes_count: 0,
      pip_packages_count: 0,
      has_label: false,
      deduplicated_previous: true
    })
  })
})

describe('ensureCurrentSnapshotOnTop', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedScanCustomNodes.mockResolvedValue([])
    mockedReadGitHead.mockReturnValue('abc1234')
  })

  const installation = {
    id: 'install-1',
    name: 'Test',
    createdAt: '2026-01-01T00:00:00.000Z',
    installPath: '/test/install',
    sourceId: 'test'
  } as InstallationRecord

  // The live state `captureState` produces here: ref 'unknown' (manifest read
  // fails), commit from mocked readGitHead, no nodes, no pip, channel 'stable'.
  const liveStateSnapshot = {
    version: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    trigger: 'boot' as const,
    label: null,
    comfyui: { ref: 'unknown', commit: 'abc1234', releaseTag: '', variant: '' },
    customNodes: [],
    pipPackages: {},
    pythonVersion: undefined,
    updateChannel: 'stable'
  }

  function seedTopSnapshot(memory: Map<string, string>, snapshot: object, filename: string): void {
    memory.set(
      path.join('/test/install', '.launcher', 'snapshots', filename),
      JSON.stringify(snapshot)
    )
  }

  it('writes a post-restore snapshot of the live state when the top snapshot does not match', async () => {
    const memory = installFsMemory()
    // Imported-but-never-applied snapshot on top: different commit than live.
    seedTopSnapshot(
      memory,
      { ...liveStateSnapshot, comfyui: { ...liveStateSnapshot.comfyui, commit: 'imported9' } },
      '20250101_000000_000-manual-imported.json'
    )

    const result = await ensureCurrentSnapshotOnTop('/test/install', installation)

    expect(result.saved).toBe(true)
    expect(result.filename).toMatch(/-post-restore-/)
    // The imported snapshot is kept (retry can still use it).
    expect(
      memory.has(
        path.join('/test/install', '.launcher', 'snapshots', '20250101_000000_000-manual-imported.json')
      )
    ).toBe(true)
    // The written snapshot records the live commit.
    const written = JSON.parse(
      memory.get(path.join('/test/install', '.launcher', 'snapshots', result.filename!))!
    )
    expect(written.comfyui.commit).toBe('abc1234')
    expect(written.trigger).toBe('post-restore')
    expect(mockedTelemetryEmit).toHaveBeenCalledWith(
      'comfy.desktop.snapshot.created',
      expect.objectContaining({ trigger: 'post-restore' })
    )
  })

  it('is a no-op when the top snapshot already matches the live state', async () => {
    const memory = installFsMemory()
    seedTopSnapshot(memory, liveStateSnapshot, '20250101_000000_000-boot-match.json')

    const result = await ensureCurrentSnapshotOnTop('/test/install', installation)

    expect(result.saved).toBe(false)
    expect(result.filename).toBe('20250101_000000_000-boot-match.json')
    expect(mockedTelemetryEmit).not.toHaveBeenCalled()
    // No new file written — only the seeded one remains.
    const files = [...memory.keys()].filter((k) => k.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('writes a snapshot that sorts above an imported top with a future timestamp', async () => {
    const memory = installFsMemory()
    // A multi-snapshot import (or a same-ms import) can leave the newest entry
    // with a timestamp at/after `now`; the correction snapshot must still win.
    seedTopSnapshot(
      memory,
      {
        ...liveStateSnapshot,
        createdAt: new Date(Date.now() + 60_000).toISOString(),
        comfyui: { ...liveStateSnapshot.comfyui, commit: 'imported9' }
      },
      '29991231_000000_000-manual-imported.json'
    )

    const result = await ensureCurrentSnapshotOnTop('/test/install', installation)

    expect(result.saved).toBe(true)
    const entries = await listSnapshots('/test/install')
    expect(entries[0]!.filename).toBe(result.filename)
  })

  it('writes a new snapshot when only updateChannel or pythonVersion differ (stricter than statesMatch)', async () => {
    const memory = installFsMemory()
    // Same comfyui/nodes/pips as live (so `statesMatch` is true) but a different
    // updateChannel — `snapshotRepresentsCurrentState` must treat this as stale.
    seedTopSnapshot(
      memory,
      { ...liveStateSnapshot, updateChannel: 'nightly' },
      '20250101_000000_000-boot-channel.json'
    )

    const result = await ensureCurrentSnapshotOnTop('/test/install', installation)

    expect(result.saved).toBe(true)
    expect(result.filename).toMatch(/-post-restore-/)
  })

  it('does not pile up duplicates across repeated failed restores (retry)', async () => {
    const memory = installFsMemory()
    seedTopSnapshot(
      memory,
      { ...liveStateSnapshot, comfyui: { ...liveStateSnapshot.comfyui, commit: 'imported9' } },
      '20250101_000000_000-manual-imported.json'
    )

    const first = await ensureCurrentSnapshotOnTop('/test/install', installation)
    expect(first.saved).toBe(true)

    // A second failed attempt (retry) now sees a live-state snapshot on top and
    // must not write another.
    const second = await ensureCurrentSnapshotOnTop('/test/install', installation)
    expect(second.saved).toBe(false)
    expect(second.filename).toBe(first.filename)

    const files = [...memory.keys()].filter((k) => k.endsWith('.json'))
    expect(files).toHaveLength(2) // imported + one post-restore
  })
})
