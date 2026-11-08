import type { WebContents } from 'electron'

import { canMintWorkspaceTokens, subjectOf, workspaceIdOf } from '../cloud/claims'
import { mintWorkspaceToken } from '../cloud/workspaceToken'
import type { WorkspaceTokenMint } from '../cloud/workspaceToken'
import { getCloudSession } from '../devplatform/session'

const MINT_REFRESH_SKEW_MS = 60_000

export interface GrantSession {
  currentWorkspaceId(): string | null
  currentSubject(): string | null
  getAccessToken(): Promise<string | null>
}

export type MintWorkspaceToken = (
  accessToken: string,
  workspaceId: string
) => Promise<WorkspaceTokenMint>

function mintKey(subject: string, workspaceId: string): string {
  return JSON.stringify([subject, workspaceId])
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
    const epoch = this.epoch
    const held = await this.workspaceToken(workspaceId, epoch)
    if (!held || epoch !== this.epoch || !this.mayHold(view, workspaceId)) return null
    return this.session.currentSubject() === held.subject ? held.token : null
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

  private async workspaceToken(workspaceId: string, epoch: number): Promise<HeldToken | null> {
    const accessToken = await this.session.getAccessToken()
    if (epoch !== this.epoch) return null
    if (!accessToken || workspaceIdOf(accessToken) !== workspaceId) return null
    if (!canMintWorkspaceTokens(accessToken)) return null
    const subject = subjectOf(accessToken)
    if (!subject) return null
    const key = mintKey(subject, workspaceId)
    const cached = this.minted.get(key)
    if (cached && cached.expiresAt - MINT_REFRESH_SKEW_MS > Date.now())
      return { token: cached.token, subject }

    const result = await this.mintOnce(accessToken, key, workspaceId)
    if (epoch !== this.epoch || this.session.currentSubject() !== subject) return null
    if (result.kind !== 'minted') return null
    this.minted.set(key, { token: result.token, expiresAt: result.expiresAt })
    return { token: result.token, subject }
  }

  private mintOnce(
    accessToken: string,
    key: string,
    workspaceId: string
  ): Promise<WorkspaceTokenMint> {
    const inFlight = this.minting.get(key)
    if (inFlight) return inFlight
    const minting = this.minting
    const pending = this.mint(accessToken, workspaceId).finally(() => {
      if (minting.get(key) === pending) minting.delete(key)
    })
    minting.set(key, pending)
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
