import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import type { InstallationRecord } from '../../installations'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}))
vi.mock('../../lib/fetch', () => ({
  fetchJSON: vi.fn(),
}))
vi.mock('../../lib/paths', async () => {
  const os = await import('os')
  const path = await import('path')
  const dir = path.join(os.tmpdir(), `torch-catalog-test-${process.pid}-${Math.random().toString(36).slice(2)}`)
  return { dataDir: () => dir }
})
vi.mock('./r2Catalog', () => ({
  fetchR2VendorReleases: vi.fn(async () => []),
  r2BundleUrl: vi.fn(() => ''),
}))
vi.mock('./envPaths', async (importOriginal) => ({
  ...(await importOriginal<typeof EnvPaths>()),
  getInstalledTorchTuple: vi.fn(() => ({ torch: null, torchvision: null, torchaudio: null })),
}))

import type * as EnvPaths from './envPaths'
import { fetchJSON } from '../../lib/fetch'
import { dataDir } from '../../lib/paths'
import { getInstalledTorchTuple } from './envPaths'
import { getCachedTorchStacks, resolveTorchStack, reconcileTorchStack, _resetForTest } from './torchStackCatalog'
import {
  _setComputeCapsForTest, _setRemoteDefsForTest, _resetRemoteForTest,
} from './torchIndexManifest'
import type { TorchIndexStackDef } from './torchIndexManifest'

const realPlatform = process.platform
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

const CU130_ID = 'pytorch-index:cu130:2.11.0'
const cu130Def: TorchIndexStackDef = {
  indexTag: 'cu130',
  accel: 'nvidia',
  platforms: ['win32', 'linux'],
  packages: { torch: '2.11.0+cu130' },
  date: '2026-04-01',
  pythonAbis: ['3.13'],
}

function install(pythonVersion?: string): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'Test Install',
    sourceId: 'standalone',
    installPath: '/tmp/test-install',
    status: 'installed',
    createdAt: new Date(0).toISOString(),
    variant: 'win-nvidia',
    ...(pythonVersion ? { pythonVersion } : {}),
  } as InstallationRecord
}

beforeEach(() => {
  setPlatform('win32')
  _resetForTest()
  _setComputeCapsForTest(null)
  _setRemoteDefsForTest([cu130Def])
})
afterEach(() => {
  setPlatform(realPlatform)
  _setComputeCapsForTest(undefined)
  _setRemoteDefsForTest(null)
  vi.mocked(fetchJSON).mockReset()
  vi.mocked(getInstalledTorchTuple).mockReturnValue({ torch: null, torchvision: null, torchaudio: null })
  fs.rmSync(dataDir(), { recursive: true, force: true })
})

describe('per-install Python ABI gate on index-served stacks', () => {
  it('shows and resolves an ABI-pinned entry on a matching Python', async () => {
    const inst = install('3.13.2')
    expect(getCachedTorchStacks(inst).map((e) => e.stackId)).toContain(CU130_ID)
    const entry = await resolveTorchStack(inst, CU130_ID)
    expect(entry?.stackId).toBe(CU130_ID)
  })

  it('hides and refuses to resolve the same entry on a different Python ABI', async () => {
    const inst = install('3.12.10')
    expect(getCachedTorchStacks(inst)).toEqual([])
    expect(await resolveTorchStack(inst, CU130_ID)).toBeNull()
  })

  it('fails closed when the install Python is unknown and the entry pins ABIs', async () => {
    const inst = install(undefined)
    expect(getCachedTorchStacks(inst)).toEqual([])
    expect(await resolveTorchStack(inst, CU130_ID)).toBeNull()
  })

  it('leaves entries without an ABI pin available on any Python', async () => {
    _setRemoteDefsForTest([{ ...cu130Def, pythonAbis: undefined }])
    for (const inst of [install('3.12.10'), install(undefined)]) {
      expect(getCachedTorchStacks(inst).map((e) => e.stackId)).toContain(CU130_ID)
      expect((await resolveTorchStack(inst, CU130_ID))?.stackId).toBe(CU130_ID)
    }
  })
})

describe('remote manifest availability on resolve', () => {
  it('resolves a remote-only stack without a prior check-update (fetches on demand)', async () => {
    _resetRemoteForTest()
    vi.mocked(fetchJSON).mockResolvedValue({ schemaVersion: 1, stacks: [cu130Def] })
    const entry = await resolveTorchStack(install('3.13.2'), CU130_ID)
    expect(entry?.stackId).toBe(CU130_ID)
    expect(vi.mocked(fetchJSON)).toHaveBeenCalledTimes(1)
  })
})

describe('compute-cap mismatch is informational, never a gate', () => {
  it('a mismatched entry lists with a warning, still resolves, and resolves without it', async () => {
    _setRemoteDefsForTest([{ ...cu130Def, computeCap: { min: 7.5, max: 12.0 } }])
    _setComputeCapsForTest([6.1]) // Pascal - outside the entry's kernel range
    const inst = install('3.13.2')
    const listed = getCachedTorchStacks(inst).find((e) => e.stackId === CU130_ID)
    expect(listed?.capWarning).toEqual({ min: 7.5, max: 12.0, detected: [6.1] })
    // The mismatch never blocks the change (detection may be wrong or
    // partial), and the display-only warning must not reach the entry the
    // transaction persists.
    const entry = await resolveTorchStack(inst, CU130_ID)
    expect(entry?.stackId).toBe(CU130_ID)
    expect(entry?.capWarning).toBeUndefined()
  })

  it('reconcile adoption of a manual change persists the entry without the warning', async () => {
    _setRemoteDefsForTest([{ ...cu130Def, computeCap: { min: 7.5, max: 12.0 } }])
    _setComputeCapsForTest([6.1])
    vi.mocked(getInstalledTorchTuple).mockReturnValue(
      { torch: '2.11.0+cu130', torchvision: null, torchaudio: null }
    )
    const updates: Record<string, unknown>[] = []
    await reconcileTorchStack(install('3.13.2'), async (data) => { updates.push(data) })
    const adopted = updates.find((u) => u.lastVerifiedTorchStack)
      ?.lastVerifiedTorchStack as { stackId?: string; capWarning?: unknown } | undefined
    expect(adopted?.stackId).toBe(CU130_ID)
    expect(adopted?.capWarning).toBeUndefined()
  })
})
