import { useI18n } from 'vue-i18n'
import { useModal } from './useModal'
import { useProgressStore } from '../stores/progressStore'
import { TID } from '../../../shared/testIds'
import type { ActionResult, PortConflictInfo, ShowProgressOpts } from '../types/ipc'

type Relaunch = (opts: ShowProgressOpts) => unknown

type PortChoice = 'use-next-port' | 'stop-other'

export function portConflictTitleKey(conflict: PortConflictInfo): string {
  if (!conflict.priorBusy) return 'errors.portConflictTitle'
  if (conflict.priorSurvivors) return 'errors.priorSurvivorsTitle'
  if (conflict.priorUnknown) return 'errors.priorProcessUnknownTitle'
  return 'errors.priorProcessBusyTitle'
}

function stopLabelKey(conflict: PortConflictInfo): string {
  if (!conflict.priorBusy) return 'errors.portConflictKill'
  return conflict.priorSurvivors ? 'errors.priorSurvivorsStop' : 'errors.priorProcessBusyStop'
}

export function usePortConflictPrompt(
  relaunch: Relaunch
): (installationId: string) => Promise<void> {
  const { t } = useI18n()
  const modal = useModal()
  const progressStore = useProgressStore()

  function restart(
    installationId: string,
    title: string,
    returnTo: string | undefined,
    apiCall: () => Promise<ActionResult>
  ): void {
    relaunch({ installationId, title, apiCall, cancellable: true, returnTo, opKind: 'launch' })
  }

  async function stopBusyPrior(conflict: PortConflictInfo): Promise<boolean> {
    const messageKey = conflict.priorSurvivors
      ? 'errors.priorSurvivorsConfirmMessage'
      : conflict.priorUnknown
        ? 'errors.priorProcessUnknownConfirmMessage'
        : 'errors.priorProcessBusyConfirmMessage'
    return modal.confirm({
      title: t(portConflictTitleKey(conflict)),
      message: t(messageKey),
      confirmLabel: t(stopLabelKey(conflict)),
      confirmStyle: 'danger'
    })
  }

  async function askPortChoice(
    conflict: PortConflictInfo,
    message: string
  ): Promise<PortChoice | null> {
    const title = t(portConflictTitleKey(conflict))
    const useNextLabel = t('errors.portConflictUsePort')
    const stopLabel = t(stopLabelKey(conflict))
    if (conflict.nextPort && conflict.isComfy) {
      const picked = await modal.choose({
        title,
        message,
        primaryLabel: useNextLabel,
        secondaryLabel: stopLabel,
        testIds: {
          action: TID.progressPortConflictUsePort,
          secondary: TID.progressPortConflictKill
        }
      })
      if (picked === 'primary') return 'use-next-port'
      return picked === 'secondary' ? 'stop-other' : null
    }
    if (conflict.nextPort || conflict.isComfy) {
      const onlyNext = !!conflict.nextPort
      const confirmed = await modal.confirm({
        title,
        message,
        confirmLabel: onlyNext ? useNextLabel : stopLabel,
        confirmStyle: onlyNext ? 'primary' : 'danger',
        testIds: {
          action: onlyNext ? TID.progressPortConflictUsePort : TID.progressPortConflictKill
        }
      })
      if (!confirmed) return null
      return onlyNext ? 'use-next-port' : 'stop-other'
    }
    await modal.alert({ title, message })
    return null
  }

  return async function resolvePortConflict(installationId: string): Promise<void> {
    const op = progressStore.operations.get(installationId)
    const conflict = op?.result?.portConflict
    if (!op || !conflict) return
    const { title, returnTo } = op
    const retry = op.apiCall ?? (() => window.api.runAction(installationId, 'launch'))
    const message = op.result?.message ?? ''
    const choice = await askPortChoice(conflict, message)
    if (choice === 'use-next-port' && conflict.nextPort) {
      const port = conflict.nextPort
      restart(installationId, title, returnTo, () =>
        window.api.runAction(installationId, 'launch', { portOverride: port })
      )
      return
    }
    if (choice !== 'stop-other') return
    if (conflict.priorBusy) {
      if (!(await stopBusyPrior(conflict))) return
      restart(installationId, title, returnTo, () =>
        window.api.runAction(installationId, 'launch', { stopBusyPriorProcess: true })
      )
      return
    }
    const confirmed = await modal.confirm({
      title: t('errors.portConflictKillConfirmTitle'),
      message: t('errors.portConflictKillConfirmMessage'),
      confirmLabel: t('errors.portConflictKill'),
      confirmStyle: 'danger'
    })
    if (!confirmed) return
    const killed = await window.api.killPortProcess(conflict.port)
    if (killed.ok) {
      restart(installationId, title, returnTo, retry)
      return
    }
    await modal.alert({
      title: t(portConflictTitleKey(conflict)),
      message: t('errors.portConflictKillFailed', { port: conflict.port })
    })
  }
}
