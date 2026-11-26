import { reactive, watch } from 'vue'

export type GraphHover = 'off' | 'on'

const KEY = 'comfy.design.mar.graphHover'

export const graphHover = reactive<{ id: GraphHover }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'on' ? 'on' : 'off'
    } catch {
      return 'off'
    }
  })()
})

watch(
  () => graphHover.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)
