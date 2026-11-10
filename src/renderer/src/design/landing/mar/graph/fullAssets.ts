import { reactive, watch } from 'vue'

/** UI Playground › Full Assets (ComfyUI, Proposal): where the Assets
 *  panel's expand button takes you. Tab grows the panel into a tab beside
 *  the workflows; Home opens Desktop's Assets page, on this build. */
export type FullAssets = 'tab' | 'home'

export const FULL_ASSETS: { value: FullAssets; label: string }[] = [
  { value: 'tab', label: 'Tab' },
  { value: 'home', label: 'Home' }
]

const KEY = 'comfy.design.mar.fullAssets'

export const fullAssets = reactive<{ id: FullAssets }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'home' ? 'home' : 'tab'
    } catch {
      return 'tab'
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
