import { computed, ref } from 'vue'
import type { AppRun } from '../types/ipc'

export const appRuns = ref<AppRun[]>([])

export const runningAppIds = computed(
  () => new Set(appRuns.value.filter((run) => run.running).map((run) => run.appId))
)

export const finishedAppIds = computed(
  () => new Set(appRuns.value.filter((run) => run.finished).map((run) => run.appId))
)

export function watchAppRuns(): () => void {
  let heardChange = false
  const stop = window.api.onAppRunsChanged((runs) => {
    heardChange = true
    appRuns.value = runs
  })
  void window.api
    .getAppRuns()
    .then((runs) => {
      if (!heardChange) appRuns.value = runs
    })
    .catch(() => {})
  return () => {
    stop()
    appRuns.value = []
  }
}
