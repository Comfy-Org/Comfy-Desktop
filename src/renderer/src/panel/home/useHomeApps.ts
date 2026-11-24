import { ref, type Ref } from 'vue'
import type { AppCard } from '../../types/ipc'

export type HomeAppsState = 'loading' | 'ready' | 'empty' | 'failed'

export interface HomeApps {
  state: Ref<HomeAppsState>
  apps: Ref<AppCard[]>
  loadApps: () => Promise<void>
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

  void loadApps()

  return { state, apps, loadApps }
}
