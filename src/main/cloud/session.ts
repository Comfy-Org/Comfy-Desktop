import type { TokenProvider } from '../comfybuilder'
import { subjectOf, workspaceIdOf } from './claims'
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

const REFRESH_SKEW_MS = 60_000

export class CloudSession {
  private readonly refreshing = new Map<string, Promise<AuthTokens | null>>()
  private loginInFlight: Promise<AuthStatus> | null = null
  private loginAuthorizeUrl: string | null = null

  private authGeneration = 0

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

  currentAuthGeneration(): number {
    return this.authGeneration
  }

  currentSubject(): string | null {
    const t = loadTokens()
    return t ? subjectOf(t.accessToken) : null
  }

  currentWorkspaceId(): string | null {
    const t = loadTokens()
    return t ? workspaceIdOf(t.accessToken) : null
  }

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

  async listWorkspaces(): Promise<Workspace[]> {
    const token = await this.getAccessToken()
    if (!token) return []
    const workspaces = await listWorkspaces(token)
    saveWorkspaceNames(token, workspaces)
    return workspaces
  }

  async listWorkspaceMembers(): Promise<WorkspaceMember[]> {
    const token = await this.getAccessToken()
    if (!token) return []
    return listWorkspaceMembers(token)
  }

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

  asTokenProvider(onSignedOut?: () => void): TokenProvider {
    return {
      getAccessToken: () => this.getAccessToken(),
      onUnauthorized: (rejectedAccessToken) => {
        if (loadTokens()?.accessToken !== rejectedAccessToken) return
        this.logout()
        onSignedOut?.()
      }
    }
  }
}
