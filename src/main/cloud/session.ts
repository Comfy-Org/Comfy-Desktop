import type { TokenProvider } from '../comfybuilder'
import * as mainTelemetry from '../lib/telemetry'
import { isWorkspaceMintSwitchEnabled } from '../lib/workspaceMintSwitchFlag'
import {
  canMintWorkspaceTokens,
  grantFamilyOf,
  holdsPartnerNodeScope,
  subjectOf,
  workspaceIdOf
} from './claims'
import { CLOUD_CONFIG } from './config'
import { openAuthorizePage, refresh, signIn } from './oauth'
import type { OAuthOptions } from './oauth'
import { Revocations } from './revocation'
import { SignInFailure, signInFailureReport } from './signInFailure'
import {
  activateWorkspace,
  clearTokens,
  dropWorkspaceToken,
  endGrant,
  getAuthStatus,
  isSecureStorageUnavailable,
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
import {
  classifyMint,
  mintedTokenProblem,
  mintFailureReport,
  mintWorkspaceToken
} from './workspaceToken'
import type { ReauthorizeReason, WorkspaceMintOutcome } from './workspaceToken'
import { listWorkspaceMembers, listWorkspaces } from './workspaces'

const REFRESH_SKEW_MS = 60_000
const MAX_MINT_BLOCK_MS = 5 * 60_000

export const WORKSPACE_SWITCH_EVENT = 'comfy.desktop.auth.workspace_switch'
export const WORKSPACE_SWITCH_BROWSER_EVENT = 'comfy.desktop.auth.workspace_switch_browser'
export const MINT_SCOPE_NOT_GRANTED_EVENT = 'comfy.desktop.auth.mint_scope_not_granted'
export const WORKSPACE_RETURNED_TO_ANCHOR_EVENT = 'comfy.desktop.auth.workspace_returned_to_anchor'
export const SIGNED_OUT_EVENT = 'comfy.desktop.auth.signed_out'
export const EXPIRED_GRANT_REJECTED_EVENT = 'comfy.desktop.auth.expired_grant_rejected'
export const SESSION_SIGN_IN_EVENT = 'comfy.desktop.auth.session_sign_in'
export const GRANT_REFRESH_FAILED_EVENT = 'comfy.desktop.auth.grant_refresh_failed'
export const WORKSPACE_TOKEN_MINT_FAILED_EVENT = 'comfy.desktop.auth.workspace_token_mint_failed'

type SignOutReason = 'user' | 'grant_rejected' | 'refresh_refused'

type SignInPurpose = 'sign_in' | 'workspace_switch'

export interface SessionSwitchReply extends WorkspaceSwitchStatus {
  reached: boolean
  reachedThroughConsent?: true
}

type SwitchTelemetryOutcome =
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

function reportSwitch(outcome: SwitchTelemetryOutcome, reason?: SwitchReason): void {
  mainTelemetry.emit(
    WORKSPACE_SWITCH_EVENT,
    reason ? { outcome, reauthorize_reason: reason } : { outcome }
  )
}

function reportBrowser(reason: ReauthorizeReason): void {
  reportSwitch('browser', reason)
  mainTelemetry.emit(WORKSPACE_SWITCH_BROWSER_EVENT, { reauthorize_reason: reason })
}

function reportSignIn(purpose: SignInPurpose, result: mainTelemetry.TelemetryContext): void {
  mainTelemetry.emit(SESSION_SIGN_IN_EVENT, { purpose, ...result })
}

async function reportedSignIn(
  purpose: SignInPurpose,
  options: OAuthOptions
): ReturnType<typeof signIn> {
  try {
    return await signIn(options)
  } catch (error) {
    reportSignIn(purpose, { outcome: 'failed', ...signInFailureReport(error) })
    throw error
  }
}

export class CloudSession {
  private readonly refreshing = new Map<string, Promise<GrantRefresh>>()
  private readonly rotatedTo = new Map<string, string>()
  private readonly minting = new Map<string, Promise<SettledMintOutcome>>()
  private switching: { workspaceId: string; result: Promise<SessionSwitchReply> } | null = null
  private switchIntent: WorkspaceSwitchIntent = 'chosen'
  private mintBlockedUntil = 0
  private loginInFlight: Promise<AuthStatus> | null = null
  private loginAuthorizeUrl: string | null = null
  private returnedToAnchorHandler: (() => void) | null = null
  private readonly revocations = new Revocations()
  private readonly retiredRefreshTokens = new Set<string>()
  private readonly reportedRefreshFailures = new Set<string>()

  private authGeneration = 0

  async isWorkspaceMintAllowed(workspaceId: string): Promise<boolean> {
    const grant = loadGrant()
    if (grant && workspaceIdOf(grant.accessToken) === workspaceId) return true
    return isWorkspaceMintSwitchEnabled()
  }

  setReturnedToAnchorHandler(handler: () => void): void {
    this.returnedToAnchorHandler = handler
  }

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
    const { tokens, status } = await reportedSignIn('sign_in', {
      onAuthorizeUrl: (url) => {
        if (generation === this.authGeneration) this.loginAuthorizeUrl = url
      }
    })
    if (generation !== this.authGeneration) {
      this.revokeUnstored(tokens.refreshToken)
      reportSignIn('sign_in', { outcome: 'superseded' })
      return this.status()
    }
    this.storeSignedInGrant(tokens, 'sign_in')
    const anchor = workspaceIdOf(tokens.accessToken)
    if (anchor) activateWorkspace(anchor)
    return status
  }

  private storeSignedInGrant(tokens: AuthTokens, purpose: SignInPurpose): void {
    const replaced = loadGrant()?.refreshToken
    const origin = loadGrantOrigin()
    this.mintBlockedUntil = 0
    this.reportedRefreshFailures.clear()
    const saved = saveGrant(tokens)
    const sessionSaved = saved && !isSecureStorageUnavailable()
    if (saved && replaced !== tokens.refreshToken) this.retireGrant(replaced, origin)
    const mintScope = canMintWorkspaceTokens(tokens.accessToken)
    if (!mintScope) mainTelemetry.emit(MINT_SCOPE_NOT_GRANTED_EVENT)
    reportSignIn(purpose, {
      outcome: 'completed',
      mint_scope: mintScope,
      partner_node_scope: holdsPartnerNodeScope(tokens.accessToken),
      session_saved: sessionSaved
    })
  }

  private clearPendingLogin(): void {
    this.loginInFlight = null
    this.loginAuthorizeUrl = null
  }

  logout(reason: SignOutReason = 'user'): void {
    const grant = loadGrant()
    const origin = loadGrantOrigin()
    this.authGeneration += 1
    this.switching = null
    this.mintBlockedUntil = 0
    this.clearPendingLogin()
    this.retireGrant(grant?.refreshToken, origin)
    const removed = clearTokens()
    if (grant) mainTelemetry.emit(SIGNED_OUT_EVENT, { reason, stored_session_removed: removed })
  }

  private retireGrant(refreshToken: string | undefined, origin: GrantOrigin | null): void {
    if (!refreshToken) return
    if (this.refreshing.has(refreshToken)) this.retiredRefreshTokens.add(refreshToken)
    if (origin) this.revocations.add({ ...origin, refreshToken })
  }

  private revokeUnstored(refreshToken: string | undefined): void {
    if (!refreshToken || refreshToken === loadGrant()?.refreshToken) return
    this.revocations.add({
      issuer: CLOUD_CONFIG.issuer,
      clientId: CLOUD_CONFIG.clientId,
      refreshToken
    })
  }

  resumeRevocations(): void {
    void this.revocations.drain()
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
    const grant = loadGrant()
    return grant ? subjectOf(grant.accessToken) : null
  }

  currentGrantFamily(): string | null {
    const grant = loadGrant()
    return grant ? grantFamilyOf(grant.accessToken) : null
  }

  currentWorkspaceId(): string | null {
    return loadActiveWorkspaceId()
  }

  heldWorkspaceToken(workspaceId: string): string | null {
    const held = loadWorkspaceToken(workspaceId)
    return held && held.expiresAt > Date.now() ? held.accessToken : null
  }

  async getGrantAccessToken(): Promise<string | null> {
    const grant = loadGrant()
    if (!grant) return null
    if (isFresh(grant) || !grant.refreshToken) return grant.accessToken
    const subject = subjectOf(grant.accessToken)
    await this.refreshGrant(grant)
    return this.currentSubject() === subject ? (loadGrant()?.accessToken ?? null) : null
  }

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
      this.reportedRefreshFailures.clear()
      const stored = replaceGrant(grant.accessToken, refreshToken, rotated)
      if (stored) this.rotatedTo.set(grant.accessToken, rotated.accessToken)
      if (!stored && this.retiredRefreshTokens.has(refreshToken)) {
        this.revokeUnstored(rotated.refreshToken)
      }
      return 'refreshed'
    } catch (error) {
      const outcome = isDefinitiveRefreshRefusal(error) ? 'ended' : 'unavailable'
      this.reportRefreshFailure(outcome, error)
      return outcome
    } finally {
      this.retiredRefreshTokens.delete(refreshToken)
    }
  }

  private reportRefreshFailure(outcome: Exclude<GrantRefresh, 'refreshed'>, error: unknown): void {
    const failure = { outcome, ...signInFailureReport(error) }
    const report = JSON.stringify(failure)
    if (this.reportedRefreshFailures.has(report)) return
    this.reportedRefreshFailures.add(report)
    mainTelemetry.emit(GRANT_REFRESH_FAILED_EVENT, failure)
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
    if (!grant) return RETRYABLE
    const problem = mintedTokenProblem(outcome.token, workspaceId, subjectOf(grant.accessToken))
    if (problem) {
      mainTelemetry.emit(WORKSPACE_TOKEN_MINT_FAILED_EVENT, { reason: 'unusable_token', problem })
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
    const mint = await mintWorkspaceToken(grant.accessToken, workspaceId)
    if (mint.kind === 'failed')
      mainTelemetry.emit(WORKSPACE_TOKEN_MINT_FAILED_EVENT, mintFailureReport(mint))
    const outcome = classifyMint(mint)
    if (outcome.kind === 'reauthorize' && outcome.reason === 'grant_ended') {
      this.endGrantFamily(grant.accessToken)
    }
    if (
      outcome.kind === 'retryable' &&
      outcome.retryAfterSeconds !== undefined &&
      generation === this.authGeneration &&
      subjectOf(grant.accessToken) === this.currentSubject()
    ) {
      this.mintBlockedUntil =
        Date.now() + Math.min(outcome.retryAfterSeconds * 1000, MAX_MINT_BLOCK_MS)
    }
    return outcome
  }

  endGrantFamily(accessToken: string): void {
    for (let token: string | undefined = accessToken; token; token = this.rotatedTo.get(token)) {
      endGrant(token)
    }
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const token = await this.getGrantAccessToken()
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

  switchWorkspace(
    workspaceId: string,
    intent: WorkspaceSwitchIntent = 'chosen'
  ): Promise<SessionSwitchReply> {
    if (this.switching?.workspaceId === workspaceId) {
      if (intent === 'chosen' || this.switchIntent === 'restored') this.switchIntent = intent
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
    if (!grant) return this.unreached()
    if (workspaceId === workspaceIdOf(grant.accessToken)) {
      return this.switchToAnchor(workspaceId, generation, grant)
    }
    const held = loadWorkspaceToken(workspaceId)
    if (held && held.expiresAt > Date.now()) return this.activated(workspaceId, 'cached')
    if (this.switchIntent === 'requested') {
      return this.reauthorize(workspaceId, generation, 'view_requested')
    }

    const outcome = await this.mintForWorkspace(workspaceId, generation)
    if (generation !== this.authGeneration) return this.unreached()
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
      if (generation !== this.authGeneration) return this.unreached()
      if (refreshed === 'ended') return this.reauthorize(workspaceId, generation, 'grant_ended')
      if (refreshed === 'unavailable' && isExpired(grant)) {
        reportSwitch('retryable')
        return this.stayed('retryable')
      }
    }
    return this.activated(workspaceId, 'anchor')
  }

  private activated(workspaceId: string, outcome: SwitchTelemetryOutcome): SessionSwitchReply {
    activateWorkspace(workspaceId)
    reportSwitch(outcome)
    return { ...this.status(), reached: true }
  }

  private stayed(failure: WorkspaceSwitchFailure): SessionSwitchReply {
    return { ...this.status(), workspaceSwitchFailure: failure, reached: false }
  }

  private unreached(): SessionSwitchReply {
    return { ...this.status(), reached: false }
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
      ;({ tokens } = await reportedSignIn('workspace_switch', {
        workspaceId,
        onAuthorizeUrl: () => {
          browserOpened = true
          reportBrowser(reason)
        }
      }))
    } catch {
      if (!browserOpened) reportSwitch('retryable', reason)
      return generation === this.authGeneration ? this.stayed('retryable') : this.unreached()
    }
    if (generation !== this.authGeneration) {
      this.revokeUnstored(tokens.refreshToken)
      reportSignIn('workspace_switch', { outcome: 'superseded' })
      return this.unreached()
    }
    this.storeSignedInGrant(tokens, 'workspace_switch')

    const canMint = canMintWorkspaceTokens(tokens.accessToken)
    const isAnchor = workspaceId === workspaceIdOf(tokens.accessToken)
    if (!canMint) reportSwitch(isAnchor ? 'anchor' : 'retryable', 'scope_not_granted')
    if (isAnchor) {
      activateWorkspace(workspaceId)
      return this.afterConsent({ ...this.status(), reached: true }, tokens)
    }
    if (!canMint) return this.afterConsent(this.stayed('retryable'), tokens)

    const outcome = await this.mintForWorkspace(workspaceId, generation)
    if (generation !== this.authGeneration) return this.unreached()
    if (outcome.kind === 'minted') {
      activateWorkspace(workspaceId)
      return { ...this.status(), reached: true }
    }
    const unavailable = outcome.kind === 'unavailable' || outcome.kind === 'refused'
    return this.afterConsent(this.stayed(unavailable ? 'unavailable' : 'retryable'), tokens)
  }

  private afterConsent(reply: SessionSwitchReply, tokens: AuthTokens): SessionSwitchReply {
    const reached = loadActiveWorkspaceId() === workspaceIdOf(tokens.accessToken)
    return reached ? { ...reply, reachedThroughConsent: true } : reply
  }

  asTokenProvider(onSignedOut?: () => void): TokenProvider {
    return {
      getAccessToken: () => this.getAccessToken(),
      onUnauthorized: (rejectedAccessToken) => {
        if (dropWorkspaceToken(rejectedAccessToken)) return
        const grant = loadGrant()
        if (grant?.accessToken !== rejectedAccessToken) return
        if (isExpired(grant) && grant.refreshToken) {
          void this.signOutIfGrantEnded(grant, onSignedOut)
          return
        }
        this.logout('grant_rejected')
        onSignedOut?.()
      }
    }
  }

  private async signOutIfGrantEnded(grant: AuthTokens, onSignedOut?: () => void): Promise<void> {
    const generation = this.authGeneration
    const refreshed = await this.refreshGrant(grant)
    mainTelemetry.emit(EXPIRED_GRANT_REJECTED_EVENT, { refresh: refreshed })
    if (refreshed !== 'ended' || generation !== this.authGeneration) return
    if (loadGrant()?.accessToken !== grant.accessToken) return
    this.logout('refresh_refused')
    onSignedOut?.()
  }
}
