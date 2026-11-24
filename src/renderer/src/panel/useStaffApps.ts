import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { HiddenAppCard } from '../types/ipc'

export interface StaffApps {
  apps: Ref<HiddenAppCard[]>
  shown: ComputedRef<boolean>
}

export function useStaffApps(): StaffApps {
  const apps = ref<HiddenAppCard[]>([])
  let requests = 0
  let shownRequest = 0
  let stopListUpdates: (() => void) | null = null

  async function refresh(): Promise<void> {
    const request = ++requests
    const listed = await window.api.listHiddenApps().then(
      (list) => list.apps,
      () => []
    )
    if (request < shownRequest) return
    shownRequest = request
    apps.value = listed
  }

  onMounted(() => {
    stopListUpdates = window.api.onAppsListChanged(() => void refresh())
    void refresh()
  })
  onUnmounted(() => stopListUpdates?.())

  return { apps, shown: computed(() => apps.value.length > 0) }
}
