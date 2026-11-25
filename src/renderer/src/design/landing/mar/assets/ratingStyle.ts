import { reactive, watch } from 'vue'

/** UI Playground › Rating. Favorite is the star Assets has today: on or
 *  off. Five stars is what the Better Asset Management review asked for
 *  — "I would start there with either favorites or five star ratings" —
 *  one tap on the same star, then pick how many. */
export type RatingStyle = 'favorite' | 'stars'

export const RATING_STYLES: { value: RatingStyle; label: string }[] = [
  { value: 'favorite', label: 'Favorite' },
  { value: 'stars', label: 'Five stars' }
]

const KEY = 'comfy.design.mar.ratingStyle'

export const ratingStyle = reactive<{ id: RatingStyle }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'favorite' ? 'favorite' : 'stars'
    } catch {
      return 'stars'
    }
  })()
})

watch(
  () => ratingStyle.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
