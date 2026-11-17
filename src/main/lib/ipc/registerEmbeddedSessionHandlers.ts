import { app } from 'electron'

import { findEntryByComfySender } from '../../host/registry'
import type { ComfyDesktop2AuthState } from '../../../types/comfyDesktopBridge'
import {
  billingHandoffForSender,
  EMBEDDED_SESSION_CHANNELS,
  isTrustedSender,
  partnerNodeTokenForSender,
  stateForSender,
  switchWorkspaceForSender,
  workspaceTokenForSender
} from '../embeddedSession'
import { reportHostSignIn } from '../hostSignInTelemetry'
import { handleBridge } from './comfyBridge'
import { signInToCloud, signOutOfCloud, switchCloudWorkspace } from './registerDevPlatformHandlers'

const DISABLED: ComfyDesktop2AuthState = { status: 'disabled' }

export function registerEmbeddedSessionHandlers(): void {
  handleBridge(EMBEDDED_SESSION_CHANNELS.getState, DISABLED, (event) => stateForSender(event))

  handleBridge(EMBEDDED_SESSION_CHANNELS.getWorkspaceToken, null, (event, workspaceId: unknown) =>
    workspaceTokenForSender(event, workspaceId)
  )

  handleBridge(EMBEDDED_SESSION_CHANNELS.getPartnerNodeToken, null, (event, workspaceId: unknown) =>
    partnerNodeTokenForSender(event, workspaceId)
  )

  handleBridge(
    EMBEDDED_SESSION_CHANNELS.requestSignIn,
    DISABLED,
    async (event): Promise<ComfyDesktop2AuthState> => {
      if ((await stateForSender(event)).status === 'disabled') return { status: 'disabled' }
      return reportHostSignIn(async () => {
        await signInToCloud()
        return stateForSender(event)
      })
    }
  )

  handleBridge(
    EMBEDDED_SESSION_CHANNELS.signOut,
    DISABLED,
    async (event): Promise<ComfyDesktop2AuthState> => {
      const state = await stateForSender(event)
      if (state.status === 'disabled' || !isTrustedSender(event)) return state
      await signOutOfCloud(findEntryByComfySender(event.sender) ?? undefined)
      return stateForSender(event)
    }
  )

  handleBridge(EMBEDDED_SESSION_CHANNELS.switchWorkspace, DISABLED, (event, workspaceId: unknown) =>
    switchWorkspaceForSender(event, workspaceId, (id) => switchCloudWorkspace(id, 'requested'))
  )

  handleBridge(
    EMBEDDED_SESSION_CHANNELS.issueBillingHandoff,
    { status: 'disabled' },
    (event, workspaceId: unknown, receiver: unknown, intent: unknown, amountCents: unknown) =>
      billingHandoffForSender(event, workspaceId, receiver, intent, amountCents, app.getVersion())
  )
}
