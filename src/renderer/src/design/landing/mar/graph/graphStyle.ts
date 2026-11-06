import { reactive, watch } from 'vue'

/** How ComfyUI's graph editor looks in Mar's proposal (UI Playground ›
 *  Graph editor): Glass, the Home's language carried into the canvas, or
 *  Current, ComfyUI as it looks today laid out in the new structure. */
export type GraphStyle = 'glass' | 'current'

export const GRAPH_STYLES: { value: GraphStyle; label: string }[] = [
  { value: 'glass', label: 'Glass' },
  { value: 'current', label: 'Current' }
]

const KEY = 'comfy.design.mar.graphStyle'

export const graphStyle = reactive<{ id: GraphStyle }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'current' ? 'current' : 'glass'
    } catch {
      return 'glass'
    }
  })()
})

watch(
  () => graphStyle.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
