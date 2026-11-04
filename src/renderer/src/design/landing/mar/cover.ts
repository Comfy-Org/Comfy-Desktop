import { reactive, watch } from 'vue'

/** Workflow cards' cover (UI Playground › Workflow cover): the graph, as
 *  Pablo has it, the output it makes, or, since workflows carry no picture
 *  yet, one of the brand's generic covers (brand/WorkflowCover.vue). */
export type BrandedCover = 'wire' | 'trio' | 'latent' | 'mark'
export type Cover = 'graph' | 'output' | BrandedCover

export const COVERS: { value: Cover; label: string }[] = [
  { value: 'graph', label: 'Graph' },
  { value: 'output', label: 'Output' },
  { value: 'wire', label: 'Wire' },
  { value: 'trio', label: 'Trio' },
  { value: 'latent', label: 'Latent' },
  { value: 'mark', label: 'Signed' }
]

const BRANDED: Cover[] = ['wire', 'trio', 'latent', 'mark']
export const isBranded = (c: Cover): c is BrandedCover => BRANDED.includes(c)

const KEY = 'comfy.design.mar.cover'

export const cover = reactive<{ id: Cover }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as Cover | null
      return v && COVERS.some((c) => c.value === v) ? v : 'graph'
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
