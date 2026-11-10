import { BrowserWindow, ipcMain, shell } from 'electron'

import { comfyWindows } from '../../host/registry'
import type { ComfyWindowEntry } from '../../host/registry'
import { broadcastEmbeddedSessionChanged } from '../embeddedSession'
import { getViewWorkspaceGrants } from '../viewWorkspaceGrants'
import { openSystemModalAsync } from '../../popups/systemModal'
import { normalizeSha256 } from '../../comfybuilder/integrity'
import { PLATFORM_WEB_BASE_URL } from '../../devplatform/config'
import {
  getBuilderClient,
  getCloudSession,
  setUnauthorizedHandler
} from '../../devplatform/session'
import {
  resolveBuildRows,
  resolveHost,
  resolveHostArtifact,
  resolveSelectedHostArtifact
} from '../../devplatform/builds'
import type { BuildRow } from '../../devplatform/builds'
import { clearVersionCache, getVersionCacheGeneration } from '../../devplatform/versionCache'
import type {
  AuthStatus,
  Workspace,
  WorkspaceSwitchIntent,
  WorkspaceSwitchStatus
} from '../../cloud'
import {
  installations,
  defaultInstallDir,
  sourceMap,
  saveSnapshot,
  loadSnapshot,
  getSnapshotCount,
  buildExportEnvelope,
  _broadcastToRenderer,
  _operationAborts,
  i18n
} from './shared'
import { allocateInstallIdentity } from './installIdentity'
import { COMFYBUILDER_INSTALL_DEFAULTS } from '../../sources/comfybuilder/constants'
import type { InstallationRecord } from '../../installations'
import type { InstallBuildRequest, InstallBuildResult } from '../../../types/ipc'
import {
  isPersonalWorkspace,
  PERSONAL_WORKSPACE_ID,
  workspaceContextId
} from '../../../shared/workspaces'

export const DEVPLATFORM_CHANNELS = {
  signIn: 'comfybuilder:signIn',
  signOut: 'comfybuilder:signOut',
  getAuthStatus: 'comfybuilder:getAuthStatus',
  authChanged: 'comfybuilder:authChanged',
  listWorkspaces: 'comfybuilder:listWorkspaces',
  switchWorkspace: 'comfybuilder:switchWorkspace',
  listBuilds: 'comfybuilder:listBuilds',
  openBuildsPage: 'comfybuilder:openBuildsPage',
  installBuild: 'comfybuilder:installBuild',
  promoteLocalInstance: 'comfybuilder:promoteLocalInstance'
} as const

const SIGNED_OUT: AuthStatus = { signedIn: false }

const COMFYBUILDER_SOURCE_ID = 'comfybuilder'
const COMFYBUILDER_SOURCE_LABEL = 'ComfyBuilder'

export interface PromoteLocalInstanceResult {
  ok: boolean
  message?: string
}

function isPromotableLocalInstallation(inst: InstallationRecord): boolean {
  return (
    inst.status === 'installed' &&
    Boolean(inst.installPath) &&
    sourceMap[inst.sourceId]?.category === 'local'
  )
}

export function broadcastAuthChanged(status: AuthStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed())
      win.webContents.send(DEVPLATFORM_CHANNELS.authChanged, status)
  }
  for (const entry of comfyWindows.values()) {
    const panel = entry.panelView
    if (panel && !panel.webContents.isDestroyed())
      panel.webContents.send(DEVPLATFORM_CHANNELS.authChanged, status)
  }
  void broadcastEmbeddedSessionChanged()
}

export async function signInToCloud(): Promise<AuthStatus> {
  const session = getCloudSession()
  clearVersionCache()
  const login = session.login()
  const generation = session.currentAuthGeneration()
  const status = await login
  clearVersionCache()
  if (session.currentAuthGeneration() === generation) {
    getViewWorkspaceGrants().endAll()
    getViewWorkspaceGrants().allowDesktop(status.workspaceId)
  }
  broadcastAuthChanged(status)
  return status
}

async function switchAndAnnounce(
  workspaceId: string,
  intent: WorkspaceSwitchIntent
): Promise<{ reply: WorkspaceSwitchStatus; superseded: boolean }> {
  const session = getCloudSession()
  const subjectBefore = session.currentSubject()
  clearVersionCache()
  const switching = session.switchWorkspace(workspaceId, intent)
  const generation = session.currentAuthGeneration()
  const { reachedThroughConsent, ...reply } = await switching
  clearVersionCache()
  const { workspaceSwitchFailure: _failure, ...status } = reply
  const superseded = session.currentAuthGeneration() !== generation
  if (!superseded && session.currentSubject() !== subjectBefore) {
    getViewWorkspaceGrants().endAll()
    getViewWorkspaceGrants().allowDesktop(status.workspaceId)
  } else if (reachedThroughConsent) {
    getViewWorkspaceGrants().allowDesktop(status.workspaceId)
  }
  broadcastAuthChanged(status)
  return { reply, superseded }
}

export async function switchCloudWorkspace(
  workspaceId: string,
  intent: WorkspaceSwitchIntent = 'chosen'
): Promise<WorkspaceSwitchStatus> {
  return (await switchAndAnnounce(workspaceId, intent)).reply
}

export async function signOutOfCloud(host: ComfyWindowEntry | undefined): Promise<AuthStatus> {
  const session = getCloudSession()
  const installingOperations: Array<[string, AbortController]> = []
  for (const [installationId, abort] of _operationAborts) {
    const installation = await installations.get(installationId)
    if (installation?.status === 'installing' || installation?.status === 'updating') {
      installingOperations.push([installationId, abort])
    }
  }
  if (installingOperations.length > 0) {
    if (!host || host.window.isDestroyed()) return session.status()
    const confirmed = await openSystemModalAsync({
      parent: host.window,
      spec: {
        title: i18n.t('devPlatform.account.installationInProgressTitle'),
        message: i18n.t('devPlatform.account.installationInProgressMessage'),
        confirmLabel: i18n.t('devPlatform.account.cancelInstallationAndSignOut'),
        cancelLabel: i18n.t('common.close'),
        confirmStyle: 'danger',
        theme: host.lastTheme
      }
    })
    if (!confirmed) return session.status()
    for (const [installationId, abort] of installingOperations) {
      if (_operationAborts.get(installationId) !== abort) continue
      abort.abort()
      _broadcastToRenderer('install-progress', {
        installationId,
        phase: 'cancelling',
        cancelRequested: true
      })
    }
  }
  session.logout()
  getViewWorkspaceGrants().endAll()
  clearVersionCache()
  broadcastAuthChanged(SIGNED_OUT)
  return SIGNED_OUT
}

export function registerDevPlatformHandlers(): void {
  const session = getCloudSession()
  setUnauthorizedHandler(() => {
    getViewWorkspaceGrants().endAll()
    clearVersionCache()
    broadcastAuthChanged(SIGNED_OUT)
  })
  session.setReturnedToAnchorHandler(() => {
    const status = session.status()
    getViewWorkspaceGrants().allowDesktop(status.workspaceId)
    clearVersionCache()
    broadcastAuthChanged(status)
  })

  const installing = new Set<string>()
  const promoting = new Set<string>()

  ipcMain.handle(DEVPLATFORM_CHANNELS.signIn, (): Promise<AuthStatus> => signInToCloud())

  ipcMain.handle(
    DEVPLATFORM_CHANNELS.signOut,
    (event): Promise<AuthStatus> =>
      signOutOfCloud(
        [...comfyWindows.values()].find((entry) => entry.panelView?.webContents === event.sender)
      )
  )

  ipcMain.handle(DEVPLATFORM_CHANNELS.getAuthStatus, (): AuthStatus => session.status())

  ipcMain.handle(DEVPLATFORM_CHANNELS.listWorkspaces, async (): Promise<Workspace[]> => {
    const workspaces = await session.listWorkspaces()
    const personal = workspaces.find(isPersonalWorkspace)
    if (personal) {
      await installations.reassignWorkspace(personal.id, PERSONAL_WORKSPACE_ID)
    }
    return workspaces
  })

  ipcMain.handle(
    DEVPLATFORM_CHANNELS.openBuildsPage,
    async (_event, workspaceId: string): Promise<void> => {
      if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
        throw new Error('A workspace is required to open Builds.')
      }
      const url = new URL('/profile/builds', PLATFORM_WEB_BASE_URL)
      url.searchParams.set('workspace', workspaceId)
      await shell.openExternal(url.toString())
    }
  )

  ipcMain.handle(
    DEVPLATFORM_CHANNELS.switchWorkspace,
    async (_event, workspaceId: string, intent?: WorkspaceSwitchIntent) => {
      const { reply: status, superseded } = await switchAndAnnounce(
        workspaceId,
        intent === 'restored' ? 'restored' : 'chosen'
      )
      if (!superseded && status.signedIn && status.workspaceId === workspaceId) {
        getViewWorkspaceGrants().allowDesktop(workspaceId)
      }
      return status
    }
  )

  ipcMain.handle(
    DEVPLATFORM_CHANNELS.promoteLocalInstance,
    async (_event, installationId: string): Promise<PromoteLocalInstanceResult> => {
      if (promoting.has(installationId)) {
        return { ok: false, message: 'Promotion is already in progress.' }
      }
      promoting.add(installationId)
      try {
        const inst = await installations.get(installationId)
        if (!inst) return { ok: false, message: 'Instance not found.' }
        if (!isPromotableLocalInstallation(inst)) {
          return { ok: false, message: 'This instance cannot be promoted to a workspace.' }
        }
        const status = session.status()
        if (!status.signedIn) return { ok: false, message: 'Not signed in.' }
        const subject = session.currentSubject()
        let workspaceId: string | undefined
        if (!inst.workspaceId || inst.workspaceId === PERSONAL_WORKSPACE_ID) {
          workspaceId =
            workspaceContextId(status) === PERSONAL_WORKSPACE_ID
              ? status.workspaceId
              : (await session.listWorkspaces()).find(isPersonalWorkspace)?.id
        } else {
          workspaceId = inst.workspaceId
        }
        if (!workspaceId) return { ok: false, message: 'No active workspace.' }
        if (status.workspaceId !== workspaceId) {
          if (session.currentSubject() !== subject) {
            return { ok: false, message: 'Could not activate the instance workspace.' }
          }
          const { reply: switched, superseded } = await switchAndAnnounce(workspaceId, 'chosen')
          if (superseded || !switched.signedIn || switched.workspaceId !== workspaceId) {
            return { ok: false, message: 'Could not activate the instance workspace.' }
          }
          getViewWorkspaceGrants().allowDesktop(workspaceId)
        }

        const filename = await saveSnapshot(inst.installPath, inst, 'manual')
        const snapshot = await loadSnapshot(inst.installPath, filename)
        const snapshotCount = await getSnapshotCount(inst.installPath)
        await installations.update(inst.id, { lastSnapshot: filename, snapshotCount })

        const current = await installations.get(installationId)
        if (
          !current ||
          !isPromotableLocalInstallation(current) ||
          current.workspaceId !== inst.workspaceId
        ) {
          return { ok: false, message: 'The instance changed. Try again.' }
        }
        if (session.status().workspaceId !== workspaceId || session.currentSubject() !== subject) {
          return { ok: false, message: 'The active workspace changed. Try again.' }
        }

        const envelope = buildExportEnvelope(inst.name, [{ filename, snapshot }])
        const draft = await getBuilderClient().createBuildDraft(envelope)
        if (draft.workspaceId !== workspaceId) {
          throw new Error('Comfy Developer Platform created the draft in a different workspace.')
        }
        const latest = await installations.get(installationId)
        if (
          !latest ||
          !isPromotableLocalInstallation(latest) ||
          latest.workspaceId !== inst.workspaceId
        ) {
          return { ok: false, message: 'The instance changed. Try again.' }
        }
        if (session.status().workspaceId !== workspaceId || session.currentSubject() !== subject) {
          return { ok: false, message: 'The active workspace changed. Try again.' }
        }
        const url = new URL(
          `/profile/builds/${encodeURIComponent(draft.buildId)}/draft`,
          PLATFORM_WEB_BASE_URL
        )
        url.searchParams.set('workspace', workspaceId)
        await shell.openExternal(url.toString())
        return { ok: true }
      } catch (err) {
        console.warn('[dev-platform] Failed to promote local instance:', err)
        return { ok: false, message: (err as Error)?.message || String(err) }
      } finally {
        promoting.delete(installationId)
      }
    }
  )

  ipcMain.handle(DEVPLATFORM_CHANNELS.listBuilds, async (): Promise<BuildRow[]> => {
    if (!session.isSignedIn()) return []
    const status = session.status()
    const workspaceId = status.workspaceId
    const localWorkspaceId = workspaceContextId(status)
    if (localWorkspaceId === PERSONAL_WORKSPACE_ID && workspaceId) {
      await installations.reassignWorkspace(workspaceId, PERSONAL_WORKSPACE_ID)
    }
    const cacheGeneration = getVersionCacheGeneration()
    const host = await resolveHost()
    const client = getBuilderClient()
    const builds = await client.listBuilds()
    const membersPromise = builds.some((build) => build.createdBy)
      ? session.listWorkspaceMembers().catch((err) => {
          console.warn('[dev-platform] Failed to resolve Build creators:', err)
          return []
        })
      : Promise.resolve([])
    if (workspaceId && session.status().workspaceId === workspaceId) {
      try {
        await installations.associateUnownedBuildInstalls(
          localWorkspaceId,
          new Set(builds.map((build) => build.id))
        )
      } catch (err) {
        console.warn('[dev-platform] Failed to associate unowned build installs:', err)
      }
    }
    const [rows, members] = await Promise.all([
      resolveBuildRows(
        client,
        host,
        builds,
        await installedBuildVersions(localWorkspaceId),
        cacheGeneration
      ),
      membersPromise
    ])
    const creatorNames = new Map(
      members.map((member) => [member.id, member.name || member.email || member.id])
    )
    _broadcastToRenderer('installations-changed', {})
    return rows.map((row) => ({
      ...row,
      ...(row.createdBy ? { creatorName: creatorNames.get(row.createdBy) || row.createdBy } : {})
    }))
  })

  ipcMain.handle(
    DEVPLATFORM_CHANNELS.installBuild,
    async (_event, request: InstallBuildRequest): Promise<InstallBuildResult> => {
      if (!session.isSignedIn()) return { ok: false, message: 'Not signed in.' }
      const status = session.status()
      const workspaceId = status.workspaceId
      if (!workspaceId) return { ok: false, message: 'No active workspace.' }
      if (!request || typeof request !== 'object') {
        return { ok: false, message: 'Invalid build install request.' }
      }
      const buildId = typeof request.buildId === 'string' ? request.buildId.trim() : ''
      if (!buildId) return { ok: false, message: 'A build is required.' }
      if (request.name !== undefined && typeof request.name !== 'string') {
        return { ok: false, message: 'Invalid instance name.' }
      }
      if (request.installRoot !== undefined && typeof request.installRoot !== 'string') {
        return { ok: false, message: 'Invalid install location.' }
      }
      const hasArtifactId = request.artifactId !== undefined
      const hasReleaseVersion = request.releaseVersion !== undefined
      if (hasArtifactId !== hasReleaseVersion) {
        return { ok: false, message: 'Invalid Build release selection.' }
      }
      const artifactId = typeof request.artifactId === 'string' ? request.artifactId.trim() : ''
      const releaseVersion = request.releaseVersion
      if (
        hasArtifactId &&
        (!artifactId ||
          typeof releaseVersion !== 'number' ||
          !Number.isInteger(releaseVersion) ||
          releaseVersion < 1)
      ) {
        return { ok: false, message: 'Invalid Build release selection.' }
      }
      const installKey = `${workspaceId}:${buildId}`
      if (installing.has(installKey)) return { ok: false, message: 'Install already starting.' }
      installing.add(installKey)
      try {
        const client = getBuilderClient()
        const builds = await client.listBuilds()
        const build = builds.find((candidate) => candidate.id === buildId)
        if (!build) return { ok: false, message: 'Build not found in the active workspace.' }
        const host = await resolveHost()
        const resolved = hasArtifactId
          ? await resolveSelectedHostArtifact(client, host, buildId, releaseVersion!, artifactId)
          : await resolveHostArtifact(client, host, buildId)
        if (!resolved) return { ok: false, message: 'No installable build for this machine.' }

        const { artifact } = resolved
        if (!normalizeSha256(artifact.archiveSha256)) {
          return { ok: false, message: 'This build has no SHA-256 integrity value.' }
        }

        const identity = await allocateInstallIdentity(
          request.name?.trim() || build.name,
          request.installRoot?.trim() || defaultInstallDir()
        )
        if (!identity.ok) return identity
        if (session.status().workspaceId !== workspaceId) {
          return { ok: false, message: 'The active workspace changed. Try again.' }
        }

        const entry = await installations.add({
          name: identity.name,
          sourceId: COMFYBUILDER_SOURCE_ID,
          sourceLabel: COMFYBUILDER_SOURCE_LABEL,
          installPath: identity.installPath,
          workspaceId: workspaceContextId(status),
          distributionId: buildId,
          distributionName: build.name,
          version: String(resolved.version),
          artifactId: artifact.id,
          artifactOs: artifact.os,
          artifactGpu: artifact.gpu,
          artifactAccelVariant: artifact.accelVariant,
          artifactSha256: artifact.archiveSha256,
          ...COMFYBUILDER_INSTALL_DEFAULTS,
          useSharedModels: false,
          status: 'installing',
          seen: false
        })

        return { ok: true, entry: { id: entry.id, name: entry.name } }
      } finally {
        installing.delete(installKey)
      }
    }
  )
}

async function installedBuildVersions(
  workspaceId: string | undefined
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!workspaceId) return map
  for (const inst of await installations.list()) {
    if (
      inst.sourceId !== COMFYBUILDER_SOURCE_ID ||
      inst.workspaceId !== workspaceId ||
      inst.status === 'failed'
    ) {
      continue
    }
    const id = inst.distributionId
    const version = Number(inst.version)
    if (typeof id !== 'string' || !id || !Number.isFinite(version)) continue
    map.set(id, Math.max(version, map.get(id) ?? Number.NEGATIVE_INFINITY))
  }
  return map
}
