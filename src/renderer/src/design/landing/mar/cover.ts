import { reactive, watch } from 'vue'

/** Workflow cards' cover (UI Playground › Workflow cover): the graph, as
 *  Pablo has it, or the output it makes. */
export type Cover = 'graph' | 'output'

export const COVERS: { value: Cover; label: string }[] = [
  { value: 'graph', label: 'Graph' },
  { value: 'output', label: 'Output' }
]

const KEY = 'comfy.design.mar.cover'

export const cover = reactive<{ id: Cover }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'output' ? 'output' : 'graph'
    } catch {
      return 'graph'
    }
  })()
})

watch(
  () => cover.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
