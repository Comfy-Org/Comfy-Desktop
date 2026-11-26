import { computed, reactive, watch } from 'vue'
import { marNav, marPanelsOn } from './marShell'

export type SidebarMotion = 'desktop' | 'snap'

export const SIDEBAR_MOTIONS: { value: SidebarMotion; label: string }[] = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'snap', label: 'Snap' }
]

export const sidebarMotion = reactive<{ id: SidebarMotion }>({ id: 'desktop' })

watch(
  () => sidebarMotion.id,
  (id) => {
    document.documentElement.dataset.marSideMotion = id
  },
  { immediate: true }
)

export const RAIL_TOOLTIP_DELAY_MS = 100

export const railTooltips = computed(
  () => marPanelsOn.value && marNav.collapsed && sidebarMotion.id === 'desktop'
)
