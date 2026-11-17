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

export async function syncCloudWindowWorkspace(entry: ComfyWindowEntry): Promise<void> {
  if (entry.sourceCategory !== 'cloud' || !entry.installationId) return
  const installation = await getInstallation(entry.installationId)
  if (!installation) return
  const previousUrl = entry.comfyUrl
  const nextUrl = await cloudWorkspaceUrl(installation, previousUrl)
  const contents = entry.comfyView.webContents
  if (
    nextUrl === previousUrl ||
    entry.comfyUrl !== previousUrl ||
    entry.installationId !== installation.id ||
    entry.window.isDestroyed() ||
    contents.isDestroyed()
  )
    return

  await contents.loadURL(nextUrl)
  entry.comfyUrl = nextUrl
}
