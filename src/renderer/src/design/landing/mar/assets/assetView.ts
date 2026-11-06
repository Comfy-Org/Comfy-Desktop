import { reactive, watch } from 'vue'

/** How your own things are laid out (Assets, in Mar's proposal): the
 *  View menu next to Sort. Applied as data attributes on <html> so the
 *  page's grid answers in CSS (marShell.css). */
export type AssetLayout = 'grid' | 'square' | 'list'
export type AssetSize = 's' | 'm' | 'l'

const KEY = 'comfy.design.mar.assetView'
const DEFAULTS = { layout: 'grid' as AssetLayout, size: 'm' as AssetSize, details: true }

function load(): typeof DEFAULTS {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export const assetView = reactive(load())

watch(
  () => ({ ...assetView }),
  (v) => {
    const d = document.documentElement.dataset
    d.marAssetLayout = v.layout
    d.marAssetSize = v.size
    d.marAssetDetails = v.details ? 'on' : 'off'
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the view lasts for this window only.
    }
  },
  { immediate: true }
)
