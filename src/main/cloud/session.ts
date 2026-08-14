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
import { refresh, signIn } from './oauth'
import { clearTokens, getAuthStatus, loadTokens, saveTokens } from './tokenStore'
import type { AuthStatus, Workspace } from './types'
import { listWorkspaces } from './workspaces'

/** Refresh an access token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 60_000

export class CloudSession {
  /** Deduped in-flight refresh: parallel callers share one rotation so they
   *  never race the refresh token (a race can revoke the whole token family). */
  private refreshing: Promise<string | null> | null = null
  private loginInFlight: Promise<AuthStatus> | null = null

  /** Latest browser-auth intent. Older flows may finish, but cannot replace
   *  tokens chosen by a newer login, workspace switch, or logout. */
  private authGeneration = 0

  /** Start the PKCE sign-in (system browser); persists tokens on success. */
  login(): Promise<AuthStatus> {
    if (this.loginInFlight) return this.loginInFlight
    const login = this.authenticate().finally(() => {
      if (this.loginInFlight === login) this.loginInFlight = null
    })
    this.loginInFlight = login
    return login
  }

  /** Forget tokens. Installed environments are untouched. */
  logout(): void {
    this.authGeneration += 1
    this.loginInFlight = null
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
    // Single-flight: the first caller runs the refresh, the rest await it.
    if (!this.refreshing) {
      this.refreshing = this.doRefresh(tokens.accessToken, tokens.refreshToken).finally(() => {
        this.refreshing = null
      })
    }
    return this.refreshing
  }

  private async doRefresh(accessToken: string, refreshToken: string): Promise<string | null> {
    try {
      const rotated = await refresh(refreshToken)
      // Refresh is a compare-and-swap against the token pair that started it.
      // Logout or a newer browser auth may complete while the request is in
      // flight; that newer intent must never be overwritten by this response.
      const current = loadTokens()
      if (
        !current ||
        current.accessToken !== accessToken ||
        current.refreshToken !== refreshToken
      ) {
        return current?.accessToken ?? null
      }
      saveTokens(rotated)
      return rotated.accessToken
    } catch {
      // Refresh failed: fall back to the current token and let the caller's 401
      // handling take over. Re-read in case another flow updated it meanwhile.
      return loadTokens()?.accessToken ?? null
    }
  }

  /** The signed-in user's workspaces (empty when signed out or team-workspaces off). */
  async listWorkspaces(): Promise<Workspace[]> {
    const token = await this.getAccessToken()
    if (!token) return []
    return listWorkspaces(token)
  }

  /**
   * Switch the active workspace. A PKCE cloud token is scoped at consent time, so
   * this re-runs sign-in pre-selecting the workspace (no silent re-scope exists).
   */
  async switchWorkspace(workspaceId: string): Promise<AuthStatus> {
    this.loginInFlight = null
    return this.authenticate(workspaceId)
  }

  private async authenticate(workspaceId?: string): Promise<AuthStatus> {
    const generation = ++this.authGeneration
    const { tokens, status } = workspaceId ? await signIn({ workspaceId }) : await signIn()
    if (generation !== this.authGeneration) return this.status()
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
