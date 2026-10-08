/**
 * CloudSession - the one object the app (and its UI) drives for auth + workspace.
 *
 * Ties the PKCE flow, the encrypted token store, and the workspace client into a
 * single facade, and exposes a {@link TokenProvider} so the comfy-builder client
 * can pull a fresh bearer token without ever seeing the store. Tokens never leave
 * the main process; the UI only ever gets {@link AuthStatus} + {@link Workspace}.
 */
import type { TokenProvider } from '../comfybuilder'
import { workspaceIdOf } from './claims'
import type { OAuthOptions } from './oauth'
import { openAuthorizePage, refresh, signIn } from './oauth'
import {
  activateWorkspace,
  clearTokens,
  getAuthStatus,
  loadTokens,
  loadWorkspaceTokens,
  replaceWorkspaceTokens,
  saveTokens,
  saveWorkspaceNames
} from './tokenStore'
import type { AuthStatus, AuthTokens, Workspace, WorkspaceMember } from './types'
import { listWorkspaceMembers, listWorkspaces } from './workspaces'

/** Refresh an access token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 60_000

export class CloudSession {
  /** Refresh rotations are single-flight per workspace token family. */
  private readonly refreshing = new Map<string, Promise<AuthTokens | null>>()
  private loginInFlight: Promise<AuthStatus> | null = null
  private loginAuthorizeUrl: string | null = null

  /** Latest browser-auth intent. Older flows may finish, but cannot replace
   *  tokens chosen by a newer login, workspace switch, or logout. */
  private authGeneration = 0

  /** Start the PKCE sign-in (system browser); persists tokens on success.
   *  A repeat request while one is pending reopens its browser page, since the
   *  user may have closed it or hit an IdP error there. */
  login(): Promise<AuthStatus> {
    if (this.loginInFlight) {
      if (this.loginAuthorizeUrl) void openAuthorizePage(this.loginAuthorizeUrl).catch(() => {})
      return this.loginInFlight
    }
    const generation = ++this.authGeneration
    const login = this.authenticateAtGeneration(generation, {
      onAuthorizeUrl: (url) => {
        if (generation === this.authGeneration) this.loginAuthorizeUrl = url
      }
    }).finally(() => {
      if (this.loginInFlight === login) this.clearPendingLogin()
    })
    this.loginInFlight = login
    return login
  }

  private clearPendingLogin(): void {
    this.loginInFlight = null
    this.loginAuthorizeUrl = null
  }

  /** Forget tokens. Installed environments are untouched. */
  logout(): void {
    this.authGeneration += 1
    this.clearPendingLogin()
    clearTokens()
  }

  status(): AuthStatus {
    return getAuthStatus()
  }

  isSignedIn(): boolean {
    return getAuthStatus().signedIn
  }

  /** The workspace the active token is scoped to, or null when signed out. */
  currentWorkspaceId(): string | null {
    const t = loadTokens()
    return t ? workspaceIdOf(t.accessToken) : null
  }

  /**
   * A valid access token, refreshing it first if it is expired (or about to be)
   * and a refresh token is available. Null when signed out or the refresh fails.
   */
  async getAccessToken(): Promise<string | null> {
    const tokens = loadTokens()
    if (!tokens) return null
    if (tokens.expiresAt - REFRESH_SKEW_MS > Date.now() || !tokens.refreshToken)
      return tokens.accessToken
    const workspaceId = workspaceIdOf(tokens.accessToken)
    await this.refreshWorkspaceTokens(workspaceId, tokens)
    const active = loadTokens()
    return active && workspaceIdOf(active.accessToken) === workspaceId ? active.accessToken : null
  }

  private refreshKey(workspaceId: string | null, refreshToken: string): string {
    return `${workspaceId === null ? 'default' : `workspace:${workspaceId}`}\0${refreshToken}`
  }

  private refreshWorkspaceTokens(
    workspaceId: string | null,
    tokens: AuthTokens
  ): Promise<AuthTokens | null> {
    const key = this.refreshKey(workspaceId, tokens.refreshToken ?? '')
    const inFlight = this.refreshing.get(key)
    if (inFlight) return inFlight
    const refreshing = this.doRefresh(workspaceId, tokens).finally(() => {
      if (this.refreshing.get(key) === refreshing) this.refreshing.delete(key)
    })
    this.refreshing.set(key, refreshing)
    return refreshing
  }

  private async doRefresh(
    workspaceId: string | null,
    tokens: AuthTokens
  ): Promise<AuthTokens | null> {
    const refreshToken = tokens.refreshToken
    if (!refreshToken) return tokens
    try {
      const rotated = await refresh(refreshToken)
      const saved = replaceWorkspaceTokens(workspaceId, tokens.accessToken, refreshToken, rotated)
      return saved ? rotated : loadWorkspaceTokens(workspaceId)
    } catch {
      return loadWorkspaceTokens(workspaceId)
    }
  }

  /** The signed-in user's workspaces; unavailable catalogs reject rather than imply removal. */
  async listWorkspaces(): Promise<Workspace[]> {
    const token = await this.getAccessToken()
    if (!token) return []
    const workspaces = await listWorkspaces(token)
    saveWorkspaceNames(token, workspaces)
    return workspaces
  }

  /** Members of the active workspace, used to resolve Builder creator ids. */
  async listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    const token = await this.getAccessToken()
    if (!token) return []
    return listWorkspaceMembers(token)
  }

  /** Activate cached workspace credentials, using browser auth only when needed. */
  async switchWorkspace(workspaceId: string): Promise<AuthStatus> {
    this.clearPendingLogin()
    const generation = ++this.authGeneration
    const current = loadTokens()
    let cached =
      current && workspaceIdOf(current.accessToken) === workspaceId
        ? current
        : loadWorkspaceTokens(workspaceId)
    if (cached?.refreshToken && cached.expiresAt - REFRESH_SKEW_MS <= Date.now()) {
      cached = await this.refreshWorkspaceTokens(workspaceId, cached)
    }
    if (generation !== this.authGeneration) return this.status()
    if (cached && cached.expiresAt > Date.now()) {
      if (cached !== current) activateWorkspace(workspaceId)
      return this.status()
    }
    return this.authenticateAtGeneration(generation, { workspaceId })
  }

  private async authenticateAtGeneration(
    generation: number,
    options: OAuthOptions
  ): Promise<AuthStatus> {
    const { workspaceId } = options
    const { tokens, status } = await signIn(options)
    if (generation !== this.authGeneration) return this.status()
    if (workspaceId && status.workspaceId !== workspaceId) return this.status()
    saveTokens(tokens)
    return status
  }

  /** Adapter for the comfy-builder client's auth seam. */
  asTokenProvider(onSignedOut?: () => void): TokenProvider {
    return {
      getAccessToken: () => this.getAccessToken(),
      onUnauthorized: (rejectedAccessToken) => {
        // A request issued before a newer login may return 401 afterward. Only
        // invalidate the exact token the server rejected, never the new session.
        if (loadTokens()?.accessToken !== rejectedAccessToken) return
        this.logout()
        onSignedOut?.()
      }
    }
  }
}
