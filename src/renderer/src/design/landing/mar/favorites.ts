import { reactive, watch } from 'vue'

/** Favorites (Mar's proposal), rescued from her usertest-home prototype:
 *  star a template, an app or an asset from its card; it sits under
 *  Favorites in the sidebar and on the Favorites page, and starred
 *  templates lead the ⌘K search. One list, newest last. */
export type FavoriteKind = 'template' | 'app' | 'asset'

const KEY = 'comfy.design.mar.favorites.v2'
const OLD_KEY = 'comfy.design.mar.favorites'
const START = ['image_z_image_turbo', 'video_ltx2_5_i2v', 'image_qwen_image_edit_2511'].map(
  (id) => `template:${id}`
)

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (Array.isArray(v)) return v
    // Stars from the first version (template ids only) carry over.
    const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? 'null')
    return Array.isArray(old) ? old.map((id: string) => `template:${id}`) : START
  } catch {
    return START
  }
}

export const favorites = reactive({
  keys: load(),
  /** Starred template ids, the shape search reads. */
  get ids(): string[] {
    return favoriteIds('template')
  }
})

export function favoriteIds(kind: FavoriteKind): string[] {
  const p = `${kind}:`
  return favorites.keys.filter((k) => k.startsWith(p)).map((k) => k.slice(p.length))
}
export function isFavorite(id: string, kind: FavoriteKind = 'template'): boolean {
  return favorites.keys.includes(`${kind}:${id}`)
}
export function toggleFavorite(id: string, kind: FavoriteKind = 'template'): void {
  const key = `${kind}:${id}`
  if (favorites.keys.includes(key)) {
    favorites.keys = favorites.keys.filter((k) => k !== key)
  } else {
    favorites.keys = [...favorites.keys, key]
  }
}

watch(
  () => [...favorites.keys],
  (keys) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(keys))
    } catch {
      // Storage blocked: the stars last for this window only.
    }
  }
)
