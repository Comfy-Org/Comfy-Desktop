/**
 * Dev-platform IPC bridge: the ONE seam between the renderer and the
 * cloud-auth + comfy-builder libraries.
 *
 * Auth, workspace, build-catalog, and install-kickoff all funnel through
 * the single main-process `CloudSession` (see `../../devplatform/session`).
 * Access/refresh tokens NEVER cross this boundary: handlers return and broadcast
 * only renderer-safe shapes: `AuthStatus`, `Workspace[]`, and build
 * DISPLAY rows: never a token or a download ref.
 *
 * `signInToCloud` is exported alongside the handlers because the title-bar file
 * menu starts sign-ins from main, with no renderer in the loop. It shares the
 * same auth broadcast as renderer-driven sign-ins.
 */
import { BrowserWindow, ipcMain, shell } from 'electron'

import { comfyWindows } from '../../host/registry'
import { normalizeSha256 } from '../../comfybuilder/integrity'
import { PLATFORM_WEB_BASE_URL } from '../../devplatform/config'
import {
  getBuilderClient,
  getCloudSession,
  setUnauthorizedHandler
} from '../../devplatform/session'
import { resolveBuildRows, resolveHost, resolveHostArtifact } from '../../devplatform/builds'
import type { BuildRow } from '../../devplatform/builds'
import { clearVersionCache, getVersionCacheGeneration } from '../../devplatform/versionCache'
import type { AuthStatus, Workspace } from '../../cloud'
import {
  installations,
  uniqueName,
  sanitizeDirName,
  allocateUniqueDir,
  findDuplicatePath,
  defaultInstallDir,
  sourceMap,
  saveSnapshot,
  loadSnapshot,
  getSnapshotCount,
  buildExportEnvelope,
  _broadcastToRenderer
} from './shared'
import type { InstallationRecord } from '../../installations'
import type { InstallBuildRequest, InstallBuildResult } from '../../../types/ipc'

/** IPC channels for the dev-platform bridge. Kept together so a rename can't desync. */
export const DEVPLATFORM_CHANNELS = {
  signIn: 'comfybuilder:signIn',
  signOut: 'comfybuilder:signOut',
  getAuthStatus: 'comfybuilder:getAuthStatus',
  authChanged: 'comfybuilder:authChanged',
  listWorkspaces: 'comfybuilder:listWorkspaces',
  switchWorkspace: 'comfybuilder:switchWorkspace',
  listBuilds: 'comfybuilder:listBuilds',
  installBuild: 'comfybuilder:installBuild',
  promoteLocalInstance: 'comfybuilder:promoteLocalInstance'
} as const

const SIGNED_OUT: AuthStatus = { signedIn: false }

const COMFYBUILDER_SOURCE_ID = 'comfybuilder'
const COMFYBUILDER_SOURCE_LABEL = 'ComfyBuilder'
const COMFYBUILDER_LAUNCH_ARGS = '--enable-manager'

export interface PromoteLocalInstanceResult {
  ok: boolean
  message?: string
}

function isPromotableLocalInstallation(inst: InstallationRecord): boolean {
  return (
    inst.status === 'installed' &&
    Boolean(inst.installPath) &&
    sourceMap[inst.sourceId]?.category === 'local' &&
    inst.sourceId !== COMFYBUILDER_SOURCE_ID &&
    !inst.workspaceId
  )
}

function validatePlatformDraftUrl(value: string): string {
  const platformOrigin = new URL(PLATFORM_WEB_BASE_URL).origin
  const url = new URL(value, PLATFORM_WEB_BASE_URL)
  if (url.protocol !== 'https:' || url.origin !== platformOrigin) {
    throw new Error('Comfy Builder returned an invalid draft URL.')
  }
  return url.toString()
}

/**
 * Push the renderer-safe {@link AuthStatus} to every surface so they update in
 * lockstep. Only the status (never tokens) is sent.
 *
 * A host window loads NO page of its own - the dashboard/chooser renderer lives
 * in a child `panelView` WebContentsView - so `BrowserWindow.getAllWindows()`
 * alone delivers to an empty webContents and the chip never repaints. That went
 * unnoticed while the only sign-in trigger was the chip itself, which set the
 * store from `signIn()`'s return value and never needed the push. Now that the
 * file menu starts sign-ins from main, this broadcast is the only path back.
 */
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
}

/**
 * Run the browser sign-in handoff and announce the result. The primitive
 * behind both the `comfybuilder:signIn` IPC and the title-bar file menu's
 * sign-in item. `CloudSession` owns browser-auth race handling.
 */
export async function signInToCloud(): Promise<AuthStatus> {
  const session = getCloudSession()
  clearVersionCache()
  const status = await session.login()
  clearVersionCache()
  broadcastAuthChanged(status)
  return status
}

/** Sign-in state for main-side surfaces that decide what to render (the file
 *  menu). Renderer surfaces read it over `getAuthStatus` instead. */
export function isSignedInToCloud(): boolean {
  return getCloudSession().status().signedIn
}

/**
 * Register the dev-platform IPC handlers. Call once at startup.
 *
 * The renderer can never pass a token in or read one out: `signIn` takes no
 * arguments and returns only the status; every catalog call reads the bearer
 * token main-side via the session's `TokenProvider`.
 */
export function registerDevPlatformHandlers(): void {
  const session = getCloudSession()
  setUnauthorizedHandler(() => {
    clearVersionCache()
    broadcastAuthChanged(SIGNED_OUT)
  })

  // Build ids whose install-kickoff is mid-flight, so a double-click cannot
  // create two records for the same build.
  const installing = new Set<string>()
  const promoting = new Set<string>()

  ipcMain.handle(DEVPLATFORM_CHANNELS.signIn, (): Promise<AuthStatus> => signInToCloud())

  ipcMain.handle(DEVPLATFORM_CHANNELS.signOut, (): AuthStatus => {
    session.logout()
    clearVersionCache()
    broadcastAuthChanged(SIGNED_OUT)
    return SIGNED_OUT
  })

  ipcMain.handle(DEVPLATFORM_CHANNELS.getAuthStatus, (): AuthStatus => session.status())

  ipcMain.handle(
    DEVPLATFORM_CHANNELS.listWorkspaces,
    (): Promise<Workspace[]> => session.listWorkspaces()
  )

  // A workspace switch re-runs sign-in pre-selecting the workspace (a PKCE token
  // is scoped at consent time), so it can open the browser and change identity:
  // broadcast the new status so every surface re-scopes together.
  ipcMain.handle(
    DEVPLATFORM_CHANNELS.switchWorkspace,
    async (_event, workspaceId: string): Promise<AuthStatus> => {
      clearVersionCache()
      const status = await session.switchWorkspace(workspaceId)
      clearVersionCache()
      broadcastAuthChanged(status)
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
        const status = session.status()
        if (!status.signedIn) return { ok: false, message: 'Not signed in.' }
        const workspaceId = status.workspaceId
        if (!workspaceId) return { ok: false, message: 'No active workspace.' }

        const inst = await installations.get(installationId)
        if (!inst) return { ok: false, message: 'Instance not found.' }
        if (!isPromotableLocalInstallation(inst)) {
          return { ok: false, message: 'This instance cannot be promoted to a workspace.' }
        }

        const filename = await saveSnapshot(inst.installPath, inst, 'manual')
        const snapshot = await loadSnapshot(inst.installPath, filename)
        const snapshotCount = await getSnapshotCount(inst.installPath)
        await installations.update(inst.id, { lastSnapshot: filename, snapshotCount })

        const current = await installations.get(installationId)
        if (!current || !isPromotableLocalInstallation(current)) {
          return { ok: false, message: 'The instance changed. Try again.' }
        }
        if (session.status().workspaceId !== workspaceId) {
          return { ok: false, message: 'The active workspace changed. Try again.' }
        }

        const envelope = buildExportEnvelope(inst.name, [{ filename, snapshot }])
        const draft = await getBuilderClient().createBuildDraft(envelope)
        if (draft.workspaceId !== workspaceId) {
          throw new Error('Comfy Builder created the draft in a different workspace.')
        }
        const latest = await installations.get(installationId)
        if (!latest || !isPromotableLocalInstallation(latest)) {
          return { ok: false, message: 'The instance changed. Try again.' }
        }
        if (session.status().workspaceId !== workspaceId) {
          return { ok: false, message: 'The active workspace changed. Try again.' }
        }
        await shell.openExternal(validatePlatformDraftUrl(draft.editUrl))
        return { ok: true }
      } catch (err) {
        console.warn('[dev-platform] Failed to promote local instance:', err)
        return { ok: false, message: (err as Error)?.message || String(err) }
      } finally {
        promoting.delete(installationId)
      }
    }
  )

  // Display rows for the current workspace. Signed out -> empty (no network
  // calls); the renderer already gates the grid on sign-in. The installed-version
  // map lets a row whose newer build runs here surface as `update-available`.
  ipcMain.handle(DEVPLATFORM_CHANNELS.listBuilds, async (): Promise<BuildRow[]> => {
    if (!session.isSignedIn()) return []
    const workspaceId = session.status().workspaceId
    const cacheGeneration = getVersionCacheGeneration()
    const host = await resolveHost()
    const client = getBuilderClient()
    const builds = await client.listBuilds()
    // Associate only unowned installs whose exact opaque id is present in the
    // successfully fetched catalog for the same active workspace.
    if (workspaceId && session.status().workspaceId === workspaceId) {
      try {
        await installations.associateUnownedBuildInstalls(
          workspaceId,
          new Set(builds.map((build) => build.id))
        )
      } catch (err) {
        console.warn('[dev-platform] Failed to associate unowned build installs:', err)
      }
    }
    const rows = await resolveBuildRows(
      client,
      host,
      builds,
      await installedBuildVersions(workspaceId),
      cacheGeneration
    )
    // Catalog reads warm the synchronous source update cache. Re-pull
    // installations so existing managed instances gain their Update action.
    _broadcastToRenderer('installations-changed', {})
    return rows
  })

  // Resolve the host artifact for one build and create an `installing`
  // record, then hand the id back so the renderer runs the normal
  // `installInstance` + progress flow. The install itself (download -> verify
  // sha -> extract) runs in the comfybuilder SourcePlugin.
  ipcMain.handle(
    DEVPLATFORM_CHANNELS.installBuild,
    async (_event, request: InstallBuildRequest): Promise<InstallBuildResult> => {
      if (!session.isSignedIn()) return { ok: false, message: 'Not signed in.' }
      const workspaceId = session.status().workspaceId
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
      const installKey = `${workspaceId}:${buildId}`
      if (installing.has(installKey)) return { ok: false, message: 'Install already starting.' }
      installing.add(installKey)
      try {
        // The in-flight set only covers one handler invocation: a repeat call
        // after this one returns (but before the renderer's install starts)
        // would otherwise create a second record for the same build.
        // Failed records don't block: retrying those goes through their own
        // install tile, and startup recovery demotes stale `installing` ones.
        const existing = (await installations.list()).find(
          (inst) =>
            inst.sourceId === COMFYBUILDER_SOURCE_ID &&
            inst.workspaceId === workspaceId &&
            inst.distributionId === buildId &&
            inst.status !== 'failed'
        )
        if (existing) {
          return { ok: false, message: `"${existing.name}" already installs this build.` }
        }
        const client = getBuilderClient()
        const builds = await client.listBuilds()
        const build = builds.find((candidate) => candidate.id === buildId)
        if (!build) return { ok: false, message: 'Build not found in the active workspace.' }
        const host = await resolveHost()
        const resolved = await resolveHostArtifact(client, host, buildId)
        if (!resolved) return { ok: false, message: 'No installable build for this machine.' }

        const { artifact } = resolved
        if (!normalizeSha256(artifact.archiveSha256)) {
          return { ok: false, message: 'This build has no SHA-256 integrity value.' }
        }

        const requestedName = request.name?.trim()
        const displayName = await uniqueName(requestedName || build.name)

        const installRoot = request.installRoot?.trim() || defaultInstallDir()
        const installPath = allocateUniqueDir(installRoot, sanitizeDirName(displayName))
        const duplicate = await findDuplicatePath(installPath)
        if (duplicate)
          return { ok: false, message: `That directory is already used by "${duplicate.name}".` }
        if (session.status().workspaceId !== workspaceId) {
          return { ok: false, message: 'The active workspace changed. Try again.' }
        }

        const entry = await installations.add({
          name: displayName,
          sourceId: COMFYBUILDER_SOURCE_ID,
          sourceLabel: COMFYBUILDER_SOURCE_LABEL,
          installPath,
          workspaceId,
          distributionId: buildId,
          distributionName: build.name,
          version: String(resolved.version),
          artifactId: artifact.id,
          artifactOs: artifact.os,
          artifactGpu: artifact.gpu,
          artifactAccelVariant: artifact.accelVariant,
          artifactSha256: artifact.archiveSha256,
          launchArgs: COMFYBUILDER_LAUNCH_ARGS,
          launchMode: 'window',
          browserPartition: 'unique',
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

/** Persisted build id -> highest installed version, over the comfybuilder
 *  installs, so `listBuildRows` can mark an outdated one `update-available`.
 *  The installation schema retains the legacy `distributionId` field name. */
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
