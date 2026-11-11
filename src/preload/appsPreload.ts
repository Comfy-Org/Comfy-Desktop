import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const BRIDGE = 2
const SETTLE_QUIET_MS = 400
const SETTLE_MAX_MS = 3000
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
  'openInComfy'
]

contextBridge.exposeInMainWorld('comfyDesktopApps', {
  getInfo: () => ({ bridge: BRIDGE, calls: CALLS }),
  getAuthState: () => ipcRenderer.invoke('comfy-apps:get-auth-state'),
  signIn: () => ipcRenderer.invoke('comfy-apps:sign-in'),
  run: (workflow: unknown) => ipcRenderer.invoke('comfy-apps:run', workflow),
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
  getLocal: () => ipcRenderer.invoke('comfy-apps:get-local'),
  startLocal: () => ipcRenderer.invoke('comfy-apps:start-local'),
  cancelSetup: () => ipcRenderer.invoke('comfy-apps:cancel-setup'),
  localBuilds: () => ipcRenderer.invoke('comfy-apps:local-builds'),
  localFetch: (req: { method: string; path: string; body?: unknown; fileName?: string }) =>
    ipcRenderer.invoke('comfy-apps:local-fetch', req),
  localDownload: (req: { url: string; folder: string; name: string }) =>
    ipcRenderer.invoke('comfy-apps:local-download', req),
  onLocalEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, msg: unknown) => callback(msg)
    ipcRenderer.on('comfy-apps:local-event', listener)
    return () => {
      ipcRenderer.removeListener('comfy-apps:local-event', listener)
    }
  }
})

function reportWhenSettled(): void {
  let quiet: ReturnType<typeof setTimeout> | undefined
  const settle = (): void => {
    clearTimeout(quiet)
    clearTimeout(cap)
    observer.disconnect()
    ipcRenderer.send('comfy-apps:page-settled')
  }
  const wait = (): void => {
    clearTimeout(quiet)
    quiet = setTimeout(settle, SETTLE_QUIET_MS)
  }
  const observer = new MutationObserver(wait)
  const cap = setTimeout(settle, SETTLE_MAX_MS)
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true
  })
  wait()
}

window.addEventListener('DOMContentLoaded', reportWhenSettled, { once: true })
