import { reactive, watch } from 'vue'

const KEY = 'comfy.design.mar.createLook'

export const createLook = reactive<{ id: string }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) ?? 'current'
    } catch {
      return 'current'
    }
  })()
})

watch(
  () => createLook.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)
