import { reactive, watch } from 'vue'

/** How the PyTorch list marks the selected build (UI Playground › Selected
 *  PyTorch), to compare them. */
export type TorchPick = 'outline' | 'filled' | 'check' | 'radio'

export const TORCH_PICKS: { value: TorchPick; label: string }[] = [
  { value: 'outline', label: 'Outline' },
  { value: 'filled', label: 'Filled' },
  { value: 'check', label: 'Check' },
  { value: 'radio', label: 'Radio' }
]

const KEY = 'comfy.design.mar.torchPick'

export const torchPick = reactive<{ id: TorchPick }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY) as TorchPick | null
      return v && TORCH_PICKS.some((c) => c.value === v) ? v : 'outline'
    } catch {
      return 'outline'
    }
  })()
})

watch(
  () => torchPick.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
