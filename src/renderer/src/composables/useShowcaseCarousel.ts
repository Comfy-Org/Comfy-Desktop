import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { SHOWCASE_CARDS, type ShowcaseCard } from '../lib/installShowcase'

export const SHOWCASE_INTERVAL_MS = 7_000

export interface ShowcaseCarousel {
  card: ComputedRef<ShowcaseCard>
  index: Ref<number>
  count: number
  next: () => void
  prev: () => void
  goTo: (index: number) => void
  paused: Ref<boolean>
  pause: () => void
  resume: () => void
}

export function useShowcaseCarousel(
  cards: readonly ShowcaseCard[] = SHOWCASE_CARDS,
  intervalMs = SHOWCASE_INTERVAL_MS
): ShowcaseCarousel {
  const index = ref(0)
  const paused = ref(false)
  const count = cards.length

  const wrap = (at: number): number => ((at % count) + count) % count

  let timer: ReturnType<typeof setInterval> | undefined

  function schedule(): void {
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      if (paused.value) return
      index.value = wrap(index.value + 1)
    }, intervalMs)
  }

  schedule()
  onScopeDispose(() => clearInterval(timer))

  function moveTo(at: number): void {
    index.value = wrap(at)
    schedule()
  }

  return {
    card: computed(() => cards[wrap(index.value)]!),
    index,
    count,
    next: () => moveTo(index.value + 1),
    prev: () => moveTo(index.value - 1),
    goTo: moveTo,
    paused,
    pause: () => {
      paused.value = true
    },
    resume: () => {
      paused.value = false
      schedule()
    }
  }
}
