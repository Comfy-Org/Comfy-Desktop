import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Installation } from '../types/ipc'
import { useInstallationStore } from './installationStore'

const mockInstallations: Installation[] = [
  {
    id: 'inst-1',
    name: 'My ComfyUI',
    sourceLabel: 'Local',
    sourceCategory: 'local'
  } as Installation,
  {
    id: 'inst-2',
    name: 'Remote ComfyUI',
    sourceLabel: 'Cloud',
    sourceCategory: 'cloud'
  } as Installation
]

vi.stubGlobal('window', {
  ...window,
  api: {
    getInstallations: vi.fn(),
    onInstallationsChanged: vi.fn(),
    onInstallationsVersionsUpdated: vi.fn()
  }
})

describe('useInstallationStore', () => {
  let store: ReturnType<typeof useInstallationStore>

  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    store = useInstallationStore()
    vi.clearAllMocks()
  })

  it('should have empty initial state', () => {
    expect(store.installations).toEqual([])
    expect(store.loading).toBe(true)
  })

  describe('fetchInstallations', () => {
    it('should populate installations and manage loading state', async () => {
      vi.mocked(window.api.getInstallations).mockResolvedValue(mockInstallations)

      const promise = store.fetchInstallations()
      expect(store.loading).toBe(true)

      const result = await promise
      expect(store.loading).toBe(false)
      expect(store.installations).toEqual(mockInstallations)
      expect(result).toEqual(mockInstallations)
    })

    it('collapses calls made while a fetch is in flight into one follow-up fetch', async () => {
      const resolvers: Array<(value: Installation[]) => void> = []
      vi.mocked(window.api.getInstallations).mockImplementation(
        () => new Promise((resolve) => resolvers.push(resolve))
      )
      const first = store.fetchInstallations()
      const burst = [
        store.fetchInstallations(),
        store.fetchInstallations(),
        store.fetchInstallations()
      ]
      // The follow-up must not overlap the in-flight request.
      expect(window.api.getInstallations).toHaveBeenCalledTimes(1)

      resolvers[0]!([mockInstallations[0]!])
      await expect(first).resolves.toEqual([mockInstallations[0]])
      await vi.waitFor(() => expect(window.api.getInstallations).toHaveBeenCalledTimes(2))

      // Burst callers get the follow-up's result, which started after they asked.
      resolvers[1]!(mockInstallations)
      for (const result of await Promise.all(burst)) expect(result).toEqual(mockInstallations)
      expect(window.api.getInstallations).toHaveBeenCalledTimes(2)
      expect(store.installations).toEqual(mockInstallations)

      // The drained queue resets: a call during the next fetch queues a new one.
      const next = store.fetchInstallations()
      const nextQueued = store.fetchInstallations()
      resolvers[2]!(mockInstallations)
      await next
      await vi.waitFor(() => expect(window.api.getInstallations).toHaveBeenCalledTimes(4))
      resolvers[3]!([mockInstallations[1]!])
      await expect(nextQueued).resolves.toEqual([mockInstallations[1]])
    })

    it('still runs the queued fetch when the in-flight one fails', async () => {
      vi.mocked(window.api.getInstallations)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce(mockInstallations)
      const first = store.fetchInstallations()
      const queued = store.fetchInstallations()
      await expect(first).rejects.toThrow('Network error')
      await expect(queued).resolves.toEqual(mockInstallations)
    })

    it('should clear loading even on error', async () => {
      vi.mocked(window.api.getInstallations).mockRejectedValue(new Error('Network error'))

      await expect(store.fetchInstallations()).rejects.toThrow('Network error')
      expect(store.loading).toBe(false)
    })
  })

  describe('getById', () => {
    beforeEach(async () => {
      vi.mocked(window.api.getInstallations).mockResolvedValue(mockInstallations)
      await store.fetchInstallations()
    })

    it('should return installation matching the given id', () => {
      const result = store.getById('inst-2')
      expect(result).toEqual(mockInstallations[1])
    })

    it('should return undefined for an unknown id', () => {
      const result = store.getById('nonexistent')
      expect(result).toBeUndefined()
    })
  })
})
