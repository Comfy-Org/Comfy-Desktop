import { reactive, watch } from 'vue'

export type ViewerShortcut = 'off' | 'on'

const KEY = 'comfy.design.mar.viewerShortcut'

export const viewerShortcut = reactive<{ id: ViewerShortcut }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'off' ? 'off' : 'on'
    } catch {
      return 'on'
    }
  })()
})

watch(
  () => viewerShortcut.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)

export const viewerOnScreen = reactive({ count: 0 })
