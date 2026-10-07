/**
 * IPC for `__comfyDesktop2.Auth`. Trust and token rules live in
 * `../embeddedSession`; this file only wires the channels.
 */
import { ipcMain } from 'electron'

import { findEntryByComfySender } from '../../host/registry'
import type { ComfyDesktop2AuthState } from '../../../types/comfyDesktopBridge'
import { EMBEDDED_SESSION_CHANNELS, accessTokenForSender, stateForSender } from '../embeddedSession'
import { signInToCloud, signOutOfCloud } from './registerDevPlatformHandlers'

export function registerEmbeddedSessionHandlers(): void {
  ipcMain.handle(EMBEDDED_SESSION_CHANNELS.getState, (event) => stateForSender(event))

  ipcMain.handle(EMBEDDED_SESSION_CHANNELS.getAccessToken, (event) => accessTokenForSender(event))

  ipcMain.handle(
    EMBEDDED_SESSION_CHANNELS.requestSignIn,
    async (event): Promise<ComfyDesktop2AuthState> => {
      if ((await stateForSender(event)).status === 'disabled') return { status: 'disabled' }
      await signInToCloud()
      return stateForSender(event)
    }
  )

  ipcMain.handle(
    EMBEDDED_SESSION_CHANNELS.signOut,
    async (event): Promise<ComfyDesktop2AuthState> => {
      if ((await stateForSender(event)).status === 'disabled') return { status: 'disabled' }
      await signOutOfCloud(findEntryByComfySender(event.sender) ?? undefined)
      return stateForSender(event)
    }
  )
}
