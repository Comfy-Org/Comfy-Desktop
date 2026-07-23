/**
 * Cloud auth + workspace functionality library — public surface.
 *
 * Standalone, UI-agnostic (no IPC/Vue): the login flow, an encrypted token
 * store, and the workspace client, tied together by {@link CloudSession}. It
 * pairs with the comfy-builder client — `session.asTokenProvider()` is the
 * `TokenProvider` that client consumes — so the UI plugs both together:
 *
 * ```ts
 * const session = new CloudSession()
 * await session.login()                                   // system-browser PKCE
 * const workspaces = await session.listWorkspaces()       // choose workspace
 * await session.switchWorkspace(chosen.id)                // re-auth, scoped
 * const client = new ComfyBuilderClient({ auth: session.asTokenProvider() })
 * const dists = await client.listDistributions()          // scoped to that workspace
 * ```
 */
export { CloudSession } from './session'
export { signIn, refresh } from './oauth'
export { listWorkspaces } from './workspaces'
export { getAuthStatus, loadTokens, saveTokens, clearTokens } from './tokenStore'
export { statusFromAccessToken, workspaceIdOf } from './claims'
export { CLOUD_CONFIG, CLOUD_ISSUER } from './config'
export type { AuthStatus, AuthTokens, Workspace } from './types'
