import { reactive } from 'vue'

export type BlankStart = 'empty' | 'search'

export const BLANK_STARTS: { value: BlankStart; label: string }[] = [
  { value: 'empty', label: 'Empty canvas' },
  { value: 'search', label: 'Search nodes and templates' }
]

export const blankStart = reactive<{ id: BlankStart }>({ id: 'empty' })
