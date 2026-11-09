import type { WebContents } from 'electron'

import { canMintWorkspaceTokens, subjectOf } from '../cloud/claims'
import { mintWorkspaceToken } from '../cloud/workspaceToken'
import type { WorkspaceTokenMint } from '../cloud/workspaceToken'
import { getCloudSession } from '../devplatform/session'
import * as mainTelemetry from './telemetry'

const MINT_REFRESH_SKEW_MS = 60_000

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
  currentAuthGeneration(): number
  getGrantAccessToken(): Promise<string | null>
  isWorkspaceMintAllowed(workspaceId: string): Promise<boolean>
}

export type MintWorkspaceToken = (
  accessToken: string,
  workspaceId: string
) => Promise<WorkspaceTokenMint>

function mintKey(subject: string, workspaceId: string): string {
  return JSON.stringify([subject, workspaceId])
}

interface MintFence {
  epoch: number
  generation: number
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
  private minting = new Map<string, Promise<WorkspaceTokenMint>>()

  constructor(
    private readonly session: GrantSession,
    private readonly mint: MintWorkspaceToken = mintWorkspaceToken
  ) {}

  /** Desktop UI (sign-in, dashboard) chose `workspaceId`: every view may hold it. */
  allowDesktop(workspaceId: string | undefined): void {
    this.seed()
    if (workspaceId) this.desktopAllowed.add(workspaceId)
  }

  /** `view` itself asked to switch to `workspaceId`. */
  allowView(view: WebContents, workspaceId: string): void {
    this.seed()
    const allowed = this.viewAllowed.get(view) ?? new Set<string>()
    allowed.add(workspaceId)
    this.viewAllowed.set(view, allowed)
  }

  /** Sign-in or sign-out: forget every allowlist and token, and drop replies in flight. */
  endAll(): void {
    this.epoch += 1
    this.seeded = true
    this.desktopAllowed = new Set()
    this.viewAllowed = new WeakMap()
    this.minted = new Map()
    this.minting = new Map()
  }

  async tokenFor(view: WebContents, workspaceId: string): Promise<string | null> {
    if (!this.mayHold(view, workspaceId)) return null
    const fence = this.currentFence()
    const held = await this.workspaceToken(workspaceId, fence)
    if (!held || !this.isCurrent(fence) || !this.mayHold(view, workspaceId)) return null
    return this.session.currentSubject() === held.subject ? held.token : null
  }

  private currentFence(): MintFence {
    return { epoch: this.epoch, generation: this.session.currentAuthGeneration() }
  }

  private isCurrent(fence: MintFence): boolean {
    return fence.epoch === this.epoch && fence.generation === this.session.currentAuthGeneration()
  }

  private seed(): void {
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

  private async workspaceToken(workspaceId: string, fence: MintFence): Promise<HeldToken | null> {
    const accessToken = await this.session.getGrantAccessToken()
    if (!this.isCurrent(fence) || !accessToken || !canMintWorkspaceTokens(accessToken)) return null
    const subject = subjectOf(accessToken)
    if (!subject) return null
    const key = mintKey(subject, workspaceId)
    const cached = this.minted.get(key)
    if (cached && cached.expiresAt - MINT_REFRESH_SKEW_MS > Date.now())
      return { token: cached.token, subject }

    const allowed = await this.session.isWorkspaceMintAllowed(workspaceId)
    if (!allowed || !this.isCurrent(fence)) return null
    const result = await this.mintOnce(accessToken, key, workspaceId, fence)
    if (!this.isCurrent(fence) || this.session.currentSubject() !== subject) return null
    if (result.kind !== 'minted') return null
    this.minted.set(key, { token: result.token, expiresAt: result.expiresAt })
    return { token: result.token, subject }
  }

  private mintOnce(
    accessToken: string,
    key: string,
    workspaceId: string,
    fence: MintFence
  ): Promise<WorkspaceTokenMint> {
    const flight = JSON.stringify([fence.generation, key])
    const inFlight = this.minting.get(flight)
    if (inFlight) return inFlight
    const minting = this.minting
    const pending = this.mint(accessToken, workspaceId)
      .then((result) => {
        reportMint(result)
        return result
      })
      .finally(() => {
        if (minting.get(flight) === pending) minting.delete(flight)
      })
    minting.set(flight, pending)
    return pending
  }
}

let grants: ViewWorkspaceGrants | null = null

/** The process-wide view grants, bound to the shared CloudSession. */
export function getViewWorkspaceGrants(): ViewWorkspaceGrants {
  if (!grants) grants = new ViewWorkspaceGrants(getCloudSession())
  return grants
}

/** @internal: reset the singleton between tests. */
export function _resetForTest(): void {
  grants = null
}
