import { reactive } from 'vue'

export type TplDetails = 'current' | 'compact'

export const TPL_DETAILS: { value: TplDetails; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'compact', label: 'Compact' }
]

export const tplDetails = reactive<{ id: TplDetails }>({ id: 'current' })
