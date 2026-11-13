import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'

export function useAppsEnabled(): Ref<boolean | null> {
  const appsEnabled = ref<boolean | null>(null)
  let pushed = false
  let stop: (() => void) | null = null

  onMounted(async () => {
    stop = window.api.onAppsEnabledChanged(({ enabled }) => {
      pushed = true
      appsEnabled.value = enabled === true
    })
    const enabled = await window.api.getAppsEnabled().then(
      (on) => on === true,
      () => false
    )
    if (!pushed) appsEnabled.value = enabled
  })

  onBeforeUnmount(() => stop?.())

  return appsEnabled
}
