import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  ComfyDesktop2AuthState,
  ComfyDesktopAssetFailure,
  ComfyDesktopHostedAssetsBridge,
  ComfyDesktopHostedAuthBridge,
  ComfyDesktopHostedLocalBridge,
  ComfyDesktopHostedOutputsBridge,
  ComfyDesktopHostedTelemetryBridge,
  ComfyDesktopLocalEvent,
  ComfyDesktopOutputAction
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
  openInComfy: (request) => ipcRenderer.invoke('apps-local:open-in-comfy', request),
  localBuilds: () => ipcRenderer.invoke('apps-local:builds'),
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

const outputs: ComfyDesktopHostedOutputsBridge = {
  showOutput: (request) => ipcRenderer.invoke('apps-outputs:show', request),
  onOutputAction: (callback) => {
    const handler = (_event: IpcRendererEvent, action: ComfyDesktopOutputAction): void =>
      callback(action)
    ipcRenderer.on('apps-outputs:action', handler)
    return () => ipcRenderer.removeListener('apps-outputs:action', handler)
  }
}

const NO_PATH: ComfyDesktopAssetFailure = { error: 'no-path' }

function pathOfFile(file: File): string {
  try {
    return webUtils.getPathForFile(file)
  } catch {
    return ''
  }
}

const assets: ComfyDesktopHostedAssetsBridge = {
  recent: (request) => ipcRenderer.invoke('apps-assets:recent', request),
  fromFile: async (file, request) => {
    const filePath = pathOfFile(file)
    return filePath ? ipcRenderer.invoke('apps-assets:from-path', filePath, request) : NO_PATH
  },
  read: (ref) => ipcRenderer.invoke('apps-assets:read', ref),
  valueFor: (ref, request) => ipcRenderer.invoke('apps-assets:value-for', ref, request)
}

contextBridge.exposeInMainWorld('comfyDesktopAuth', auth)
contextBridge.exposeInMainWorld('comfyDesktopLocal', local)
contextBridge.exposeInMainWorld('comfyDesktopTelemetry', telemetry)
contextBridge.exposeInMainWorld('comfyDesktopOutputs', outputs)
contextBridge.exposeInMainWorld('comfyDesktopAssets', assets)
