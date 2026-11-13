import { computed, reactive, watch } from 'vue'
import { can } from '../../milestones'
import './looks.css'

/**
 * Looks (UI Playground › Look): Void as it is, or Grain. Type and colour
 * stay exactly Void's; Grain changes only the image treatment. Its
 * stylesheet is scoped to `:root[data-mar-look='grain']`. Current changes
 * nothing.
 */
export type MarLook = 'current'

export const LOOKS: { value: MarLook; label: string }[] = [
  { value: 'current', label: 'Current · as it is' }
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

/** The look on screen, or undefined for Current (and Milestone 0). */
export const lookOn = computed<Exclude<MarLook, 'current'> | undefined>(() =>
  can.value.design && marLook.id !== 'current' ? marLook.id : undefined
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
