import {
  ipcMain,
  installations,
  i18n,
  killByPort,
  findPidsByPort,
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

export function registerSessionHandlers(): void {
  ipcMain.handle('stop-comfyui', async (_event, installationId?: string) => {
    recordIpcInvocation('stop-comfyui', installationId)
    // `_onStop` swaps the window body twice: up front (the "Stopping…" panel)
    // and again after the kill settles (stopping → stopped surface).
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
    // Abort only — the owning handler deletes its own map entry when it
    // actually exits. Deleting here would drop the in-progress guard while
    // the operation is still mutating (e.g. a torch transaction past its
    // cancellation point), letting a second operation start over it.
    _operationAborts.get(installationId)?.abort()
  })

  ipcMain.handle('kill-port-process', async (_event, port: number) => {
    recordIpcInvocation('kill-port-process', port)
    // The user confirmed stopping whatever holds the port: say what that was, for support.
    const holders = await findPidsByPort(port).catch(() => [] as number[])
    console.info(
      `[launch] stopping what holds port ${port} at the user's request: ` +
        (holders.length > 0 ? `pids ${holders.join(', ')}` : 'no listener could be listed')
    )
    removePortLock(port)
    await killByPort(port)
    await new Promise((r) => setTimeout(r, 500))
    const remaining = await findPidsByPort(port)
    console.info(
      `[launch] port ${port} ` +
        (remaining.length === 0 ? 'is free' : `is still held by pids ${remaining.join(', ')}`)
    )
    return { ok: remaining.length === 0 }
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
        // Substitute the `{operation}` placeholder with the localized label, falling back to
        // the raw action id so the renderer never paints the bare template.
        const labelKey = `actions.${actionId}`
        const label = i18n.t(labelKey)
        const operation = label === labelKey ? actionId : label
        return { ok: false, message: i18n.t('errors.operationInProgress', { operation }) }
      }

      const requestedSessionId = actionData?.sessionIdOverride
      const sessionId =
        actionId === 'launch' && requestedSessionId === `performance-test:${installationId}`
          ? requestedSessionId
          : undefined
      return dispatchSessionAction(
        { event: _event, installationId, sessionId, inst, actionData },
        actionId
      )
    }
  )
}
