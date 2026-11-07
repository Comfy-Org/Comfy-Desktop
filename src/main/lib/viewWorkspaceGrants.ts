/**
 * What a local ComfyUI view may hold, decided in main. A view gets a token only
 * for Desktop's current workspace, only when that workspace is on its
 * allowlist, and only a minted workspace token, never Desktop's OAuth access
 * token. Sign-in and sign-out end every grant, so a reply that lands
 * after them reaches no view.
 */
import type { WebContents } from 'electron'

import { canMintWorkspaceTokens, workspaceIdOf } from '../cloud/claims'
import { mintWorkspaceToken } from '../cloud/workspaceToken'
import type { WorkspaceTokenMint } from '../cloud/workspaceToken'
import { getCloudSession } from '../devplatform/session'

const MINT_REFRESH_SKEW_MS = 60_000

export interface GrantSession {
  currentWorkspaceId(): string | null
  getAccessToken(): Promise<string | null>
}

export type MintWorkspaceToken = (
  accessToken: string,
  workspaceId: string
) => Promise<WorkspaceTokenMint>

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
    const token = await this.workspaceToken(workspaceId, epoch)
    return epoch === this.epoch && this.mayHold(view, workspaceId) ? token : null
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

  private async workspaceToken(workspaceId: string, epoch: number): Promise<string | null> {
    const accessToken = await this.session.getAccessToken()
    if (!accessToken || workspaceIdOf(accessToken) !== workspaceId) return null
    if (!canMintWorkspaceTokens(accessToken)) return null
    const cached = this.minted.get(workspaceId)
    if (cached && cached.expiresAt - MINT_REFRESH_SKEW_MS > Date.now()) return cached.token

    const result = await this.mintOnce(accessToken, workspaceId)
    if (epoch !== this.epoch) return null
    if (result.kind !== 'minted') return null
    this.minted.set(workspaceId, { token: result.token, expiresAt: result.expiresAt })
    return result.token
  }

  private mintOnce(accessToken: string, workspaceId: string): Promise<WorkspaceTokenMint> {
    const inFlight = this.minting.get(workspaceId)
    if (inFlight) return inFlight
    const minting = this.minting
    const pending = this.mint(accessToken, workspaceId).finally(() => {
      if (minting.get(workspaceId) === pending) minting.delete(workspaceId)
    })
    minting.set(workspaceId, pending)
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
