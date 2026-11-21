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

  const listed = computed(() => [...apps.value.running, ...apps.value.ready])
  const isRunning = computed(() => apps.value.running.length > 0)
  const hasApps = computed(() => listed.value.length > 0)

  const readyTitle = computed(() => {
    const [only, ...others] = listed.value
    return only && others.length === 0 && !isRunning.value ? only.title : null
  })

  const label = computed(() => {
    const [only, ...others] = listed.value
    if (!only) return ''
    if (others.length === 0) return only.title
    const count = listed.value.length
    if (apps.value.ready.length === 0) return t('titleBar.runningMany', { count })
    if (!isRunning.value) return t('titleBar.readyMany', { count })
    return t('titleBar.appsMany', { count })
  })

  const tooltip = computed(() => {
    const [only, ...others] = listed.value
    if (!only) return ''
    if (others.length === 0) return t('titleBar.openRunning', { app: only.title })
    if (apps.value.ready.length === 0) return t('titleBar.showRunning')
    if (!isRunning.value) return t('titleBar.showReady')
    return t('titleBar.showApps')
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
    readyTitle,
    runningLabel: label,
    runningTooltip: tooltip,
    openRunning
  }
}
