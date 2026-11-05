/**
 * Bridge for the hosted Apps page. Exposes only these calls; the Cloud token
 * stays in main, which checks every call comes from the apps origin.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('comfyDesktopApps', {
  version: 1,
  getAuthState: () => ipcRenderer.invoke('comfy-apps:get-auth-state'),
  signIn: () => ipcRenderer.invoke('comfy-apps:sign-in'),
  run: (workflow: unknown) => ipcRenderer.invoke('comfy-apps:run', workflow),
  getRun: (runId: string) => ipcRenderer.invoke('comfy-apps:get-run', runId),
  getOutput: (file: unknown) => ipcRenderer.invoke('comfy-apps:get-output', file),
  uploadImage: (bytes: Uint8Array, name: string) =>
    ipcRenderer.invoke('comfy-apps:upload-image', bytes, name)
})
