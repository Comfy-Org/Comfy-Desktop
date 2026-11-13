import { reactive, watch } from 'vue'

/** UI Playground › Full Assets (ComfyUI, Proposal): where the Assets
 *  panel's expand button takes you. Home (default) opens Desktop's Assets
 *  page on this build, one Assets for both; Tab grows the panel into a tab
 *  beside the workflows. */
export type FullAssets = 'tab' | 'home'

export const FULL_ASSETS: { value: FullAssets; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'tab', label: 'Tab' }
]

// v2: Home became the default; a Tab saved before that doesn't carry over.
const KEY = 'comfy.design.mar.fullAssets.v2'

export const fullAssets = reactive<{ id: FullAssets }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'tab' ? 'tab' : 'home'
    } catch {
      return 'home'
    }
  })()
})

watch(
  () => fullAssets.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
