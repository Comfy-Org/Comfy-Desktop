/**
 * ComfyBuilder auth IPC bridge — main process only.
 *
 * This is the ONLY bridge between the renderer UI and main-process auth. It
 * exposes the signed-in status and lets the renderer trigger sign-in/out, but
 * access/refresh tokens NEVER cross the IPC boundary: handlers return and
 * broadcast a renderer-safe {@link AuthStatus}, and tokens stay in the main
 * process (persisted encrypted by `tokenStore`).
 */
import { BrowserWindow, ipcMain } from 'electron'

import { signIn } from './oauth'
import { clearTokens, getAuthStatus, saveTokens } from './tokenStore'
import type { AuthStatus } from './types'

/** IPC channels for the ComfyBuilder auth bridge. Kept together so a rename can't desync. */
export const COMFYBUILDER_AUTH_CHANNELS = {
  signIn: 'comfybuilder:signIn',
  signOut: 'comfybuilder:signOut',
  getAuthStatus: 'comfybuilder:getAuthStatus',
  authChanged: 'comfybuilder:authChanged',
} as const

/** The renderer-safe status returned and broadcast on sign-out. */
const SIGNED_OUT: AuthStatus = { signedIn: false }

/**
 * Push the renderer-safe {@link AuthStatus} to every open window so all
 * surfaces update in lockstep. Only the status (never tokens) is sent.
 */
function broadcastAuthChanged(status: AuthStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(COMFYBUILDER_AUTH_CHANNELS.authChanged, status)
  }
}

/**
 * Register the ComfyBuilder auth IPC handlers. Call once at startup.
 *
 * The renderer can never pass a token in or read one out: `signIn` takes no
 * arguments and returns only the status; the tokens it obtains are persisted
 * main-side via `saveTokens`.
 */
export function registerComfybuilderAuthIpc(): void {
  // Run the PKCE browser flow, persist the tokens main-side, and hand back only
  // the renderer-safe status. Tokens never leave the main process.
  ipcMain.handle(COMFYBUILDER_AUTH_CHANNELS.signIn, async (): Promise<AuthStatus> => {
    const { tokens, status } = await signIn()
    saveTokens(tokens)
    broadcastAuthChanged(status)
    return status
  })

  // Forget the stored tokens and tell every window the session ended.
  ipcMain.handle(COMFYBUILDER_AUTH_CHANNELS.signOut, (): AuthStatus => {
    clearTokens()
    broadcastAuthChanged(SIGNED_OUT)
    return SIGNED_OUT
  })

  // Read-only status derived from the stored access-token claims.
  ipcMain.handle(COMFYBUILDER_AUTH_CHANNELS.getAuthStatus, (): AuthStatus => getAuthStatus())
}
