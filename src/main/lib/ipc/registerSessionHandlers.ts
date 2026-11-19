import {
  ipcMain,
  installations,
  i18n,
  killByPort,
  findPidsByPort,
  isPortListening,
  removePortLock,
  REQUIRES_STOPPED,
  _onStop,
  _operationAborts,
  _getPublicSessions,
  _getLaunchingInstances,
  _getStoppingInstallationIds,
  hasRunningSessionForInstallation,
  stopRunning
} from './shared'
import { dispatchSessionAction, _getActiveOperations } from './sessionActions'
import { recordIpcInvocation } from '../e2eOverrides'
import { performanceTestSessionKey } from '../../../shared/performanceTestSession'

export function registerSessionHandlers(): void {
  ipcMain.handle('stop-comfyui', async (_event, installationId?: string) => {
    recordIpcInvocation('stop-comfyui', installationId)
    const onEnterStopping = _onStop ?? undefined
    await stopRunning(installationId, onEnterStopping)
    if (_onStop) _onStop({ installationId })
  })

  ipcMain.handle('get-running-instances', () => _getPublicSessions())

  ipcMain.handle('get-launching-instances', () => _getLaunchingInstances())

  ipcMain.handle('get-stopping-instances', () => _getStoppingInstallationIds())

  ipcMain.handle('get-active-operations', () => _getActiveOperations())

  ipcMain.handle('cancel-launch', () => {
    for (const [_id, abort] of _operationAborts) {
      abort.abort()
    }
    _operationAborts.clear()
  })

  ipcMain.handle('cancel-operation', (_event, installationId: string) => {
    recordIpcInvocation('cancel-operation', installationId)
    _operationAborts.get(installationId)?.abort()
  })

  ipcMain.handle('kill-port-process', async (_event, port: number) => {
    recordIpcInvocation('kill-port-process', port)
    const holders = await findPidsByPort(port).catch(() => [] as number[])
    console.info(
      `[launch] stopping what holds port ${port} at the user's request: ` +
        (holders.length > 0 ? `pids ${holders.join(', ')}` : 'no listener could be listed')
    )
    await killByPort(port)
    await new Promise((r) => setTimeout(r, 500))
    const remaining = await findPidsByPort(port)
    const free = remaining.length === 0 && !(await isPortListening(port))
    if (free) removePortLock(port)
    console.info(
      `[launch] port ${port} ` +
        (free
          ? 'is free'
          : remaining.length > 0
            ? `is still held by pids ${remaining.join(', ')}`
            : 'is still in use by a process that could not be listed')
    )
    return { ok: free }
  })

  ipcMain.handle(
    'run-action',
    async (
      _event,
      installationId: string,
      actionId: string,
      actionData?: Record<string, unknown>
    ) => {
      recordIpcInvocation('run-action', { installationId, actionId, actionData })
      const maybeInst = await installations.get(installationId)
      if (!maybeInst) return { ok: false, message: 'Installation not found.' }
      const inst = maybeInst
      if (REQUIRES_STOPPED.has(actionId) && hasRunningSessionForInstallation(installationId)) {
        return { ok: false, message: i18n.t('errors.stopRequired'), running: true }
      }
      if (REQUIRES_STOPPED.has(actionId) && _operationAborts.has(installationId)) {
        const labelKey = `actions.${actionId}`
        const label = i18n.t(labelKey)
        const operation = label === labelKey ? actionId : label
        return { ok: false, message: i18n.t('errors.operationInProgress', { operation }) }
      }

      const requestedSessionId = actionData?.sessionIdOverride
      const sessionId =
        actionId === 'launch' && requestedSessionId === performanceTestSessionKey(installationId)
          ? requestedSessionId
          : undefined
      return dispatchSessionAction(
        { event: _event, installationId, sessionId, inst, actionData },
        actionId
      )
    }
  )
}
