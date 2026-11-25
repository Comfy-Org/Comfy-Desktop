import { reactive } from 'vue'

export type DlFooter = 'button' | 'joined'

export const DL_FOOTERS: { value: DlFooter; label: string }[] = [
  { value: 'button', label: 'Button' },
  { value: 'joined', label: 'Joined' }
]

export const dlFooter = reactive<{ id: DlFooter }>({ id: 'button' })
