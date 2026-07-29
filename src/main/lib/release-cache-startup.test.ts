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
  refreshTorchStackCatalogs: vi.fn(async () => true),
}))

import {
  runStartupReleaseChecks,
  startPeriodicReleaseChecks,
  _resetTorchCatalogFloorForTest,
} from './release-cache-startup'
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
  vi.mocked(refreshTorchStackCatalogs).mockResolvedValue(true)
  _resetTorchCatalogFloorForTest()
})

describe('runStartupReleaseChecks', () => {
  it('refreshes the PyTorch stack catalog alongside the release fetch', async () => {
    const installs = [install()]
    await runStartupReleaseChecks(installs)
    expect(vi.mocked(releaseCache.getOrFetch)).toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledWith(installs)
  })

  it('still refreshes the PyTorch catalog when every channel cache is fresh (first boot after upgrade)', async () => {
    // Catalog freshness is independent of the release cache: the refresh
    // must run even when no release fetch tasks are scheduled.
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    const onRefreshed = vi.fn()
    await runStartupReleaseChecks([install()], { onRefreshed })
    expect(vi.mocked(releaseCache.getOrFetch)).not.toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })

  it('skips the PyTorch refresh inside the floor window within one app run (dashboard prewarm spam guard)', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    let clock = 100_000_000 // beyond the floor relative to the cold-start timestamp of 0
    const now = () => clock
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)

    // Dashboard refreshes shortly after boot must not refetch the catalog...
    clock += 5 * 60 * 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)

    // ...but once the floor elapses it refreshes again.
    clock += 60 * 60 * 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(2)
  })

  it('retries a failed catalog refresh on the next check instead of waiting out the floor', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    let clock = 100_000_000
    const now = () => clock

    // Failure must not advance the floor...
    vi.mocked(refreshTorchStackCatalogs).mockResolvedValueOnce(false)
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)

    // ...so the next check retries immediately and succeeds...
    clock += 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(2)

    // ...after which the floor applies again.
    clock += 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(2)
  })

  it('joins an in-flight catalog refresh instead of refetching concurrently', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    let resolveRefresh!: (ok: boolean) => void
    vi.mocked(refreshTorchStackCatalogs).mockImplementationOnce(
      () => new Promise((resolve) => (resolveRefresh = resolve)),
    )

    const first = runStartupReleaseChecks([install()])
    const second = runStartupReleaseChecks([install()])
    resolveRefresh(true)
    await Promise.all([first, second])
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)
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
