import { reactive, watch } from 'vue'

/** UI Playground › Everywhere in Assets. Off by default: Assets browses
 *  one build at a time, as the PRD scopes it. On, the build picker adds
 *  Everywhere (every running build at once, each card naming its build),
 *  kept for when browsing across builds gets its own scope. */
export type AssetsEverywhere = 'off' | 'on'

const KEY = 'comfy.design.mar.assetsEverywhere'

export const assetsEverywhere = reactive<{ id: AssetsEverywhere }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'on' ? 'on' : 'off'
    } catch {
      return 'off'
    }
  })()
})

watch(
  () => assetsEverywhere.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
