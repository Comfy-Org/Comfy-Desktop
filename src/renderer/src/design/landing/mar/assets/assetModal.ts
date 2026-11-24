import { reactive, watch } from 'vue'

/** UI Playground › Asset modal. Window, the proposal: the asset sits in a
 *  frame with the app blurred behind, so you never lose where you were.
 *  Full screen is what the Better Assets Management review settled on for
 *  the first milestone: the modal takes the whole window, tags stay out
 *  until they are editable, and Close moves inside, next to the name. */
export type AssetModal = 'window' | 'full'

export const ASSET_MODALS: { value: AssetModal; label: string }[] = [
  { value: 'window', label: 'Window' },
  { value: 'full', label: 'Full screen' }
]

const KEY = 'comfy.design.mar.assetModal'

export const assetModal = reactive<{ id: AssetModal }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'full' ? 'full' : 'window'
    } catch {
      return 'window'
    }
  })()
})

watch(
  () => assetModal.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
