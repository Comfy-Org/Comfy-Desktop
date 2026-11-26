import { reactive, watch } from 'vue'

export type ViewerShortcut = 'off' | 'stage' | 'bar'

export const VIEWER_SHORTCUTS: { value: ViewerShortcut; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'stage', label: 'On picture' },
  { value: 'bar', label: 'By zoom' }
]

const KEY = 'comfy.design.mar.viewerShortcut'

export const viewerShortcut = reactive<{ id: ViewerShortcut }>({
  id: (() => {
    try {
      const saved = localStorage.getItem(KEY)
      return saved === 'off' || saved === 'bar' ? saved : 'stage'
    } catch {
      return 'stage'
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
