import { ipcMain, net } from 'electron'
import {
  get as getInstallation,
  update as updateInstallation,
  type InstallationRecord
} from '../../installations'
import { getEntryByInstallationId } from '../../host/registry'
import {
  buildTemplateDeeplink,
  isPersistableTemplateId
} from '../../sources/standalone/curatedTemplates'
import { TEMPLATE_SEARCH_ENV, templateSearchBackendFor } from '../../templateSearch/backend'
import type { TemplateSearchBackend } from '../../templateSearch/types'
import type { OpenTemplateOutcome, TemplateSearchResponse } from '../../../types/ipc'

export const MAX_QUERY_LENGTH = 2000

interface TemplateSearchHandlerOptions {
  isLocalInstallation: (installation: InstallationRecord) => boolean
  backend?: TemplateSearchBackend
}

function backendFromEnv(): TemplateSearchBackend {
  return templateSearchBackendFor(process.env[TEMPLATE_SEARCH_ENV], (url, init) =>
    net.fetch(url, init)
  )
}

function queryFrom(value: unknown): string | null {
  const query = typeof value === 'string' ? value.trim() : ''
  return query && query.length <= MAX_QUERY_LENGTH ? query : null
}

async function openInAttachedBuild(installationId: string, templateId: string): Promise<boolean> {
  const entry = getEntryByInstallationId(installationId)
  const contents = entry?.comfyView.webContents
  if (!entry?.comfyUrl || !contents || contents.isDestroyed()) return false
  await contents.loadURL(buildTemplateDeeplink(entry.comfyUrl, templateId))
  return true
}

export function registerTemplateSearchHandlers({
  isLocalInstallation,
  backend = backendFromEnv()
}: TemplateSearchHandlerOptions): void {
  ipcMain.handle(
    'template-search:search',
    async (_event, value: unknown): Promise<TemplateSearchResponse> => {
      const query = queryFrom(value)
      if (!query) return { kind: 'failed' }
      try {
        return { kind: 'result', result: await backend.search(query) }
      } catch (err) {
        console.warn('[template-search] search failed:', (err as Error).message)
        return { kind: 'failed' }
      }
    }
  )

  ipcMain.handle(
    'template-search:open',
    async (_event, installationId: unknown, templateId: unknown): Promise<OpenTemplateOutcome> => {
      if (typeof installationId !== 'string' || !isPersistableTemplateId(templateId))
        return 'refused'
      const installation = await getInstallation(installationId)
      if (!installation || !isLocalInstallation(installation)) return 'refused'
      if (await openInAttachedBuild(installationId, templateId)) return 'opened'
      await updateInstallation(installationId, { pendingTemplateOpen: templateId })
      return 'launch'
    }
  )
}
