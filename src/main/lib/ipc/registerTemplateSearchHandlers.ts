import { ipcMain } from 'electron'
import type { InstallationRecord } from '../../installations'
import type { TerminalEnv } from '../../types/sources'
import {
  changesBuildEnv,
  createSearchProcess,
  type SearchProcess
} from '../../templateSearch/searchProcess'
import type { TemplateSearchAvailability } from '../../../types/ipc'
import { _broadcastToRenderer } from './broadcast'
import { sessionLifecycleEvents } from './shared'
import { setSessionActionObserver } from './sessionActions'

type SearchProcessApi = Pick<
  SearchProcess,
  'decide' | 'prepare' | 'download' | 'downloadInBackground' | 'onBuildAction' | 'onBuildActionEnd'
>

export const STARTUP_SETTLE_MS = 15_000

interface TemplateSearchHandlerOptions {
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  settled: Promise<unknown>
  process?: SearchProcessApi
}

function broadcastAvailability(availability: TemplateSearchAvailability): void {
  _broadcastToRenderer('template-search:availability', availability)
}

export function registerTemplateSearchHandlers({
  isLocalInstallation,
  terminalEnvOf,
  settled,
  process = createSearchProcess({
    isLocalInstallation,
    terminalEnvOf,
    broadcast: broadcastAvailability
  })
}: TemplateSearchHandlerOptions): void {
  let automaticDownload: 'after_startup' | 'pending' | 'done' = 'after_startup'

  function downloadAutomatically(): void {
    if (automaticDownload !== 'pending') return
    void process.downloadInBackground().then(
      (done) => {
        if (done) automaticDownload = 'done'
      },
      () => false
    )
  }

  function onBuildActionEnd(): void {
    process.onBuildActionEnd()
    downloadAutomatically()
  }

  setSessionActionObserver({
    async before(installationId, actionId) {
      if (changesBuildEnv(actionId)) await process.onBuildAction(installationId)
    },
    after: onBuildActionEnd
  })
  sessionLifecycleEvents.on('launch-ended', onBuildActionEnd)
  void settled.then(() =>
    setTimeout(() => {
      automaticDownload = 'pending'
      downloadAutomatically()
    }, STARTUP_SETTLE_MS)
  )

  ipcMain.handle('template-search:prepare', () => process.prepare())
  ipcMain.handle('template-search:download', () => process.download())
}
