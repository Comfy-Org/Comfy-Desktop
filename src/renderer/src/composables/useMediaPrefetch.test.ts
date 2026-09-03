import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useMediaPrefetch } from './useMediaPrefetch'

let idleQueue: Array<() => void> = []
let nextHandle = 1

interface FakeVideo {
  src: string
  muted: boolean
  preload: string
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

  it('warms muted with preload=auto so the element buffers without playing', () => {
    const { result } = run(() => useMediaPrefetch())
    result.prefetch(['a.mp4'])
    flushIdle()
    expect(videos[0]!.muted, 'a warm must not make sound').toBe(true)
    expect(videos[0]!.preload, 'preload=auto is what fills the cache').toBe('auto')
  })

  it('serialises to one warm at a time by default (large media)', () => {
    const { result } = run(() => useMediaPrefetch())
    result.prefetch(['a.mp4', 'b.mp4', 'c.mp4'])
    flushIdle()
    expect(videos, 'only one warm in flight at a time').toHaveLength(1)

    videos[0]!.fireLoaded()
    flushIdle()
    expect(videos, 'settling the first warm pumps the next').toHaveLength(2)
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
    expect(videos[0]!.src, 'dispose detaches the element source').toBe('')
    expect(videos[0]!.loadCalled, 'dispose calls load() to free the element').toBe(true)
  })
})
