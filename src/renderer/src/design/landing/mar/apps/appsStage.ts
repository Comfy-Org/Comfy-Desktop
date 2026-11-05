import { reactive, watch } from 'vue'

/** The stages of the Apps PRD (UI Playground › Apps stage), each adding to
 *  the one before: M1 runs on Cloud, M2 runs what it can on your GPU, M3
 *  lets you iterate and find more apps. */
export type AppsStage = 'm1' | 'm2' | 'm3'

export const APPS_STAGES: { value: AppsStage; label: string }[] = [
  { value: 'm1', label: 'M1 · Cloud' },
  { value: 'm2', label: 'M2 · Local' },
  { value: 'm3', label: 'M3 · Iterate' }
]

const KEY = 'comfy.design.mar.appsStage'

export const appsStage = reactive<{ id: AppsStage }>({
  id: (() => {
    try {
      const v = localStorage.getItem(KEY)
      return APPS_STAGES.some((s) => s.value === v) ? (v as AppsStage) : 'm1'
    } catch {
      return 'm1'
    }
  })()
})

watch(
  () => appsStage.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      // Storage blocked: the pick lasts for this window only.
    }
  }
)

/** Where a starter app runs from M2 on. Sizes are samples. */
export type AppRun =
  | { kind: 'local'; download: string }
  | { kind: 'split'; download: string; local: string; cloud: string }
  | { kind: 'cloud' }

export const APP_RUNS: Record<string, AppRun> = {
  's-image': { kind: 'local', download: '12 GB' },
  's-reshoot': { kind: 'split', download: '4 GB', local: 'Prepare the clip', cloud: 'Re-shoot it' },
  's-cine': { kind: 'cloud' },
  's-jutsu': { kind: 'cloud' }
}

/** Models already downloaded, for this window. */
export const downloaded = reactive<Record<string, boolean>>({})
