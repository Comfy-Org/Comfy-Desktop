import { ref, type Ref } from 'vue'
import type { AppCard } from '../../types/ipc'

export type HomeAppsState = 'loading' | 'ready' | 'empty' | 'failed' | 'off'

export interface HomeApps {
  state: Ref<HomeAppsState>
  apps: Ref<AppCard[]>
  appsAreOn: Promise<boolean>
  loadApps: () => Promise<void>
}

async function askWhetherAppsAreOn(): Promise<boolean> {
  try {
    return await window.api.getAppsEnabled()
  } catch {
    return false
  }
}

export function useHomeApps(): HomeApps {
  const state = ref<HomeAppsState>('loading')
  const apps = ref<AppCard[]>([])

  async function loadApps(): Promise<void> {
    state.value = 'loading'
    try {
      apps.value = await window.api.listApps()
      state.value = apps.value.length > 0 ? 'ready' : 'empty'
    } catch {
      apps.value = []
      state.value = 'failed'
    }
  }

  const appsAreOn = askWhetherAppsAreOn()
  void appsAreOn.then((on) => {
    if (on) return loadApps()
    state.value = 'off'
  })

  return { state, apps, appsAreOn, loadApps }
}
