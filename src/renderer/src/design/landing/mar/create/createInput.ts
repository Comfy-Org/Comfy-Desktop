import { reactive, watch } from 'vue'

export type CreateInput = 'agent' | 'search'

const KEY = 'comfy.design.mar.createInput'

export const CREATE_INPUTS: { value: CreateInput; label: string }[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'search', label: 'Search' }
]

export const createInput = reactive<{ id: CreateInput }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'search' ? 'search' : 'agent'
    } catch {
      return 'agent'
    }
  })()
})

watch(
  () => createInput.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)
