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
const workspaceNavigationVersions = new WeakMap<ComfyWindowEntry, number>()
const CLOUD_TAB_WORKSPACE_KEY = 'Comfy.Workspace.Current'
const CLOUD_TAB_SWITCH_TARGET_KEY = 'Comfy.Workspace.SwitchTargetId'

export function cloudWorkspaceNavigationVersion(entry: ComfyWindowEntry): number {
  return workspaceNavigationVersions.get(entry) ?? 0
}

export async function cloudWorkspaceUrl(
  installation: InstallationRecord,
  rawUrl: string,
  pickerWorkspaceId?: string
): Promise<string> {
  if (installation.sourceId !== 'cloud' || !isTrustedCloudUrl(rawUrl)) return rawUrl

  const session = getCloudSession()
  const status = session.status()
  if (!status.signedIn) return rawUrl

  const selectedWorkspaceId = (): string =>
    installationWorkspaceId(
      installation,
      pickerWorkspaceId ||
        settings.get(DASHBOARD_WORKSPACE_SETTING) ||
        workspaceContextId(session.status())
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

async function canKeepCloudPage(
  contents: WebContents,
  launchUrl: string,
  sameLaunchUrl: boolean
): Promise<boolean> {
  if (!isTrustedCloudUrl(launchUrl) || !getCloudSession().status().signedIn) return sameLaunchUrl
  const target = new URL(launchUrl)
  const workspaceId = target.searchParams.get('workspace')
  if (!workspaceId) return sameLaunchUrl

  const pageUrl = contents.getURL()
  if (!isTrustedCloudUrl(pageUrl) || new URL(pageUrl).origin !== target.origin) return sameLaunchUrl

  const currentWorkspaceId: unknown = await contents
    .executeJavaScript(
      `(() => {
      if (location.origin !== ${JSON.stringify(target.origin)}) return null
      const pending = sessionStorage.getItem(${JSON.stringify(CLOUD_TAB_SWITCH_TARGET_KEY)})
      if (pending) return pending
      const workspace = sessionStorage.getItem(${JSON.stringify(CLOUD_TAB_WORKSPACE_KEY)})
      return workspace ? JSON.parse(workspace)?.id : null
    })()`
    )
    .catch(() => null)
  if (typeof currentWorkspaceId === 'string') return currentWorkspaceId === workspaceId

  return new URL(pageUrl).searchParams.get('workspace') === workspaceId
}

interface CloudWindowOpenOptions {
  pickerWorkspaceId?: string
  cancelLoadRetry?: () => void
}

async function navigateToSelectedWorkspace(
  entry: ComfyWindowEntry,
  installationId: string,
  isLatest: () => boolean,
  { pickerWorkspaceId, cancelLoadRetry }: CloudWindowOpenOptions
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

  const nextUrl = await cloudWorkspaceUrl(installation, previousUrl, pickerWorkspaceId)
  if (!isLatest() || !stillAttached()) return false
  const sameLaunchUrl = nextUrl === previousUrl
  const keepPage =
    !failedWorkspaceLoads.has(contents) &&
    (await canKeepCloudPage(contents, nextUrl, sameLaunchUrl))
  if (!isLatest() || !stillAttached()) return false
  if (keepPage && sameLaunchUrl) return true

  cancelLoadRetry?.()
  workspaceNavigationVersions.set(entry, cloudWorkspaceNavigationVersion(entry) + 1)
  if (!keepPage) {
    try {
      await contents.loadURL(nextUrl)
    } catch (error) {
      if (stillAttached()) failedWorkspaceLoads.add(contents)
      throw error
    }
    if (!stillAttached()) return false
  }

  failedWorkspaceLoads.delete(contents)
  entry.comfyUrl = nextUrl
  return true
}

export async function syncCloudWindowWorkspace(
  entry: ComfyWindowEntry,
  options: CloudWindowOpenOptions = {}
): Promise<boolean> {
  const { installationId } = entry
  if (entry.sourceCategory !== 'cloud' || !installationId) return true

  const previousSync = pendingWorkspaceSyncs.get(entry)
  const isLatest = (): boolean => pendingWorkspaceSyncs.get(entry) === sync
  const sync: Promise<boolean> = Promise.resolve(previousSync)
    .catch(() => false)
    .then(() => isLatest() && navigateToSelectedWorkspace(entry, installationId, isLatest, options))
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
