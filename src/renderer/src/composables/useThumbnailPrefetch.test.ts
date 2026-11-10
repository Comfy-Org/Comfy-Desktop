import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useThumbnailPrefetch } from './useThumbnailPrefetch'

let idleQueue: Array<() => void> = []
let nextHandle = 1

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
  vi.stubGlobal('navigator', { connection: undefined })
})

afterEach(() => vi.unstubAllGlobals())

function flushIdle(): void {
  const pending = idleQueue
  idleQueue = []
  for (const cb of pending) cb?.()
}

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

    result.prefetch(['a.webp'])
    flushIdle()
    expect(images).toHaveLength(2)
  })

  it('caps concurrency and drains as fetches complete', () => {
    const { result } = run(() => useThumbnailPrefetch({ concurrency: 2 }))
    result.prefetch(['a', 'b', 'c', 'd'])
    flushIdle()
    expect(images).toHaveLength(2)

    loadImage(0)
    flushIdle()
    expect(images).toHaveLength(3)

    loadImage(1)
    loadImage(2)
    flushIdle()
    expect(images).toHaveLength(4)
  })

  it('defers while busy and resumes once important work finishes', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      let busy = true
      const { result } = run(() => useThumbnailPrefetch({ isBusy: () => busy, concurrency: 5 }))
      result.prefetch(['a', 'b'])
      flushIdle()
      expect(images).toHaveLength(0)

      busy = false
      vi.advanceTimersByTime(1500)
      flushIdle()
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
    expect(images[0]!.onload).not.toBeNull()
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
    loadImage(0)
    flushIdle()
    expect(images).toHaveLength(1)

    result.prefetch(['d'])
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
      expect(images).toHaveLength(0)
      vi.advanceTimersByTime(50)
      expect(images.map((i) => i.src).sort()).toEqual(['a', 'b'])
    } finally {
      vi.useRealTimers()
    }
  })
})
