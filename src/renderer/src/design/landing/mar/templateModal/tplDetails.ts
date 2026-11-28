import { reactive } from 'vue'

export type TplDetails = 'current' | 'compact' | 'split' | 'checklist' | 'tabs'

export const TPL_DETAILS: { value: TplDetails; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'compact', label: 'Compact' },
  { value: 'split', label: 'Split' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'tabs', label: 'Tabs' }
]

export const LAYERED_DETAILS: TplDetails[] = ['split', 'checklist', 'tabs']

export const tplDetails = reactive<{ id: TplDetails }>({ id: 'current' })
