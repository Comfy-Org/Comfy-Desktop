import { reactive, watch } from 'vue'

/** Builds on Mar's Home (UI Playground › Build on Home): On by default, a
 *  compact Builds row with Pablo's Home content (your recent builds, their
 *  state, click to launch), or Off. Desktop only: Cloud has no local
 *  builds, so the row never shows there. */
export type HomeBuilds = 'off' | 'on'

export const HOME_BUILDS: { value: HomeBuilds; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'on', label: 'On' }
]

const KEY = 'comfy.design.mar.homeBuilds.v2'

export const homeBuilds = reactive<{ id: HomeBuilds }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'off' ? 'off' : 'on'
    } catch {
      return 'on'
    }
  })()
})

watch(
  () => homeBuilds.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
