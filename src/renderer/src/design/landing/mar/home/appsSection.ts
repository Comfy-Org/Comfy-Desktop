import { reactive } from 'vue'

export type AppsSection = 'apps' | 'mixed' | 'rows'

export const APPS_SECTIONS: { value: AppsSection; label: string }[] = [
  { value: 'apps', label: 'Apps only' },
  { value: 'mixed', label: 'Explore (mixed)' },
  { value: 'rows', label: 'Two rows' }
]

export const appsSection = reactive<{ id: AppsSection }>({ id: 'apps' })
