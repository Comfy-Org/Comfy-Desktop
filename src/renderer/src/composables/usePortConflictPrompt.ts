import { useI18n } from 'vue-i18n'
import { useModal, type ModalSelectItem } from './useModal'
import { useProgressStore } from '../stores/progressStore'
import { TID } from '../../../shared/testIds'
import type { ActionResult, PortConflictInfo, ShowProgressOpts } from '../types/ipc'

type Relaunch = (opts: ShowProgressOpts) => unknown

const USE_NEXT_PORT = 'use-next-port'
const STOP_OTHER = 'stop-other'

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

  return async function resolvePortConflict(installationId: string): Promise<void> {
    const op = progressStore.operations.get(installationId)
    const conflict = op?.result?.portConflict
    if (!op || !conflict) return
    const { title, returnTo } = op
    const retry = op.apiCall ?? (() => window.api.runAction(installationId, 'launch'))
    const message = op.result?.message ?? ''
    const items: ModalSelectItem[] = []
    if (conflict.nextPort) {
      items.push({
        value: USE_NEXT_PORT,
        label: t('errors.portConflictUsePort'),
        testId: TID.progressPortConflictUsePort
      })
    }
    if (conflict.isComfy) {
      items.push({
        value: STOP_OTHER,
        label: t(stopLabelKey(conflict)),
        testId: TID.progressPortConflictKill
      })
    }
    if (items.length === 0) {
      await modal.alert({ title: t(portConflictTitleKey(conflict)), message })
      return
    }
    const choice = await modal.select({
      title: t(portConflictTitleKey(conflict)),
      message,
      items
    })
    if (choice === USE_NEXT_PORT && conflict.nextPort) {
      const port = conflict.nextPort
      restart(installationId, title, returnTo, () =>
        window.api.runAction(installationId, 'launch', { portOverride: port })
      )
      return
    }
    if (choice !== STOP_OTHER) return
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
