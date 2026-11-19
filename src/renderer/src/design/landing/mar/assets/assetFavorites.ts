import { reactive, watch } from 'vue'

/**
 * Starred assets (Alex Tov's media-assets proto): a star on the card, and
 * Favorites in the Assets sidebar shows only those. Its own store, apart
 * from the app-wide favorites (mar/favorites.ts), which don't ship yet.
 * Remembered per viewer.
 */
const KEY = 'comfy.design.mar.assetFavorites'

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

const starred = reactive(new Set<string>(load()))

export const isStarred = (id: string): boolean => starred.has(id)
export function toggleStar(id: string): void {
  if (starred.has(id)) starred.delete(id)
  else starred.add(id)
}

watch(
  () => [...starred],
  (ids) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ids))
    } catch {
      // Storage blocked: the stars last for this window only.
    }
  }
)
