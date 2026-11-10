/**
 * CloudSession - the one object the app (and its UI) drives for auth + workspace.
 *
 * Ties the PKCE flow, the encrypted token store, and the workspace client into a
 * single facade, and exposes a {@link TokenProvider} so the comfy-builder client
 * can pull a fresh bearer token without ever seeing the store. Tokens never leave
 * the main process; the UI only ever gets {@link AuthStatus} + {@link Workspace}.
 */
import type { TokenProvider } from '../comfybuilder'
import * as mainTelemetry from '../lib/telemetry'
import { isWorkspaceMintSwitchEnabled } from '../lib/workspaceMintSwitchFlag'
import { canMintWorkspaceTokens, subjectOf, workspaceIdOf } from './claims'
import { CLOUD_CONFIG } from './config'
import { openAuthorizePage, refresh, signIn } from './oauth'
import { Revocations } from './revocation'
import { SignInFailure } from './signInFailure'
import {
  activateWorkspace,
  clearTokens,
  dropWorkspaceToken,
  endGrant,
  getAuthStatus,
  isMintScopeWithheld,
  loadActiveWorkspaceId,
  loadGrant,
  loadGrantOrigin,
  loadWorkspaceToken,
  replaceGrant,
  saveGrant,
  saveWorkspaceNames,
  saveWorkspaceToken
} from './tokenStore'
import type { GrantOrigin } from './tokenStore'
import type {
  AuthStatus,
  AuthTokens,
  Workspace,
  WorkspaceMember,
  WorkspaceSwitchFailure,
  WorkspaceSwitchIntent,
  WorkspaceSwitchStatus
} from './types'
import { classifyMint, mintWorkspaceToken } from './workspaceToken'
import type { ReauthorizeReason, WorkspaceMintOutcome } from './workspaceToken'
import { listWorkspaceMembers, listWorkspaces } from './workspaces'

/** Refresh or re-mint an access token this many ms before it actually expires. */
const REFRESH_SKEW_MS = 60_000

/** One event per switch decision. `outcome` is how the goal of no further consent is measured. */
export const WORKSPACE_SWITCH_EVENT = 'comfy.desktop.auth.workspace_switch'
/** Mirrored to Datadog: every browser trip a workspace switch causes. */
export const WORKSPACE_SWITCH_BROWSER_EVENT = 'comfy.desktop.auth.workspace_switch_browser'
/** Mirrored to Datadog: a browser sign-in returned a grant without the mint scope. */
export const MINT_SCOPE_NOT_GRANTED_EVENT = 'comfy.desktop.auth.mint_scope_not_granted'
/** Mirrored to Datadog: a token read could not renew the active workspace, so it went back to the anchor. */
export const WORKSPACE_RETURNED_TO_ANCHOR_EVENT = 'comfy.desktop.auth.workspace_returned_to_anchor'

/** What `switchWorkspace` resolves with. `reachedThroughConsent` is for main only and never crosses IPC. */
export interface SessionSwitchReply extends WorkspaceSwitchStatus {
  reachedThroughConsent?: true
}

type WorkspaceSwitchOutcome =
  | 'cached'
  | 'anchor'
  | 'minted'
  | 'browser'
  | 'unavailable'
  | 'retryable'
  | 'refused'

type SwitchReason = ReauthorizeReason | 'scope_not_granted'

type GrantRefresh = 'refreshed' | 'ended' | 'unavailable'

type SettledMintOutcome = Exclude<WorkspaceMintOutcome, { kind: 'unauthorized' }>

const RETRYABLE: SettledMintOutcome = { kind: 'retryable' }

const ENDED_GRANT_OAUTH_ERRORS: ReadonlySet<string> = new Set(['invalid_grant', 'invalid_client'])

function isFresh(tokens: AuthTokens): boolean {
  return tokens.expiresAt - REFRESH_SKEW_MS > Date.now()
}

function isExpired(tokens: AuthTokens): boolean {
  return tokens.expiresAt <= Date.now()
}

function isDefinitiveRefreshRefusal(error: unknown): boolean {
  return (
    error instanceof SignInFailure &&
    (error.httpStatus === 400 || error.httpStatus === 401) &&
    error.oauthError !== undefined &&
    ENDED_GRANT_OAUTH_ERRORS.has(error.oauthError)
  )
}

function refreshFailureOutcome(refreshed: GrantRefresh): SettledMintOutcome {
  return refreshed === 'ended' ? { kind: 'reauthorize', reason: 'grant_ended' } : RETRYABLE
}

function reportSwitch(outcome: WorkspaceSwitchOutcome, reason?: SwitchReason): void {
  mainTelemetry.emit(
    WORKSPACE_SWITCH_EVENT,
    reason ? { outcome, reauthorize_reason: reason } : { outcome }
  )
}

function reportBrowser(reason: ReauthorizeReason): void {
  reportSwitch('browser', reason)
  mainTelemetry.emit(WORKSPACE_SWITCH_BROWSER_EVENT, { reauthorize_reason: reason })
}

export class CloudSession {
  private readonly refreshing = new Map<string, Promise<GrantRefresh>>()
  private readonly minting = new Map<string, Promise<SettledMintOutcome>>()
  private switching: { workspaceId: string; result: Promise<SessionSwitchReply> } | null = null
  private switchIntent: WorkspaceSwitchIntent = 'chosen'
  private mintBlockedUntil = 0
  private loginInFlight: Promise<AuthStatus> | null = null
  private loginAuthorizeUrl: string | null = null
  private returnedToAnchorHandler: (() => void) | null = null
  private readonly revocations = new Revocations()
  private readonly retiredRefreshTokens = new Set<string>()

  /** Latest auth intent. Older flows may finish, but cannot change what a newer
   *  login, workspace switch, or logout chose. */
  private authGeneration = 0

  /** The one mint policy: the grant's anchor always, any other workspace unless the ops flag killed it. */
  async isWorkspaceMintAllowed(workspaceId: string): Promise<boolean> {
    const grant = loadGrant()
    if (grant && workspaceIdOf(grant.accessToken) === workspaceId) return true
    return isWorkspaceMintSwitchEnabled()
  }

  /** Called after a token read moved the active workspace back to the anchor. */
  setReturnedToAnchorHandler(handler: () => void): void {
    this.returnedToAnchorHandler = handler
  }

  /** Start the PKCE sign-in (system browser); persists tokens on success.
   *  A repeat request while one is pending reopens its browser page, since the
   *  user may have closed it or hit an IdP error there. */
  login(): Promise<AuthStatus> {
    if (this.loginInFlight) {
      if (this.loginAuthorizeUrl) void openAuthorizePage(this.loginAuthorizeUrl).catch(() => {})
      return this.loginInFlight
    }
    this.switching = null
    const generation = ++this.authGeneration
    const login = this.signInAtGeneration(generation).finally(() => {
      if (this.loginInFlight === login) this.clearPendingLogin()
    })
    this.loginInFlight = login
    return login
  }

  private async signInAtGeneration(generation: number): Promise<AuthStatus> {
    const { tokens, status } = await signIn({
      onAuthorizeUrl: (url) => {
        if (generation === this.authGeneration) this.loginAuthorizeUrl = url
      }
    })
    if (generation !== this.authGeneration) return this.status()
    this.storeSignedInGrant(tokens)
    const anchor = workspaceIdOf(tokens.accessToken)
    if (anchor) activateWorkspace(anchor)
    return status
  }

  private storeSignedInGrant(tokens: AuthTokens): void {
    const replaced = loadGrant()?.refreshToken
    const origin = loadGrantOrigin()
    this.mintBlockedUntil = 0
    const mintScopeWithheld = !canMintWorkspaceTokens(tokens.accessToken)
    saveGrant(tokens, { mintScopeWithheld })
    if (replaced !== tokens.refreshToken) this.retireGrant(replaced, origin)
    if (mintScopeWithheld) mainTelemetry.emit(MINT_SCOPE_NOT_GRANTED_EVENT)
  }

  private clearPendingLogin(): void {
    this.loginInFlight = null
    this.loginAuthorizeUrl = null
  }

  /** Forget tokens at once; revoke this grant on Cloud in the background. Installs are untouched. */
  logout(): void {
    const refreshToken = loadGrant()?.refreshToken
    const origin = loadGrantOrigin()
    this.authGeneration += 1
    this.switching = null
    this.mintBlockedUntil = 0
    this.clearPendingLogin()
    this.retireGrant(refreshToken, origin)
    clearTokens()
  }

  /** Revoke a grant Desktop no longer holds, and any rotation of it still in flight. */
  private retireGrant(refreshToken: string | undefined, origin: GrantOrigin | null): void {
    if (!refreshToken) return
    if (this.refreshing.has(refreshToken)) this.retiredRefreshTokens.add(refreshToken)
    if (origin) this.revocations.add({ ...origin, refreshToken })
  }

  /** Resume revocations a previous run queued and Cloud has not confirmed. */
  resumeRevocations(): void {
    void this.revocations.drain()
  }

  status(): AuthStatus {
    return getAuthStatus()
  }

  isSignedIn(): boolean {
    return getAuthStatus().signedIn
  }

  /** Bumped by every login, workspace switch and logout. */
  currentAuthGeneration(): number {
    return this.authGeneration
  }

  /** The account the grant belongs to, or null when signed out. */
  currentSubject(): string | null {
    const grant = loadGrant()
    return grant ? subjectOf(grant.accessToken) : null
  }

  /** The active workspace, or null when signed out. */
  currentWorkspaceId(): string | null {
    return loadActiveWorkspaceId()
  }

  /** The grant's access token for minting and scope checks. After a failed refresh it is the stale one. */
  async getGrantAccessToken(): Promise<string | null> {
    const grant = loadGrant()
    if (!grant) return null
    if (isFresh(grant) || !grant.refreshToken) return grant.accessToken
    const subject = subjectOf(grant.accessToken)
    await this.refreshGrant(grant)
    return this.currentSubject() === subject ? (loadGrant()?.accessToken ?? null) : null
  }

  /** The token for API calls in the active workspace, null when it cannot get one.
   *  A definitively refused grant returns its stale token, so the API's 401 ends the session. */
  async getAccessToken(): Promise<string | null> {
    const grant = loadGrant()
    if (!grant) return null
    const generation = this.authGeneration
    const subject = subjectOf(grant.accessToken)
    const workspaceId = loadActiveWorkspaceId()
    const unchanged = (): boolean =>
      generation === this.authGeneration &&
      subject === this.currentSubject() &&
      workspaceId === loadActiveWorkspaceId()
    if (!workspaceId || workspaceId === workspaceIdOf(grant.accessToken)) {
      if (isFresh(grant) || !grant.refreshToken) return grant.accessToken
      const refreshed = await this.refreshGrant(grant)
      if (!unchanged()) return null
      if (refreshed === 'unavailable' && isExpired(grant)) return null
      return loadGrant()?.accessToken ?? null
    }
    const held = loadWorkspaceToken(workspaceId)
    if (held && isFresh(held)) return held.accessToken

    const outcome = await this.mintForWorkspace(workspaceId, generation)
    if (!unchanged()) return null
    if (outcome.kind === 'minted') return outcome.token
    if (held && held.expiresAt > Date.now()) return held.accessToken
    if (outcome.kind !== 'retryable') this.returnToAnchor(workspaceId, outcome)
    return null
  }

  private returnToAnchor(
    workspaceId: string,
    outcome: Exclude<SettledMintOutcome, { kind: 'minted' | 'retryable' }>
  ): void {
    const grant = loadGrant()
    const anchor = grant && workspaceIdOf(grant.accessToken)
    if (!anchor || loadActiveWorkspaceId() !== workspaceId) return
    activateWorkspace(anchor)
    mainTelemetry.emit(WORKSPACE_RETURNED_TO_ANCHOR_EVENT, {
      reason: outcome.kind === 'reauthorize' ? outcome.reason : outcome.kind
    })
    this.returnedToAnchorHandler?.()
  }

  private refreshGrant(grant: AuthTokens): Promise<GrantRefresh> {
    const refreshToken = grant.refreshToken
    if (!refreshToken) return Promise.resolve('ended')
    const inFlight = this.refreshing.get(refreshToken)
    if (inFlight) return inFlight
    const refreshing = this.rotateGrant(grant, refreshToken).finally(() => {
      if (this.refreshing.get(refreshToken) === refreshing) this.refreshing.delete(refreshToken)
    })
    this.refreshing.set(refreshToken, refreshing)
    return refreshing
  }

  private async rotateGrant(grant: AuthTokens, refreshToken: string): Promise<GrantRefresh> {
    try {
      const rotated = await refresh(refreshToken)
      const stored = replaceGrant(grant.accessToken, refreshToken, rotated)
      const next = rotated.refreshToken
      if (!stored && this.retiredRefreshTokens.has(refreshToken) && next) {
        this.revocations.add({
          issuer: CLOUD_CONFIG.issuer,
          clientId: CLOUD_CONFIG.clientId,
          refreshToken: next
        })
      }
      return 'refreshed'
    } catch (error) {
      return isDefinitiveRefreshRefusal(error) ? 'ended' : 'unavailable'
    } finally {
      this.retiredRefreshTokens.delete(refreshToken)
    }
  }

  private mintForWorkspace(workspaceId: string, generation: number): Promise<SettledMintOutcome> {
    const key = JSON.stringify([generation, workspaceId])
    const inFlight = this.minting.get(key)
    if (inFlight) return inFlight
    const minting = this.mintWithGrant(workspaceId, generation)
      .then((outcome) => this.storeMinted(workspaceId, generation, outcome))
      .finally(() => {
        if (this.minting.get(key) === minting) this.minting.delete(key)
      })
    this.minting.set(key, minting)
    return minting
  }

  private storeMinted(
    workspaceId: string,
    generation: number,
    outcome: SettledMintOutcome
  ): SettledMintOutcome {
    if (outcome.kind !== 'minted' || generation !== this.authGeneration) return outcome
    const grant = loadGrant()
    if (
      !grant ||
      workspaceIdOf(outcome.token) !== workspaceId ||
      subjectOf(outcome.token) !== subjectOf(grant.accessToken)
    ) {
      return RETRYABLE
    }
    saveWorkspaceToken(workspaceId, { accessToken: outcome.token, expiresAt: outcome.expiresAt })
    return outcome
  }

  private async mintWithGrant(
    workspaceId: string,
    generation: number
  ): Promise<SettledMintOutcome> {
    const subject = this.currentSubject()
    if (!(await this.isWorkspaceMintAllowed(workspaceId))) {
      return { kind: 'reauthorize', reason: 'mint_disabled' }
    }
    const grant = loadGrant()
    if (!grant) return RETRYABLE
    if (!canMintWorkspaceTokens(grant.accessToken))
      return { kind: 'reauthorize', reason: 'mint_scope_missing' }
    if (!isFresh(grant)) {
      const refreshed = await this.refreshGrant(grant)
      if (refreshed === 'ended' || (refreshed === 'unavailable' && isExpired(grant)))
        return refreshFailureOutcome(refreshed)
    }
    const first = await this.postMint(workspaceId, generation, subject)
    if (first.kind !== 'unauthorized') return first
    const current = loadGrant()
    if (!current) return RETRYABLE
    const refreshed = await this.refreshGrant(current)
    if (refreshed !== 'refreshed') return refreshFailureOutcome(refreshed)
    const second = await this.postMint(workspaceId, generation, subject)
    return second.kind === 'unauthorized' ? RETRYABLE : second
  }

  private async postMint(
    workspaceId: string,
    generation: number,
    subject: string | null
  ): Promise<WorkspaceMintOutcome> {
    const grant = loadGrant()
    if (
      !grant ||
      generation !== this.authGeneration ||
      subject !== subjectOf(grant.accessToken) ||
      Date.now() < this.mintBlockedUntil
    )
      return RETRYABLE
    const outcome = classifyMint(await mintWorkspaceToken(grant.accessToken, workspaceId))
    if (outcome.kind === 'reauthorize' && outcome.reason === 'grant_ended') {
      endGrant(grant.accessToken)
    }
    if (
      outcome.kind === 'retryable' &&
      outcome.retryAfterSeconds !== undefined &&
      generation === this.authGeneration &&
      subjectOf(grant.accessToken) === this.currentSubject()
    ) {
      this.mintBlockedUntil = Date.now() + outcome.retryAfterSeconds * 1000
    }
    return outcome
  }

  /** The signed-in user's workspaces; unavailable catalogs reject rather than imply removal. */
  async listWorkspaces(): Promise<Workspace[]> {
    const token = await this.getGrantAccessToken()
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

  /** Activate `workspaceId`. Only a refused grant, an SSO policy, a missing mint scope or a
   *  mint kill switch opens the browser, and only for a `chosen` switch; every other failure
   *  stays put and says so. */
  switchWorkspace(
    workspaceId: string,
    intent: WorkspaceSwitchIntent = 'chosen'
  ): Promise<SessionSwitchReply> {
    if (this.switching?.workspaceId === workspaceId) {
      if (intent === 'chosen') this.switchIntent = 'chosen'
      return this.switching.result
    }
    this.clearPendingLogin()
    this.switchIntent = intent
    const generation = ++this.authGeneration
    const result = this.runSwitch(workspaceId, generation).finally(() => {
      if (this.switching?.result === result) this.switching = null
    })
    this.switching = { workspaceId, result }
    return result
  }

  private async runSwitch(workspaceId: string, generation: number): Promise<SessionSwitchReply> {
    const grant = loadGrant()
    if (!grant) return this.status()
    if (workspaceId === workspaceIdOf(grant.accessToken)) {
      return this.switchToAnchor(workspaceId, generation, grant)
    }
    const held = loadWorkspaceToken(workspaceId)
    if (held && held.expiresAt > Date.now()) return this.activated(workspaceId, 'cached')

    const outcome = await this.mintForWorkspace(workspaceId, generation)
    if (generation !== this.authGeneration) return this.status()
    switch (outcome.kind) {
      case 'minted':
        return this.activated(workspaceId, 'minted')
      case 'unavailable':
        reportSwitch('unavailable')
        return this.stayed('unavailable')
      case 'refused':
        reportSwitch('refused')
        return this.stayed('unavailable')
      case 'retryable':
        reportSwitch('retryable')
        return this.stayed('retryable')
      case 'reauthorize':
        if (outcome.reason === 'mint_scope_missing' && isMintScopeWithheld()) {
          reportSwitch('retryable', 'scope_not_granted')
          return this.stayed('retryable')
        }
        return this.reauthorize(workspaceId, generation, outcome.reason)
    }
  }

  private async switchToAnchor(
    workspaceId: string,
    generation: number,
    grant: AuthTokens
  ): Promise<SessionSwitchReply> {
    if (!isFresh(grant)) {
      const refreshed = await this.refreshGrant(grant)
      if (generation !== this.authGeneration) return this.status()
      if (refreshed === 'ended') return this.reauthorize(workspaceId, generation, 'grant_ended')
      if (refreshed === 'unavailable' && isExpired(grant)) {
        reportSwitch('retryable')
        return this.stayed('retryable')
      }
    }
    return this.activated(workspaceId, 'anchor')
  }

  private activated(workspaceId: string, outcome: WorkspaceSwitchOutcome): WorkspaceSwitchStatus {
    activateWorkspace(workspaceId)
    reportSwitch(outcome)
    return this.status()
  }

  private stayed(failure: WorkspaceSwitchFailure): WorkspaceSwitchStatus {
    return { ...this.status(), workspaceSwitchFailure: failure }
  }

  private async reauthorize(
    workspaceId: string,
    generation: number,
    reason: ReauthorizeReason
  ): Promise<SessionSwitchReply> {
    if (this.switchIntent === 'restored') {
      reportSwitch('retryable', reason)
      return this.stayed('retryable')
    }
    let browserOpened = false
    let tokens: AuthTokens
    try {
      ;({ tokens } = await signIn({
        workspaceId,
        onAuthorizeUrl: () => {
          browserOpened = true
          reportBrowser(reason)
        }
      }))
    } catch {
      if (!browserOpened) reportSwitch('retryable', reason)
      return generation === this.authGeneration ? this.stayed('retryable') : this.status()
    }
    if (generation !== this.authGeneration) return this.status()
    this.storeSignedInGrant(tokens)

    const canMint = canMintWorkspaceTokens(tokens.accessToken)
    const isAnchor = workspaceId === workspaceIdOf(tokens.accessToken)
    if (!canMint) reportSwitch(isAnchor ? 'anchor' : 'retryable', 'scope_not_granted')
    if (isAnchor) {
      activateWorkspace(workspaceId)
      return this.afterConsent(this.status(), tokens)
    }
    if (!canMint) return this.afterConsent(this.stayed('retryable'), tokens)

    const outcome = await this.mintForWorkspace(workspaceId, generation)
    if (generation !== this.authGeneration) return this.status()
    if (outcome.kind === 'minted') {
      activateWorkspace(workspaceId)
      return this.status()
    }
    const unavailable = outcome.kind === 'unavailable' || outcome.kind === 'refused'
    return this.afterConsent(this.stayed(unavailable ? 'unavailable' : 'retryable'), tokens)
  }

  private afterConsent(reply: WorkspaceSwitchStatus, tokens: AuthTokens): SessionSwitchReply {
    const reached = loadActiveWorkspaceId() === workspaceIdOf(tokens.accessToken)
    return reached ? { ...reply, reachedThroughConsent: true } : reply
  }

  /** Adapter for the comfy-builder client's auth seam. */
  asTokenProvider(onSignedOut?: () => void): TokenProvider {
    return {
      getAccessToken: () => this.getAccessToken(),
      onUnauthorized: (rejectedAccessToken) => {
        if (dropWorkspaceToken(rejectedAccessToken)) return
        if (loadGrant()?.accessToken !== rejectedAccessToken) return
        this.logout()
        onSignedOut?.()
      }
    }
  }
}
