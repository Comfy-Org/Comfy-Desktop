import { reactive, watch, type Component } from 'vue'
import type { AssetGroup } from './assetGroups'
import { LayoutDashboard, LayoutGrid, Rows3 } from 'lucide-vue-next'

/** How your own things are laid out (Assets, in Mar's proposal): the
 *  View menu next to Sort. Applied as data attributes on <html> so the
 *  page's grid answers in CSS (marShell.css). */
export type AssetLayout = 'grid' | 'square' | 'list'
export type AssetSize = 's' | 'm' | 'l'
/** The Assets page's wall (AssetLayoutMenu): masonry in columns, masonry
 *  in rows (each row one height, every picture in its shape), or an even
 *  grid. */
export type AssetWall = 'masonry' | 'rows' | 'grid'
/** The walls as the Layout menu and the toolbar's toggles show them:
 *  the short name on the tab, the full one in the tooltip. */
export const WALLS: { value: AssetWall; label: string; title: string; icon: Component }[] = [
  { value: 'masonry', label: 'Masonry', title: 'Masonry columns', icon: LayoutDashboard },
  { value: 'rows', label: 'Rows', title: 'Masonry rows', icon: Rows3 },
  { value: 'grid', label: 'Grid', title: 'Grid', icon: LayoutGrid }
]

// v3: everyone starts again on masonry, ungrouped (Group by None), the
// way Assets opens.
const KEY = 'comfy.design.mar.assetView.v3'
const DEFAULTS = {
  layout: 'grid' as AssetLayout,
  size: 'm' as AssetSize,
  details: true,
  wall: 'masonry' as AssetWall,
  /** Group by: what one run made, the day, or the type, each under its
   *  header. */
  group: 'none' as AssetGroup,
  /** The color label's dot on each card. */
  labels: true,
  /** The sidebar's TAGS and LABELS, in the order picked from their ⋯. */
  tagSort: 'name' as 'name' | 'count',
  labelSort: 'custom' as 'custom' | 'name' | 'color'
}

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
    d.marAssetWall = v.wall
    d.marAssetGroup = v.group
    d.marAssetLabels = v.labels ? 'on' : 'off'
    try {
      localStorage.setItem(KEY, JSON.stringify(v))
    } catch {
      // Storage blocked: the view lasts for this window only.
    }
  },
  { immediate: true }
)
