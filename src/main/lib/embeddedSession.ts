/**
 * Shares Desktop's Comfy account session (`CloudSession`) with the hosted
 * local ComfyUI view, so an SSO user (who has no Firebase account) can sign in
 * there and run partner nodes.
 *
 * Only a short-lived access token and the identity read from it cross to the
 * renderer; the refresh token stays in main. Only the main frame of a
 * registered comfyView, still on the loopback ComfyUI Desktop loaded into it,
 * is served. Remote and LAN servers never receive the token.
 */
import type { WebContents, WebFrameMain } from 'electron'

import { identityOf } from '../cloud/claims'
import { getCloudSession } from '../devplatform/session'
import { comfyWindows, findEntryByComfySender } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import type { ComfyDesktop2AuthState } from '../../types/comfyDesktopBridge'
import { isEmbeddedSessionEnabled } from './embeddedSessionFlag'

export const EMBEDDED_SESSION_CHANNELS = {
  getState: 'desktop2-auth:get-state',
  getWorkspaceToken: 'desktop2-auth:get-workspace-token',
  getIdentityToken: 'desktop2-auth:get-identity-token',
  requestSignIn: 'desktop2-auth:request-sign-in',
  signOut: 'desktop2-auth:sign-out',
  changed: 'desktop2-auth:changed'
} as const

const DISABLED: ComfyDesktop2AuthState = { status: 'disabled' }
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])

export interface EmbeddedSessionSender {
  sender: WebContents
  senderFrame: WebFrameMain | null
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function isLoopbackComfyUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

function servesEntry(entry: ComfyWindowEntry, currentUrl: string): boolean {
  if (!entry.installationId || !isLoopbackComfyUrl(entry.comfyUrl)) return false
  const expected = originOf(entry.comfyUrl)
  return expected !== null && originOf(currentUrl) === expected
}

/** The sender is the main frame of a registered comfyView, on its own loopback ComfyUI. */
export function isTrustedSender({ sender, senderFrame }: EmbeddedSessionSender): boolean {
  const entry = findEntryByComfySender(sender)
  if (!entry || !senderFrame) return false
  const mainFrame = sender.mainFrame
  if (
    senderFrame.processId !== mainFrame.processId ||
    senderFrame.routingId !== mainFrame.routingId
  )
    return false
  return servesEntry(entry, senderFrame.url)
}

async function sessionState(): Promise<ComfyDesktop2AuthState> {
  if (!(await isEmbeddedSessionEnabled())) return DISABLED
  const token = await getCloudSession().getAccessToken()
  const identity = token ? identityOf(token) : null
  return identity ? { status: 'signed_in', ...identity } : { status: 'signed_out' }
}

export async function stateForSender(
  event: EmbeddedSessionSender
): Promise<ComfyDesktop2AuthState> {
  return isTrustedSender(event) ? sessionState() : DISABLED
}

/**
 * The workspace credential for a trusted view: released only for an exact,
 * non-empty workspace that Desktop's session is scoped to. Absent, malformed
 * or mismatched scope gets nothing, so a view never runs as a workspace it
 * did not name.
 */
export async function workspaceTokenForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown
): Promise<string | null> {
  if (typeof workspaceId !== 'string' || workspaceId === '') return null
  const token = await trustedSessionToken(event)
  return token && identityOf(token)?.workspaceId === workspaceId ? token : null
}

/**
 * The account token for user-identity calls that name no workspace (account
 * and workspace listing). Never the credential for API-node execution.
 */
export function identityTokenForSender(event: EmbeddedSessionSender): Promise<string | null> {
  return trustedSessionToken(event)
}

async function trustedSessionToken(event: EmbeddedSessionSender): Promise<string | null> {
  if (!isTrustedSender(event) || !(await isEmbeddedSessionEnabled())) return null
  return getCloudSession().getAccessToken()
}

/** Push the current session to every comfyView Desktop would serve. No-op while disabled. */
export async function broadcastEmbeddedSessionChanged(): Promise<void> {
  const state = await sessionState()
  if (state.status === 'disabled') return
  for (const entry of comfyWindows.values()) {
    const contents = entry.comfyView.webContents
    if (contents.isDestroyed() || !servesEntry(entry, contents.getURL())) continue
    contents.send(EMBEDDED_SESSION_CHANNELS.changed, state)
  }
}
