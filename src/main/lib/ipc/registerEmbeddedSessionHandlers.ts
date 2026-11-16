import { app, ipcMain } from 'electron'

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
import { signInToCloud, signOutOfCloud, switchCloudWorkspace } from './registerDevPlatformHandlers'

export function registerEmbeddedSessionHandlers(): void {
  ipcMain.handle(EMBEDDED_SESSION_CHANNELS.getState, (event) => stateForSender(event))

  ipcMain.handle(EMBEDDED_SESSION_CHANNELS.getWorkspaceToken, (event, workspaceId: unknown) =>
    workspaceTokenForSender(event, workspaceId)
  )

  ipcMain.handle(EMBEDDED_SESSION_CHANNELS.getPartnerNodeToken, (event, workspaceId: unknown) =>
    partnerNodeTokenForSender(event, workspaceId)
  )

  ipcMain.handle(
    EMBEDDED_SESSION_CHANNELS.requestSignIn,
    async (event): Promise<ComfyDesktop2AuthState> => {
      if ((await stateForSender(event)).status === 'disabled') return { status: 'disabled' }
      return reportHostSignIn(async () => {
        await signInToCloud()
        return stateForSender(event)
      })
    }
  )

  ipcMain.handle(
    EMBEDDED_SESSION_CHANNELS.signOut,
    async (event): Promise<ComfyDesktop2AuthState> => {
      const state = await stateForSender(event)
      if (state.status === 'disabled' || !isTrustedSender(event)) return state
      await signOutOfCloud(findEntryByComfySender(event.sender) ?? undefined)
      return stateForSender(event)
    }
  )

  ipcMain.handle(EMBEDDED_SESSION_CHANNELS.switchWorkspace, (event, workspaceId: unknown) =>
    switchWorkspaceForSender(event, workspaceId, (id) => switchCloudWorkspace(id, 'requested'))
  )

  ipcMain.handle(
    EMBEDDED_SESSION_CHANNELS.issueBillingHandoff,
    (event, workspaceId: unknown, receiver: unknown, intent: unknown, amountCents: unknown) =>
      billingHandoffForSender(event, workspaceId, receiver, intent, amountCents, app.getVersion())
  )
}
