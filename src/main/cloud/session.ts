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
import { openAuthorizePage, refresh } from './oauth'
import {
  mintPartnerNodeToken,
  mintWorkspaceToken,
  revokeAccountSession,
  signInAccount
} from './accountSession'
import { SignInFailure } from './signInFailure'
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
  private readonly partnerTokens = new Map<
    string,
    {
      credential: string
      pending: Promise<string | null>
      expiresAt: number
    }
  >()
  private loginInFlight: Promise<AuthStatus> | null = null
  private loginAuthorizeUrl: string | null = null
  private loginAbort: AbortController | null = null

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
    this.loginAbort?.abort()
    this.loginAbort = null
    this.loginInFlight = null
    this.loginAuthorizeUrl = null
  }

  /** Clear local credentials and request server sign-out. */
  async logout(): Promise<void> {
    this.authGeneration += 1
    this.partnerTokens.clear()
    this.clearPendingLogin()
    const sessionToken = loadTokens()?.sessionToken
    clearTokens()
    if (sessionToken) await revokeAccountSession(sessionToken)
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
    if (tokens.expiresAt - REFRESH_SKEW_MS > Date.now()) return tokens.accessToken
    const workspaceId = workspaceIdOf(tokens.accessToken)
    await this.refreshWorkspaceTokens(workspaceId, tokens)
    const active = loadTokens()
    return active &&
      active.expiresAt > Date.now() &&
      workspaceIdOf(active.accessToken) === workspaceId
      ? active.accessToken
      : null
  }

  private refreshKey(workspaceId: string | null, refreshToken: string): string {
    return `${workspaceId === null ? 'default' : `workspace:${workspaceId}`}\0${refreshToken}`
  }

  private refreshWorkspaceTokens(
    workspaceId: string | null,
    tokens: AuthTokens
  ): Promise<AuthTokens | null> {
    const key = this.refreshKey(workspaceId, tokens.sessionToken ?? tokens.refreshToken ?? '')
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
    if (!refreshToken && !tokens.sessionToken) return null
    try {
      const rotated = tokens.sessionToken
        ? await mintWorkspaceToken(tokens.sessionToken, workspaceId ?? undefined)
        : await refresh(refreshToken!)
      const saved = replaceWorkspaceTokens(workspaceId, tokens.accessToken, refreshToken, rotated)
      return saved ? rotated : loadWorkspaceTokens(workspaceId)
    } catch (error) {
      if (
        error instanceof SignInFailure &&
        error.httpStatus === 401 &&
        loadTokens()?.sessionToken === tokens.sessionToken &&
        tokens.sessionToken
      ) {
        this.invalidateStoredSession()
        return null
      }
      const cached = loadWorkspaceTokens(workspaceId)
      return cached && cached.expiresAt > Date.now() ? cached : null
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

  /** Select a workspace through the account session, or migrate a legacy login. */
  async switchWorkspace(workspaceId: string): Promise<AuthStatus> {
    this.clearPendingLogin()
    const generation = ++this.authGeneration
    const current = loadTokens()
    if (current?.sessionToken) {
      let tokens: AuthTokens
      try {
        tokens = await mintWorkspaceToken(current.sessionToken, workspaceId)
      } catch (error) {
        if (
          error instanceof SignInFailure &&
          error.httpStatus === 401 &&
          generation === this.authGeneration &&
          loadTokens()?.sessionToken === current.sessionToken
        ) {
          this.invalidateStoredSession()
          return this.status()
        }
        throw error
      }
      if (
        generation === this.authGeneration &&
        loadTokens()?.sessionToken === current.sessionToken
      ) {
        if (workspaceIdOf(tokens.accessToken) !== workspaceId) {
          throw new SignInFailure('Unexpected workspace in token response', 'server_error')
        }
        saveTokens(tokens)
      }
      return this.status()
    }
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
    options: { workspaceId?: string; onAuthorizeUrl?: (url: string) => void }
  ): Promise<AuthStatus> {
    const controller = new AbortController()
    this.loginAbort?.abort()
    this.loginAbort = controller
    let tokens: AuthTokens
    try {
      tokens = await signInAccount(options.onAuthorizeUrl ?? (() => {}), controller.signal)
    } catch (error) {
      if (generation !== this.authGeneration) return this.status()
      throw error
    }
    if (generation !== this.authGeneration) {
      if (tokens.sessionToken) await revokeAccountSession(tokens.sessionToken).catch(() => {})
      return this.status()
    }
    try {
      if (options.workspaceId && tokens.sessionToken) {
        tokens = await mintWorkspaceToken(
          tokens.sessionToken,
          options.workspaceId,
          controller.signal
        )
      }
      if (options.workspaceId && workspaceIdOf(tokens.accessToken) !== options.workspaceId) {
        throw new SignInFailure('Unexpected workspace in login response', 'server_error')
      }
      if (generation !== this.authGeneration) {
        if (tokens.sessionToken) await revokeAccountSession(tokens.sessionToken).catch(() => {})
        return this.status()
      }
    } catch (error) {
      if (tokens.sessionToken) await revokeAccountSession(tokens.sessionToken).catch(() => {})
      if (generation !== this.authGeneration) return this.status()
      throw error
    }
    const previous = loadTokens()?.sessionToken
    this.partnerTokens.clear()
    clearTokens()
    saveTokens(tokens)
    if (previous && previous !== tokens.sessionToken)
      void revokeAccountSession(previous).catch(() => {})
    return this.status()
  }

  async getPartnerNodeToken(workspaceId: string): Promise<string | null> {
    const generation = this.authGeneration
    let tokens = loadTokens()
    if (!tokens || workspaceIdOf(tokens.accessToken) !== workspaceId) return null
    if (!tokens.sessionToken) {
      if (!(await this.getAccessToken()) || generation !== this.authGeneration) return null
      tokens = loadTokens()
      if (!tokens || workspaceIdOf(tokens.accessToken) !== workspaceId) return null
    }
    const credential = tokens.sessionToken ?? tokens.accessToken
    let entry = this.partnerTokens.get(workspaceId)
    if (!entry || entry.credential !== credential || entry.expiresAt <= Date.now()) {
      const pending = mintPartnerNodeToken(credential, workspaceId)
        .then(
          (token) => {
            if (workspaceIdOf(token.accessToken) !== workspaceId) return null
            created.expiresAt = token.expiresAt - REFRESH_SKEW_MS
            return token.accessToken
          },
          () => null
        )
        .then((token) => {
          if (!token) created.expiresAt = Date.now() + 5_000
          return token
        })
      const created = { credential, pending, expiresAt: Infinity }
      entry = created
      this.partnerTokens.set(workspaceId, entry)
    }
    const token = await entry.pending
    return generation === this.authGeneration && this.currentWorkspaceId() === workspaceId
      ? token
      : null
  }

  private invalidateStoredSession(): void {
    this.partnerTokens.clear()
    clearTokens()
  }

  /** Adapter for the comfy-builder client's auth seam. */
  asTokenProvider(onSignedOut?: () => void): TokenProvider {
    return {
      getAccessToken: () => this.getAccessToken(),
      onUnauthorized: (rejectedAccessToken) => {
        // A request issued before a newer login may return 401 afterward. Only
        // invalidate the exact token the server rejected, never the new session.
        if (loadTokens()?.accessToken !== rejectedAccessToken) return
        this.invalidateStoredSession()
        onSignedOut?.()
      }
    }
  }
}
