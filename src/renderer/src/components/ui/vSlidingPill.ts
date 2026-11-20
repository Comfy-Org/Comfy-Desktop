import type { Directive } from 'vue'

export const SLIDING_PILL_PICKED =
  ":is([role='tab'][aria-selected='true'], [role='radio'][aria-checked='true'], [aria-pressed='true'])"
const SLIDING_PILL_ITEM = ":is([role='tab'], [role='radio'], [aria-pressed])"

interface Track {
  pill: HTMLSpanElement
  mutations: MutationObserver
  sizes: ResizeObserver
  placedAt: string
}

const tracks = new WeakMap<HTMLElement, Track>()

function ownedBy(track: HTMLElement, el: Element): boolean {
  return el.parentElement?.closest('[data-sliding-pill]') === track
}

function pickedIn(track: HTMLElement): HTMLElement | null {
  const picked = Array.from(track.querySelectorAll<HTMLElement>(SLIDING_PILL_PICKED)).filter((el) =>
    ownedBy(track, el)
  )
  return picked.length === 1 ? (picked[0] ?? null) : null
}

function offsetWithin(item: HTMLElement, track: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  let node: HTMLElement | null = item
  while (node && node !== track) {
    x += node.offsetLeft
    y += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return { x, y }
}

function snapNextMove(pill: HTMLElement): () => void {
  pill.style.transition = 'none'
  return () => {
    void pill.offsetWidth
    pill.style.transition = ''
  }
}

function place(track: HTMLElement, state: Track, slide: boolean): void {
  const { pill } = state
  track.querySelectorAll<HTMLElement>(SLIDING_PILL_ITEM).forEach((item) => {
    if (ownedBy(track, item)) state.sizes.observe(item)
  })
  const picked = pickedIn(track)
  track.dataset.slidingPill = picked ? 'on' : 'off'
  if (!picked) {
    pill.hidden = true
    state.placedAt = ''
    return
  }
  const { x, y } = offsetWithin(picked, track)
  const at = `${x},${y},${picked.offsetWidth},${picked.offsetHeight}`
  if (at === state.placedAt) return
  const release = slide && !pill.hidden ? undefined : snapNextMove(pill)
  pill.hidden = false
  pill.style.width = `${picked.offsetWidth}px`
  pill.style.height = `${picked.offsetHeight}px`
  pill.style.borderRadius = getComputedStyle(picked).borderRadius
  pill.style.transform = `translate(${x}px, ${y}px)`
  state.placedAt = at
  release?.()
}

function pillClass(value: string | undefined): string {
  return ['sliding-pill', value ?? ''].join(' ').trim()
}

export const vSlidingPill: Directive<HTMLElement, string | undefined> = {
  mounted(track, binding) {
    track.dataset.slidingPill = 'on'
    const pill = document.createElement('span')
    pill.className = pillClass(binding.value)
    pill.setAttribute('aria-hidden', 'true')
    pill.dataset.testid = 'sliding-pill'
    pill.hidden = true
    track.prepend(pill)
    if (getComputedStyle(track).position === 'static') track.style.position = 'relative'
    const state: Track = {
      pill,
      placedAt: '',
      mutations: new MutationObserver(() => place(track, state, true)),
      sizes: new ResizeObserver(() => place(track, state, false))
    }
    tracks.set(track, state)
    state.mutations.observe(track, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-checked', 'aria-pressed']
    })
    state.sizes.observe(track)
    place(track, state, false)
  },
  updated(track, binding) {
    const state = tracks.get(track)
    if (state) state.pill.className = pillClass(binding.value)
  },
  beforeUnmount(track) {
    const state = tracks.get(track)
    if (!state) return
    state.mutations.disconnect()
    state.sizes.disconnect()
    state.pill.remove()
    tracks.delete(track)
  }
}
