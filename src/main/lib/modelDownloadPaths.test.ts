import os from 'os'
import path from 'path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => path.join(os.tmpdir(), 'comfyui-desktop-2-test') }
}))

import { resolveModelsPresence } from './modelDownloadPaths'

describe('resolveModelsPresence', () => {
  it('reads unresolvable or model-free templates as not downloaded', async () => {
    const { presence, timedOut } = await resolveModelsPresence(
      ['broken', 'empty'],
      null,
      async (id) => {
        if (id === 'broken') throw new Error('HTTP 404')
        return []
      },
      1000
    )

    expect(timedOut).toBe(false)
    expect(presence).toEqual(
      new Map([
        ['broken', false],
        ['empty', false]
      ])
    )
  })

  it('leaves templates unbadged when the lookup overruns its budget', async () => {
    vi.useFakeTimers()
    try {
      let finishSlowLookup!: () => void
      const result = resolveModelsPresence(
        ['fast', 'slow'],
        null,
        (id) =>
          id === 'fast'
            ? Promise.resolve([])
            : new Promise((resolve) => (finishSlowLookup = () => resolve([]))),
        50
      )
      await vi.advanceTimersByTimeAsync(50)
      const { presence, timedOut } = await result

      expect(timedOut).toBe(true)
      expect(presence).toEqual(new Map([['fast', false]]))

      finishSlowLookup()
      await vi.runAllTimersAsync()
      expect(presence.has('slow')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
