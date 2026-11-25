import { computed, reactive, watch } from 'vue'
import { can } from '../../milestones'
import { instances, proto } from '../../useProto'

/**
 * Where the prototype is shown: the desktop app, or Comfy Cloud in a
 * browser (UI Playground › Surface). Cloud swaps the app's title bar for
 * the browser's tab and address bar with the app's own bar one level
 * below, and drops what a browser can't do (local builds).
 */

export type Surface = 'desktop' | 'cloud'

export const SURFACES: { value: Surface; label: string }[] = [
  { value: 'desktop', label: 'Desktop app' },
  { value: 'cloud', label: 'Comfy Cloud' }
]

const KEY = 'comfy.design.mar.surface'

function load(): Surface {
  try {
    return localStorage.getItem(KEY) === 'cloud' ? 'cloud' : 'desktop'
  } catch {
    return 'desktop'
  }
}

export const surface = reactive<{ id: Surface }>({ id: load() })

/** Shown as Comfy Cloud in a browser. Cloud's first screen is Home, so
 *  before Milestone 4 there is only the desktop app. */
export const onCloud = computed(() => can.value.home && surface.id === 'cloud')

watch(
  () => surface.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

watch(
  onCloud,
  (on) => {
    if (on) document.documentElement.dataset.marSurface = 'cloud'
    else delete document.documentElement.dataset.marSurface
  },
  { immediate: true }
)

// In a browser only cloud builds run: point the active build at one while
// on Cloud, and give the previous pick back on the way out.
let picked: string | undefined
watch(
  onCloud,
  (on) => {
    if (on) {
      const cloud = instances.value.find((i) => i.kind === 'cloud')
      if (!cloud) return
      picked = proto.activeInstanceId
      proto.activeInstanceId = cloud.id
    } else if (picked !== undefined) {
      proto.activeInstanceId = picked
      picked = undefined
    }
  },
  { immediate: true }
)
