import { computed, ref, watch, type Component, type Ref } from 'vue'
import { Image as ImageIcon, Video, AudioLines, Box } from 'lucide-vue-next'
import type { FieldOption } from '../types/ipc'

/** Modality tab order + its glyph. Mirrors the main-process curated manifest's
 *  `TEMPLATE_MODALITY_ORDER`; kept here so the renderer owns its own UI ordering
 *  without reaching across the process boundary. */
const MODALITY_ORDER = ['image', 'video', '3d', 'audio'] as const
type Modality = (typeof MODALITY_ORDER)[number]

const MODALITY_GLYPH: Record<Modality, Component> = {
  image: ImageIcon,
  video: Video,
  audio: AudioLines,
  '3d': Box,
}

export interface TemplateTab {
  modality: Modality
  label: string
  glyph: Component
  count: number
}

function modalityOf(option: FieldOption): Modality | null {
  const value = option.data?.modality
  return (MODALITY_ORDER as readonly string[]).includes(value as string) ? (value as Modality) : null
}

/**
 * Groups the picker's template options into per-modality tabs and tracks the
 * active one. The "None" sentinel is excluded; only modalities with ≥1 template
 * get a tab. The active tab follows the selected template (so re-entering the
 * step lands on the user's pick) and defaults to the first populated tab.
 */
export function useTemplateTabs(
  options: Ref<FieldOption[]>,
  noneValue: Ref<string> | string,
  selectedValue: Ref<string | null>,
  translate: (key: string) => string
) {
  const none = computed(() => (typeof noneValue === 'string' ? noneValue : noneValue.value))

  const templateCards = computed(() => options.value.filter((o) => o.value !== none.value))

  const cardsByModality = computed(() => {
    const groups = new Map<Modality, FieldOption[]>()
    for (const card of templateCards.value) {
      const modality = modalityOf(card)
      if (!modality) continue
      const bucket = groups.get(modality)
      if (bucket) bucket.push(card)
      else groups.set(modality, [card])
    }
    return groups
  })

  const tabs = computed<TemplateTab[]>(() =>
    MODALITY_ORDER.filter((modality) => cardsByModality.value.has(modality)).map((modality) => ({
      modality,
      label: translate(`standalone.modality.${modality}`),
      glyph: MODALITY_GLYPH[modality],
      count: cardsByModality.value.get(modality)!.length,
    }))
  )

  const modalityOfSelected = computed<Modality | null>(() => {
    const selected = templateCards.value.find((o) => o.value === selectedValue.value)
    return selected ? modalityOf(selected) : null
  })

  const activeModality = ref<Modality | null>(null)

  /** Keep the active tab valid: prefer the selected template's modality, then
   *  the current tab if it still exists, then the first populated tab. */
  watch(
    [tabs, modalityOfSelected],
    () => {
      const available = tabs.value.map((t) => t.modality)
      if (available.length === 0) {
        activeModality.value = null
        return
      }
      if (modalityOfSelected.value && available.includes(modalityOfSelected.value)) {
        activeModality.value = modalityOfSelected.value
      } else if (!activeModality.value || !available.includes(activeModality.value)) {
        activeModality.value = available[0]!
      }
    },
    { immediate: true }
  )

  const visibleCards = computed(() =>
    activeModality.value ? (cardsByModality.value.get(activeModality.value) ?? []) : []
  )

  function selectTab(modality: Modality): void {
    activeModality.value = modality
  }

  return { tabs, activeModality, visibleCards, selectTab }
}
