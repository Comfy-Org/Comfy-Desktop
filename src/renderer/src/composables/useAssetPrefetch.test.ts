import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useAssetPrefetch, type AssetLoader } from './useAssetPrefetch'

let idleQueue: Array<() => void> = []
let nextHandle = 1

beforeEach(() => {
  idleQueue = []
  nextHandle = 1
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    idleQueue.push(cb)
    return nextHandle++
  })
  vi.stubGlobal('cancelIdleCallback', (handle: number) => {
    idleQueue[handle - 1] = undefined as unknown as () => void
  })
  vi.stubGlobal('navigator', { connection: undefined })
})

afterEach(() => vi.unstubAllGlobals())

/** Fire queued idle callbacks; work that settles synchronously and re-pumps
 *  enqueues the next job, which the browser fires on a subsequent idle. Drain
 *  those follow-ups too, capped so a genuine wedge surfaces as a hang-free fail. */
function flushIdle(): void {
  for (let i = 0; i < 100 && idleQueue.length > 0; i++) {
    const pending = idleQueue
    idleQueue = []
    for (const cb of pending) cb?.()
  }
}

function run<T>(fn: () => T): { result: T; dispose: () => void } {
  const scope = effectScope()
  const result = scope.run(fn)!
  return { result, dispose: () => scope.stop() }
}

describe('useAssetPrefetch', () => {
  it('drains the queue when a loader settles synchronously', () => {
    const loaded: string[] = []
    // A loader that calls done() before returning its canceller — the frame is
    // already warm (cache hit), so it settles inside the same call.
    const syncLoader: AssetLoader = (url, done) => {
      loaded.push(url)
      done()
      return () => {}
    }
    const { result } = run(() => useAssetPrefetch(syncLoader, { concurrency: 1 }))

    result.prefetch(['a', 'b', 'c'])
    flushIdle()

    expect(loaded, 'a synchronous settle must not wedge the queue').toEqual(['a', 'b', 'c'])
  })

  it('does not retain a canceller for a synchronously-settled load', () => {
    let cancelled = 0
    const syncLoader: AssetLoader = (_url, done) => {
      done()
      return () => {
        cancelled++
      }
    }
    const { result, dispose } = run(() => useAssetPrefetch(syncLoader, { concurrency: 1 }))

    result.prefetch(['a'])
    flushIdle()
    dispose()

    expect(cancelled, 'an already-settled load is not cancelled on dispose').toBe(0)
  })
})
