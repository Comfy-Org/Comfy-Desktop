// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DiffModule from './diff'

vi.mock('./store', () => ({
  listSnapshots: vi.fn(),
  loadSnapshot: vi.fn()
}))

vi.mock('./diff', async (importOriginal) => ({
  ...(await importOriginal<typeof DiffModule>()),
  resolveSnapshotVersion: vi.fn()
}))

import { listSnapshots } from './store'
import { resolveSnapshotVersion } from './diff'
import { getSnapshotListData } from './tabData'
import type { Snapshot } from './types'

const mockedListSnapshots = vi.mocked(listSnapshots)
const mockedResolveSnapshotVersion = vi.mocked(resolveSnapshotVersion)

function entry(i: number): { filename: string; snapshot: Snapshot } {
  return {
    filename: `snap-${i}.json`,
    snapshot: {
      version: 1,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 100 - i)).toISOString(),
      trigger: 'boot',
      label: null,
      comfyui: { ref: 'master', commit: `commit-${i}`, releaseTag: '', variant: '' },
      customNodes: [],
      pipPackages: {}
    } as unknown as Snapshot
  }
}

describe('getSnapshotListData', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('resolves snapshot versions with bounded concurrency, keeping list order', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => entry(i))
    mockedListSnapshots.mockResolvedValue(entries as never)

    let inFlight = 0
    let peak = 0
    mockedResolveSnapshotVersion.mockImplementation(async (_installPath, comfyui) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      // Finish out of order so the result has to be placed by index, not by completion.
      await new Promise((resolve) => setTimeout(resolve, comfyui.commit!.endsWith('1') ? 5 : 1))
      inFlight--
      return `v-${comfyui.commit}`
    })

    const { snapshots, totalCount } = await getSnapshotListData('/install')

    expect(totalCount).toBe(12)
    expect(mockedResolveSnapshotVersion).toHaveBeenCalledTimes(12)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(2)
    expect(snapshots.map((s) => s.comfyuiVersion)).toEqual(
      entries.map((e) => `v-${e.snapshot.comfyui.commit}`)
    )
  })
})
