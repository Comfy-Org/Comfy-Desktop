import { reactive, watch } from 'vue'

/** How the Create / Build / Agent switch looks in Mar's proposal
 *  (UI Playground › Mode switch), until one is decided. */
export type ModeStyle = 'pablo' | 'stack' | 'title' | 'split' | 'foot'

// Stack, Title and Foot still render (MarModeSwitch) but are out of the
// picker: Mar kept Split as the default and Pablo's pill to compare.
export const MODE_STYLES: { value: ModeStyle; label: string }[] = [
  { value: 'split', label: 'Split · Create or Build, Agent apart' },
  { value: 'pablo', label: 'Pill · picked one named (before)' }
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
