import { reactive, watch } from 'vue'

/** Which first-run Home Mar's proposal shows when there is no local install
 *  (UI Playground › First run), each under the same greeting and prompt.
 *  Stage was Original with other cards and is folded into it. */
export type FirstRun =
  | 'original'
  | 'reel'
  | 'guided'
  | 'paths'
  | 'cinematic'
  | 'checklist'
  | 'agent'

export const FIRST_RUNS: { value: FirstRun; label: string }[] = [
  { value: 'original', label: 'Examples · run one, or open the editor' },
  { value: 'reel', label: 'Reel · what Comfy makes, as prompts' },
  { value: 'guided', label: 'Guided · pick, watch it run, open it' },
  { value: 'paths', label: 'Paths · Create or Build, side by side' },
  { value: 'cinematic', label: 'Cinematic · a showcase playing, full width' },
  { value: 'checklist', label: 'Checklist · a Get started card beside' },
  { value: 'agent', label: 'Agent · Comfy offers three tasks (exploration)' }
]

const KEY = 'comfy.design.mar.firstRun'

export const firstRun = reactive<{ id: FirstRun }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return FIRST_RUNS.some((f) => f.value === v) ? (v as FirstRun) : 'original'
    } catch {
      return 'original'
    }
  })()
})

watch(
  () => firstRun.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)
