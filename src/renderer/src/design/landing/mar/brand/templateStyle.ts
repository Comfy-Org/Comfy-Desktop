import { reactive, watch } from 'vue'

/** How template pictures look in Mar's proposal (UI Playground ›
 *  Templates): the plain output photo, or the photo carrying Comfy's brand
 *  in one small, confident touch (BrandedThumb.vue). Brand colour lives in
 *  the imagery only; the UI around the card stays neutral. */
export type TemplateStyle = 'photo' | 'mark' | 'volt' | 'duotone' | 'mat' | 'split'

export const TEMPLATE_STYLES: { value: TemplateStyle; label: string }[] = [
  { value: 'photo', label: 'Photo · the output' },
  { value: 'mark', label: 'Signed · C mark in the corner' },
  { value: 'volt', label: 'Volt edge · a thin rule' },
  { value: 'duotone', label: 'Duotone · colour on hover' },
  { value: 'mat', label: 'Print · paper mat' },
  { value: 'split', label: 'Before / after · Volt line' }
]

const KEY = 'comfy.design.mar.templateStyle'

export const templateStyle = reactive<{ id: TemplateStyle }>({
  id: (() => {
    try {
      const saved = localStorage.getItem(KEY)
      return TEMPLATE_STYLES.find((s) => s.value === saved)?.value ?? 'photo'
    } catch {
      return 'photo'
    }
  })()
})

watch(
  () => templateStyle.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
