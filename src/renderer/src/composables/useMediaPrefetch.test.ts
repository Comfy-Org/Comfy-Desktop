import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useMediaPrefetch } from './useMediaPrefetch'

// Drive idle callbacks manually so tests control exactly when a queued warm runs.
let idleQueue: Array<() => void> = []
let nextHandle = 1

// Track each warm <video> + its listeners so tests can settle them one at a time.
interface FakeVideo {
  src: string
  listeners: Record<string, Array<() => void>>
  fireLoaded: () => void
  loadCalled: boolean
}
let videos: FakeVideo[] = []

function makeFakeVideo(): FakeVideo {
  const listeners: Record<string, Array<() => void>> = {}
  const el = {
    muted: false,
    preload: '',
    src: '',
    listeners,
    loadCalled: false,
    addEventListener(ev: string, cb: () => void) {
      ;(listeners[ev] ??= []).push(cb)
    },
    removeEventListener(ev: string, cb: () => void) {
      listeners[ev] = (listeners[ev] ?? []).filter((c) => c !== cb)
    },
    removeAttribute() {
      el.src = ''
    },
    load() {
      el.loadCalled = true
    },
    fireLoaded() {
      for (const cb of listeners['loadeddata'] ?? []) cb()
    }
  }
  return el as unknown as FakeVideo
}

beforeEach(() => {
  idleQueue = []
  nextHandle = 1
  videos = []

  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    idleQueue.push(cb)
    return nextHandle++
  })
  vi.stubGlobal('cancelIdleCallback', (handle: number) => {
    idleQueue[handle - 1] = undefined as unknown as () => void
  })
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'video') throw new Error(`unexpected createElement(${tag})`)
      const v = makeFakeVideo()
      videos.push(v)
      return v
    }
  })
  vi.stubGlobal('navigator', { connection: undefined })
})

afterEach(() => vi.unstubAllGlobals())

function flushIdle(): void {
  const pending = idleQueue
  idleQueue = []
  for (const cb of pending) cb?.()
}

function run<T>(fn: () => T): { result: T; dispose: () => void } {
  const scope = effectScope()
  const result = scope.run(fn)!
  return { result, dispose: () => scope.stop() }
}

describe('useMediaPrefetch', () => {
  it('warms each url exactly once, de-duplicating repeats', () => {
    const { result } = run(() => useMediaPrefetch({ concurrency: 10 }))
    result.prefetch(['a.mp4', 'b.mp4', 'a.mp4', null, undefined])
    flushIdle()
    expect(videos.map((v) => v.src).sort()).toEqual(['a.mp4', 'b.mp4'])
  })

  it('serialises to one warm at a time by default (large media)', () => {
    const { result } = run(() => useMediaPrefetch())
    result.prefetch(['a.mp4', 'b.mp4', 'c.mp4'])
    flushIdle()
    expect(videos).toHaveLength(1)

    // Settle the first warm; its `done` pumps the next.
    videos[0]!.fireLoaded()
    flushIdle()
    expect(videos).toHaveLength(2)
  })

  it('skips warming on a data-saver connection', () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } })
    const { result } = run(() => useMediaPrefetch())
    result.prefetch(['a.mp4'])
    flushIdle()
    expect(videos).toHaveLength(0)
  })

  it('releases the element source on dispose', () => {
    const { result, dispose } = run(() => useMediaPrefetch())
    result.prefetch(['a.mp4'])
    flushIdle()
    expect(videos).toHaveLength(1)
    dispose()
    // Cancel path detaches the source and calls load() so the element is freed.
    expect(videos[0]!.src).toBe('')
    expect(videos[0]!.loadCalled).toBe(true)
  })
})
