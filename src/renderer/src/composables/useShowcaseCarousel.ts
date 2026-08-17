import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from 'vue'
import { SHOWCASE_CARDS, type ShowcaseCard } from '../lib/installShowcase'

/** How long each card holds.
 *
 *  The 15-50s figures from Ubuntu and Ubiquity are sized for a full-bleed
 *  slideshow carrying images and several sentences. A card here is one short
 *  line — roughly 3s of reading — so that range would leave it sitting long
 *  after it has been absorbed.
 *
 *  The floor that does apply is Unity's documented 2s minimum dwell, which
 *  exists to stop content flickering past. 7s clears it with room to notice the
 *  change and read without hurrying. */
export const SHOWCASE_INTERVAL_MS = 7_000

export interface ShowcaseCarousel {
  card: ComputedRef<ShowcaseCard>
  index: Ref<number>
  count: number
  next: () => void
  prev: () => void
  goTo: (index: number) => void
  /** Rotation stops while the user is reading or interacting. */
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

  /** Restarts the dwell, so a card the user just chose is not cut short by
   *  whatever was left of the previous card's timer. */
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
    }
  }
}
