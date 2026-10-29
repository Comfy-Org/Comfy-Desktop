import { computed, reactive, watch } from 'vue'
import { isMariana } from '../proposal'
import './looks.css'

/**
 * Looks (UI Playground › Look): Void as it is, or Grain. Type and colour
 * stay exactly Void's; Grain changes only the image treatment. Its
 * stylesheet is scoped to `:root[data-mar-look='grain']`. Current changes
 * nothing.
 */
export type MarLook = 'current' | 'grain'

export const LOOKS: { value: MarLook; label: string }[] = [
  { value: 'current', label: 'Current · Void as it is' },
  { value: 'grain', label: 'Grain · film grain and vignette on every picture' }
]

const KEY = 'comfy.design.mar.look'

export const marLook = reactive<{ id: MarLook }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as MarLook | null
      return v && LOOKS.some((l) => l.value === v) ? v : 'current'
    } catch {
      return 'current'
    }
  })()
})

/** The look on screen, or undefined for Current (and Pablo's proposal). */
export const lookOn = computed<Exclude<MarLook, 'current'> | undefined>(() =>
  isMariana.value && marLook.id !== 'current' ? marLook.id : undefined
)

watch(
  () => marLook.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

watch(
  lookOn,
  (id) => {
    if (id) document.documentElement.dataset.marLook = id
    else delete document.documentElement.dataset.marLook
  },
  { immediate: true }
)
