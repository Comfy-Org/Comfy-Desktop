import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'
import { useDialogs } from './useDialogs'
import { useActionGuard } from './useActionGuard'
import { useMigrateAction } from './useMigrateAction'
import { useSessionStore } from '../stores/sessionStore'
import { emitTelemetryAction } from '../lib/telemetry'
import { progressOpKindForActionId, destroysInstanceForActionId } from '../lib/progressOpKind'
import {
  IN_PLACE_RELAUNCH,
  augmentActionWithStopWarning,
  stopAndWaitForExit
} from '../lib/stopWarning'
import {
  REQUIRES_STOPPED,
  type ActionDef,
  type Installation,
  type ShowProgressOpts
} from '../types/ipc'
import {
  runConfirmChain,
  runDiskSpaceCheck,
  runFieldSelectsChain,
  runPromptChain,
  runSelectChain
} from './actionShoppingList'

export interface PreparedDetailAction {
  action: ActionDef
  wasRunning: boolean
  requiresStoppedGuard: boolean
}

export interface DetailActionProgressTarget {
  returnTo: ShowProgressOpts['returnTo']
  onShowProgress: (opts: ShowProgressOpts) => void
}

export function useDetailActionPreflight() {
  const { t } = useI18n()
  const modal = useModal()
  const dialogs = useDialogs()
  const actionGuard = useActionGuard()
  const { confirmMigration } = useMigrateAction()
  const sessionStore = useSessionStore()

  async function prepareDetailAction(
    inst: Installation,
    action: ActionDef
  ): Promise<PreparedDetailAction | null> {
    const ownsPreflight = action.id === 'migrate-to-standalone'
    const requiresStoppedGuard = REQUIRES_STOPPED.has(action.id)
    const wasRunning = sessionStore.isRunning(inst.id)
    if (requiresStoppedGuard && !ownsPreflight) {
      const proceed = await actionGuard.checkBeforeAction(inst.id, action.label)
      if (!proceed) return null
    }

    let next: ActionDef = { ...action }

    if (ownsPreflight) {
      const migrateResult = await confirmMigration(inst, next.confirm)
      if (!migrateResult) return null
      next = { ...next, data: { ...next.data, ...migrateResult } }
    }

    if (requiresStoppedGuard && wasRunning && !ownsPreflight) {
      next = augmentActionWithStopWarning(
        next,
        t('errors.willStopRunning', { name: inst.name || 'ComfyUI' })
      )
    }

    const afterFieldSelects = await runFieldSelectsChain(next, dialogs, t)
    if (!afterFieldSelects) return null
    next = afterFieldSelects

    const afterSelect = await runSelectChain(next, inst.id, dialogs, t)
    if (!afterSelect) return null
    next = afterSelect

    const afterPrompt = await runPromptChain(next, dialogs)
    if (!afterPrompt) return null
    next = afterPrompt

    if (!ownsPreflight) {
      const afterConfirm = await runConfirmChain(next, modal, dialogs)
      if (!afterConfirm) return null
      next = afterConfirm
    }

    if (!(await runDiskSpaceCheck(next, inst, modal, t, null, dialogs))) return null

    return { action: next, wasRunning, requiresStoppedGuard }
  }

  function showDetailActionProgress(
    inst: Installation,
    prepared: PreparedDetailAction,
    target: DetailActionProgressTarget
  ): void {
    const { action, wasRunning, requiresStoppedGuard } = prepared
    const rawTitle = (action.progressTitle || action.label).replace(/\{(\w+)\}/g, (_, k: string) =>
      String((action.data as Record<string, unknown>)?.[k] ?? k)
    )
    const title = `${rawTitle} — ${inst.name}`
    const isRestart = action.id === 'restart'
    const needsSelfStop = wasRunning && requiresStoppedGuard && !isRestart
    const wantsRelaunch = needsSelfStop && IN_PLACE_RELAUNCH.has(action.id)
    const isRunning = (): boolean => sessionStore.isRunning(inst.id)
    const apiCall = isRestart
      ? async (): Promise<ReturnType<typeof window.api.runAction>> => {
          await stopAndWaitForExit(inst.id, isRunning)
          return window.api.runAction(inst.id, 'launch')
        }
      : needsSelfStop
        ? async (): Promise<ReturnType<typeof window.api.runAction>> => {
            await stopAndWaitForExit(inst.id, isRunning)
            const result = await window.api.runAction(inst.id, action.id, action.data)
            if (wantsRelaunch && result?.ok !== false) {
              await window.api.runAction(inst.id, 'launch')
            }
            return result
          }
        : (): ReturnType<typeof window.api.runAction> =>
            window.api.runAction(inst.id, action.id, action.data)
    emitTelemetryAction('comfy.desktop.action.invoked', { action_id: action.id })
    target.onShowProgress({
      installationId: inst.id,
      title,
      apiCall,
      cancellable: !!action.cancellable,
      returnTo: target.returnTo,
      triggersInstanceStart: action.id === 'launch' || isRestart || wantsRelaunch,
      opKind: isRestart ? 'launch' : progressOpKindForActionId(action.id),
      destroysInstance: destroysInstanceForActionId(action.id),
      actionId: action.id,
      actionData: action.data
    })
  }

  return { prepareDetailAction, showDetailActionProgress }
}
