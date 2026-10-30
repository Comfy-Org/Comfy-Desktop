import { reactive, watch } from 'vue'

/** How a first-time Home shows its examples (UI Playground › First-time
 *  examples): Pablo's fan, today's row of pictures, a coverflow, a bento
 *  with one big example, or a deck to flick through. */
export type ExampleLook = 'fan' | 'row' | 'coverflow' | 'bento' | 'deck'

export const EXAMPLE_LOOKS: { value: ExampleLook; label: string }[] = [
  { value: 'fan', label: "Fan · Pablo's hand of cards" },
  { value: 'row', label: 'Row · big pictures side by side' },
  { value: 'coverflow', label: 'Coverflow · a 3D carousel' },
  { value: 'bento', label: 'Bento · one big, four small' },
  { value: 'deck', label: 'Deck · a stack to flick through' }
]

const KEY = 'comfy.design.mar.exampleLook'

export const exampleLook = reactive<{ id: ExampleLook }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return EXAMPLE_LOOKS.some((l) => l.value === v) ? (v as ExampleLook) : 'fan'
    } catch {
      return 'fan'
    }
  })()
})

watch(
  () => exampleLook.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
