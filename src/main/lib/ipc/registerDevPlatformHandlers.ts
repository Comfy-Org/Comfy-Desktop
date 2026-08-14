/**
 * Dev-platform IPC bridge: the ONE seam between the renderer and the
 * cloud-auth + comfy-builder libraries.
 *
 * Auth, workspace, distribution-catalog, and install-kickoff all funnel through
 * the single main-process `CloudSession` (see `../../devplatform/session`).
 * Access/refresh tokens NEVER cross this boundary: handlers return and broadcast
 * only renderer-safe shapes: `AuthStatus`, `Workspace[]`, and distribution
 * DISPLAY rows: never a token or a download ref.
 *
 * `signInToCloud` is exported alongside the handlers because the title-bar file
 * menu starts sign-ins from main, with no renderer in the loop. It shares the
 * same auth broadcast as renderer-driven sign-ins.
 */
import { BrowserWindow, ipcMain } from 'electron'

import { comfyWindows } from '../../host/registry'
import { normalizeSha256 } from '../../comfybuilder/integrity'
import {
  getBuilderClient,
  getCloudSession,
  setUnauthorizedHandler
} from '../../devplatform/session'
import {
  listDistributionRows,
  resolveHost,
  resolveHostArtifact
} from '../../devplatform/distributions'
import type { DistributionRow } from '../../devplatform/distributions'
import { clearVersionCache, getVersionCacheGeneration } from '../../devplatform/versionCache'
import type { AuthStatus, Workspace } from '../../cloud'
import {
  installations,
  uniqueName,
  sanitizeDirName,
  allocateUniqueDir,
  findDuplicatePath,
  defaultInstallDir,
  _broadcastToRenderer
} from './shared'

/** IPC channels for the dev-platform bridge. Kept together so a rename can't desync. */
export const DEVPLATFORM_CHANNELS = {
  signIn: 'comfybuilder:signIn',
  signOut: 'comfybuilder:signOut',
  getAuthStatus: 'comfybuilder:getAuthStatus',
  authChanged: 'comfybuilder:authChanged',
  listWorkspaces: 'comfybuilder:listWorkspaces',
  switchWorkspace: 'comfybuilder:switchWorkspace',
  listDistributions: 'comfybuilder:listDistributions',
  installDistribution: 'comfybuilder:installDistribution'
} as const

const SIGNED_OUT: AuthStatus = { signedIn: false }

const COMFYBUILDER_SOURCE_ID = 'comfybuilder'
const COMFYBUILDER_SOURCE_LABEL = 'ComfyBuilder'
const COMFYBUILDER_LAUNCH_ARGS = '--enable-manager'

/** Result of an install-kickoff: mirrors the `add-installation` handler's shape
 *  so the renderer can drive the same `installInstance` + progress UI. */
export interface InstallDistributionResult {
  ok: boolean
  message?: string
  entry?: { id: string; name: string }
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

  // Distribution ids whose install-kickoff is mid-flight, so a double-click
  // cannot create two records for the same distribution.
  const installing = new Set<string>()

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

  // Display rows for the current workspace. Signed out -> empty (no network
  // calls); the renderer already gates the grid on sign-in. The installed-version
  // map lets a row whose newer build runs here surface as `update-available`.
  ipcMain.handle(DEVPLATFORM_CHANNELS.listDistributions, async (): Promise<DistributionRow[]> => {
    if (!session.isSignedIn()) return []
    const cacheGeneration = getVersionCacheGeneration()
    const host = await resolveHost()
    const rows = await listDistributionRows(
      getBuilderClient(),
      host,
      await installedDistributionVersions(),
      cacheGeneration
    )
    // Catalog reads warm the synchronous source update cache. Re-pull
    // installations so existing distribution tiles gain their Update action.
    _broadcastToRenderer('installations-changed', {})
    return rows
  })

  // Resolve the host artifact for one distribution and create an `installing`
  // record, then hand the id back so the renderer runs the normal
  // `installInstance` + progress flow. The install itself (download -> verify
  // sha -> extract) runs in the comfybuilder SourcePlugin.
  ipcMain.handle(
    DEVPLATFORM_CHANNELS.installDistribution,
    async (_event, distributionId: string): Promise<InstallDistributionResult> => {
      if (!session.isSignedIn()) return { ok: false, message: 'Not signed in.' }
      if (installing.has(distributionId)) return { ok: false, message: 'Install already starting.' }
      installing.add(distributionId)
      try {
        const client = getBuilderClient()
        const host = await resolveHost()
        const resolved = await resolveHostArtifact(client, host, distributionId)
        if (!resolved) return { ok: false, message: 'No installable build for this machine.' }

        const { artifact } = resolved
        if (!normalizeSha256(artifact.archiveSha256)) {
          return { ok: false, message: 'This build has no SHA-256 integrity value.' }
        }

        // Name the install after the distribution. One extra list call keeps the
        // renderer from having to pass a (spoofable) display name back to main.
        const dists = await client.listDistributions()
        const dist = dists.find((d) => d.id === distributionId)
        const displayName = await uniqueName(dist?.name ?? distributionId)

        const installPath = allocateUniqueDir(defaultInstallDir(), sanitizeDirName(displayName))
        const duplicate = await findDuplicatePath(installPath)
        if (duplicate)
          return { ok: false, message: `That directory is already used by "${duplicate.name}".` }

        const entry = await installations.add({
          name: displayName,
          sourceId: COMFYBUILDER_SOURCE_ID,
          sourceLabel: COMFYBUILDER_SOURCE_LABEL,
          installPath,
          distributionId,
          distributionName: dist?.name ?? distributionId,
          version: String(resolved.version),
          artifactId: artifact.id,
          artifactOs: artifact.os,
          artifactGpu: artifact.gpu,
          artifactAccelVariant: artifact.accelVariant,
          artifactSha256: artifact.archiveSha256,
          launchArgs: COMFYBUILDER_LAUNCH_ARGS,
          launchMode: 'window',
          browserPartition: 'unique',
          status: 'installing',
          seen: false
        })

        return { ok: true, entry: { id: entry.id, name: entry.name } }
      } finally {
        installing.delete(distributionId)
      }
    }
  )
}

/** distributionId -> highest installed version, over the comfybuilder installs,
 *  so `listDistributionRows` can mark an outdated one `update-available`. */
async function installedDistributionVersions(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const inst of await installations.list()) {
    if (inst.sourceId !== COMFYBUILDER_SOURCE_ID) continue
    const id = inst.distributionId
    const version = Number(inst.version)
    if (typeof id !== 'string' || !id || !Number.isFinite(version)) continue
    map.set(id, Math.max(version, map.get(id) ?? Number.NEGATIVE_INFINITY))
  }
  return map
}
