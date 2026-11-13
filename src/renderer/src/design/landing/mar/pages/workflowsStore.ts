import { watch } from 'vue'
import { allWorkflows } from '../../gallery'
import { collection } from './collection'
import type { ItemStatus } from './MarStatus.vue'

/** Workflows in Mar's proposal: the gallery's, with the states the
 *  product shows on a workflow (ComfyUI_frontend WorkflowTab: running,
 *  completed, failed; plus unsaved changes and shared). No percentage
 *  or queue position: those live in the queue. */
export interface MarWorkflow {
  id: string
  name: string
  source: 'local' | 'cloud'
  thumbId: string
  category: 'image' | 'video'
  project?: string
  modified: string
  age: number
  envId?: string
  fav?: boolean
  status?: ItemStatus
  statusLabel?: string
}

const STATES: [ItemStatus, string?][] = [
  ['executing'],
  ['completed'],
  ['failed'],
  ['draft', 'Unsaved']
]

const seed = (): MarWorkflow[] =>
  allWorkflows.value.map((w, i) => {
    const s = STATES[i]
    return {
      id: w.id,
      name: w.name,
      source: w.source,
      thumbId: w.thumbId,
      category: w.category,
      project: w.project,
      modified: w.modified,
      age: w.age,
      envId: w.envId,
      fav: i === 1,
      status: s?.[0] ?? (w.source === 'cloud' && i % 2 ? 'shared' : undefined),
      statusLabel: s?.[1]
    }
  })

export const workflows = collection<MarWorkflow>(seed(), 'workflow')

// The seed follows the simulated user: switching First-time to Returning
// (or Data: Mine) in the UI Playground brings that user's workflows.
watch(
  () => allWorkflows.value.map((w) => w.id).join(),
  () => workflows.items.splice(0, workflows.items.length, ...seed())
)
