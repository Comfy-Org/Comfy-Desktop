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
  'decide' | 'prepare' | 'download' | 'onBuildAction' | 'onBuildActionEnd'
>

interface TemplateSearchHandlerOptions {
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  process?: SearchProcessApi
}

function broadcastAvailability(availability: TemplateSearchAvailability): void {
  _broadcastToRenderer('template-search:availability', availability)
}

export function registerTemplateSearchHandlers({
  isLocalInstallation,
  terminalEnvOf,
  process = createSearchProcess({
    isLocalInstallation,
    terminalEnvOf,
    broadcast: broadcastAvailability
  })
}: TemplateSearchHandlerOptions): void {
  setSessionActionObserver({
    async before(installationId, actionId) {
      if (changesBuildEnv(actionId)) await process.onBuildAction(installationId)
    },
    after() {
      process.onBuildActionEnd()
    }
  })
  sessionLifecycleEvents.on('launch-ended', () => process.onBuildActionEnd())

  ipcMain.handle('template-search:prepare', () => process.prepare())
  ipcMain.handle('template-search:download', () => process.download())
}
