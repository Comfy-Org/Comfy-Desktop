import { ipcMain, type WebContents } from 'electron'
import * as settings from '../../settings'
import { get as getInstallation, type InstallationRecord } from '../../installations'
import { getEntryByInstallationId } from '../../host/registry'
import { isPersistableTemplateId } from '../../sources/standalone/curatedTemplates'
import type { TerminalEnv } from '../../types/sources'
import { TEMPLATE_SEARCH_MAX_QUERY } from '../../../shared/templateSearch'
import {
  changesBuildEnv,
  createSearchProcess,
  isBuildBusy,
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
import { setSessionActionObserver } from './sessionActions'

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

function comfyView(installationId: string): { url: string; contents: WebContents } | null {
  const entry = getEntryByInstallationId(installationId)
  const contents = entry?.comfyView.webContents
  if (!entry?.comfyUrl || !contents || contents.isDestroyed()) return null
  return { url: entry.comfyUrl, contents }
}

function searchEnabled(): boolean {
  return settings.get('templateSearchEnabled') === true
}

function opensInAWindow(installation: InstallationRecord): boolean {
  return (installation.launchMode ?? 'window') === 'window'
}

export function registerTemplateSearchHandlers({
  isLocalInstallation,
  terminalEnvOf,
  process = createSearchProcess({
    isLocalInstallation,
    terminalEnvOf,
    broadcast: broadcastAvailability
  }),
  search = createDesktopSearch({
    process,
    isLocalInstallation,
    terminalEnvOf,
    enabled: searchEnabled
  })
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
      if (!searchEnabled()) return 'refused'
      if (typeof installationId !== 'string' || !isPersistableTemplateId(templateId))
        return 'refused'
      const installation = await getInstallation(installationId)
      if (!installation || !isLocalInstallation(installation)) return 'refused'
      if (!opensInAWindow(installation) || isBuildBusy(installationId)) return 'refused'
      if (!_runningSessions.has(installationId)) {
        queueTemplateOpen(installationId, templateId)
        return 'launch'
      }
      const view = comfyView(installationId)
      if (!view) return 'refused'
      try {
        await view.contents.loadURL(buildTemplateDeeplink(view.url, templateId))
        return 'opened'
      } catch {
        return 'refused'
      }
    }
  )
}
