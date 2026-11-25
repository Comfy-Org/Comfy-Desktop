import { reactive, watch } from 'vue'

export type ComposerSearch = 'simple' | 'smart'

const KEY = 'comfy.design.mar.composerSearch'

export const COMPOSER_SEARCHES: { value: ComposerSearch; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'smart', label: 'Smart' }
]

export const composerSearch = reactive<{ id: ComposerSearch }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'simple' ? 'simple' : 'smart'
    } catch {
      return 'smart'
    }
  })()
})

watch(
  () => composerSearch.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)
