import { reactive } from 'vue'

export type BuildsAt = 'bottom' | 'top'

export const BUILDS_AT: { value: BuildsAt; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'top', label: 'After Recently used' }
]

export const buildsAt = reactive<{ id: BuildsAt }>({ id: 'bottom' })
