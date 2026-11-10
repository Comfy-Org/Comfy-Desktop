import type { WebContents } from 'electron'

import { canMintWorkspaceTokens, grantFamilyOf, subjectOf, workspaceIdOf } from '../cloud/claims'
import {
  classifyMint,
  mintPartnerNodeToken,
  mintWorkspaceToken,
  renewPartnerNodeToken
} from '../cloud/workspaceToken'
import type { WorkspaceTokenMint } from '../cloud/workspaceToken'
import { getCloudSession, rejectAccessToken } from '../devplatform/session'
import * as mainTelemetry from './telemetry'

const MINT_REFRESH_SKEW_MS = 60_000
const PARTNER_NODE_RENEW_BEFORE_MS = 60 * 60_000
const PARTNER_NODE_RETRY_MS = 60_000

export const VIEW_TOKEN_MINTED_EVENT = 'comfy.desktop.auth.view_token_minted'
export const VIEW_TOKEN_MINT_FAILED_EVENT = 'comfy.desktop.auth.view_token_mint_failed'

function reportMint(result: WorkspaceTokenMint): void {
  if (result.kind === 'minted') {
    mainTelemetry.emit(VIEW_TOKEN_MINTED_EVENT)
    return
  }
  mainTelemetry.emit(
    VIEW_TOKEN_MINT_FAILED_EVENT,
    result.status === null ? { reason: 'network' } : { reason: 'http', http_status: result.status }
  )
}

export interface GrantSession {
  currentWorkspaceId(): string | null
  currentSubject(): string | null
  currentGrantFamily(): string | null
  currentAuthGeneration(): number
  getGrantAccessToken(): Promise<string | null>
  heldWorkspaceToken(workspaceId: string): string | null
  isWorkspaceMintAllowed(workspaceId: string): Promise<boolean>
  endGrantFamily(accessToken: string): void
}

export type MintWorkspaceToken = (
  accessToken: string,
  workspaceId: string
) => Promise<WorkspaceTokenMint>

export interface PartnerNodeTokenCalls {
  mint: MintWorkspaceToken
  renew(partnerNodeToken: string): Promise<WorkspaceTokenMint>
}

const PARTNER_NODE_TOKEN_CALLS: PartnerNodeTokenCalls = {
  mint: (accessToken, workspaceId) => mintPartnerNodeToken(accessToken, workspaceId),
  renew: (partnerNodeToken) => renewPartnerNodeToken(partnerNodeToken)
}

const PARTNER_NODE_MINT_DISABLED_CODE = 'partner_node_token_disabled'

function isRetryableFailure(result: WorkspaceTokenMint): boolean {
  return (
    result.kind === 'failed' &&
    result.code !== PARTNER_NODE_MINT_DISABLED_CODE &&
    (result.status === null || result.status === 429 || result.status >= 500 || result.status < 300)
  )
}

function mintKey(subject: string, workspaceId: string): string {
  return JSON.stringify([subject, workspaceId])
}

type Gate = () => Promise<boolean>

const OPEN: Gate = async () => true

interface MintFence {
  epoch: number
  generation: number
  family: string | null
}

interface HeldToken {
  token: string
  subject: string
}

interface MintedToken {
  token: string
  expiresAt: number
}

export class ViewWorkspaceGrants {
  private epoch = 0
  private seeded = false
  private desktopAllowed = new Set<string>()
  private viewAllowed = new WeakMap<WebContents, Set<string>>()
  private minted = new Map<string, MintedToken>()
  private partnerNodeMinted = new Map<string, MintedToken>()
  private partnerNodeRetryAt = new Map<string, number>()
  private minting = new Map<string, Promise<WorkspaceTokenMint>>()

  constructor(
    private readonly session: GrantSession,
    private readonly mint: MintWorkspaceToken = mintWorkspaceToken,
    private readonly onUnauthorized: (accessToken: string) => void = () => {},
    private readonly partnerNode: PartnerNodeTokenCalls = PARTNER_NODE_TOKEN_CALLS
  ) {}

  allowDesktop(workspaceId: string | undefined): void {
    this.seed()
    if (workspaceId) this.desktopAllowed.add(workspaceId)
  }

  allowView(view: WebContents, workspaceId: string): void {
    this.seed()
    const allowed = this.viewAllowed.get(view) ?? new Set<string>()
    allowed.add(workspaceId)
    this.viewAllowed.set(view, allowed)
  }

  endAll(): void {
    this.epoch += 1
    this.seeded = true
    this.desktopAllowed = new Set()
    this.viewAllowed = new WeakMap()
    this.minted = new Map()
    this.partnerNodeMinted = new Map()
    this.partnerNodeRetryAt = new Map()
    this.minting = new Map()
  }

  tokenFor(view: WebContents, workspaceId: string, gate: Gate = OPEN): Promise<string | null> {
    return this.handOut(view, workspaceId, gate, (fence) => this.workspaceToken(workspaceId, fence))
  }

  partnerNodeTokenFor(
    view: WebContents,
    workspaceId: string,
    gate: Gate = OPEN
  ): Promise<string | null> {
    return this.handOut(view, workspaceId, gate, (fence) =>
      this.partnerNodeToken(workspaceId, fence)
    )
  }

  private async handOut(
    view: WebContents,
    workspaceId: string,
    gate: Gate,
    read: (fence: MintFence) => Promise<HeldToken | null>
  ): Promise<string | null> {
    if (!this.mayHold(view, workspaceId)) return null
    const fence = this.currentFence()
    if (!(await gate()) || !this.isCurrent(fence)) return null
    const held = await read(fence)
    if (!held || !this.isCurrent(fence) || !this.mayHold(view, workspaceId)) return null
    return this.session.currentSubject() === held.subject ? held.token : null
  }

  private currentFence(): MintFence {
    return {
      epoch: this.epoch,
      generation: this.session.currentAuthGeneration(),
      family: this.session.currentGrantFamily()
    }
  }

  private isCurrent(fence: MintFence): boolean {
    return (
      fence.epoch === this.epoch &&
      fence.generation === this.session.currentAuthGeneration() &&
      fence.family === this.session.currentGrantFamily()
    )
  }

  seed(): void {
    if (this.seeded) return
    this.seeded = true
    const current = this.session.currentWorkspaceId()
    if (current) this.desktopAllowed.add(current)
  }

  private mayHold(view: WebContents, workspaceId: string): boolean {
    this.seed()
    if (this.session.currentWorkspaceId() !== workspaceId) return false
    return (
      this.desktopAllowed.has(workspaceId) || this.viewAllowed.get(view)?.has(workspaceId) === true
    )
  }

  private unmintable(grant: string, workspaceId: string, subject: string): HeldToken | null {
    const token =
      workspaceIdOf(grant) === workspaceId ? grant : this.session.heldWorkspaceToken(workspaceId)
    if (!token || canMintWorkspaceTokens(token)) return null
    if (workspaceIdOf(token) !== workspaceId || subjectOf(token) !== subject) return null
    return { token, subject }
  }

  private async workspaceToken(workspaceId: string, fence: MintFence): Promise<HeldToken | null> {
    const accessToken = await this.session.getGrantAccessToken()
    if (!this.isCurrent(fence) || !accessToken) return null
    const subject = subjectOf(accessToken)
    if (!subject) return null
    if (!canMintWorkspaceTokens(accessToken))
      return this.unmintable(accessToken, workspaceId, subject)
    const key = mintKey(subject, workspaceId)
    const cached = this.minted.get(key)
    if (cached && cached.expiresAt - MINT_REFRESH_SKEW_MS > Date.now())
      return { token: cached.token, subject }

    const allowed = await this.session.isWorkspaceMintAllowed(workspaceId)
    if (!allowed || !this.isCurrent(fence)) return null
    const result = await this.once(['workspace', key], fence, () =>
      this.mint(accessToken, workspaceId).then((minted) => {
        reportMint(minted)
        this.endAnEndedGrant(accessToken, minted)
        if (minted.kind === 'failed' && minted.status === 401) this.onUnauthorized(accessToken)
        return minted
      })
    )
    if (!this.isCurrent(fence) || this.session.currentSubject() !== subject) return null
    if (result.kind !== 'minted') return null
    if (
      workspaceIdOf(result.token) !== workspaceId ||
      subjectOf(result.token) !== subject ||
      canMintWorkspaceTokens(result.token)
    )
      return null
    this.minted.set(key, { token: result.token, expiresAt: result.expiresAt })
    return { token: result.token, subject }
  }

  private async partnerNodeToken(workspaceId: string, fence: MintFence): Promise<HeldToken | null> {
    const accessToken = await this.session.getGrantAccessToken()
    if (!this.isCurrent(fence) || !accessToken) return null
    const subject = subjectOf(accessToken)
    if (!subject) return null
    const key = JSON.stringify([subject, grantFamilyOf(accessToken), workspaceId])
    const cached = this.partnerNodeMinted.get(key)
    if (cached && cached.expiresAt - PARTNER_NODE_RENEW_BEFORE_MS > Date.now())
      return { token: cached.token, subject }
    if (Date.now() < (this.partnerNodeRetryAt.get(key) ?? 0)) return this.stillHeld(key, subject)

    const allowed = await this.session.isWorkspaceMintAllowed(workspaceId)
    if (!allowed || !this.isCurrent(fence)) return null
    const result = await this.once(['partner-node', key], fence, () =>
      cached
        ? this.renewOrMint(key, cached.token, accessToken, workspaceId, fence)
        : this.mintPartnerNode(accessToken, workspaceId)
    )
    const usable =
      result.kind === 'minted' &&
      workspaceIdOf(result.token) === workspaceId &&
      subjectOf(result.token) === subject &&
      result.expiresAt - MINT_REFRESH_SKEW_MS > Date.now()
    if (!usable && fence.epoch === this.epoch) {
      const retryAfterMs =
        result.kind === 'failed' && result.retryAfterSeconds !== undefined
          ? result.retryAfterSeconds * 1000
          : 0
      const retryAt = Date.now() + Math.max(PARTNER_NODE_RETRY_MS, retryAfterMs)
      this.partnerNodeRetryAt.set(key, Math.max(retryAt, this.partnerNodeRetryAt.get(key) ?? 0))
      if (cached && !isRetryableFailure(result)) this.forgetPartnerNodeToken(key, cached.token)
    }
    if (!this.isCurrent(fence) || this.session.currentSubject() !== subject) return null
    if (usable) {
      this.partnerNodeRetryAt.delete(key)
      this.partnerNodeMinted.set(key, { token: result.token, expiresAt: result.expiresAt })
      return { token: result.token, subject }
    }
    return this.stillHeld(key, subject)
  }

  private stillHeld(key: string, subject: string): HeldToken | null {
    const held = this.partnerNodeMinted.get(key)
    return held && held.expiresAt - MINT_REFRESH_SKEW_MS > Date.now()
      ? { token: held.token, subject }
      : null
  }

  private async renewOrMint(
    key: string,
    partnerNodeToken: string,
    accessToken: string,
    workspaceId: string,
    fence: MintFence
  ): Promise<WorkspaceTokenMint> {
    const renewed = await this.partnerNode.renew(partnerNodeToken)
    if (renewed.kind === 'minted' && renewed.expiresAt - PARTNER_NODE_RENEW_BEFORE_MS > Date.now())
      return renewed
    if (renewed.kind === 'failed' && !isRetryableFailure(renewed))
      this.forgetPartnerNodeToken(key, partnerNodeToken)
    if (isRetryableFailure(renewed) || !this.isCurrent(fence)) return renewed
    return this.mintPartnerNode(accessToken, workspaceId)
  }

  private async mintPartnerNode(
    accessToken: string,
    workspaceId: string
  ): Promise<WorkspaceTokenMint> {
    const minted = await this.partnerNode.mint(accessToken, workspaceId)
    this.endAnEndedGrant(accessToken, minted)
    return minted
  }

  private endAnEndedGrant(accessToken: string, result: WorkspaceTokenMint): void {
    const outcome = classifyMint(result)
    if (outcome.kind === 'reauthorize' && outcome.reason === 'grant_ended')
      this.session.endGrantFamily(accessToken)
  }

  private forgetPartnerNodeToken(key: string, token: string): void {
    if (this.partnerNodeMinted.get(key)?.token === token) this.partnerNodeMinted.delete(key)
  }

  private once(
    key: readonly string[],
    fence: MintFence,
    start: () => Promise<WorkspaceTokenMint>
  ): Promise<WorkspaceTokenMint> {
    const flight = JSON.stringify([fence.generation, fence.family, ...key])
    const inFlight = this.minting.get(flight)
    if (inFlight) return inFlight
    const minting = this.minting
    const pending = start().finally(() => {
      if (minting.get(flight) === pending) minting.delete(flight)
    })
    minting.set(flight, pending)
    return pending
  }
}

let grants: ViewWorkspaceGrants | null = null

export function getViewWorkspaceGrants(): ViewWorkspaceGrants {
  if (!grants)
    grants = new ViewWorkspaceGrants(getCloudSession(), mintWorkspaceToken, rejectAccessToken)
  return grants
}

export function _resetForTest(): void {
  grants = null
}
