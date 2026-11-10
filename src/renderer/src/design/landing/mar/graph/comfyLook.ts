import { reactive, watch } from 'vue'
import type { MarAsset } from '../pages/assetsStore'
import { collection } from '../pages/collection'
import { graphStyle } from './graphStyle'

/** What ComfyUI's view stands for (UI Playground › Graph editor): Proposal,
 *  our take on the new structure, or Production, ComfyUI as it ships plus
 *  Better Assets Phase 1 only: Generated / Imported tabs, Grid or List, the
 *  filter without Source, and Inspect asset opening the file in a tab. */
export type ComfyLook = 'proposal' | 'production'

export const COMFY_LOOKS: { value: ComfyLook; label: string }[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'production', label: 'Production' }
]

const KEY = 'comfy.design.mar.comfyLook'

export const comfyLook = reactive<{ id: ComfyLook }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'production' ? 'production' : 'proposal'
    } catch {
      return 'proposal'
    }
  })()
})

/** Production: the asset open in its own tab beside the workflows, one at a
 *  time (the next one takes its place), with the list it steps through.
 *  `on` is whether that tab is the one showing. */
export const assetTab = reactive<{
  asset: MarAsset | null
  list: MarAsset[]
  build: string
  on: boolean
}>({ asset: null, list: [], build: '', on: false })

/** Proposal: Assets expanded from its panel to a whole tab (the
 *  library, as on Desktop's Assets page); `on` while it's the tab shown. */
export const assetsTab = reactive({ open: false, on: false })
/** The files the tab browses: the panel's own, handed over on expand. */
export const graphLibrary = collection<MarAsset>([], 'asset')

watch(
  () => comfyLook.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
    // Production is ComfyUI's own chrome: top bar, workflow tabs, docked rail.
    if (id === 'production') graphStyle.id = 'current'
    else assetTab.asset = null
  },
  { immediate: true }
)
