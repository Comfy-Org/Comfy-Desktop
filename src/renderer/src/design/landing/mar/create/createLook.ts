import { reactive, watch } from 'vue'

const KEY = 'comfy.design.mar.createLook'
export const DEFAULT_CREATE_LOOK = 'V12'

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
    return !stored || stored === 'current' ? DEFAULT_CREATE_LOOK : stored
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
