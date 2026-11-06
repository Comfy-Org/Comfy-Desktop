import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { IN_PLACE_RELAUNCH, stopAndWaitForExit } from '../lib/stopWarning'
import { successTerminalGoDashboardOrOpen } from '../lib/progressTerminalPresets'
import { REQUIRES_STOPPED, type Installation, type ShowProgressOpts } from '../types/ipc'

import type { Overlay } from './useOverlay'

interface DeepLinkRouterOpts {
  installationId: string
  bootstrapReady: Promise<void>
  openOverlay: (next: Overlay | null) => Promise<boolean>
  showAppUpdateRestartPrompt: (version: string | null) => Promise<void>
  showAppUpdateDownloadPrompt: (version: string | null) => Promise<void>
  pickInstallFromPicker?: (
    installation: Installation,
    opts?: { startupRestore?: boolean; isRestart?: boolean }
  ) => Promise<void> | void
  runInstallActionFromPicker?: (
    installation: Installation,
    actionId: string
  ) => Promise<void> | void
  showProgressFromPicker?: (opts: ShowProgressOpts) => void
}

export function useDeepLinkRouter(opts: DeepLinkRouterOpts): void {
  const installationStore = useInstallationStore()
  const sessionStore = useSessionStore()
  const { t } = useI18n()
  let unsubPanelTriggerOverlay: (() => void) | null = null

  onMounted(() => {
    unsubPanelTriggerOverlay = window.api.onPanelTriggerOverlay((payload) => {
      void (async () => {
        if (payload.kind === 'app-update-restart-prompt') {
          await opts.bootstrapReady
          await opts.showAppUpdateRestartPrompt(payload.version ?? null)
          return
        }
        if (payload.kind === 'app-update-download-prompt') {
          await opts.bootstrapReady
          await opts.showAppUpdateDownloadPrompt(payload.version ?? null)
          return
        }
        if (payload.kind === 'install-update') {
          const id = payload.installationId
          if (!id || id !== opts.installationId) return
          await opts.bootstrapReady
          const inst = installationStore.getById(id)
          if (!inst) return
          window.api.openInstancePicker({
            installationId: inst.id,
            initialTab: 'update',
            autoAction: 'update-comfyui'
          })
          return
        }
        if (payload.kind === 'open-settings') {
          await opts.bootstrapReady
          const inst = opts.installationId ? installationStore.getById(opts.installationId) : null
          const requested = payload.settingsTab
          const tab = requested ?? (inst ? 'comfy' : 'global')
          if (tab === 'global' || tab === 'global-storage') {
            window.api.openGlobalSettings(tab === 'global-storage' ? 'storage' : undefined)
            return
          }
          if (inst) {
            window.api.openInstancePicker({
              installationId: inst.id,
              initialTab: 'config'
            })
          } else {
            window.api.openInstancePicker()
          }
          return
        }
        if (payload.kind === 'picker-pick-install') {
          await opts.bootstrapReady
          const id = payload.installationId
          if (!id) return
          const inst = installationStore.getById(id)
          if (!inst) {
            if (payload.startupRestore) {
              window.api.resolveStartupRestoreReveal('dashboard-fallback')
            }
            return
          }
          await opts.pickInstallFromPicker?.(inst, {
            startupRestore: payload.startupRestore === true,
            isRestart: payload.isRestart === true
          })
          return
        }
        if (payload.kind === 'picker-install-action') {
          await opts.bootstrapReady
          const id = payload.installationId
          const actionId = payload.actionId
          if (!id || !actionId) return
          const inst = installationStore.getById(id)
          if (!inst) return
          await opts.runInstallActionFromPicker?.(inst, actionId)
          return
        }
        if (payload.kind === 'picker-show-progress') {
          await opts.bootstrapReady
          const id = payload.installationId
          const actionId = payload.actionId
          const title = payload.title
          if (!id || !actionId || !title) return
          const inst = installationStore.getById(id)
          if (!inst) return
          const isRestart = !!payload.isRestart
          const actionData = (payload.actionData ?? undefined) as
            | Record<string, unknown>
            | undefined
          const wasRunning = sessionStore.isRunning(id)
          const requiresStoppedGuard = !isRestart && REQUIRES_STOPPED.has(actionId)
          const needsSelfStop = wasRunning && requiresStoppedGuard
          const wantsRelaunch = needsSelfStop && IN_PLACE_RELAUNCH.has(actionId)
          const isRunning = (): boolean => sessionStore.isRunning(id)
          const apiCall = isRestart
            ? async () => {
                await stopAndWaitForExit(id, isRunning)
                return window.api.runAction(id, 'launch')
              }
            : needsSelfStop
              ? async () => {
                  await stopAndWaitForExit(id, isRunning)
                  const result = await window.api.runAction(id, actionId, actionData)
                  if (wantsRelaunch && result?.ok !== false) {
                    await window.api.runAction(id, 'launch')
                  }
                  return result
                }
              : () => window.api.runAction(id, actionId, actionData)
          const successTerminal = payload.successChoice
            ? successTerminalGoDashboardOrOpen({
                title: payload.opKind === 'update' ? t('progress.updatedSuccess') : undefined,
                dashboardLabel: t('progress.successChoiceGoDashboard'),
                openLabel: t('progress.successChoiceOpen')
              })
            : undefined
          opts.showProgressFromPicker?.({
            installationId: id,
            title,
            apiCall,
            cancellable: !!payload.cancellable,
            returnTo: 'detail',
            triggersInstanceStart: !!payload.triggersInstanceStart || wantsRelaunch,
            opKind: payload.opKind,
            actionId,
            actionData,
            successTerminal
          })
        }
      })()
    })
  })

  onUnmounted(() => {
    unsubPanelTriggerOverlay?.()
  })
}
