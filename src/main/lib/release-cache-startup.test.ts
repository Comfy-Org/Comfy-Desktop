// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { InstallationRecord } from '../installations'

vi.mock('./release-cache', () => ({
  get: vi.fn(() => undefined),
  getOrFetch: vi.fn(async () => null),
  buildCacheEntry: vi.fn((release: object) => ({ ...release, checkedAt: Date.now() }))
}))
vi.mock('./comfyui-releases', () => ({
  fetchLatestRelease: vi.fn(async () => null)
}))
vi.mock('../sources/standalone/torchStackCatalog', () => ({
  refreshTorchStackCatalogs: vi.fn(async () => true)
}))

import {
  runStartupReleaseChecks,
  startPeriodicReleaseChecks,
  _resetTorchCatalogFloorForTest
} from './release-cache-startup'
import * as releaseCache from './release-cache'
import { fetchLatestRelease } from './comfyui-releases'
import { refreshTorchStackCatalogs } from '../sources/standalone/torchStackCatalog'

function getOrFetchFallingBackTo(cached: { checkedAt: number } | null) {
  return (async (_repo: string, _channel: string, fetchFn: () => Promise<unknown>) => {
    try {
      return (await fetchFn()) ?? cached
    } catch {
      return cached
    }
  }) as unknown as typeof releaseCache.getOrFetch
}

function install(overrides: Partial<InstallationRecord> = {}): InstallationRecord {
  return {
    id: 'inst-1',
    name: 'Test Install',
    sourceId: 'standalone',
    installPath: '/tmp/test-install',
    status: 'installed',
    createdAt: new Date(0).toISOString(),
    variant: 'win-nvidia',
    ...overrides
  } as InstallationRecord
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(releaseCache.get).mockReturnValue(null)
  vi.mocked(releaseCache.getOrFetch).mockResolvedValue(null)
  vi.mocked(fetchLatestRelease).mockResolvedValue(null)
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
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    const onRefreshed = vi.fn()
    await runStartupReleaseChecks([install()], { onRefreshed })
    expect(vi.mocked(releaseCache.getOrFetch)).not.toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })

  it('skips the PyTorch refresh inside the floor window within one app run (dashboard prewarm spam guard)', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    let clock = 100_000_000
    const now = () => clock
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)

    clock += 5 * 60 * 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)

    clock += 60 * 60 * 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(2)
  })

  it('retries a failed catalog refresh on the next check instead of waiting out the floor', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    let clock = 100_000_000
    const now = () => clock

    vi.mocked(refreshTorchStackCatalogs).mockResolvedValueOnce(false)
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)

    clock += 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(2)

    clock += 1000
    await runStartupReleaseChecks([install()], { now })
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(2)
  })

  it('joins an in-flight catalog refresh instead of refetching concurrently', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: Date.now() })
    let resolveRefresh!: (ok: boolean) => void
    vi.mocked(refreshTorchStackCatalogs).mockImplementationOnce(
      () => new Promise((resolve) => (resolveRefresh = resolve))
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
      install({ status: 'installing' })
    ])
    expect(vi.mocked(releaseCache.getOrFetch)).not.toHaveBeenCalled()
    expect(vi.mocked(refreshTorchStackCatalogs)).not.toHaveBeenCalled()
  })

  it('still completes the release check and fires onRefreshed when the PyTorch refresh rejects', async () => {
    vi.mocked(releaseCache.getOrFetch).mockImplementation(getOrFetchFallingBackTo(null))
    vi.mocked(fetchLatestRelease).mockResolvedValue({ tag_name: 'v1.2.3' })
    vi.mocked(refreshTorchStackCatalogs).mockRejectedValueOnce(new Error('offline'))
    const onRefreshed = vi.fn()
    await expect(runStartupReleaseChecks([install()], { onRefreshed })).resolves.toBeUndefined()
    expect(vi.mocked(releaseCache.getOrFetch)).toHaveBeenCalled()
    expect(onRefreshed).toHaveBeenCalledTimes(1)
  })

  it('does not fire onRefreshed when every fetch fails (offline), so renderers are not told to re-pull', async () => {
    const stale = { checkedAt: 1 }
    vi.mocked(releaseCache.get).mockReturnValue(stale)
    vi.mocked(releaseCache.getOrFetch).mockImplementation(getOrFetchFallingBackTo(stale))
    vi.mocked(fetchLatestRelease).mockRejectedValue(new Error('getaddrinfo ENOTFOUND github.com'))
    vi.mocked(refreshTorchStackCatalogs).mockResolvedValue(false)
    const onRefreshed = vi.fn()
    await runStartupReleaseChecks([install(), install({ id: 'inst-2', updateChannel: 'latest' })], {
      onRefreshed
    })
    expect(vi.mocked(fetchLatestRelease)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(refreshTorchStackCatalogs)).toHaveBeenCalledTimes(1)
    expect(onRefreshed).not.toHaveBeenCalled()
  })

  it('fires onRefreshed when it joins a concurrent fetch that lands a newer entry', async () => {
    vi.mocked(releaseCache.get).mockReturnValue({ checkedAt: 1 })
    vi.mocked(releaseCache.getOrFetch).mockResolvedValue({ checkedAt: 2 })
    vi.mocked(refreshTorchStackCatalogs).mockResolvedValue(false)
    const onRefreshed = vi.fn()
    await runStartupReleaseChecks([install()], { onRefreshed })
    expect(vi.mocked(fetchLatestRelease)).not.toHaveBeenCalled()
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
