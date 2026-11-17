import type { WebContents } from 'electron'
import { get as getInstallation, type InstallationRecord } from '../installations'
import { getCloudSession } from '../devplatform/session'
import type { ComfyWindowEntry } from '../host/registry'
import * as settings from '../settings'
import {
  DASHBOARD_WORKSPACE_SETTING,
  PERSONAL_WORKSPACE_ID,
  installationWorkspaceId,
  isPersonalWorkspace,
  workspaceContextId
} from '../../shared/workspaces'
import { isTrustedCloudUrl } from './trustedCloudUrl'

const pendingWorkspaceSyncs = new WeakMap<ComfyWindowEntry, Promise<boolean>>()
const failedWorkspaceLoads = new WeakSet<WebContents>()

export async function cloudWorkspaceUrl(
  installation: InstallationRecord,
  rawUrl: string
): Promise<string> {
  if (installation.sourceId !== 'cloud' || !isTrustedCloudUrl(rawUrl)) return rawUrl

  const session = getCloudSession()
  const status = session.status()
  if (!status.signedIn) return rawUrl

  const selectedWorkspaceId = (): string =>
    installationWorkspaceId(
      installation,
      settings.get(DASHBOARD_WORKSPACE_SETTING) || workspaceContextId(session.status())
    )
  const selected = selectedWorkspaceId()
  const subject = session.currentSubject()
  const workspaceId =
    selected !== PERSONAL_WORKSPACE_ID
      ? selected
      : workspaceContextId(status) === PERSONAL_WORKSPACE_ID && status.workspaceId
        ? status.workspaceId
        : (await session.listWorkspaces()).find(isPersonalWorkspace)?.id

  if (!workspaceId) throw new Error('Could not determine the personal workspace for Comfy Cloud.')
  if (session.currentSubject() !== subject || selectedWorkspaceId() !== selected) {
    throw new Error('The selected workspace changed. Open Comfy Cloud again.')
  }

  const url = new URL(rawUrl)
  url.searchParams.set('workspace', workspaceId)
  return url.href
}

async function navigateToSelectedWorkspace(
  entry: ComfyWindowEntry,
  installationId: string,
  isLatest: () => boolean
): Promise<boolean> {
  const installation = await getInstallation(installationId)
  if (!installation || !isLatest() || entry.window.isDestroyed()) return false

  const previousUrl = entry.comfyUrl
  const contents = entry.comfyView.webContents
  const stillAttached = (): boolean =>
    !entry.window.isDestroyed() &&
    !contents.isDestroyed() &&
    entry.comfyView.webContents === contents &&
    entry.installationId === installationId &&
    entry.comfyUrl === previousUrl

  const nextUrl = await cloudWorkspaceUrl(installation, previousUrl)
  if (!isLatest() || !stillAttached()) return false
  if (nextUrl === previousUrl && !failedWorkspaceLoads.has(contents)) return true

  try {
    await contents.loadURL(nextUrl)
  } catch (error) {
    if (stillAttached()) failedWorkspaceLoads.add(contents)
    throw error
  }
  if (!stillAttached()) return false

  failedWorkspaceLoads.delete(contents)
  entry.comfyUrl = nextUrl
  return true
}

export async function syncCloudWindowWorkspace(entry: ComfyWindowEntry): Promise<boolean> {
  const { installationId } = entry
  if (entry.sourceCategory !== 'cloud' || !installationId) return true

  const previousSync = pendingWorkspaceSyncs.get(entry)
  const isLatest = (): boolean => pendingWorkspaceSyncs.get(entry) === sync
  const sync: Promise<boolean> = Promise.resolve(previousSync)
    .catch(() => false)
    .then(() => isLatest() && navigateToSelectedWorkspace(entry, installationId, isLatest))
  pendingWorkspaceSyncs.set(entry, sync)

  try {
    return (await sync) && isLatest()
  } catch (error) {
    if (isLatest()) throw error
    return false
  } finally {
    if (isLatest()) pendingWorkspaceSyncs.delete(entry)
  }
}
