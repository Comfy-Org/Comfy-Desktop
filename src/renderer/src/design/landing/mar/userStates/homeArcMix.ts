import { reactive, watch } from 'vue'

/** How the Home's arc shows apps and templates from Milestone 3 on
 *  (UI Playground › Apps and templates). */
export type HomeArcMix = 'tabs' | 'mixed' | 'row' | 'topics'

export const HOME_ARC_MIXES: { value: HomeArcMix; label: string }[] = [
  { value: 'tabs', label: '1 · Apps | Templates tabs over the arc' },
  { value: 'mixed', label: '2 · One arc, apps and templates mixed' },
  { value: 'row', label: '3 · Arc of apps, row of templates' },
  { value: 'topics', label: '4 · Arc by use case (chips)' }
]

const KEY = 'comfy.design.mar.homeArcMix'

export const homeArcMix = reactive<{ id: HomeArcMix }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return HOME_ARC_MIXES.some((l) => l.value === v) ? (v as HomeArcMix) : 'tabs'
    } catch {
      return 'tabs'
    }
  })()
})

watch(
  () => homeArcMix.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
