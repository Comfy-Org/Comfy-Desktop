import { reactive } from 'vue'

export type HomeLayout = 'current' | 'recents'

export const HOME_LAYOUTS: { value: HomeLayout; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'recents', label: 'Recents first' }
]

export const homeLayout = reactive<{ id: HomeLayout }>({ id: 'current' })
