import { reactive, watch } from 'vue'

/** How a first-time Home shows its examples (UI Playground › First-time
 *  examples): Pablo's fan, the fan's caption over coverflow covers, today's row of pictures, a coverflow, an arc
 *  carousel, a bento with one big example, or a deck to flick through. */
export type ExampleLook = 'fan' | 'fanflow' | 'row' | 'coverflow' | 'arc' | 'bento' | 'deck'

export const EXAMPLE_LOOKS: { value: ExampleLook; label: string }[] = [
  { value: 'fan', label: 'Fan · a hand of cards' },
  { value: 'fanflow', label: "Fan × Coverflow · the fan's caption, coverflow's covers" },
  { value: 'row', label: 'Row · big pictures side by side' },
  { value: 'coverflow', label: 'Coverflow · a 3D carousel' },
  { value: 'arc', label: 'Arc carousel · tall cards on a 3D arc' },
  { value: 'bento', label: 'Bento · one big, four small' },
  { value: 'deck', label: 'Deck · a stack to flick through' }
]

const KEY = 'comfy.design.mar.exampleLook'

export const exampleLook = reactive<{ id: ExampleLook }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return EXAMPLE_LOOKS.some((l) => l.value === v) ? (v as ExampleLook) : 'arc'
    } catch {
      return 'arc'
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
