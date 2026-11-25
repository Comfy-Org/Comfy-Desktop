import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { HiddenAppCard, HiddenAppsList } from '../types/ipc'

const FIRST_RETRY_MS = 5_000
const LONGEST_RETRY_MS = 5 * 60_000

export interface StaffApps {
  apps: Ref<HiddenAppCard[]>
  shown: ComputedRef<boolean>
}

function isHiddenAppsList(value: unknown): value is HiddenAppsList {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as HiddenAppsList).apps)
  )
}

async function askForList(): Promise<HiddenAppsList | null> {
  try {
    const list: unknown = await window.api.listHiddenApps()
    return isHiddenAppsList(list) ? list : null
  } catch {
    return null
  }
}

export function useStaffApps(): StaffApps {
  const apps = ref<HiddenAppCard[]>([])
  let requests = 0
  let shownRequest = 0
  let mounted = false
  let retryDelay = FIRST_RETRY_MS
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let stopListUpdates: (() => void) | null = null

  function cancelRetry(): void {
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
  }

  function retryLater(): void {
    if (!mounted || retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void refresh()
    }, retryDelay)
    retryDelay = Math.min(retryDelay * 2, LONGEST_RETRY_MS)
  }

  async function refresh(): Promise<void> {
    const request = ++requests
    const list = await askForList()
    if (request < shownRequest) return
    shownRequest = request
    if (list) apps.value = list.apps
    if (list && !list.stale) {
      cancelRetry()
      retryDelay = FIRST_RETRY_MS
      return
    }
    retryLater()
  }

  function retryNowIfWaiting(): void {
    if (retryTimer === null) return
    cancelRetry()
    void refresh()
  }

  onMounted(() => {
    mounted = true
    stopListUpdates = window.api.onAppsListChanged(() => void refresh())
    window.addEventListener('focus', retryNowIfWaiting)
    void refresh()
  })
  onUnmounted(() => {
    mounted = false
    cancelRetry()
    window.removeEventListener('focus', retryNowIfWaiting)
    stopListUpdates?.()
  })

  return { apps, shown: computed(() => apps.value.length > 0) }
}
