import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ComfyDesktop2AuthState,
  ComfyDesktopHostedAuthBridge,
  ComfyDesktopHostedLocalBridge,
  ComfyDesktopHostedTelemetryBridge,
  ComfyDesktopLocalEvent
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

const local: ComfyDesktopHostedLocalBridge = {
  getLocal: (want) => ipcRenderer.invoke('apps-local:get', want),
  startLocal: (want) => ipcRenderer.invoke('apps-local:start', want),
  localFetch: (request) => ipcRenderer.invoke('apps-local:fetch', request),
  localDownload: (model) => ipcRenderer.invoke('apps-local:download', model),
  onLocalEvent: (callback) => {
    const handler = (_event: IpcRendererEvent, update: ComfyDesktopLocalEvent): void =>
      callback(update)
    ipcRenderer.on('apps-local:event', handler)
    return () => ipcRenderer.removeListener('apps-local:event', handler)
  }
}

const telemetry: ComfyDesktopHostedTelemetryBridge = {
  track: (name, props) => ipcRenderer.send('apps-telemetry:track', { name, props })
}

contextBridge.exposeInMainWorld('comfyDesktopAuth', auth)
contextBridge.exposeInMainWorld('comfyDesktopLocal', local)
contextBridge.exposeInMainWorld('comfyDesktopTelemetry', telemetry)
