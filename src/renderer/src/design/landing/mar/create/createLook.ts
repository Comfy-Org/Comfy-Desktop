import { reactive, watch } from 'vue'
import { CREATE_LOOKS } from './looks'

const KEY = 'comfy.design.mar.createLook'
export const DEFAULT_CREATE_LOOK = 'V15'

function storedLook(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export const createLook = reactive<{ id: string }>({
  id: (() => {
    const stored = storedLook()
    return stored && CREATE_LOOKS.some((l) => l.value === stored) ? stored : DEFAULT_CREATE_LOOK
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
