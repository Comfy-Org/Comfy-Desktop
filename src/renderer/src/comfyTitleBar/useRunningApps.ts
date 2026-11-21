import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'

export interface RunningApp {
  id: string
  title: string
}

interface MenuAnchor {
  x: number
  y: number
}

export interface RunningAppsBridge {
  onAppsRunningChanged?: (cb: (apps: RunningApp[]) => void) => () => void
  clickRunningApps?: (anchor: MenuAnchor) => void
}

export function useRunningApps(
  bridge: RunningAppsBridge | undefined,
  button: Readonly<Ref<HTMLElement | null>>
) {
  const { t } = useI18n()
  const apps = ref<RunningApp[]>([])
  let stop: (() => void) | undefined

  const label = computed(() => {
    const [only, ...others] = apps.value
    if (!only) return ''
    return others.length === 0
      ? only.title
      : t('titleBar.runningMany', { count: apps.value.length })
  })

  const tooltip = computed(() => {
    const [only, ...others] = apps.value
    if (!only) return ''
    return others.length === 0
      ? t('titleBar.openRunning', { app: only.title })
      : t('titleBar.showRunning')
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

  return { runningApps: apps, runningLabel: label, runningTooltip: tooltip, openRunning }
}
