import { computed, inject, provide, type Component, type InjectionKey } from 'vue'
import { CircleStop, Play, RotateCw, ScrollText, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { until } from '@vueuse/core'
import { useAutoStartBuild } from '../../composables/useAutoStartBuild'
import { buildProgressOf, useBuildProgress } from '../../composables/useBuildProgress'
import { useInstallContextMenu } from '../../composables/useInstallContextMenu'
import { useModal } from '../../composables/useModal'
import { useQuickUpdate } from '../../composables/useQuickUpdate'
import { openInstallManager } from '../../lib/openInstallManager'
import { useProgressStore } from '../../stores/progressStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { Installation, ShowProgressOpts } from '../../types/ipc'

export interface BuildMenuHost {
  launch: (build: Installation, opts?: { isRestart?: boolean }) => void | Promise<void>
  openDetails: (build: Installation) => void | Promise<void>
  showProgress: (opts: ShowProgressOpts) => void | Promise<void>
  canPromoteToWorkspace?: (build: Installation) => boolean
}

export interface BuildMenuEntry {
  id: string
  label: string
  icon?: Component
  separator?: boolean
  danger?: boolean
  disabled?: boolean
  title?: string
}

const BUILD_MENU_HOST: InjectionKey<BuildMenuHost> = Symbol('buildMenuHost')
const NO_HOST: BuildMenuHost = {
  launch: () => {},
  openDetails: () => {},
  showProgress: () => {}
}
const STOP_WAIT_MS = 15_000

export function provideBuildMenuHost(host: BuildMenuHost): void {
  provide(BUILD_MENU_HOST, host)
}

export function useBuildMenuHost(): BuildMenuHost {
  return inject(BUILD_MENU_HOST, NO_HOST)
}

function startsGroup(entries: BuildMenuEntry[], items: BuildMenuEntry[]): void {
  const [head] = entries
  if (!head) return
  head.separator = items.length > 0
  items.push(...entries)
}

export function useBuildMenu(build: () => Installation) {
  const { t } = useI18n()
  const host = useBuildMenuHost()
  const modal = useModal()
  const sessionStore = useSessionStore()
  const progressStore = useProgressStore()
  const install = useBuildProgress(build)
  const { runQuickUpdate } = useQuickUpdate({
    onShowProgress: (opts) => void host.showProgress(opts),
    onUnavailable: (inst) => openInstallManager(inst, { initialTab: 'update' })
  })
  const installMenu = useInstallContextMenu({
    onManage: (inst, options) =>
      options ? openInstallManager(inst, options) : void host.openDetails(inst),
    onShowProgress: (opts) => void host.showProgress(opts),
    onUpdate: runQuickUpdate,
    canPromoteToWorkspace: (inst) => host.canPromoteToWorkspace?.(inst) ?? false,
    autoStart: useAutoStartBuild()
  })

  function isLocal(inst: Installation): boolean {
    return inst.sourceCategory !== 'cloud'
  }

  const items = computed<BuildMenuEntry[]>(() => {
    const inst = build()
    const progress = buildProgressOf(progressStore, inst.id)
    const running = !progress && isLocal(inst) && sessionStore.isRunning(inst.id)
    const items: BuildMenuEntry[] = []

    const now: BuildMenuEntry[] = []
    if (progress) {
      if (progress.kind !== 'uninstall') {
        now.push({ id: 'view-logs', label: t('installProgress.viewLogs'), icon: ScrollText })
      }
      now.push({ id: 'cancel', label: t('common.cancel'), icon: X, disabled: progress.cancelling })
    } else if (running) {
      now.push(
        { id: 'view-logs', label: t('installProgress.viewLogs'), icon: ScrollText },
        { id: 'restart', label: t('actions.restart'), icon: RotateCw },
        { id: 'stop', label: t('actions.stop'), icon: CircleStop }
      )
    } else if (!sessionStore.isStopping(inst.id) && !sessionStore.isLaunching(inst.id)) {
      now.push({ id: 'launch', label: t('actions.launch'), icon: Play })
    }
    startsGroup(now, items)

    const existing = installMenu
      .getMenuItems(inst)
      .map(({ id, label, icon, disabled, title, style, separator }): BuildMenuEntry => ({
        id,
        label,
        icon,
        disabled,
        title,
        separator,
        danger: style === 'danger'
      }))

    startsGroup(
      existing.filter((item) => item.id === 'auto-start'),
      items
    )

    startsGroup(
      existing.filter(
        (item) => item.id !== 'stop' && item.id !== 'delete' && item.id !== 'auto-start'
      ),
      items
    )
    startsGroup(
      existing.filter((item) => item.id === 'delete'),
      items
    )
    return items
  })

  async function restart(inst: Installation): Promise<void> {
    const confirmed = await modal.confirm({
      title: t('actions.restartConfirmTitle'),
      message: t('actions.restartConfirmMessage'),
      confirmLabel: t('actions.restartConfirm'),
      confirmStyle: 'danger'
    })
    if (!confirmed) return
    try {
      await window.api.stopComfyUI(inst.id)
    } catch (err) {
      await modal.alert({
        title: t('actions.restart'),
        message: (err as Error)?.message || String(err)
      })
      return
    }
    await until(() => sessionStore.isRunning(inst.id)).toBe(false, { timeout: STOP_WAIT_MS })
    if (sessionStore.isRunning(inst.id)) return
    await host.launch(inst, { isRestart: true })
  }

  async function run(id: string, opts: { confirmed?: boolean } = {}): Promise<void> {
    const inst = build()
    switch (id) {
      case 'launch':
        return host.launch(inst)
      case 'view-logs':
        if (install.progress.value) install.viewLogs()
        else openInstallManager(inst, { initialTab: 'console' })
        return
      case 'cancel':
        return install.cancel()
      case 'restart':
        return restart(inst)
      default:
        return installMenu.triggerAction(id, inst, opts)
    }
  }

  return { items, run }
}
