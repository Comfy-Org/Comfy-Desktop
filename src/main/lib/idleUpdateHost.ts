import { app } from 'electron'
import { get as getInstallation } from '../installations'
import * as settings from '../settings'
import { findInstallationIdByComfySender } from '../host/registry'
import { idleUpdateChannel } from '../sources/standalone/updateSections'
import type { TitlePopupHostBindings } from '../popups/titlePopup'
import { probeQueue } from './comfyProcessRecord'
import { createIdleUpdateWatcher, type IdleSession, type IdleUpdateWatcher } from './idleUpdate'
import { _operationAborts, _runningSessions } from './ipc/shared'
import { t } from './i18n'
import * as updater from './updater'

function localSessions(): IdleSession[] {
  const sessions: IdleSession[] = []
  for (const [sessionId, s] of _runningSessions) {
    if (!s.proc || s.port <= 0) continue
    sessions.push({
      installationId: s.sourceInstallationId ?? sessionId,
      port: s.port,
      startedAt: s.startedAt
    })
  }
  return sessions
}

async function instanceUpdateChannel(installationId: string): Promise<string | null> {
  if (_operationAborts.has(installationId)) return null
  const inst = await getInstallation(installationId)
  return inst?.sourceId === 'standalone' ? idleUpdateChannel(inst) : null
}

function envMs(name: string): number | undefined {
  const value = Number(process.env[name])
  return process.env[name] && Number.isFinite(value) ? value : undefined
}

export function startIdleUpdates(
  runBackgroundOp: TitlePopupHostBindings['pickerRunBackgroundOp']
): IdleUpdateWatcher {
  const watcher = createIdleUpdateWatcher(
    {
      now: () => Date.now(),
      runningSessions: localSessions,
      probeQueue: (port) => probeQueue(port),
      instanceUpdateChannel,
      updateInstance: (installationId, channel) =>
        runBackgroundOp({
          installationId,
          actionId: 'update-comfyui',
          actionData: { channel },
          title: t('standalone.restartWhenIdle'),
          cancellable: false
        }),
      appUpdateWaiting: () =>
        settings.get('installUpdatesWhenIdle') === true &&
        updater.getCurrentUpdateState().kind === 'ready' &&
        _operationAborts.size === 0,
      installAppUpdate: () => updater.installUpdate(false)
    },
    { tickMs: envMs('E2E_IDLE_UPDATE_TICK_MS'), quietMs: envMs('E2E_IDLE_UPDATE_QUIET_MS') }
  )
  app.on('web-contents-created', (_event, contents) => {
    contents.on('input-event', () => watcher.noteInput(findInstallationIdByComfySender(contents)))
  })
  return watcher
}
