import { reactive, watch } from 'vue'
import { can } from '../milestones'

/** Workflow cards' cover (UI Playground › Workflow cover): the tilted canvas
 *  (brand/WorkflowCover.vue), since workflows carry no picture yet, or the
 *  image the workflow makes. */
export type Cover = 'canvas' | 'output'

export const COVERS: { value: Cover; label: string }[] = [
  { value: 'canvas', label: 'Canvas' },
  { value: 'output', label: 'Image' }
]

export const defaultCover = (): Cover =>
  can.value.projects && !can.value.onboarding ? 'output' : 'canvas'

export const isBranded = (c: Cover): boolean => c !== 'output'

const KEY = 'comfy.design.mar.workflowCover'

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

// Each stage opens on its own: the canvas until the future milestones, where
// workflows carry the image they make. The tweak still overrides it after.
watch(
  defaultCover,
  (id) => {
    cover.id = id
  },
  { immediate: true }
)

export type RecentsCover = 'generic' | 'image'

export const RECENTS_COVERS: { value: RecentsCover; label: string }[] = [
  { value: 'generic', label: 'Generic' },
  { value: 'image', label: 'Image' }
]

const RECENTS_KEY = 'comfy.design.mar.recentsCover'

export const recentsCover = reactive<{ id: RecentsCover }>({
  id: (() => {
    try {
      const v = localStorage.getItem(RECENTS_KEY) as RecentsCover | null
      return v && RECENTS_COVERS.some((c) => c.value === v) ? v : 'generic'
    } catch {
      return 'generic'
    }
  })()
})

watch(
  () => recentsCover.id,
  (id) => {
    try {
      localStorage.setItem(RECENTS_KEY, id)
    } catch {
      return
    }
  }
)
