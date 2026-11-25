import { reactive, watch } from 'vue'

export type ComposerPos = 'bottom' | 'center'

const KEY = 'comfy.design.mar.composerPos'

export const COMPOSER_POSITIONS: { value: ComposerPos; label: string }[] = [
  { value: 'bottom', label: 'Bottom' },
  { value: 'center', label: 'Center' }
]

export const composerPos = reactive<{ id: ComposerPos }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'center' ? 'center' : 'bottom'
    } catch {
      return 'bottom'
    }
  })()
})

watch(
  () => composerPos.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)
