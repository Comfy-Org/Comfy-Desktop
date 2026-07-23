/**
 * CloudSession — the one object the app (and its UI) drives for auth + workspace.
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

  /** Start the PKCE sign-in (system browser); persists tokens on success. */
  async login(): Promise<AuthStatus> {
    const { tokens, status } = await signIn()
    saveTokens(tokens)
    return status
  }

  /** Forget tokens. Installed environments are untouched. */
  logout(): void {
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
    if (tokens.expiresAt - REFRESH_SKEW_MS > Date.now() || !tokens.refreshToken) return tokens.accessToken
    // Single-flight: the first caller runs the refresh, the rest await it.
    if (!this.refreshing) {
      this.refreshing = this.doRefresh(tokens.refreshToken).finally(() => { this.refreshing = null })
    }
    return this.refreshing
  }

  private async doRefresh(refreshToken: string): Promise<string | null> {
    try {
      const rotated = await refresh(refreshToken)
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
    const { tokens, status } = await signIn({ workspaceId })
    saveTokens(tokens)
    return status
  }

  /** Adapter for the comfy-builder client's auth seam. */
  asTokenProvider(): TokenProvider {
    return {
      getAccessToken: () => this.getAccessToken(),
      onUnauthorized: () => this.logout(),
    }
  }
}
