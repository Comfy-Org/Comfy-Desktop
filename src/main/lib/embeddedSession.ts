/**
 * Shares Desktop's Comfy account session (`CloudSession`) with the hosted
 * local ComfyUI view, so an SSO user (who has no Firebase account) can sign in
 * there and run partner nodes.
 *
 * Only a workspace token minted for the view's allowed workspace and the
 * identity read from Desktop's access token cross to the renderer; the OAuth
 * grant stays in main. Only the main frame of a
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
import { getViewWorkspaceGrants } from './viewWorkspaceGrants'

export const EMBEDDED_SESSION_CHANNELS = {
  getState: 'desktop2-auth:get-state',
  getWorkspaceToken: 'desktop2-auth:get-workspace-token',
  requestSignIn: 'desktop2-auth:request-sign-in',
  signOut: 'desktop2-auth:sign-out',
  switchWorkspace: 'desktop2-auth:switch-workspace',
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
 * The workspace credential for a trusted view: only for Desktop's current
 * workspace, only when it is on that view's allowlist in main, and a minted
 * workspace token rather than Desktop's OAuth access token.
 */
export async function workspaceTokenForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown
): Promise<string | null> {
  if (typeof workspaceId !== 'string' || workspaceId === '') return null
  if (!isTrustedSender(event) || !(await isEmbeddedSessionEnabled())) return null
  return getViewWorkspaceGrants().tokenFor(event.sender, workspaceId)
}

/**
 * Re-scopes Desktop's session to `workspaceId` for a trusted, signed-in view
 * and adds it to that view's allowlist, then reads the state back. Anything
 * else returns its state untouched.
 */
export async function switchWorkspaceForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown,
  switchWorkspace: (workspaceId: string) => Promise<unknown>
): Promise<ComfyDesktop2AuthState> {
  const state = await stateForSender(event)
  if (state.status !== 'signed_in' || typeof workspaceId !== 'string' || workspaceId === '')
    return state
  getViewWorkspaceGrants().allowView(event.sender, workspaceId)
  await switchWorkspace(workspaceId)
  return stateForSender(event)
}

/** Bumped per broadcast, so a slower earlier read never overwrites a newer state. */
let broadcastGeneration = 0

/** Push the current session to every comfyView Desktop would serve. No-op while disabled. */
export async function broadcastEmbeddedSessionChanged(): Promise<void> {
  const generation = ++broadcastGeneration
  const state = await sessionState()
  if (generation !== broadcastGeneration || state.status === 'disabled') return
  for (const entry of comfyWindows.values()) {
    const contents = entry.comfyView.webContents
    if (contents.isDestroyed() || !servesEntry(entry, contents.getURL())) continue
    contents.send(EMBEDDED_SESSION_CHANNELS.changed, state)
  }
}
