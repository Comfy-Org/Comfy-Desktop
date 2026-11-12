import type { WebContents, WebFrameMain } from 'electron'

import { identityOf } from '../cloud/claims'
import { getCloudSession, rejectAccessToken } from '../devplatform/session'
import { comfyWindows, findEntryByComfySender } from '../host/registry'
import type { ComfyWindowEntry } from '../host/registry'
import type { WorkspaceSwitchOutcome } from '../cloud/types'
import { issueBillingHandoff } from '../cloud/billingHandoff'
import type {
  ComfyDesktop2AuthState,
  ComfyDesktop2BillingHandoff,
  ComfyDesktop2BillingHandoffReceiver
} from '../../types/comfyDesktopBridge'
import { isEmbeddedSessionEnabled } from './embeddedSessionFlag'
import * as mainTelemetry from './telemetry'
import { getViewWorkspaceGrants } from './viewWorkspaceGrants'

export const EMBEDDED_SESSION_DISABLED_EVENT = 'comfy.desktop.auth.embedded_session_disabled'

export const EMBEDDED_SESSION_CHANNELS = {
  getState: 'desktop2-auth:get-state',
  getWorkspaceToken: 'desktop2-auth:get-workspace-token',
  getPartnerNodeToken: 'desktop2-auth:get-partner-node-token',
  requestSignIn: 'desktop2-auth:request-sign-in',
  signOut: 'desktop2-auth:sign-out',
  switchWorkspace: 'desktop2-auth:switch-workspace',
  issueBillingHandoff: 'desktop2-auth:issue-billing-handoff',
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

let disabledReported = false

function reportDisabledOncePerProcess(): void {
  if (disabledReported) return
  disabledReported = true
  mainTelemetry.emit(EMBEDDED_SESSION_DISABLED_EVENT)
}

async function enabledForLocalView(): Promise<boolean> {
  const enabled = await isEmbeddedSessionEnabled()
  if (!enabled) reportDisabledOncePerProcess()
  return enabled
}

async function sessionState(
  enabled: () => Promise<boolean> = isEmbeddedSessionEnabled
): Promise<ComfyDesktop2AuthState> {
  if (!(await enabled())) return DISABLED
  const session = getCloudSession()
  const grant = await session.getGrantAccessToken()
  const identity = grant ? identityOf(grant) : null
  if (!identity) return { status: 'signed_out' }
  const { userId, email } = identity
  const workspaceId = session.currentWorkspaceId()
  return {
    status: 'signed_in',
    userId,
    ...(email ? { email } : {}),
    ...(workspaceId ? { workspaceId } : {})
  }
}

export async function stateForSender(
  event: EmbeddedSessionSender
): Promise<ComfyDesktop2AuthState> {
  return isTrustedSender(event) ? sessionState(enabledForLocalView) : DISABLED
}

export async function workspaceTokenForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown
): Promise<string | null> {
  if (typeof workspaceId !== 'string' || workspaceId === '') return null
  if (!isTrustedSender(event)) return null
  return getViewWorkspaceGrants().tokenFor(event.sender, workspaceId, enabledForLocalView)
}

export async function partnerNodeTokenForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown
): Promise<string | null> {
  if (typeof workspaceId !== 'string' || workspaceId === '') return null
  if (!isTrustedSender(event)) return null
  return getViewWorkspaceGrants().partnerNodeTokenFor(
    event.sender,
    workspaceId,
    enabledForLocalView
  )
}

export async function switchWorkspaceForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown,
  switchWorkspace: (workspaceId: string) => Promise<WorkspaceSwitchOutcome>
): Promise<ComfyDesktop2AuthState> {
  const state = await stateForSender(event)
  if (state.status !== 'signed_in' || typeof workspaceId !== 'string' || workspaceId === '')
    return state
  const grants = getViewWorkspaceGrants()
  grants.seed()
  const { reached } = await switchWorkspace(workspaceId)
  if (reached) grants.allowView(event.sender, workspaceId)
  return stateForSender(event)
}

const BILLING_HANDOFF_RECEIVERS: ReadonlySet<unknown> =
  new Set<ComfyDesktop2BillingHandoffReceiver>(['billing_web', 'platform'])

function isBillingHandoffReceiver(value: unknown): value is ComfyDesktop2BillingHandoffReceiver {
  return BILLING_HANDOFF_RECEIVERS.has(value)
}

export async function billingHandoffForSender(
  event: EmbeddedSessionSender,
  workspaceId: unknown,
  receiver: unknown,
  clientVersion: string
): Promise<ComfyDesktop2BillingHandoff> {
  if (typeof workspaceId !== 'string' || workspaceId === '' || !isBillingHandoffReceiver(receiver))
    return { status: 'disabled' }
  if (!isTrustedSender(event)) return { status: 'disabled' }
  const grants = getViewWorkspaceGrants()
  if (!grants.mayHold(event.sender, workspaceId) || !(await enabledForLocalView()))
    return { status: 'disabled' }
  const accessToken = await getCloudSession().getGrantAccessToken()
  if (!accessToken) return { status: 'sign_in_again' }
  const handoff = await issueBillingHandoff(accessToken, { workspaceId, receiver, clientVersion })
  if (handoff.status === 'sign_in_again') rejectAccessToken(accessToken)
  return grants.mayHold(event.sender, workspaceId) ? handoff : { status: 'disabled' }
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

export function _resetForTest(): void {
  disabledReported = false
}
