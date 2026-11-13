import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ComfyDesktop2AuthState,
  ComfyDesktopHostedAuthBridge
} from '../types/comfyDesktopBridge'

const auth: ComfyDesktopHostedAuthBridge = {
  getState: () => ipcRenderer.invoke('desktop2-auth:get-state'),
  getWorkspaceToken: (workspaceId) =>
    ipcRenderer.invoke('desktop2-auth:get-workspace-token', workspaceId),
  getPartnerNodeToken: (workspaceId) =>
    ipcRenderer.invoke('desktop2-auth:get-partner-node-token', workspaceId),
  requestSignIn: () => ipcRenderer.invoke('desktop2-auth:request-sign-in'),
  onChanged: (callback) => {
    const handler = (_event: IpcRendererEvent, state: ComfyDesktop2AuthState): void =>
      callback(state)
    ipcRenderer.on('desktop2-auth:changed', handler)
    return () => ipcRenderer.removeListener('desktop2-auth:changed', handler)
  }
}

contextBridge.exposeInMainWorld('comfyDesktopAuth', auth)
