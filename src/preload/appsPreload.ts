import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const BRIDGE = 3
const CALLS = [
  'getInfo',
  'getAuthState',
  'signIn',
  'run',
  'getRun',
  'getOutput',
  'uploadImage',
  'uploadFile',
  'saveFile',
  'readSaved',
  'showInFolder',
  'saveVersions',
  'readVersions',
  'getNodePrice',
  'getLocal',
  'startLocal',
  'cancelSetup',
  'localBuilds',
  'localFetch',
  'onLocalEvent',
  'localDownload',
  'cancelRun',
  'openInComfy',
  'track'
]

contextBridge.exposeInMainWorld('comfyDesktopApps', {
  getInfo: () => ({ bridge: BRIDGE, calls: CALLS }),
  getAuthState: () => ipcRenderer.invoke('comfy-apps:get-auth-state'),
  signIn: () => ipcRenderer.invoke('comfy-apps:sign-in'),
  run: (workflow: unknown, app?: { app: string; model?: string }) =>
    app === undefined
      ? ipcRenderer.invoke('comfy-apps:run', workflow)
      : ipcRenderer.invoke('comfy-apps:run', workflow, app),
  getRun: (runId: string) => ipcRenderer.invoke('comfy-apps:get-run', runId),
  cancelRun: (runId: string) => ipcRenderer.invoke('comfy-apps:cancel-run', runId),
  openInComfy: (req: { prompt: unknown; where: 'local' | 'cloud'; name: string; build?: string }) =>
    ipcRenderer.invoke('comfy-apps:open-in-comfy', req),
  getOutput: (file: unknown, save?: { app: string; label: string }) =>
    save === undefined
      ? ipcRenderer.invoke('comfy-apps:get-output', file)
      : ipcRenderer.invoke('comfy-apps:get-output', file, save),
  uploadImage: (bytes: Uint8Array, name: string) =>
    ipcRenderer.invoke('comfy-apps:upload-image', bytes, name),
  uploadFile: (bytes: Uint8Array, name: string) =>
    ipcRenderer.invoke('comfy-apps:upload-image', bytes, name),
  saveFile: (bytes: Uint8Array, app: string, label: string, ext: string) =>
    ipcRenderer.invoke('comfy-apps:save-file', bytes, app, label, ext),
  readSaved: (path: string) => ipcRenderer.invoke('comfy-apps:read-saved', path),
  showInFolder: (path: string) => ipcRenderer.invoke('comfy-apps:show-in-folder', path),
  saveVersions: (app: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('comfy-apps:save-versions', app, bytes),
  readVersions: (app: string) => ipcRenderer.invoke('comfy-apps:read-versions', app),
  getNodePrice: (node: string) => ipcRenderer.invoke('comfy-apps:get-node-price', node),
  getLocal: (want?: { minVersion?: string }) => ipcRenderer.invoke('comfy-apps:get-local', want),
  startLocal: (want?: { minVersion?: string }) =>
    ipcRenderer.invoke('comfy-apps:start-local', want),
  cancelSetup: () => ipcRenderer.invoke('comfy-apps:cancel-setup'),
  localBuilds: () => ipcRenderer.invoke('comfy-apps:local-builds'),
  localFetch: (req: { method: string; path: string; body?: unknown; fileName?: string }) =>
    ipcRenderer.invoke('comfy-apps:local-fetch', req),
  localDownload: (req: { url: string; folder: string; name: string }) =>
    ipcRenderer.invoke('comfy-apps:local-download', req),
  track: (name: string, fields?: Record<string, unknown>): void => {
    try {
      ipcRenderer.invoke('comfy-apps:track', name, fields).catch(() => {})
    } catch {}
  },
  onLocalEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, msg: unknown) => callback(msg)
    ipcRenderer.on('comfy-apps:local-event', listener)
    return () => {
      ipcRenderer.removeListener('comfy-apps:local-event', listener)
    }
  }
})
