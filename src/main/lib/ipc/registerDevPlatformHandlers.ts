/**
 * Dev-platform IPC bridge: the ONE seam between the renderer and the
 * cloud-auth + comfy-builder libraries.
 *
 * Auth, workspace, distribution-catalog, and install-kickoff all funnel through
 * the single main-process `CloudSession` (see `../../devplatform/session`).
 * Access/refresh tokens NEVER cross this boundary: handlers return and broadcast
 * only renderer-safe shapes: `AuthStatus`, `Workspace[]`, and distribution
 * DISPLAY rows: never a token or a download ref.
 */
import { BrowserWindow, ipcMain } from 'electron'

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
 * Push the renderer-safe {@link AuthStatus} to every window so all surfaces
 * update in lockstep. Only the status (never tokens) is sent. Exported so a
 * mid-request session expiry could announce itself later.
 */
export function broadcastAuthChanged(status: AuthStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(DEVPLATFORM_CHANNELS.authChanged, status)
  }
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

  // Bumped by signOut so a sign-in already out in the browser when the user
  // signs out cannot resurrect the session when its flow completes.
  let signOutGeneration = 0

  // Distribution ids whose install-kickoff is mid-flight, so a double-click
  // cannot create two records for the same distribution.
  const installing = new Set<string>()

  ipcMain.handle(DEVPLATFORM_CHANNELS.signIn, async (): Promise<AuthStatus> => {
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
  })

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
  // calls); the renderer already gates the grid on sign-in.
  ipcMain.handle(DEVPLATFORM_CHANNELS.listDistributions, async (): Promise<DistributionRow[]> => {
    if (!session.isSignedIn()) return []
    const host = await resolveHost()
    return listDistributionRows(getBuilderClient(), host)
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
          ...(artifact.outputSha256 ? { artifactSha256: artifact.outputSha256 } : {}),
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
}
