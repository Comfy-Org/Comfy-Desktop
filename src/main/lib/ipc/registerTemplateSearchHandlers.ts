import { ipcMain, type WebContents } from 'electron'
import { get as getInstallation, type InstallationRecord } from '../../installations'
import { getEntryByInstallationId } from '../../host/registry'
import { isPersistableTemplateId } from '../../sources/standalone/curatedTemplates'
import type { TerminalEnv } from '../../types/sources'
import { TEMPLATE_SEARCH_MAX_QUERY } from '../../../shared/templateSearch'
import {
  changesBuildEnv,
  createSearchProcess,
  type SearchProcess
} from '../../templateSearch/searchProcess'
import { createDesktopSearch, type DesktopSearch } from '../../templateSearch/desktopSearch'
import {
  buildTemplateDeeplink,
  claimTemplateOpen,
  dropTemplateOpen,
  queueTemplateOpen
} from '../../templateSearch/openTemplate'
import type {
  OpenTemplateOutcome,
  TemplateSearchAvailability,
  TemplateSearchResponse
} from '../../../types/ipc'
import { _broadcastToRenderer } from './broadcast'
import { _runningSessions, sessionLifecycleEvents } from './shared'
import { _getActiveOperations, setSessionActionObserver } from './sessionActions'

type SearchProcessApi = Pick<
  SearchProcess,
  'decide' | 'prepare' | 'download' | 'onBuildAction' | 'onBuildActionEnd'
>
type SearchApi = Pick<DesktopSearch, 'search' | 'forget'>

interface TemplateSearchHandlerOptions {
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  process?: SearchProcessApi
  search?: SearchApi
}

function broadcastAvailability(availability: TemplateSearchAvailability): void {
  _broadcastToRenderer('template-search:availability', availability)
}

function queryFrom(value: unknown): string | null {
  const query = typeof value === 'string' ? value.trim() : ''
  return query && query.length <= TEMPLATE_SEARCH_MAX_QUERY ? query : null
}

function runningComfyView(installationId: string): { url: string; contents: WebContents } | null {
  if (!_runningSessions.has(installationId)) return null
  const entry = getEntryByInstallationId(installationId)
  const contents = entry?.comfyView.webContents
  if (!entry?.comfyUrl || !contents || contents.isDestroyed()) return null
  return { url: entry.comfyUrl, contents }
}

function opensInAWindow(installation: InstallationRecord): boolean {
  return (installation.launchMode ?? 'window') === 'window'
}

function hasOperationOtherThanLaunch(installationId: string): boolean {
  return _getActiveOperations().some(
    (operation) => operation.installationId === installationId && operation.actionId !== 'launch'
  )
}

export function registerTemplateSearchHandlers({
  isLocalInstallation,
  terminalEnvOf,
  process = createSearchProcess({
    isLocalInstallation,
    terminalEnvOf,
    broadcast: broadcastAvailability
  }),
  search = createDesktopSearch({ process, isLocalInstallation, terminalEnvOf })
}: TemplateSearchHandlerOptions): void {
  setSessionActionObserver({
    async before(installationId, actionId) {
      if (actionId === 'launch') claimTemplateOpen(installationId)
      if (!changesBuildEnv(actionId)) return
      search.forget(installationId)
      await process.onBuildAction(installationId)
    },
    after(installationId, actionId) {
      if (actionId === 'launch') dropTemplateOpen(installationId)
      process.onBuildActionEnd()
    }
  })
  sessionLifecycleEvents.on('launch-ended', () => process.onBuildActionEnd())

  ipcMain.handle(
    'template-search:search',
    async (_event, value: unknown, installationId: unknown): Promise<TemplateSearchResponse> => {
      const query = queryFrom(value)
      if (!query) return { kind: 'failed' }
      try {
        return await search.search(
          query,
          typeof installationId === 'string' && installationId ? installationId : null
        )
      } catch (err) {
        console.warn('[template-search] search failed:', (err as Error).message)
        return { kind: 'failed' }
      }
    }
  )

  ipcMain.handle('template-search:prepare', () => process.prepare())
  ipcMain.handle('template-search:download', () => process.download())

  ipcMain.handle(
    'template-search:open',
    async (_event, installationId: unknown, templateId: unknown): Promise<OpenTemplateOutcome> => {
      if (typeof installationId !== 'string' || !isPersistableTemplateId(templateId))
        return 'refused'
      const installation = await getInstallation(installationId)
      if (!installation || !isLocalInstallation(installation)) return 'refused'
      if (!opensInAWindow(installation) || hasOperationOtherThanLaunch(installationId))
        return 'refused'
      const running = runningComfyView(installationId)
      if (running) {
        try {
          await running.contents.loadURL(buildTemplateDeeplink(running.url, templateId))
          return 'opened'
        } catch {
          return 'refused'
        }
      }
      queueTemplateOpen(installationId, templateId)
      return 'launch'
    }
  )
}
