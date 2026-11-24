import { reactive, watch } from 'vue'

export type AssetFoldersShown = 'off' | 'on'

const KEY = 'comfy.design.mar.assetFolders'

export const assetFoldersShown = reactive<{ id: AssetFoldersShown }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'on' ? 'on' : 'off'
    } catch {
      return 'off'
    }
  })()
})

watch(
  () => assetFoldersShown.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)
