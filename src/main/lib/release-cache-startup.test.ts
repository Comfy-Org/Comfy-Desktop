// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { InstallationRecord } from '../installations'

vi.mock('./release-cache', () => ({
  get: vi.fn(() => undefined),
  getOrFetch: vi.fn(async () => null),
  buildCacheEntry: vi.fn((release: unknown) => release),
}))
vi.mock('./comfyui-releases', () => ({
  fetchLatestRelease: vi.fn(async () => null),
}))
vi.mock('../sources/standalone/torchStackCatalog', () => ({
  refreshTorchStackCatalogs: vi.fn(async () => {}),
}))

import { runStartupReleaseChecks, startPeriodicReleaseChecks } from './release-cache-startup'
import * as releaseCache from './release-cache'
import { refreshTorchStackCatalogs } from '../sources/standalone/torchStackCatalog'

function install(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'Test Install',
    sourceId: 'standalone',
    installPath: '/tmp/test-install',
    status: 'installed',
    createdAt: new Date(0).toISOString(),
    variant: 'win-nvidia',
    ...overrides,
  } as InstallationRecord
}

beforeEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` keeps implementations, so pin the defaults each test relies on.
  vi.mocked(releaseCache.get).mockReturnValue(null)
  vi.mocked(releaseCache.getOrFetch).mockResolvedValue(null)
  vi.mocked(refreshTorchStackCatalogs).mockResolvedValue(undefined)
})

describe('runStartupReleaseChecks', () => {
  it('refreshes the PyTorch stack catalog alongside the release fetch', async () => {
    const installs = [install()]
    await runStartupReleaseChecks(installs)
    expect(vi.mocked(releaseCache.getOrFetch)).toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledWith(installs)
  })

  it('skips the PyTorch refresh when every channel cache is fresh', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    await runStartupReleaseChecks([install()])
    expect(vi.mocked(releaseCache.getOrFetch)).not.toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).not.toHaveBeenCalled()
  })

  it('does not run at all without ComfyUI installs', async () => {
    await runStartupReleaseChecks([
      install({ sourceId: 'cloud' }),
      install({ status: 'installing' }),
    ])
    expect(vi.mocked(releaseCache.getOrFetch)).not.toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).not.toHaveBeenCalled()
  })

  it('still completes the release check and fires onRefreshed when the PyTorch refresh rejects', async () => {
    vi.mocked(refreshTorchStackCatalogs).mockRejectedValueOnce(new Error('offline'))
    const onRefreshed = vi.fn()
    await expect(runStartupReleaseChecks([install()], { onRefreshed })).resolves.toBeUndefined()
    expect(vi.mocked(releaseCache.getOrFetch)).toHaveBeenCalled()
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })
})

describe('startPeriodicReleaseChecks', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('refreshes the PyTorch catalog on each tick, bypassing the freshness floor', async () => {
    // Fresh cache entry: the startup floor would skip, but the periodic poll must not.
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    const stop = startPeriodicReleaseChecks(async () => [install()], { intervalMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.mocked(releaseCache.getOrFetch)).toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(2)
    stop()
  })
})
