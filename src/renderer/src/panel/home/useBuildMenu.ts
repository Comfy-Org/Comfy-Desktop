import { computed, inject, provide, type Component, type InjectionKey } from 'vue'
import { CircleStop, Play, RotateCw, ScrollText, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { until } from '@vueuse/core'
import { useAutoStartBuild } from '../../composables/useAutoStartBuild'
import { buildProgressOf, useBuildProgress } from '../../composables/useBuildProgress'
import { useCanPromoteToWorkspace } from '../../composables/useCanPromoteToWorkspace'
import {
  isPromotingToWorkspace,
  useInstallContextMenu
} from '../../composables/useInstallContextMenu'
import { useModal } from '../../composables/useModal'
import { useQuickUpdate } from '../../composables/useQuickUpdate'
import { openInstallManager } from '../../lib/openInstallManager'
import { useProgressStore } from '../../stores/progressStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { Installation, ShowProgressOpts } from '../../types/ipc'
import { homeBuildStatus, isBuildOpenBlocked } from './homeBuild'

export interface BuildMenuHost {
  launch: (build: Installation, opts?: { isRestart?: boolean }) => void | Promise<void>
  openDetails: (build: Installation) => void | Promise<void>
  showProgress: (opts: ShowProgressOpts) => void | Promise<void>
}

export interface BuildMenuEntry {
  id: string
  label: string
  icon?: Component
  separator?: boolean
  danger?: boolean
  disabled?: boolean
  title?: string
  hint?: string
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

function startsGroup(entries: BuildMenuEntry[], items: BuildMenuEntry[]): void {
  const [head] = entries
  if (!head) return
  head.separator = items.length > 0
  items.push(...entries)
}

export function useBuildMenu(build: () => Installation) {
  const { t } = useI18n()
  const host = inject(BUILD_MENU_HOST, NO_HOST)
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
    canPromoteToWorkspace: useCanPromoteToWorkspace(),
    autoStart: useAutoStartBuild()
  })
  const status = computed(() => homeBuildStatus(build(), sessionStore))
  const canLaunch = computed(
    () =>
      !install.progress.value &&
      !isPromotingToWorkspace(build()) &&
      !isBuildOpenBlocked(status.value) &&
      status.value !== 'starting'
  )

  function isLocal(inst: Installation): boolean {
    return inst.sourceCategory !== 'cloud'
  }

  function isStarting(inst: Installation): boolean {
    const operation = sessionStore.operationInstances.get(inst.id)
    return (
      sessionStore.isLaunching(inst.id) ||
      (operation?.actionId === 'launch' && operation.sessionId === undefined)
    )
  }

  const items = computed<BuildMenuEntry[]>(() => {
    const inst = build()
    const progress = buildProgressOf(progressStore, inst.id)
    const running = canLaunch.value && isLocal(inst) && status.value === 'running'
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
    } else if (isLocal(inst) && isStarting(inst)) {
      now.push(
        { id: 'view-logs', label: t('installProgress.viewLogs'), icon: ScrollText },
        { id: 'cancel', label: t('common.cancel'), icon: X }
      )
    } else if (canLaunch.value) {
      now.push({ id: 'launch', label: t('actions.launch'), icon: Play })
    }
    startsGroup(now, items)

    const existing = installMenu
      .getMenuItems(inst)
      .map(({ id, label, icon, disabled, title, hint, style, separator }): BuildMenuEntry => ({
        id,
        label,
        icon,
        disabled,
        title,
        hint,
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

  async function cancelLeftStart(inst: Installation): Promise<void> {
    await window.api.cancelOperation(inst.id)
    await window.api.stopComfyUI(inst.id)
  }

  async function run(id: string, opts: { confirmed?: boolean } = {}): Promise<void> {
    const inst = build()
    switch (id) {
      case 'launch':
        if (canLaunch.value) return host.launch(inst)
        return
      case 'view-logs':
        if (install.progress.value) install.viewLogs()
        else openInstallManager(inst, { initialTab: 'console' })
        return
      case 'cancel':
        return install.progress.value ? install.cancel() : cancelLeftStart(inst)
      case 'restart':
        if (canLaunch.value) return restart(inst)
        return
      default:
        return installMenu.triggerAction(id, inst, opts)
    }
  }

  return { items, run }
}
