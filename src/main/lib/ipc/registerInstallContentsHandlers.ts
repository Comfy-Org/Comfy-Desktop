import { ipcMain } from 'electron'
import * as installations from '../../installations'
import type { InstallationRecord } from '../../installations'
import { isRolloutEnabled } from '../../settings'
import type { InstallContentsPage, InstallContentsRequest } from '../../../types/ipc'
import { resolveInstallFolders } from '../installFolders'
import type { InstallFolders } from '../installFolders'
import { parseListRequest } from '../installContents/listing'
import { listCloudWorkflows, listLocalWorkflows } from '../installContents/workflows'
import { listCloudModels, listLocalModels } from '../installContents/models'
import { listCloudNodes, listLocalNodes } from '../installContents/nodes'
import * as i18n from '../i18n'
import { sourceMap } from './shared'

/** How one listing reads a local build and a Comfy Cloud build. */
interface ListingSources<T> {
  local: (
    folders: InstallFolders,
    request: InstallContentsRequest
  ) => Promise<InstallContentsPage<T>>
  cloud: (request: InstallContentsRequest) => Promise<InstallContentsPage<T>>
}

const refused = (key: string): InstallContentsPage<never> => ({
  ok: false,
  message: i18n.t(key)
})

const emptyPage: InstallContentsPage<never> = {
  ok: true,
  items: [],
  nextCursor: null,
  total: 0,
  truncated: false
}

/** The build's folders, decided the way launch decides them. */
export function foldersOf(inst: InstallationRecord): InstallFolders {
  return resolveInstallFolders(inst, sourceMap[inst.sourceId]?.getLaunchCommand(inst) ?? null)
}

/** The install a dashboard request names, or why the request is refused. */
async function requestedInstall(
  installationId: unknown
): Promise<{ inst: InstallationRecord } | { refusal: InstallContentsPage<never> }> {
  // Ships dark: nothing reaches a build's files until the dashboard launches.
  if (!isRolloutEnabled('newDashboardEnabled'))
    return { refusal: refused('installContents.disabled') }
  if (typeof installationId !== 'string') {
    return { refusal: refused('installContents.invalidRequest') }
  }
  const inst = await installations.get(installationId)
  return inst ? { inst } : { refusal: refused('installContents.notFound') }
}

async function list<T>(
  installationId: unknown,
  rawRequest: unknown,
  sources: ListingSources<T>
): Promise<InstallContentsPage<T>> {
  const requested = await requestedInstall(installationId)
  if ('refusal' in requested) return requested.refusal
  const { inst } = requested
  const request = parseListRequest(rawRequest)
  if (!request) return refused('installContents.invalidRequest')
  const category = sourceMap[inst.sourceId]?.category
  // A remote build's files live on its server; the dashboard shows an empty state.
  if (category === 'remote') return emptyPage
  try {
    return category === 'cloud'
      ? await sources.cloud(request)
      : await sources.local(foldersOf(inst), request)
  } catch (err) {
    console.warn('[install-contents] listing failed:', (err as Error).message)
    return refused('installContents.readError')
  }
}

/** The Builds dashboard's tabs: a build's workflows, models and custom nodes. */
export function registerInstallContentsHandlers(): void {
  ipcMain.handle('install-contents:list-workflows', (_event, installationId, request) =>
    list(installationId, request, {
      local: (folders, req) => listLocalWorkflows(folders.workflows, req),
      cloud: listCloudWorkflows
    })
  )
  ipcMain.handle('install-contents:list-models', (_event, installationId, request) =>
    list(installationId, request, { local: listLocalModels, cloud: listCloudModels })
  )
  ipcMain.handle('install-contents:list-nodes', (_event, installationId, request) =>
    list(installationId, request, {
      local: (folders, req) => listLocalNodes(folders.customNodes, req),
      cloud: listCloudNodes
    })
  )
}
