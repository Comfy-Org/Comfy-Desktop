import type { WebContents, WebFrameMain } from 'electron'

import { identityOf } from '../cloud/claims'
import { getCloudSession } from '../devplatform/session'
import { isLocalInstall } from '../host/localInstall'
import { comfyWindows, findEntryByComfySender } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import type { ComfyDesktop2AuthState } from '../../types/comfyDesktopBridge'
import { isEmbeddedSessionEnabled } from './embeddedSessionFlag'

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
  if (!isLocalInstall(entry) || !isLoopbackComfyUrl(entry.comfyUrl)) return false
  const expected = originOf(entry.comfyUrl)
  return expected !== null && originOf(currentUrl) === expected
}

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

export async function workspaceTokenForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown
): Promise<string | null> {
  if (typeof workspaceId !== 'string' || workspaceId === '') return null
  const token = await trustedSessionToken(event)
  return token && identityOf(token)?.workspaceId === workspaceId ? token : null
}

async function trustedSessionToken(event: EmbeddedSessionSender): Promise<string | null> {
  if (!isTrustedSender(event) || !(await isEmbeddedSessionEnabled())) return null
  return getCloudSession().getAccessToken()
}

export async function switchWorkspaceForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown,
  switchWorkspace: (workspaceId: string) => Promise<unknown>
): Promise<ComfyDesktop2AuthState> {
  const state = await stateForSender(event)
  if (state.status !== 'signed_in' || typeof workspaceId !== 'string' || workspaceId === '')
    return state
  await switchWorkspace(workspaceId)
  return stateForSender(event)
}

let broadcastGeneration = 0

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
