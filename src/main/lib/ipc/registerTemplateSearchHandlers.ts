import { ipcMain } from 'electron'
import { get as getInstallation, type InstallationRecord } from '../../installations'
import { getEntryByInstallationId, type ComfyWindowEntry } from '../../host/registry'
import { navigatorFor } from '../../host/buildNavigator'
import { isPersistableTemplateId } from '../../sources/standalone/curatedTemplates'
import type { TerminalEnv } from '../../types/sources'
import { TEMPLATE_SEARCH_MAX_QUERY } from '../../../shared/templateSearch'
import {
  changesBuildEnv,
  createSearchProcess,
  isBuildBusy,
  templateSearchOn,
  templateSearchPartnersOn,
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
  'decide' | 'prepare' | 'download' | 'downloadInBackground' | 'onBuildAction' | 'onBuildActionEnd'
>
type SearchApi = Pick<DesktopSearch, 'search' | 'forget'>

export const STARTUP_SETTLE_MS = 15_000

interface TemplateSearchHandlerOptions {
  isLocalInstallation: (installation: InstallationRecord) => boolean
  terminalEnvOf: (installation: InstallationRecord) => TerminalEnv | null
  settled: Promise<unknown>
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

function buildWindow(installationId: string): ComfyWindowEntry | null {
  const entry = getEntryByInstallationId(installationId)
  const contents = entry?.comfyView.webContents
  if (!entry?.comfyUrl || !contents || contents.isDestroyed()) return null
  return entry
}

function opensInAWindow(installation: InstallationRecord): boolean {
  return (installation.launchMode ?? 'window') === 'window'
}

export function registerTemplateSearchHandlers({
  isLocalInstallation,
  terminalEnvOf,
  settled,
  process = createSearchProcess({
    isLocalInstallation,
    terminalEnvOf,
    broadcast: broadcastAvailability
  }),
  search = createDesktopSearch({
    process,
    isLocalInstallation,
    terminalEnvOf,
    searchOn: templateSearchOn,
    partnersOn: templateSearchPartnersOn
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
      if (actionId === 'launch') claimTemplateOpen(installationId)
      if (!changesBuildEnv(actionId)) return
      search.forget(installationId)
      await process.onBuildAction(installationId)
    },
    after(installationId, actionId) {
      if (actionId === 'launch') dropTemplateOpen(installationId)
      if (changesBuildEnv(actionId)) search.forget(installationId)
      onBuildActionEnd()
    }
  })
  sessionLifecycleEvents.on('launch-ended', onBuildActionEnd)
  void settled.then(() =>
    setTimeout(() => {
      automaticDownload = 'pending'
      downloadAutomatically()
    }, STARTUP_SETTLE_MS)
  )

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
      if (!templateSearchOn()) return 'refused'
      if (typeof installationId !== 'string' || !isPersistableTemplateId(templateId))
        return 'refused'
      const installation = await getInstallation(installationId)
      if (!installation || !isLocalInstallation(installation)) return 'refused'
      if (!opensInAWindow(installation) || isBuildBusy(installationId)) return 'refused'
      const session = _runningSessions.get(installationId)
      if (!session) {
        queueTemplateOpen(installationId, templateId)
        return 'launch'
      }
      const entry = session.mode === 'window' ? buildWindow(installationId) : null
      if (!entry) return 'refused'
      try {
        const deeplink = buildTemplateDeeplink(entry.comfyUrl, templateId)
        return (await navigatorFor(entry).open(deeplink)) === 'loaded' ? 'opened' : 'refused'
      } catch {
        return 'refused'
      }
    }
  )
}
