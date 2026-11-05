import { reactive, watch } from 'vue'

/** Apps on Mar's Home (UI Playground › Apps on Home): On by default, the
 *  starter apps named by what they make, or Off. */
export type HomeApps = 'off' | 'on'

export const HOME_APPS: { value: HomeApps; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
]

const KEY = 'comfy.design.mar.homeApps'

export const homeApps = reactive<{ id: HomeApps }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'off' ? 'off' : 'on'
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
