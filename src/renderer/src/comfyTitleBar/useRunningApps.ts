import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

import type { TitleBarApps } from '../types/ipc'

interface MenuAnchor {
  x: number
  y: number
}

export interface RunningAppsBridge {
  onAppsRunningChanged?: (cb: (apps: TitleBarApps) => void) => () => void
  clickRunningApps?: (anchor: MenuAnchor) => void
}

export function useRunningApps(
  bridge: RunningAppsBridge | undefined,
  button: Readonly<Ref<HTMLElement | null>>
) {
  const { t } = useI18n()
  const apps = ref<TitleBarApps>({ running: [], ready: [] })
  let stop: (() => void) | undefined

  const isRunning = computed(() => apps.value.running.length > 0)
  const shown = computed(() => (isRunning.value ? apps.value.running : apps.value.ready))
  const hasApps = computed(() => shown.value.length > 0)

  const label = computed(() => {
    const [only, ...others] = shown.value
    if (!only) return ''
    if (others.length > 0) {
      const count = shown.value.length
      return isRunning.value
        ? t('titleBar.runningMany', { count })
        : t('titleBar.readyMany', { count })
    }
    return isRunning.value ? only.title : t('titleBar.appReady', { app: only.title })
  })

  const tooltip = computed(() => {
    const listed = [...apps.value.running, ...apps.value.ready]
    const [only, ...others] = listed
    if (!only) return ''
    if (others.length === 0) return t('titleBar.openRunning', { app: only.title })
    return isRunning.value ? t('titleBar.showRunning') : t('titleBar.showReady')
  })

  function openRunning(): void {
    const rect = button.value?.getBoundingClientRect()
    bridge?.clickRunningApps?.({
      x: Math.round(rect?.left ?? 0),
      y: Math.round(rect?.bottom ?? 0)
    })
  }

  onMounted(() => {
    stop = bridge?.onAppsRunningChanged?.((next) => {
      apps.value = next
    })
  })
  onUnmounted(() => stop?.())

  return {
    hasApps,
    isRunning,
    runningLabel: label,
    runningTooltip: tooltip,
    openRunning
  }
}
