import { reactive, watch } from 'vue'

/** Apps on Mar's Home (UI Playground › Apps on Home): the starter apps
 *  named by what they make, on the arc carousel by default, as a grid, or
 *  Off. */
export type HomeApps = 'off' | 'on' | 'grid'

export const HOME_APPS: { value: HomeApps; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'Carousel' },
  { value: 'grid', label: 'Grid' }
]

const KEY = 'comfy.design.mar.homeApps'

export const homeApps = reactive<{ id: HomeApps }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as HomeApps | null
      return v && HOME_APPS.some((a) => a.value === v) ? v : 'on'
    } catch {
      return 'on'
    }
  })()
})

watch(
  () => homeApps.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
