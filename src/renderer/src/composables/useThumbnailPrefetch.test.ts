import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useThumbnailPrefetch } from './useThumbnailPrefetch'

// Drive idle callbacks manually so tests control exactly when a queued fetch
// runs — no real timers, no flakiness.
let idleQueue: Array<() => void> = []
let nextHandle = 1

// Track the Image instances the composable creates + their live handlers, so we
// can assert concurrency, completion, and leak-freedom (handlers nulled).
interface FakeImage {
  src: string
  onload: (() => void) | null
  onerror: (() => void) | null
}
let images: FakeImage[] = []

beforeEach(() => {
  idleQueue = []
  nextHandle = 1
  images = []

  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    idleQueue.push(cb)
    return nextHandle++
  })
  vi.stubGlobal('cancelIdleCallback', (handle: number) => {
    // Mark cancelled by index; flushIdle skips holes.
    idleQueue[handle - 1] = undefined as unknown as () => void
  })
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        const self = this as unknown as FakeImage
        images.push(self)
      }
    }
  )
  // Default: a normal (non-metered) connection.
  vi.stubGlobal('navigator', { connection: undefined })
})

afterEach(() => vi.unstubAllGlobals())

/** Run all currently-queued idle callbacks (FIFO), as the browser would when idle.
 *  Idle work that schedules more idle work surfaces on the next flush. */
function flushIdle(): void {
  const pending = idleQueue
  idleQueue = []
  for (const cb of pending) cb?.()
}

/** Settle the Nth in-flight image as loaded. */
function loadImage(i: number): void {
  images[i]!.onload?.()
}

function run<T>(fn: () => T): { result: T; dispose: () => void } {
  const scope = effectScope()
  const result = scope.run(fn)!
  return { result, dispose: () => scope.stop() }
}

describe('useThumbnailPrefetch', () => {
  it('warms each url exactly once, de-duplicating repeats', () => {
    const { result } = run(() => useThumbnailPrefetch({ concurrency: 10 }))
    result.prefetch(['a.webp', 'b.webp', 'a.webp', null, undefined])
    flushIdle()
    expect(images.map((i) => i.src).sort()).toEqual(['a.webp', 'b.webp'])

    result.prefetch(['a.webp']) // already seen → no new fetch
    flushIdle()
    expect(images).toHaveLength(2)
  })

  it('caps concurrency and drains as fetches complete', () => {
    const { result } = run(() => useThumbnailPrefetch({ concurrency: 2 }))
    result.prefetch(['a', 'b', 'c', 'd'])
    flushIdle()
    expect(images).toHaveLength(2) // only 2 in flight

    loadImage(0)
    flushIdle()
    expect(images).toHaveLength(3) // a freed a slot

    loadImage(1)
    loadImage(2)
    flushIdle()
    expect(images).toHaveLength(4) // all drained
  })

  it('defers while busy and resumes once important work finishes', () => {
    // Fake only the backoff timer; keep our requestIdleCallback stub intact.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let busy = true
      const { result } = run(() => useThumbnailPrefetch({ isBusy: () => busy, concurrency: 5 }))
      result.prefetch(['a', 'b'])
      flushIdle() // busy → backs off on a timer, nothing fetched
      expect(images).toHaveLength(0)

      busy = false
      vi.advanceTimersByTime(1500) // backoff elapses → pump retries
      flushIdle() // now-scheduled idle loads run
      expect(images.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips entirely under data-saver', () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    const { result } = run(() => useThumbnailPrefetch())
    result.prefetch(['a', 'b'])
    flushIdle()
    expect(images).toHaveLength(0)
  })

  it('skips entirely on a 2g connection', () => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '2g' } })
    const { result } = run(() => useThumbnailPrefetch())
    result.prefetch(['a'])
    flushIdle()
    expect(images).toHaveLength(0)
  })

  it('releases image handlers on settle (no leak)', () => {
    const { result } = run(() => useThumbnailPrefetch({ concurrency: 1 }))
    result.prefetch(['a'])
    flushIdle()
    loadImage(0)
    expect(images[0]!.onload).toBeNull()
    expect(images[0]!.onerror).toBeNull()
  })

  it('detaches handlers of still-loading images on dispose (no leak)', () => {
    const { result, dispose } = run(() => useThumbnailPrefetch({ concurrency: 1 }))
    result.prefetch(['a'])
    flushIdle()
    expect(images[0]!.onload).not.toBeNull() // in flight
    dispose()
    expect(images[0]!.onload).toBeNull()
    expect(images[0]!.onerror).toBeNull()
  })

  it('cancels pending work and queues nothing more after dispose', () => {
    const { result, dispose } = run(() => useThumbnailPrefetch({ concurrency: 1 }))
    result.prefetch(['a', 'b', 'c'])
    flushIdle()
    expect(images).toHaveLength(1)

    dispose()
    loadImage(0) // completing the in-flight one must not pump the queue
    flushIdle()
    expect(images).toHaveLength(1)

    result.prefetch(['d']) // disposed → ignored
    flushIdle()
    expect(images).toHaveLength(1)
  })

  it('falls back to setTimeout when requestIdleCallback is unavailable', () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    vi.stubGlobal('cancelIdleCallback', undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const { result } = run(() => useThumbnailPrefetch({ concurrency: 5 }))
      result.prefetch(['a', 'b'])
      expect(images).toHaveLength(0) // deferred, not run synchronously
      vi.advanceTimersByTime(50)
      expect(images.map((i) => i.src).sort()).toEqual(['a', 'b'])
    } finally {
      vi.useRealTimers()
    }
  })
})
