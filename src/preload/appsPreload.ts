/**
 * Bridge for the hosted Apps page. Exposes only these calls; the Cloud token
 * stays in main, which checks every call comes from the apps origin.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

// The bridge's version and the calls it has. Old Desktops stay installed for months while the
// page deploys daily, so the page asks before it uses a call ("Update Comfy Desktop to use
// this app"). Raise BRIDGE when a call changes shape; adding a call only adds to CALLS.
const BRIDGE = 1
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
  'localFetch',
  'onLocalEvent',
  'localDownload',
  'cancelRun'
]

contextBridge.exposeInMainWorld('comfyDesktopApps', {
  getInfo: () => ({ bridge: BRIDGE, calls: CALLS }),
  getAuthState: () => ipcRenderer.invoke('comfy-apps:get-auth-state'),
  signIn: () => ipcRenderer.invoke('comfy-apps:sign-in'),
  run: (workflow: unknown) => ipcRenderer.invoke('comfy-apps:run', workflow),
  getRun: (runId: string) => ipcRenderer.invoke('comfy-apps:get-run', runId),
  // Ask Cloud to stop a run: { ok, status }; 200 also for a run already over, 404 for an unknown one.
  cancelRun: (runId: string) => ipcRenderer.invoke('comfy-apps:cancel-run', runId),
  // Bytes of an output, also saved to <outputDir>/apps/<app>/; save = { app, label }.
  getOutput: (file: unknown, save: { app: string; label: string }) =>
    ipcRenderer.invoke('comfy-apps:get-output', file, save),
  uploadImage: (bytes: Uint8Array, name: string) =>
    ipcRenderer.invoke('comfy-apps:upload-image', bytes, name),
  // Any input file: an image or a video (the same upload).
  uploadFile: (bytes: Uint8Array, name: string) =>
    ipcRenderer.invoke('comfy-apps:upload-image', bytes, name),
  saveFile: (bytes: Uint8Array, app: string, label: string, ext: string) =>
    ipcRenderer.invoke('comfy-apps:save-file', bytes, app, label, ext),
  readSaved: (path: string) => ipcRenderer.invoke('comfy-apps:read-saved', path),
  showInFolder: (path: string) => ipcRenderer.invoke('comfy-apps:show-in-folder', path),
  // The app's versions index, kept as <outputDir>/apps/<app>/versions.json; main names the file.
  saveVersions: (app: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('comfy-apps:save-versions', app, bytes),
  readVersions: (app: string) => ipcRenderer.invoke('comfy-apps:read-versions', app),
  // What Cloud says a node costs (its price_badge), so a choice can show a price per option.
  getNodePrice: (node: string) => ipcRenderer.invoke('comfy-apps:get-node-price', node),
  // The person's own ComfyUI that Desktop runs on this computer: { state, name?, clientId? }.
  getLocal: () => ipcRenderer.invoke('comfy-apps:get-local'),
  // Starts the default local install as the dashboard's Launch does; resolves once it answers.
  startLocal: () => ipcRenderer.invoke('comfy-apps:start-local'),
  // One call to it, from main's short list: { method, path, body?, fileName? } -> { status, contentType, body }.
  localFetch: (req: { method: string; path: string; body?: unknown; fileName?: string }) =>
    ipcRenderer.invoke('comfy-apps:local-fetch', req),
  // A model from huggingface.co into the install's models folder: { url, folder, name } ->
  // { state: 'done' } or { state: 'failed', error }. Progress comes through onLocalEvent as type 'download'.
  localDownload: (req: { url: string; folder: string; name: string }) =>
    ipcRenderer.invoke('comfy-apps:local-download', req),
  // Its run messages ({ type, data }) and model downloads ({ type: 'download', data }) as they
  // arrive; returns the call that stops them.
  onLocalEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: IpcRendererEvent, msg: unknown) => callback(msg)
    ipcRenderer.on('comfy-apps:local-event', listener)
    return () => {
      ipcRenderer.removeListener('comfy-apps:local-event', listener)
    }
  }
})
