import { reactive, watch } from 'vue'

/**
 * Stars on a file (Better Asset Management review): one to five, to sort
 * the keepers from the rest of a run. "It's quite important because you
 * generate lots of junk." Zero means unrated, which is not the same as
 * one star. Remembered per viewer, like the favorites it replaces when
 * UI Playground › Rating is on Five stars.
 */
export const MAX_STARS = 5

const KEY = 'comfy.design.mar.assetRating'

function load(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, number>) : {}
  } catch {
    return {}
  }
}

const stars = reactive<Record<string, number>>(load())

export const ratingOf = (id: string): number => stars[id] ?? 0

/** Clamped to 0…5; 0 takes the stars off again. */
export function setRating(ids: string[], n: number): void {
  const v = Math.max(0, Math.min(MAX_STARS, Math.round(n)))
  for (const id of ids) {
    if (v) stars[id] = v
    else delete stars[id]
  }
}

watch(
  () => ({ ...stars }),
  (all) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch {
      // Storage blocked: the stars last for this window only.
    }
  },
  { deep: true }
)
