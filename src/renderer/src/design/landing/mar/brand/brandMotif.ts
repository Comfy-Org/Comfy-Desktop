import { reactive, watch } from 'vue'
import './motif.css'

/** Comfy's brand motif in Mar's proposal (UI Playground › Brand motif):
 *  the trio, three slabs at the C mark's 16°, in card tones. On, it
 *  takes the empty states (the third slab holds the place's icon), the
 *  step progress (Learn) and the loaders (the slabs fill in turn). Off,
 *  the UI as it ships. Never on cards with pictures, banners or headers.
 *  Its quieter touches (cut bar ends, the skeleton sheen, Deploy's
 *  step markers) are CSS in motif.css, keyed off
 *  <html data-mar-motif>. */
export type BrandMotif = 'off' | 'trio'

export const BRAND_MOTIFS: { value: BrandMotif; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'trio', label: 'Trio' }
]

const KEY = 'comfy.design.mar.brandMotif'

export const brandMotif = reactive<{ id: BrandMotif }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'trio' ? 'trio' : 'off'
    } catch {
      return 'off'
    }
  })()
})

watch(
  () => brandMotif.id,
  (id) => {
    document.documentElement.dataset.marMotif = id
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  },
  { immediate: true }
)
