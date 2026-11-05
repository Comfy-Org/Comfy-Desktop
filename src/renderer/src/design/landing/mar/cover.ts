import { reactive, watch } from 'vue'

/** Workflow cards' cover (UI Playground › Workflow cover): the tilted
 *  canvas (brand/WorkflowCover.vue), since workflows carry no picture yet,
 *  or the image the workflow makes. */
export type Cover = 'canvas' | 'output'

export const COVERS: { value: Cover; label: string }[] = [
  { value: 'canvas', label: 'Canvas' },
  { value: 'output', label: 'Image' }
]

export const isBranded = (c: Cover): boolean => c === 'canvas'

const KEY = 'comfy.design.mar.cover'

export const cover = reactive<{ id: Cover }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as Cover | null
      return v && COVERS.some((c) => c.value === v) ? v : 'canvas'
    } catch {
      return 'canvas'
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
