/**
 * Hands Desktop's OAuth session (Flow A, `CloudSession`) to the embedded
 * ComfyUI view, so the view signs in as the Desktop account instead of running
 * its own Firebase sign-in.
 *
 * What crosses to the renderer: a short-lived access token and the identity
 * claims read from it. Never the refresh token. Only a registered comfyView's
 * main frame, still on the origin Desktop loaded into it, and only a loopback
 * ComfyUI or the Cloud issuer, is served; everything else reads `disabled`.
 */
import type { WebContents, WebFrameMain } from 'electron'

import { CLOUD_ISSUER } from '../cloud/config'
import { identityOf } from '../cloud/claims'
import { getCloudSession } from '../devplatform/session'
import { comfyWindows, findEntryByComfySender } from '../host/registry'
import type {
  ComfyDesktop2AuthRefusal,
  ComfyDesktop2AuthState
} from '../../types/comfyDesktopBridge'
import { isEmbeddedOAuthSessionEnabled } from './embeddedAuthFlag'

export const EMBEDDED_AUTH_CHANNELS = {
  getState: 'desktop2-auth:get-state',
  getAccessToken: 'desktop2-auth:get-access-token',
  requestSignIn: 'desktop2-auth:request-sign-in',
  reportRefusal: 'desktop2-auth:report-refusal',
  changed: 'desktop2-auth:changed'
} as const

const DISABLED: ComfyDesktop2AuthState = { status: 'disabled' }
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])
const REFUSALS: ReadonlySet<string> = new Set<ComfyDesktop2AuthRefusal>([
  'unauthorized',
  'sso_required'
])

export interface EmbeddedAuthSender {
  sender: WebContents
  senderFrame: WebFrameMain | null
}

function parseUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** A local ComfyUI on loopback, or Cloud itself. Remote/LAN servers never get the token. */
export function isSessionOrigin(url: string): boolean {
  const parsed = parseUrl(url)
  if (!parsed) return false
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return true
  return parsed.origin === parseUrl(CLOUD_ISSUER)?.origin
}

function sameOrigin(a: string, b: string): boolean {
  const left = parseUrl(a)
  const right = parseUrl(b)
  return left !== null && right !== null && left.origin === right.origin
}

/** The sender is a registered comfyView's main frame, on the origin Desktop loaded into it. */
export function isTrustedEmbeddedSender({ sender, senderFrame }: EmbeddedAuthSender): boolean {
  const entry = findEntryByComfySender(sender)
  if (!entry?.installationId || !entry.comfyUrl) return false
  const mainFrame = sender.mainFrame
  if (
    !senderFrame ||
    senderFrame.processId !== mainFrame.processId ||
    senderFrame.routingId !== mainFrame.routingId
  )
    return false
  return isSessionOrigin(entry.comfyUrl) && sameOrigin(senderFrame.url, entry.comfyUrl)
}

/** The session as any trusted view sees it. Refreshes the access token when due. */
export async function embeddedAuthState(): Promise<ComfyDesktop2AuthState> {
  if (!(await isEmbeddedOAuthSessionEnabled())) return DISABLED
  const token = await getCloudSession().getAccessToken()
  const identity = token ? identityOf(token) : null
  return identity ? { status: 'signed_in', ...identity } : { status: 'signed_out' }
}

export async function stateForSender(event: EmbeddedAuthSender): Promise<ComfyDesktop2AuthState> {
  return isTrustedEmbeddedSender(event) ? embeddedAuthState() : DISABLED
}

export async function accessTokenForSender(event: EmbeddedAuthSender): Promise<string | null> {
  if (!isTrustedEmbeddedSender(event) || !(await isEmbeddedOAuthSessionEnabled())) return null
  return getCloudSession().getAccessToken()
}

/**
 * A trusted view reports that `accessToken` was refused. Desktop re-mints it;
 * when the grant is gone Desktop signs out and `onSignedOut` fans that out.
 */
export async function handleRefusalFromSender(
  event: EmbeddedAuthSender,
  accessToken: unknown,
  reason: unknown,
  onSignedOut: () => void
): Promise<ComfyDesktop2AuthState> {
  if (
    typeof accessToken !== 'string' ||
    typeof reason !== 'string' ||
    !REFUSALS.has(reason) ||
    !isTrustedEmbeddedSender(event) ||
    !(await isEmbeddedOAuthSessionEnabled())
  )
    return stateForSender(event)
  const signedIn = await getCloudSession().revalidate(accessToken)
  if (!signedIn) onSignedOut()
  return stateForSender(event)
}

/** Push the current session to every embedded view Desktop would serve. No-op while disabled. */
export async function broadcastEmbeddedAuthChanged(): Promise<void> {
  const state = await embeddedAuthState()
  if (state.status === 'disabled') return
  for (const entry of comfyWindows.values()) {
    const contents = entry.comfyView.webContents
    if (contents.isDestroyed() || !entry.installationId || !isSessionOrigin(entry.comfyUrl))
      continue
    if (!sameOrigin(contents.getURL(), entry.comfyUrl)) continue
    contents.send(EMBEDDED_AUTH_CHANNELS.changed, state)
  }
}
