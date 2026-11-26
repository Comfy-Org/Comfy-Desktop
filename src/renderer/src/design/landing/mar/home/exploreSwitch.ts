import { reactive } from 'vue'

export type ExploreSwitch = 'seg' | 'ghost' | 'text' | 'beside'

export const EXPLORE_SWITCHES: { value: ExploreSwitch; label: string }[] = [
  { value: 'seg', label: 'Segmented' },
  { value: 'ghost', label: 'Segmented, no track' },
  { value: 'text', label: 'Text only' },
  { value: 'beside', label: 'Text, next to Explore' }
]

export const exploreSwitch = reactive<{ id: ExploreSwitch }>({ id: 'seg' })
