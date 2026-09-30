/**
 * IPC for `__comfyDesktop2.Auth`: the embedded ComfyUI view reads Desktop's
 * OAuth session through these channels. Trust and token rules live in
 * `../embeddedAuth`; this file only wires channels to them.
 */
import { ipcMain } from 'electron'

import type { AuthStatus } from '../../cloud'
import type { ComfyDesktop2AuthState } from '../../../types/comfyDesktopBridge'
import {
  EMBEDDED_AUTH_CHANNELS,
  accessTokenForSender,
  handleRefusalFromSender,
  stateForSender
} from '../embeddedAuth'
import { broadcastAuthChanged, signInToCloud } from './registerDevPlatformHandlers'

const SIGNED_OUT: AuthStatus = { signedIn: false }

export function registerEmbeddedAuthHandlers(): void {
  ipcMain.handle(EMBEDDED_AUTH_CHANNELS.getState, (event) => stateForSender(event))

  ipcMain.handle(EMBEDDED_AUTH_CHANNELS.getAccessToken, (event) => accessTokenForSender(event))

  ipcMain.handle(
    EMBEDDED_AUTH_CHANNELS.requestSignIn,
    async (event): Promise<ComfyDesktop2AuthState> => {
      if ((await stateForSender(event)).status === 'disabled') return { status: 'disabled' }
      await signInToCloud()
      return stateForSender(event)
    }
  )

  ipcMain.handle(
    EMBEDDED_AUTH_CHANNELS.reportRefusal,
    (event, accessToken: unknown, reason: unknown) =>
      handleRefusalFromSender(event, accessToken, reason, () => broadcastAuthChanged(SIGNED_OUT))
  )
}
