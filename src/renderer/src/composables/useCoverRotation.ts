import { computed, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'

export const COVER_HOLD_MS = 5_000
export const COVER_FADE_MS = 700

export interface CoverRotation {
  shown: Ref<number | null>
  leaving: Ref<number | null>
  upcoming: Ref<number | null>
  loaded: Ref<ReadonlySet<number>>
  failed: Ref<ReadonlySet<number>>
  allFailed: ComputedRef<boolean>
  markLoaded: (index: number) => void
  markFailed: (index: number) => void
  restart: () => void
}

export interface CoverRotationOptions {
  count: () => number
  key?: () => unknown
  playing: () => boolean
  random?: () => number
  holdMs?: number
  fadeMs?: number
}

export function useCoverRotation({
  count,
  key = count,
  playing,
  random = Math.random,
  holdMs = COVER_HOLD_MS,
  fadeMs = COVER_FADE_MS
}: CoverRotationOptions): CoverRotation {
  const shown = ref<number | null>(null)
  const leaving = ref<number | null>(null)
  const upcoming = ref<number | null>(null)
  const loaded = ref<ReadonlySet<number>>(new Set())
  const failed = ref<ReadonlySet<number>>(new Set())

  let deck: number[] = []
  let due = false
  let firstHold = true
  let holdTimer: ReturnType<typeof setTimeout> | undefined
  let fadeTimer: ReturnType<typeof setTimeout> | undefined

  const allFailed = computed(() => count() > 0 && failed.value.size >= count())

  function shuffled(): number[] {
    const order = Array.from({ length: count() }, (_none, index) => index).filter(
      (index) => !failed.value.has(index)
    )
    for (let at = order.length - 1; at > 0; at--) {
      const swap = Math.min(at, Math.floor(random() * (at + 1)))
      ;[order[at], order[swap]] = [order[swap]!, order[at]!]
    }
    if (order.length > 1 && order[0] === shown.value) order.push(order.shift()!)
    return order
  }

  function draw(): number | null {
    for (let tries = 0; tries < 2; tries++) {
      while (deck.length > 0) {
        const next = deck.shift()!
        if (!failed.value.has(next) && next !== shown.value) return next
      }
      deck = shuffled()
    }
    return null
  }

  function clearHold(): void {
    clearTimeout(holdTimer)
    holdTimer = undefined
  }

  function hold(): void {
    clearHold()
    if (!playing() || due || shown.value === null || !loaded.value.has(shown.value)) return
    if (upcoming.value === null) return
    const wait = firstHold ? holdMs * (0.5 + random()) : holdMs
    holdTimer = setTimeout(() => {
      holdTimer = undefined
      firstHold = false
      due = true
      advance()
    }, wait)
  }

  function advance(): void {
    const next = upcoming.value
    if (!due || !playing() || next === null || !loaded.value.has(next)) return
    due = false
    leaving.value = shown.value
    shown.value = next
    upcoming.value = draw()
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => {
      leaving.value = null
    }, fadeMs)
    hold()
  }

  function start(): void {
    clearHold()
    clearTimeout(fadeTimer)
    deck = []
    due = false
    firstHold = true
    leaving.value = null
    loaded.value = new Set()
    failed.value = new Set()
    shown.value = null
    shown.value = draw()
    upcoming.value = count() > 1 ? draw() : null
  }

  function markLoaded(index: number): void {
    if (loaded.value.has(index)) return
    loaded.value = new Set(loaded.value).add(index)
    if (index === shown.value && !holdTimer) hold()
    else if (index === upcoming.value) advance()
  }

  function markFailed(index: number): void {
    if (failed.value.has(index)) return
    failed.value = new Set(failed.value).add(index)
    if (index === leaving.value) leaving.value = null
    if (index === shown.value) {
      clearHold()
      due = false
      shown.value = upcoming.value
      upcoming.value = draw()
      hold()
    } else if (index === upcoming.value) {
      upcoming.value = draw()
      if (due) advance()
      else if (!holdTimer) hold()
    }
  }

  watch(key, start, { immediate: true })
  watch(playing, (now) => {
    if (!now) clearHold()
    else if (due) advance()
    else hold()
  })

  onScopeDispose(() => {
    clearHold()
    clearTimeout(fadeTimer)
  })

  return {
    shown,
    leaving,
    upcoming,
    loaded,
    failed,
    allFailed,
    markLoaded,
    markFailed,
    restart: start
  }
}
