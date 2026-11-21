import { computed, ref } from 'vue'
import type { AppRun } from '../types/ipc'

export const MAX_BACKGROUND_RUNS = 3

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

export function switchStopsRun(currentAppId: string, nextAppId: string): boolean {
  if (!runningAppIds.value.has(currentAppId)) return false
  const others = [...runningAppIds.value].filter((id) => id !== currentAppId && id !== nextAppId)
  return others.length >= MAX_BACKGROUND_RUNS
}
