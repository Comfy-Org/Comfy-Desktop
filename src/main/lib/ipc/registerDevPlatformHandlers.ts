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
 * menu starts sign-ins from main, with no renderer in the loop — it has to share
 * this module's sign-out race guard rather than call `session.login()` raw.
 */
import { BrowserWindow, ipcMain } from 'electron'

import { comfyWindows } from '../../host/registry'
import { getBuilderClient, getCloudSession } from '../../devplatform/session'
import {
  listDistributionRows,
  resolveHost,
  resolveHostArtifact,
} from '../../devplatform/distributions'
import type { DistributionRow } from '../../devplatform/distributions'
import type { AuthStatus, Workspace } from '../../cloud'
import {
  installations,
  uniqueName,
  sanitizeDirName,
  allocateUniqueDir,
  findDuplicatePath,
  defaultInstallDir,
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
  installDistribution: 'comfybuilder:installDistribution',
  updateDistribution: 'comfybuilder:updateDistribution',
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
 * A host window loads NO page of its own — the dashboard/chooser renderer lives
 * in a child `panelView` WebContentsView — so `BrowserWindow.getAllWindows()`
 * alone delivers to an empty webContents and the chip never repaints. That went
 * unnoticed while the only sign-in trigger was the chip itself, which set the
 * store from `signIn()`'s return value and never needed the push. Now that the
 * file menu starts sign-ins from main, this broadcast is the only path back.
 */
export function broadcastAuthChanged(status: AuthStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(DEVPLATFORM_CHANNELS.authChanged, status)
  }
  for (const entry of comfyWindows.values()) {
    const panel = entry.panelView
    if (panel && !panel.webContents.isDestroyed())
      panel.webContents.send(DEVPLATFORM_CHANNELS.authChanged, status)
  }
}

// Bumped by signOut so a sign-in already out in the browser when the user
// signs out cannot resurrect the session when its flow completes. Module
// scope, not per-registration: the file menu starts sign-ins in main without
// the renderer in the loop, and a second counter would let a sign-out miss
// the flow the other call site started.
let signOutGeneration = 0

/**
 * Run the browser sign-in handoff and announce the result. The primitive
 * behind BOTH the `comfybuilder:signIn` IPC and the title-bar file menu's
 * sign-in item, so both observe the same sign-out race guard.
 */
export async function signInToCloud(): Promise<AuthStatus> {
  const session = getCloudSession()
  const generation = signOutGeneration
  const status = await session.login()
  // Signed out while the browser flow was in flight: the login persisted
  // tokens, so drop them rather than leave a session the user tried to kill.
  if (generation !== signOutGeneration) {
    session.logout()
    return SIGNED_OUT
  }
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

  // Distribution ids whose install-kickoff is mid-flight, so a double-click
  // cannot create two records for the same distribution.
  const installing = new Set<string>()

  ipcMain.handle(DEVPLATFORM_CHANNELS.signIn, (): Promise<AuthStatus> => signInToCloud())

  ipcMain.handle(DEVPLATFORM_CHANNELS.signOut, (): AuthStatus => {
    signOutGeneration += 1
    session.logout()
    broadcastAuthChanged(SIGNED_OUT)
    return SIGNED_OUT
  })

  ipcMain.handle(DEVPLATFORM_CHANNELS.getAuthStatus, (): AuthStatus => session.status())

  ipcMain.handle(DEVPLATFORM_CHANNELS.listWorkspaces, (): Promise<Workspace[]> => session.listWorkspaces())

  // A workspace switch re-runs sign-in pre-selecting the workspace (a PKCE token
  // is scoped at consent time), so it can open the browser and change identity:
  // broadcast the new status so every surface re-scopes together.
  ipcMain.handle(DEVPLATFORM_CHANNELS.switchWorkspace, async (_event, workspaceId: string): Promise<AuthStatus> => {
    const generation = signOutGeneration
    const status = await session.switchWorkspace(workspaceId)
    if (generation !== signOutGeneration) {
      session.logout()
      return SIGNED_OUT
    }
    broadcastAuthChanged(status)
    return status
  })

  // Display rows for the current workspace. Signed out → empty (no network
  // calls); the renderer already gates the grid on sign-in. The installed-version
  // map lets a row whose newer build runs here surface as `update-available`.
  ipcMain.handle(DEVPLATFORM_CHANNELS.listDistributions, async (): Promise<DistributionRow[]> => {
    if (!session.isSignedIn()) return []
    const host = await resolveHost()
    return listDistributionRows(getBuilderClient(), host, await installedDistributionVersions())
  })

  // Resolve the host artifact for one distribution and create an `installing`
  // record, then hand the id back so the renderer runs the normal
  // `installInstance` + progress flow. The install itself (download → verify
  // sha → extract) runs in the comfybuilder SourcePlugin.
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

        // Name the install after the distribution. One extra list call keeps the
        // renderer from having to pass a (spoofable) display name back to main.
        const dists = await client.listDistributions()
        const dist = dists.find((d) => d.id === distributionId)
        const displayName = await uniqueName(dist?.name ?? distributionId)

        const installPath = allocateUniqueDir(defaultInstallDir(), sanitizeDirName(displayName))
        const duplicate = await findDuplicatePath(installPath)
        if (duplicate) return { ok: false, message: `That directory is already used by "${duplicate.name}".` }

        const { artifact } = resolved
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
          // May be absent until the builder populates it: carried through
          // verbatim so `installArtifact` verifies whenever a hash is present.
          ...(artifact.archiveSha256 ? { artifactSha256: artifact.archiveSha256 } : {}),
          launchArgs: COMFYBUILDER_LAUNCH_ARGS,
          launchMode: 'window',
          browserPartition: 'unique',
          status: 'installing',
          seen: false,
        })

        return { ok: true, entry: { id: entry.id, name: entry.name } }
      } finally {
        installing.delete(distributionId)
      }
    },
  )

  // Update an installed distribution to its latest host-compatible version:
  // re-point the EXISTING record at the new artifact + version and hand the id
  // back so the renderer drives the same `installInstance` + progress flow. The
  // plugin lays down a clean venv on re-install; staged models are preserved.
  ipcMain.handle(
    DEVPLATFORM_CHANNELS.updateDistribution,
    async (_event, distributionId: string): Promise<InstallDistributionResult> => {
      if (!session.isSignedIn()) return { ok: false, message: 'Not signed in.' }
      if (installing.has(distributionId)) return { ok: false, message: 'Update already starting.' }
      installing.add(distributionId)
      try {
        const client = getBuilderClient()
        const host = await resolveHost()
        const resolved = await resolveHostArtifact(client, host, distributionId)
        if (!resolved) return { ok: false, message: 'No installable build for this machine.' }

        const existing = (await installations.list()).find(
          (i) => i.sourceId === COMFYBUILDER_SOURCE_ID && i.distributionId === distributionId,
        )
        if (!existing) return { ok: false, message: 'This distribution is not installed.' }

        const { artifact } = resolved
        const updated = await installations.update(existing.id, {
          version: String(resolved.version),
          artifactId: artifact.id,
          artifactOs: artifact.os,
          artifactGpu: artifact.gpu,
          artifactAccelVariant: artifact.accelVariant,
          ...(artifact.archiveSha256 ? { artifactSha256: artifact.archiveSha256 } : {}),
          status: 'installing',
        })
        if (!updated) return { ok: false, message: 'This distribution is not installed.' }

        return { ok: true, entry: { id: updated.id, name: updated.name } }
      } finally {
        installing.delete(distributionId)
      }
    },
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
