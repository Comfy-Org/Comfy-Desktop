import { reactive, watch } from 'vue'

/** How the Create / Build / Agent switch looks. */
export type ModeStyle = 'stack' | 'title' | 'split' | 'foot'

// Stack, Title and Foot still render (MarModeSwitch) but are out of the
// picker: Mar kept Split.
export const MODE_STYLES: { value: ModeStyle; label: string }[] = [
  { value: 'split', label: 'Split · Create or Build, Agent apart' }
]

const KEY = 'comfy.design.mar.modeStyle'

export const modeStyle = reactive<{ id: ModeStyle }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as ModeStyle | null
      return v && MODE_STYLES.some((m) => m.value === v) ? v : 'split'
    } catch {
      return 'split'
    }
  })()
})

watch(
  () => modeStyle.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
