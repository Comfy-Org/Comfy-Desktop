import { reactive, watch } from 'vue'
import { can } from '../milestones'

/** Workflow cards' cover (UI Playground › Workflow cover): a gradient of
 *  their own (brand/WorkflowGradient.vue), since workflows carry no picture
 *  yet, the tilted canvas (brand/WorkflowCover.vue), or the image the
 *  workflow makes. */
export type Cover = 'canvas' | 'gradient' | 'output'

export const COVERS: { value: Cover; label: string }[] = [
  { value: 'gradient', label: 'Gradient' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'output', label: 'Image' }
]

export const isBranded = (c: Cover): boolean => c !== 'output'

const KEY = 'comfy.design.mar.workflowCover'

export const cover = reactive<{ id: Cover }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as Cover | null
      return v && COVERS.some((c) => c.value === v) ? v : 'gradient'
    } catch {
      return 'gradient'
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

// Each stage opens on its own: the blur until the future milestones, where
// workflows carry the image they make. The tweak still overrides it after.
watch(
  () => can.value.projects,
  (future) => {
    cover.id = future ? 'output' : 'gradient'
  },
  { immediate: true }
)
