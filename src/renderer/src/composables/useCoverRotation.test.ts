import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { COVER_FADE_MS, COVER_HOLD_MS, useCoverRotation } from './useCoverRotation'

const LONGEST_FIRST_HOLD_MS = COVER_HOLD_MS * 1.5
const FIRST_HOLD_AT_HALF_MS = COVER_HOLD_MS

let stops: Array<() => void> = []

function setup(count: number, { random = () => 0.5, playing = ref(true), key = ref(0) } = {}) {
  const scope = effectScope()
  const rotation = scope.run(() =>
    useCoverRotation({
      count: () => count,
      key: () => key.value,
      playing: () => playing.value,
      random
    })
  )!
  stops.push(() => scope.stop())
  return rotation
}

function loadAll(rotation: ReturnType<typeof setup>, count: number): void {
  for (let index = 0; index < count; index++) rotation.markLoaded(index)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  stops = []
})

afterEach(() => {
  stops.forEach((stop) => stop())
  vi.useRealTimers()
})

describe('the covers of one card', () => {
  it('open on one cover and name a different one to load next', () => {
    const rotation = setup(3)

    expect(rotation.shown.value).not.toBeNull()
    expect(rotation.upcoming.value).not.toBeNull()
    expect(rotation.upcoming.value).not.toBe(rotation.shown.value)
    expect(rotation.leaving.value).toBeNull()
  })

  it('hold a cover, then change to the next one and keep the old one under it while it fades in', () => {
    const rotation = setup(3)
    loadAll(rotation, 3)
    const first = rotation.shown.value
    const second = rotation.upcoming.value

    vi.advanceTimersByTime(FIRST_HOLD_AT_HALF_MS)

    expect(rotation.shown.value).toBe(second)
    expect(rotation.leaving.value).toBe(first)

    vi.advanceTimersByTime(COVER_FADE_MS)

    expect(rotation.leaving.value).toBeNull()
  })

  it('hold each later cover for one loop of the cover', () => {
    const rotation = setup(3)
    loadAll(rotation, 3)
    vi.advanceTimersByTime(FIRST_HOLD_AT_HALF_MS)
    const second = rotation.shown.value

    vi.advanceTimersByTime(COVER_HOLD_MS - 1)
    expect(rotation.shown.value).toBe(second)

    vi.advanceTimersByTime(1)
    expect(rotation.shown.value).not.toBe(second)
  })

  it('start the first hold only once the first cover has loaded', () => {
    const rotation = setup(2)
    const first = rotation.shown.value
    rotation.markLoaded(rotation.upcoming.value!)

    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS * 3)
    expect(rotation.shown.value).toBe(first)

    rotation.markLoaded(first!)
    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS)
    expect(rotation.shown.value).not.toBe(first)
  })

  it('wait for the next cover to load, so the card never shows a blank', () => {
    const rotation = setup(3)
    const first = rotation.shown.value!
    const second = rotation.upcoming.value!
    rotation.markLoaded(first)

    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS * 3)
    expect(rotation.shown.value).toBe(first)

    rotation.markLoaded(second)
    expect(rotation.shown.value).toBe(second)
  })

  it('show every cover once a pass, in a new order each pass, never the same one twice in a row', () => {
    const count = 4
    const rotation = setup(count, { random: Math.random })
    const seen = [rotation.shown.value]
    const stop = watch(rotation.shown, (now) => seen.push(now), { flush: 'sync' })
    stops.push(stop)
    loadAll(rotation, count)

    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS + COVER_HOLD_MS * count * 3)

    expect(new Set(seen.slice(0, count)).size).toBe(count)
    expect(new Set(seen.slice(count, count * 2)).size).toBe(count)
    for (let at = 1; at < seen.length; at++) expect(seen[at]).not.toBe(seen[at - 1])
  })

  it('change two cards at different times when they start together', () => {
    const early = setup(3, { random: () => 0 })
    const late = setup(3, { random: () => 0.9 })
    loadAll(early, 3)
    loadAll(late, 3)
    const earlyFirst = early.shown.value
    const lateFirst = late.shown.value

    vi.advanceTimersByTime(COVER_HOLD_MS * 0.5)

    expect(early.shown.value).not.toBe(earlyFirst)
    expect(late.shown.value).toBe(lateFirst)
  })

  it('stand still while the card is off screen, and go on once it is back', async () => {
    const playing = ref(false)
    const rotation = setup(3, { playing })
    loadAll(rotation, 3)
    const first = rotation.shown.value

    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS * 4)
    expect(rotation.shown.value).toBe(first)

    playing.value = true
    await nextTick()
    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS)
    expect(rotation.shown.value).not.toBe(first)
  })

  it('change at once on coming back when the next cover was due while the card was away', async () => {
    const playing = ref(true)
    const rotation = setup(3, { playing })
    const first = rotation.shown.value!
    const second = rotation.upcoming.value!
    rotation.markLoaded(first)
    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS)

    playing.value = false
    await nextTick()
    rotation.markLoaded(second)
    expect(rotation.shown.value).toBe(first)

    playing.value = true
    await nextTick()
    expect(rotation.shown.value).toBe(second)
  })

  it('skip a cover that fails to load', () => {
    const rotation = setup(3)
    loadAll(rotation, 3)
    const first = rotation.shown.value!
    const broken = rotation.upcoming.value!
    const third = [0, 1, 2].find((index) => index !== first && index !== broken)

    rotation.markFailed(broken)

    expect(rotation.upcoming.value).toBe(third)
    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS)
    expect(rotation.shown.value).toBe(third)
    expect(rotation.allFailed.value).toBe(false)
  })

  it('move on from a shown cover that fails, and say so once none can be shown', () => {
    const rotation = setup(2)
    const first = rotation.shown.value!
    const second = rotation.upcoming.value!

    rotation.markFailed(first)
    expect(rotation.shown.value).toBe(second)
    expect(rotation.upcoming.value).toBeNull()

    rotation.markFailed(second)
    expect(rotation.shown.value).toBeNull()
    expect(rotation.allFailed.value).toBe(true)
  })

  it('keep the one cover of an app that has only one', () => {
    const rotation = setup(1)
    rotation.markLoaded(0)

    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS * 4)

    expect(rotation.shown.value).toBe(0)
    expect(rotation.upcoming.value).toBeNull()
  })

  it('start over when the list of covers changes', async () => {
    const key = ref(0)
    const rotation = setup(3, { key })
    loadAll(rotation, 3)

    key.value = 1
    await nextTick()

    expect(rotation.loaded.value.size).toBe(0)
    expect(rotation.leaving.value).toBeNull()
    expect(rotation.shown.value).not.toBeNull()
  })

  it('stop once the card is gone', () => {
    const scope = effectScope()
    const rotation = scope.run(() =>
      useCoverRotation({ count: () => 3, playing: () => true, random: () => 0.5 })
    )!
    loadAll(rotation, 3)
    const first = rotation.shown.value
    scope.stop()

    vi.advanceTimersByTime(LONGEST_FIRST_HOLD_MS * 4)

    expect(rotation.shown.value).toBe(first)
  })
})
